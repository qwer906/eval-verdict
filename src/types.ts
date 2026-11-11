/**
 * 같은 입력을 한 번 돌린 결과(trial)의 점수.
 * `null` 은 "재지 못했다"(실행 오류·중단)는 뜻이다. 실패(낮은 점수)와 다르다.
 */
export type Trial = number | null;

export type Verdict = "PASS" | "FAIL" | "ERROR";

export interface CaseResult {
  readonly id: string;
  readonly trials: readonly Trial[];
  /** 같은 케이스를 변경 없이(예: 스킬·플러그인 없이) 돌린 기준선. */
  readonly baseline?: readonly Trial[];
}

export interface Report {
  /** 평가를 돌린(또는 채점한) 모델. 설정의 `model` 과 비교한다. */
  readonly model?: string;
  readonly cases: readonly CaseResult[];
  /** 판정의 분모가 된 표본 수. `null` 은 "세지 못했다". 어느 것을 볼지는 설정의 `guards` 가 정한다. */
  readonly samples?: Readonly<Record<string, number | null>>;
  /** 그때 게이트가 낸 판정. `replay` 가 지금 설정의 판정과 비교한다. */
  readonly verdict?: Verdict;
}

/** 양 끝을 포함한다: `{ min: 80 }` 이면 80 은 통과. */
export interface Range {
  readonly min?: number;
  readonly max?: number;
}

export interface CaseRule {
  /** trial 하나가 통과하는 점수 범위. */
  readonly pass: Range;
  /** 케이스가 통과하려면 통과해야 하는 trial 수(n번 중 k번의 k). */
  readonly minPassingTrials: number;
  /** 판정에 필요한 최소 표본. 잰 trial 이 이보다 적으면 ERROR. */
  readonly minTrials: number;
}

export interface Config extends CaseRule {
  /** 임계를 정한 모델. 정해 두면 결과의 모델이 다를 때 ERROR. */
  readonly model?: string;
  /** 결과에 있어야 하는 최소 케이스 수. 기본 1(빈 결과는 통과가 아니다). */
  readonly minCases: number;
  /** 케이스별 규칙. 여기 적힌 케이스는 결과에 반드시 있어야 한다. */
  readonly cases: Readonly<Record<string, Partial<CaseRule>>>;
  /** 결과 `samples` 가 들어야 하는 범위. 없거나 `null` 이거나 범위 밖이면 ERROR(측정 실패). */
  readonly guards?: Readonly<Record<string, Range>>;
}

export interface CaseOutcome {
  readonly id: string;
  readonly status: Verdict;
  readonly passing: number;
  readonly measured: number;
  readonly unmeasured: number;
  readonly rule: CaseRule;
  readonly baseline?: { readonly passing: number; readonly measured: number };
}

export interface Judgement {
  readonly verdict: Verdict;
  /** 재지 못한 것 — 하나라도 있으면 ERROR. */
  readonly errors: readonly string[];
  /** 잰 결과가 기준 미달 — ERROR 가 없을 때 하나라도 있으면 FAIL. */
  readonly failures: readonly string[];
  /** 판정은 바꾸지 않지만 사람이 볼 것. */
  readonly warnings: readonly string[];
  readonly cases: readonly CaseOutcome[];
}

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly string[] };
