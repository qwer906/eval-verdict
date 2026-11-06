# eval-verdict 설계

LLM 평가를 여러 번 돌린 결과 파일을 읽고, 머지를 막을지 말지를 **PASS / FAIL / ERROR** 하나로 정하는 TypeScript CLI·라이브러리다. 평가를 직접 돌리지는 않는다. 판정만 한다.

이 문서가 구현의 기준이다. 코드와 이 문서가 다르면 둘 중 하나를 고치고, 이유를 커밋 본문에 적는다.

## 1. 푸는 문제

같은 코드로 돌려도 LLM 평가 점수는 매번 달라진다. 평가 결과로 머지를 막으려면 세 가지를 정해야 한다. 이 도구는 비공개 팀 프로젝트에서 2026년 8월부터 운영한 평가 게이트의 판정 부분을 떼어 낸 것이고, 아래 셋은 그 게이트에서 실제로 겪은 일이다.

- **몇 번 중 몇 번 통과해야 하나.** 코드를 바꾸지 않은 브랜치에서도 7번 중 1번 FAIL이 났다. 한 번의 결과로 막으면 멀쩡한 PR이 막힌다.
- **못 잰 것과 떨어진 것을 어떻게 가르나.** 일부 run이 무너졌는데 남은 표본만으로 PASS가 나온 적이 있다. 이건 통과가 아니라 측정 실패다.
- **임계를 바꿔도 되는지 어떻게 아나.** 임계를 85에서 80으로 내리기 전에, 과거 PASS 35건 중 뒤집히는 판정이 몇 건인지 먼저 셌다(0건).

대가도 있다. "2번 중 1번만 통과하면 PASS"로 두면 80% 확률로 나타나는 회귀는 36% 확률로 그냥 통과한다. 이 규칙은 큰 회귀를 막는 용도이고, 작은 회귀는 더 큰 표본의 정기 평가가 맡는다.

## 2. 기존 도구와 차이

| 도구 | 여러 번 돌린 결과 | 못 잰 것 vs 떨어진 것 | 판정 방식 |
|---|---|---|---|
| `claude plugin eval` | run 점수의 평균을 임계와 비교 | 둘 다 exit 1 (케이스 로드 실패, API 오류 포함) | 자동 |
| toss/frontend-fundamentals 플러그인 eval | "3번 중 2번 이상 PASS" | 규칙 없음 | 사람이 markdown에 기록 |
| 토스 「Skill 품질 루브릭」 | 반복 시도 언급 없음 (규칙 기반 채점) | F 하나로 머지 차단 | 자동 (GitHub Actions) |
| **eval-verdict** | 케이스마다 n번 중 k번 | ERROR(exit 2)로 분리 | 자동. 다른 도구의 결과 파일을 읽기만 함 |

`claude plugin eval` 문서는 결과 JSON을 읽는 gating script를 직접 언급한다. 이 도구가 그 자리를 채운다.

## 3. 판정

### 결과 세 가지

| 판정 | exit | 뜻 |
|---|---|---|
| PASS | 0 | 모든 케이스가 잰 trial 중 k번 이상 통과했다 |
| FAIL | 1 | 다 쟀는데 통과한 trial이 k번보다 적은 케이스가 있다 |
| ERROR | 2 | 판정할 만큼 재지 못했다, 또는 입력이 잘못됐다 |

### 순서

1. **파일 검사.** 문제는 처음 하나에서 멈추지 않고 전부 모은다. 하나라도 있으면 ERROR.
   - 설정 파일: 모르는 키는 오류다. `minPasingTrials` 같은 오타가 조용히 기본값으로 돌아가면 게이트가 몰래 약해진다.
   - 결과 파일: 모르는 키는 무시한다. 평가 쪽이 커밋 SHA 같은 메타데이터를 붙여도 깨지지 않게.
2. **못 잰 것 모으기 (ERROR 후보).**
   - 설정에 `model`이 있는데 결과의 `model`이 다르거나 없다.
   - 케이스 수가 `minCases`보다 적다.
   - 설정 `cases`에 이름을 적은 케이스가 결과에 없다.
   - 설정 `guards`에 적은 표본 수가 결과 `samples`에 없거나, 범위 밖이거나, `null`이다.
   - 케이스의 잰 trial(`null`이 아닌 것)이 `minTrials`보다 적다.
3. **잰 것 판정 (FAIL 후보).** 케이스마다 통과 범위 `pass`에 든 trial 수를 세서 `minPassingTrials`와 비교한다. 범위는 양 끝을 포함한다.
4. **경고.** 판정은 바꾸지 않는다.
   - trial끼리 엇갈렸다(일부만 통과).
   - 기준선(`baseline`, 변경 없이 돌린 결과)도 같은 비율 이상으로 통과한다. 이 케이스는 변경의 효과를 보여 주지 못한다.
