# eval-verdict

LLM 평가를 여러 번 돌린 결과를 읽고, 머지를 막을지 말지를 **PASS / FAIL / ERROR** 하나로 정하는 TypeScript CLI·라이브러리입니다. 평가를 직접 돌리지는 않습니다. 판정만 합니다.

```
$ eval-verdict check examples/reports/report-thin.json --config examples/config.json
eval-verdict: ERROR

       case                     passed        rule                  baseline
ERROR  answer-accuracy          1/1 (+1 n/m)  ≥1 of ≥2, score ≥ 80  -
ok     false-correct-pct        2/2           ≥1 of ≥2, score ≤ 10  -
ok     unrelated-false-correct  1/1           ≥1 of ≥1, score ≤ 1   -

errors — not measured, so no PASS/FAIL:
  - samples.graded-points: 120 outside guard n ≥ 200
  - answer-accuracy: 1 measured trials < minTrials 2 (1 not measured)
```

점수만 보면 통과지만, 채점한 표본이 가드보다 적고 run 하나가 무너졌습니다. 그래서 PASS가 아니라 ERROR입니다.

## 왜 만들었나

같은 코드로 돌려도 LLM 평가 점수는 매번 달라집니다. 평가 결과로 머지를 막으려면 세 가지를 정해야 합니다. 이 도구는 비공개 팀 프로젝트에서 운영한 평가 게이트의 판정 부분을 떼어 낸 것이고, 아래 셋은 그 게이트에서 실제로 겪은 일입니다.

- **몇 번 중 몇 번 통과해야 하나.** 코드를 바꾸지 않은 브랜치에서도 7번 중 1번 FAIL이 났습니다. 케이스마다 "n번 중 k번"으로 정합니다.
- **못 잰 것과 떨어진 것을 어떻게 가르나.** run 일부가 무너졌는데 남은 표본만으로 PASS가 나온 적이 있습니다. 못 잰 것은 ERROR(exit 2)로, 떨어진 것은 FAIL(exit 1)로 나눕니다.
- **임계를 바꿔도 되는지 어떻게 아나.** 과거 결과에 새 설정을 다시 적용해 뒤집히는 판정을 먼저 봅니다(`replay`).

## 사용법

npm에는 올리지 않았습니다. 빌드해서 씁니다. Node 20 이상이 필요합니다.

```bash
git clone https://github.com/qwer906/eval-verdict && cd eval-verdict
npm ci && npm run build
node dist/bin.js check  examples/reports/report.json --config examples/config.json
node dist/bin.js replay examples/reports/*.json --config examples/config.json
```

| 명령 | 하는 일 | exit |
|---|---|---|
| `check <report>` | 결과 하나를 판정합니다. `GITHUB_STEP_SUMMARY`가 있으면 같은 판정을 markdown 표로도 남깁니다 | 0 PASS · 1 FAIL · 2 ERROR |
| `replay <report>...` | 과거 결과들에 지금 설정을 다시 적용해, 기록된 판정(`verdict`)과 달라지는 것을 보여 줍니다 | 0 안 바뀜 · 1 바뀜 · 2 입력 오류 |

`--json`은 판정 객체를 JSON으로 출력합니다. 임계는 CLI 플래그로 받지 않습니다. 로컬과 CI가 같은 설정 파일을 읽어야 "로컬에서 통과하면 CI에서도 통과"가 됩니다.

라이브러리로도 씁니다. `judge`는 파일, 네트워크, 시계를 건드리지 않는 순수 함수입니다.

```ts
import { judge, parseConfig, parseReport } from "eval-verdict";

const config = parseConfig(JSON.parse(configText));
const report = parseReport(JSON.parse(reportText));
if (config.ok && report.ok) console.log(judge(config.value, report.value).verdict);
```

## 입력

**결과 파일** (평가를 돌린 쪽이 만듭니다)

```json
{
  "model": "grader-model-a",
  "cases": [
    { "id": "answer-accuracy", "trials": [92.5, 78.0] },
    { "id": "false-correct-pct", "trials": [2.2, 14.0] },
    { "id": "unrelated-false-correct", "trials": [0] }
  ],
  "samples": { "graded-points": 430 }
}
```

