# 레퍼런스

설정 키, 결과 키, 판정 순서, exit code를 모았습니다. 규칙마다의 이유는 [design.md](design.md)에 있습니다.

## CLI

```bash
eval-verdict --version
eval-verdict check  <report.json>     --config <config.json> [--json]
eval-verdict replay <report.json>...  --config <config.json> [--json]
```

| 명령 | exit 0 | exit 1 | exit 2 |
|---|---|---|---|
| `check` | PASS | FAIL | ERROR (못 잼, 입력 오류) |
| `replay` | 기록된 판정이 안 바뀜 | 바뀌는 판정이 있음 | 입력 오류 |

| 옵션 | 설명 |
|---|---|
| `--config <file>` | 필수. 임계는 이 파일에만 둡니다. 임계를 바꾸는 플래그는 없습니다 |
| `--json` | 판정 객체(`Judgement`, `Replay`)를 JSON으로 출력합니다 |
| `-h`, `--help` | 도움말 |
| `-v`, `--version` | 버전 |

- `check`는 환경 변수 `GITHUB_STEP_SUMMARY`가 있으면 같은 판정을 markdown 표로 그 파일에 덧붙입니다.
- 덧붙이기가 실패해도 판정과 exit code는 바뀌지 않습니다.

## 설정 파일

모르는 키는 오류입니다. 오타가 조용히 기본값으로 돌아가면 게이트가 몰래 약해지기 때문입니다.

| 키 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `pass` | `Range` | 필수 | trial 하나가 통과하는 범위 |
| `minPassingTrials` | 정수 ≥ 1 | 필수 | 케이스가 통과하려면 통과해야 하는 trial 수 (k) |
| `minTrials` | 정수 ≥ 1 | 필수 | 판정에 필요한 최소 잰 trial 수 (n) |
| `minCases` | 정수 ≥ 1 | `1` | 결과에 있어야 하는 최소 케이스 수 |
| `model` | 문자열 | 없음 | 임계를 정한 모델. 결과의 `model`과 다르면 ERROR |
| `cases` | `{ [id]: { pass?, minPassingTrials?, minTrials? } }` | `{}` | 케이스별 규칙. 여기 적은 케이스는 결과에 반드시 있어야 합니다 |
| `guards` | `{ [name]: Range }` | 없음 | 결과 `samples`가 들어야 하는 범위 |
| `$schema` | 문자열 | 없음 | 에디터 자동완성용. 판정에 쓰지 않습니다. 스키마는 [`schema/config.schema.json`](../schema/config.schema.json) |

**`Range`**
- `{ "min"?: number, "max"?: number }` 형태입니다. 하나 이상 적어야 하고, 양 끝을 포함합니다.

**설정 오류로 보는 경우**
- `min > max`인 범위
- `minPassingTrials > minTrials`. 최소 표본만 모였을 때 절대 통과할 수 없는 규칙이기 때문입니다.

## 결과 파일

모르는 키는 무시합니다. 평가 쪽이 커밋 SHA 같은 메타데이터를 붙여도 깨지지 않게 하기 위해서입니다.

| 키 | 타입 | 설명 |
|---|---|---|
| `cases` | 배열 | 필수 |
| `cases[].id` | 문자열 | 케이스 이름. 중복되면 오류 |
| `cases[].trials` | `(number \| null)[]` | run마다 잰 값. `null`은 "못 쟀다"이고, 0(떨어짐)과 다릅니다 |
| `cases[].baseline` | `(number \| null)[]` | 선택. 변경 없이 같은 케이스를 돌린 값 |
| `samples` | `{ [name]: number \| null }` | 선택. 판정의 분모가 된 표본 수. `null`은 "세지 못했다" |
| `model` | 문자열 | 선택. 평가(채점)를 돌린 모델 |
| `verdict` | `"PASS" \| "FAIL" \| "ERROR"` | 선택. 그때 낸 판정. `replay`가 비교에 씁니다 |

**값 규칙**
- 숫자는 유한해야 합니다. `NaN`과 `Infinity`는 오류입니다.
- 여러 run을 합친 지표는 trial 하나짜리 케이스로 적습니다.

## 판정 순서

1. **파일 검사.** 문제는 처음 하나에서 멈추지 않고 전부 모읍니다. 하나라도 있으면 ERROR입니다.
2. **ERROR 후보.** 아래 중 하나라도 해당하면 ERROR 후보입니다.
   - 설정 `model`과 결과 `model`이 다릅니다.
   - 케이스 수가 `minCases`보다 적습니다.
   - 설정 `cases`에 적은 케이스가 결과에 없습니다.
   - `guards`의 표본이 없거나, `null`이거나, 범위 밖입니다.
   - 케이스의 잰 trial이 `minTrials`보다 적습니다.
3. **FAIL 후보.** 케이스마다 `pass` 범위에 든 trial을 세어, `minPassingTrials`보다 적으면 FAIL 후보입니다.
4. **경고.** 판정은 바꾸지 않습니다.
   - trial이 일부만 통과했을 때
   - 기준선이 같은 비율 이상으로 통과할 때
5. **합치기.** ERROR가 하나라도 있으면 ERROR입니다. 없고 FAIL이 하나라도 있으면 FAIL, 둘 다 없으면 PASS입니다.

## 자주 쓰는 설정

| 방식 | 설정 |
|---|---|
| run마다 보고, 모든 run이 나쁠 때만 FAIL | `minPassingTrials: 1`, `minTrials: 2` |
| 3번 중 2번 PASS (PASS=1, PARTIAL=0.5, FAIL=0) | `pass: { "min": 1 }`, `minPassingTrials: 2`, `minTrials: 3` |
| 여러 run을 합친 값으로 한 번만 판정 | trial 하나, `minPassingTrials: 1`, `minTrials: 1` |

## GitHub Action

```yaml
- uses: qwer906/eval-verdict@v0
  id: gate
  with:
    command: check            # 또는 replay
    reports: eval-out/*.json  # 공백으로 여러 개, glob 가능
    config: gate.config.json
```

| 입력 | 기본값 | 설명 |
|---|---|---|
| `command` | `check` | `check` 또는 `replay` |
| `reports` | 필수 | 결과 파일. 공백으로 구분하고 셸이 glob을 펼칩니다 |
| `config` | 필수 | 설정 파일 |
| `node-version` | `22` | 도구를 돌릴 Node 버전 (22 이상) |

| 출력 | 값 |
|---|---|
| `verdict` | `check`: `PASS`·`FAIL`·`ERROR`, `replay`: `UNCHANGED`·`CHANGED`·`ERROR` |

- exit code가 0이 아니면 step이 실패합니다. 판정만 보고 계속하려면 `continue-on-error: true`를 줍니다.
- `actions/setup-node`로 Node를 설치하므로, 뒤 step의 Node 버전도 이 값이 됩니다.

## 라이브러리 API

| 이름 | 설명 |
|---|---|
| `parseConfig(input: unknown): Parsed<Config>` | 설정 검사. 문제를 전부 모아 `{ ok: false, issues }`로 돌려줍니다 |
| `parseReport(input: unknown): Parsed<Report>` | 결과 검사 |
| `judge(config, report): Judgement` | 판정. 순수 함수 |
| `replay(config, reports): Replay` | 여러 결과를 다시 판정하고 뒤집힌 것을 모읍니다 |
| `formatText`, `formatMarkdown`, `formatReplay` | 터미널·markdown 출력 |
| `EXIT_CODE` | `{ PASS: 0, FAIL: 1, ERROR: 2 }` |