5. **한 비트로 합치기.** ERROR가 하나라도 있으면 ERROR, 아니면 FAIL이 하나라도 있으면 FAIL, 아니면 PASS. 못 잰 상태에서 나온 FAIL은 회귀인지 인프라 고장인지 알려 주지 않으므로 ERROR를 앞에 둔다.

판정 함수 `judge(config, report)`는 순수 함수다. 파일, 네트워크, 시계를 건드리지 않는다. 읽고 쓰는 일은 CLI만 한다.

## 4. 입력 형식

### 결과 파일 (평가를 돌린 쪽이 만든다)

```json
{
  "model": "grader-model-a",
  "cases": [
    { "id": "answer-accuracy", "trials": [92.5, 90.0] },
    { "id": "false-correct-pct", "trials": [2.2, 14.0] },
    { "id": "unrelated-false-correct", "trials": [0] },
    { "id": "format-kept", "trials": [100, null], "baseline": [100, 100] }
  ],
  "samples": { "graded-points": 430, "swap-points": 60 }
}
```

- `trials`: 같은 케이스를 run마다 잰 값. `null`은 "못 쟀다"이고 0(떨어짐)과 다르다.
- 합산 지표(여러 run을 더한 개수 등)는 trial 하나짜리 케이스로 적는다. 위의 `unrelated-false-correct`가 그렇다.
- `samples`: 판정의 분모가 된 표본 수. 이름과 값은 평가 쪽이 정하고, 어느 것을 볼지는 설정의 `guards`가 정한다. 값이 `null`이면 "세지 못했다"이다.
- `baseline`: 선택. 변경 없이 같은 케이스를 돌린 값.
- `verdict`: 선택. 그때 게이트가 낸 판정. `replay`가 비교에 쓴다.
- 같은 `id`가 두 번 나오거나, 유한하지 않은 숫자(NaN, Infinity)가 있으면 입력 오류다.

### 설정 파일 (임계는 여기에만 둔다)

```json
{
  "model": "grader-model-a",
  "pass": { "min": 80 },
  "minPassingTrials": 1,
  "minTrials": 2,
  "minCases": 4,
  "cases": {
    "false-correct-pct": { "pass": { "max": 10 }, "minTrials": 1 },
    "unrelated-false-correct": { "pass": { "max": 1 }, "minTrials": 1 }
  },
  "guards": {
    "graded-points": { "min": 200 },
    "swap-points": { "min": 40 }
  }
}
```

- 맨 위 `pass`·`minPassingTrials`·`minTrials`가 기본 규칙이고, `cases`에서 케이스별로 덮어쓴다.
- `cases`에 적은 케이스는 결과에 반드시 있어야 한다.
- `minPassingTrials`(k)가 `minTrials`(n)보다 크면 설정 오류다. 최소 표본만 모였을 때 절대 통과할 수 없다.
- `pass`는 `min`, `max`, 또는 둘 다. `min > max`는 오류다.
- `minCases` 기본값은 1이다. 빈 결과는 통과가 아니다.
- `guards`의 범위 밖 표본은 FAIL이 아니라 ERROR다. 표본이 모자란 것은 측정 실패다.

### 두 방식이 같은 형식으로 적힌다

| 방식 | 설정 |
|---|---|
| run마다 보고, 모든 run이 나쁠 때만 FAIL | `minPassingTrials: 1`, `minTrials: 2` |
| 토스 FF: 3번 중 2번 PASS | PASS=1, PARTIAL=0.5, FAIL=0으로 적고 `pass: { "min": 1 }`, `minPassingTrials: 2`, `minTrials: 3` |
| 여러 run을 합친 개수로 한 번만 판정 | trial 하나, `minPassingTrials: 1`, `minTrials: 1` |

## 5. CLI

```bash
npx eval-verdict check  report.json     --config gate.config.json
npx eval-verdict replay history/*.json  --config gate.config.json
```

옵션: `--json`(판정 객체를 JSON으로 출력), `--from <형식>`(다른 도구의 결과를 변환해서 읽기), `-h`.

| 명령 | 하는 일 | exit |
|---|---|---|
| `check` | 결과 하나를 판정한다. `GITHUB_STEP_SUMMARY`가 있으면 같은 내용을 markdown 표로도 남긴다. 그 파일 쓰기가 실패해도 판정은 바꾸지 않는다. | 0 / 1 / 2 |
| `replay` | 과거 결과들(`verdict`가 적힌 파일)에 지금 설정을 다시 적용해 뒤집히는 판정을 보여 준다. 임계를 바꾸기 전에 돌린다. `verdict`가 없는 파일은 비교하지 않는다. | 0 안 뒤집힘 · 1 뒤집힘 · 2 입력 오류 |