- `trials`: 같은 케이스를 run마다 잰 값입니다. `null`은 "못 쟀다"이고, 0(떨어짐)과 다릅니다.
- 여러 run을 합친 지표는 trial 하나짜리 케이스로 적습니다.
- `samples`: 판정의 분모가 된 표본 수입니다.
- 선택 항목:
  - `baseline`: 변경 없이 돌린 값
  - `verdict`: 그때 낸 판정. `replay`가 비교에 씁니다
- 모르는 키는 무시합니다.

**설정 파일** (임계는 여기에만 둡니다)

```json
{
  "model": "grader-model-a",
  "pass": { "min": 80 },
  "minPassingTrials": 1,
  "minTrials": 2,
  "cases": { "false-correct-pct": { "pass": { "max": 10 } } },
  "guards": { "graded-points": { "min": 200 } }
}
```

- 모르는 키는 오류입니다. `minPasingTrials` 같은 오타가 조용히 기본값으로 돌아가면 게이트가 몰래 약해집니다.
- `cases`에 적은 케이스가 결과에 없으면 ERROR입니다.

## 판정 순서

1. 파일을 검사합니다. 문제는 처음 하나에서 멈추지 않고 전부 모읍니다.
2. 못 잰 것을 모읍니다 → ERROR. 다음 경우가 해당합니다.
   - 모델이 다를 때
   - 케이스가 빠졌을 때
   - 표본이 가드 밖일 때
   - 잰 trial이 `minTrials`보다 적을 때
3. 잰 것을 판정합니다 → FAIL. 케이스마다 통과 범위에 든 trial이 `minPassingTrials`보다 적으면 FAIL입니다.
4. 경고를 남깁니다. 판정은 바꾸지 않습니다. 다음 경우가 해당합니다.
   - trial끼리 엇갈렸을 때
   - 기준선도 같은 비율로 통과할 때
5. 하나로 합칩니다. ERROR가 하나라도 있으면 ERROR, 아니면 FAIL이 하나라도 있으면 FAIL, 아니면 PASS입니다.

못 잰 상태에서 나온 FAIL은 회귀인지 인프라 고장인지 알려 주지 않습니다. 그래서 ERROR를 FAIL보다 앞에 둡니다. 규칙마다의 근거는 [docs/design.md](docs/design.md)에 있습니다.

## 검증: 실제 게이트와 같은 판정을 내는가

팀 프로젝트의 게이트 기록 파일에는 그때의 임계와 가드가 함께 남아 있습니다. 검증은 이렇게 했습니다.

1. 기록마다 그 기록 자신의 임계·가드로 설정 파일을 만들었습니다.
2. 지표는 결과 파일로 바꿨습니다.
3. `judge`로 다시 판정해 기록된 판정과 비교했습니다.

| 기록된 판정 | 건수 | eval-verdict |
|---|---|---|
| PASS | 16 | 16건 PASS |
| FAIL | 1 | FAIL. 같은 지표가 같은 이유로 걸렸습니다 |
| ERROR | 4 | 4건 ERROR. 3건은 표본 가드 미달, 1건은 채점 모델 불일치로, 게이트와 같은 이유입니다 |

- **21건 모두 일치했습니다.**
- 임계를 일부러 통과할 수 없는 값(exact ≥ 101)으로 바꾸면 PASS 16건이 모두 FAIL로 바뀝니다. 변환이 입력을 무시하고 통과시키는 것이 아니라는 확인입니다.

한계도 있습니다.

- **기록 범위:** 대상은 로컬에 남아 있던 기록 21건(2026-10-28 ~ 11-06)입니다. 그 전 기록은 작업 폴더를 정리하면서 지워져 검증하지 못했습니다.
- **변환기 위치:** 변환기는 팀 고유 코드라 이 레포에 넣지 않았습니다.
- **연결 상태:** 팀 게이트가 이 도구를 실제로 호출하도록 바꾸는 작업은 아직 하지 않았습니다.

## 개발

```bash
npm run ci   # typecheck → lint → test → build
```

- 런타임 의존성은 0개입니다. 인자 파싱은 `node:util`의 `parseArgs`로 합니다.
- 테스트는 `node:test`로 돌리고, 38개입니다.
- TypeScript strict에 `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`를 켰습니다.

## 하지 않는 것

- LLM 호출이나 평가 실행. 그래서 테스트는 매번 같은 결과를 냅니다.
- 평균이나 통계 검정. 한 줄로 설명할 수 있는 규칙만 둡니다.
- 대시보드, npm 배포.
