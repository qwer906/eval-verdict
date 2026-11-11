# AGENTS.md

이 레포에서 작업하는 코딩 에이전트와 사람을 위한 규칙입니다.

## 명령

- `npm run ci`: typecheck → lint → test → build → smoke. 커밋 전에 통과해야 합니다. GitHub Actions도 같은 명령을 돌립니다.
- `npm test`: `node:test`로 `test/**/*.test.ts`를 실행합니다(Node 22+, 타입 제거 실행).

## 규칙

- **문서가 기준입니다.** 판정 규칙은 `docs/design.md`가 정합니다. 코드와 문서가 다르면 둘 중 하나를 고치고, 이유를 커밋 본문에 적습니다.
- **판정을 바꾸면 테스트부터 씁니다.** `test/judge.test.ts`에 사례를 먼저 넣습니다.
- **런타임 의존성은 두지 않습니다.** `dependencies`는 비워 둡니다.
- **타입 단언으로 넘기지 않습니다.** 외부 JSON은 `unknown`으로 받아 `parse.ts`에서 좁힙니다. `as`로 넘기지 않습니다.
- **입력·출력 위치를 지킵니다.** `judge`·`replay`는 순수 함수입니다. 파일·환경 변수·출력은 `cli.ts`만 다룹니다.
- **임계를 CLI 플래그로 받지 않습니다.**