- 임계는 CLI 플래그로 받지 않는다. 실행할 때마다 바꿀 수 있는 임계는 게이트가 아니고, 로컬과 CI가 같은 설정 파일을 읽어야 "로컬에서 통과하면 CI에서도 통과"가 된다.
- 터미널 출력은 첫 줄에 판정, 그다음 케이스 표(상태, 케이스, 통과/잰 수, 규칙, 기준선), 그다음 errors / failures / warnings 순서다.

### `--from claude-plugin-eval` (선택)

`claude plugin eval --json`(schemaVersion 1) 결과를 읽는다.

- `cases[].name` → 케이스, `arms.with[]`의 run 하나 → trial, `arms.without[]` → 기준선
- `error`가 있는 run, 유료 grader를 건너뛴 run(`skippedPaidGraders`)은 `null`
- `aborted`인 run은 플러그인이 잘못 행동한 결과라 잰 것으로 둔다
- `partial: true`인 결과는 스위트가 끝나지 않은 것이라 통째로 ERROR

공개 문서에는 run 하나의 점수 필드 이름이 없다. 실제 `--json` 파일로 확인하기 전에는 이 어댑터를 넣지 않는다.

## 6. 첫 사용처: 팀 프로젝트의 평가 게이트

이 도구가 실제로 쓰이는 첫 자리는 이 판정 규칙이 나온 팀 프로젝트의 게이트다. 연결은 팀 레포 쪽에서 하고, 이 레포에는 팀 고유 코드를 두지 않는다.

**지금 게이트**는 한 스크립트가 LLM 호출, 지표 합산, 표본 가드, 임계 판정, 기록을 모두 한다. 지표 6개 중 run별로 보는 것은 1개이고 나머지는 run을 합친 값이며, 가드 5개는 모두 표본 수다. 임계는 채점 모델마다 다르다.

**연결한 뒤**

- 게이트 스크립트는 LLM 호출과 지표 계산까지만 하고, 4절 형식의 결과 파일을 써서 `eval-verdict check`에 넘긴다.
- 임계와 가드는 채점 모델마다 설정 파일 하나로 옮긴다.
- run별 지표는 trial 여러 개, 합산 지표는 trial 하나, 가드는 `samples`로 적는다.
- 지금 게이트는 run별 지표에서 기록이 있는 run만 본다. 같은 동작을 하려면 그 케이스는 `minTrials: 1`이다. 2로 올리는 것은 판정 변경이라 연결과 따로 한다.

**판정이 그대로라는 확인**

게이트 기록 파일에는 그때의 임계와 가드가 함께 남아 있다. 팀 레포에 기록 → (결과 파일, 설정 파일) 변환기를 두고, 기록마다 **그 기록 자신의 임계로** `check`를 돌려 기록된 판정과 모두 같은지 본다. 하나라도 다르면 연결하지 않는다. 그다음 지금 설정으로 `replay`를 돌려, 임계를 바꿔 온 이력이 몇 건을 뒤집었는지 따로 본다.

## 7. 규칙의 근거

| 규칙 | 근거 |
|---|---|
| 못 잰 trial은 `null`, 모자라면 ERROR | 게이트의 "빈 PASS 금지". 표본 가드를 100으로 뒀더니 부분적으로 무너진 run이 통과해서 200으로 올렸다 |
| n번 중 k번 | 변경 없는 코드가 7번 중 1번 FAIL → run별 판정으로 바꿨다. 토스 FF는 "≥2/3 trials" |
| 설정에 적은 케이스가 빠지면 ERROR | 한 종류의 케이스가 조용히 빠진 채 게이트가 돈 적이 있다 |
| 모델이 다르면 ERROR | 임계는 특정 모델의 이력에서 나온다. 다른 모델로 잰 값은 같은 자로 잰 게 아니다 |
| `replay` | 85→80 재기준. PASS 35건의 최솟값이 정확히 85.0이었고, 80으로 내려도 뒤집히는 건 0건이었다 |
| 문제를 전부 모아서 한 번에 | 토스 Skill 루브릭: 결함을 모두 모아 PR 코멘트 하나로 돌려준다 |
| 머지 차단은 한 비트 | 토스 Skill 루브릭: 등급 차이는 따지지 않고 F인지 아닌지만 본다 |
| 기준선 경고 | 토스 FF grader: 스킬 없이 먼저 돌려 기준선을 잡는다 |
| 런타임 의존성 0개 | 토스 Skill 루브릭 스크립트는 표준 라이브러리만 쓴다. es-toolkit도 런타임 의존성이 없다 |

## 8. 레포 구조

