import { judge } from "./judge.ts";
import type { Config, Report, Verdict } from "./types.ts";

export interface ReplayRow {
  readonly name: string;
  /** 결과 파일에 기록된 그때의 판정. 없으면 비교하지 않는다. */
  readonly recorded?: Verdict;
  readonly now: Verdict;
}

export interface Replay {
  readonly rows: readonly ReplayRow[];
  /** 기록된 판정과 지금 설정의 판정이 다른 것. */
  readonly flipped: readonly ReplayRow[];
}

/**
 * 지금 설정으로 과거 결과들을 다시 판정한다.
 * 임계를 바꾸기 전에 "그때 통과한 것 중 몇 건이 뒤집히나"를 보는 데 쓴다.
 */
export function replay(config: Config, reports: readonly { readonly name: string; readonly report: Report }[]): Replay {
  const rows = reports.map(({ name, report }): ReplayRow => ({
    name,
    now: judge(config, report).verdict,
    ...(report.verdict !== undefined ? { recorded: report.verdict } : {}),
  }));
  return { rows, flipped: rows.filter((r) => r.recorded !== undefined && r.recorded !== r.now) };
}