```
src/
  types.ts        타입
  parse.ts        unknown → 타입 좁히기 (설정은 엄격, 결과는 관대)
  judge.ts        판정 (순수 함수)
  replay.ts       과거 판정 다시 적용
  format.ts       터미널·markdown 출력
  cli.ts          인자, 파일 읽기, exit code (run(argv, io) 로 테스트에서 직접 부른다)
  bin.ts          실행 진입점
  index.ts        라이브러리 export
  adapters/       다른 도구의 결과 형식 (선택)
test/             node:test
examples/         설정·결과 예시 (PASS / FAIL / ERROR 각 하나)
scripts/smoke.mjs 빌드된 CLI를 예시 파일로 실제 실행해 exit code 확인
docs/reference.md 설정 키, 결과 키, exit code
.github/workflows/ci.yml
README.md · AGENTS.md · LICENSE
```

- 인자는 `node:util`의 `parseArgs`로 읽는다. 런타임 의존성은 두지 않는다.
- 외부 JSON은 `unknown`으로 받아 좁힌다. 타입 단언(`as`)으로 넘기지 않는다.
- CI는 `npm run ci` 하나를 돌린다. 로컬과 같은 명령이다.

## 9. 하지 않는 것

- LLM 호출, 평가 실행. 그래서 이 레포의 테스트는 매번 같은 결과를 낸다.
- 평균, 통계 검정. 한 번에 설명할 수 있는 규칙만 둔다.
- 대시보드, npm 배포.

## 10. 작업 순서

파일이 겹치지 않게 나눈다. 1이 끝나야 2와 4를 시작한다.

| 순서 | 작업 | 파일 | 끝난 기준 |
|---|---|---|---|
| 1 | 판정 | `src/types.ts`, `src/parse.ts`, `src/judge.ts`, `test/parse.test.ts`, `test/judge.test.ts` | 아래 대표 사례 테스트 통과, `tsc --noEmit`·`eslint` 통과 |
| 2 | CLI·출력·replay | `src/cli.ts`, `src/bin.ts`, `src/format.ts`, `src/replay.ts`, `src/index.ts`, `test/cli.test.ts`, `test/replay.test.ts`, `scripts/smoke.mjs` | `npm run ci` 통과, smoke가 PASS/FAIL/ERROR 예시에서 0/1/2 |
| 3 | 문서·예시·CI | `README.md`, `docs/reference.md`, `examples/`, `.github/workflows/ci.yml`, `AGENTS.md` | README 예시를 그대로 실행하면 적힌 결과가 나온다 |
| 4 | 팀 게이트 연결 | 팀 레포 (이 레포 밖) | 6절의 확인에서 기록과 다른 판정 0건 |
| 5 | `claude plugin eval` 어댑터 (선택) | `src/adapters/claude-plugin-eval.ts`, 테스트 | 실제 `--json` 파일 하나로 확인 |

3은 4절 형식이 정해져 있어 1과 함께 시작할 수 있지만, 예시 파일은 1이 끝난 뒤 실제로 돌려 확인한다.

### 대표 사례 (판정 테스트의 시작점)

| 사례 | 입력 | 기대 |
|---|---|---|
| 실제 회귀 | 2 run 모두 임계 밖, k=1 n=2 | FAIL |
| 흔들림 | 1 run만 임계 밖, k=1 n=2 | PASS + 경고 |
| 못 잰 run | `[90, null]`, n=2 | ERROR |
| 표본 부족 | `samples.graded-points` 20, guard min 200 | ERROR |
| 가드 누락 | guard에 적은 이름이 `samples`에 없음 | ERROR |
| 빈 결과 | `cases: []` | ERROR |
| 설정 케이스 누락 | 설정에 적은 케이스가 결과에 없음 | ERROR |
| 모델 불일치 | 설정 model ≠ 결과 model | ERROR |
| ERROR가 FAIL보다 앞섬 | 한 케이스 FAIL, 다른 케이스 못 잼 | ERROR (failures도 함께 남김) |
| 경계값 | 80점, `pass.min` 80 | 통과 |
| 문제 모으기 | 설정 오류 여러 개 | 전부 한 번에 보고 |
| replay | 85→80으로 바꾸고 과거 PASS 기록들 | 뒤집힘 0건 |

## 11. 정할 것

- **기본 규칙을 k=1/n=2로 둘지 k=2/n=3으로 둘지.** 앞은 팀 게이트에서 쓰던 값이고 놓치는 회귀가 있다(1절의 36%). 뒤는 토스 FF 값이고 평가를 한 번 더 돌려야 한다. 예시에는 둘 다 넣고 README 기본값만 고른다.
- **`claude plugin eval` 어댑터를 v1에 넣을지.** 5절 마지막 문단.
- **이름과 LICENSE.** `eval-verdict`는 임시 이름이다.
