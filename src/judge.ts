import { ruleFor } from "./parse.ts";
import type { CaseOutcome, Config, Judgement, Range, Report, Trial, Verdict } from "./types.ts";

/**
 * 결과 하나를 판정한다. 순수 함수 — 파일·네트워크·시계를 건드리지 않는다.
 *
 * 순서: 재지 못한 것(ERROR)을 먼저 모으고, 그다음 잰 것의 미달(FAIL)을 모은다.
 * ERROR 가 하나라도 있으면 FAIL 보다 앞선다 — 못 잰 상태에서 나온 FAIL 은
 * 회귀인지 인프라 고장인지 말해 주지 않는다.
 */
export function judge(config: Config, report: Report): Judgement {
  const errors: string[] = [];
  const failures: string[] = [];
  const warnings: string[] = [];

  // 임계는 특정 모델의 이력에서 나온다. 모델이 바뀌면 같은 자로 잰 게 아니다.
  if (config.model !== undefined && report.model !== config.model)
    errors.push(`model: thresholds were set for ${config.model}, report ran on ${report.model ?? "(not stated)"}`);

  if (report.cases.length < config.minCases)
    errors.push(`cases: ${String(report.cases.length)} in report < minCases ${String(config.minCases)}`);

  // 설정에 이름을 적은 케이스가 결과에서 빠지면, 그 케이스가 지키던 것을 아무도 안 잰다.
  const present = new Set(report.cases.map((c) => c.id));
  for (const id of Object.keys(config.cases))
    if (!present.has(id)) errors.push(`${id}: named in config but missing from report`);

  // 표본이 모자란 결과는 "통과/실패"가 아니라 "제대로 못 잰" 것이다.
  for (const [name, range] of Object.entries(config.guards ?? {})) {
    const n = report.samples?.[name];
    if (n === undefined) errors.push(`samples.${name}: missing from report (guard ${describeRange(range, "n")})`);
    else if (n === null) errors.push(`samples.${name}: not counted (guard ${describeRange(range, "n")})`);
    else if (!inRange(n, range)) errors.push(`samples.${name}: ${String(n)} outside guard ${describeRange(range, "n")}`);
  }

  const cases = report.cases.map((c): CaseOutcome => {
    const rule = ruleFor(config, c.id);
    const measured = c.trials.filter(isMeasured);
    const passing = measured.filter((v) => inRange(v, rule.pass)).length;
    const unmeasured = c.trials.length - measured.length;

    let status: Verdict = "PASS";
    if (measured.length < rule.minTrials) {
      status = "ERROR";
      errors.push(
        `${c.id}: ${String(measured.length)} measured trials < minTrials ${String(rule.minTrials)}` +
          (unmeasured > 0 ? ` (${String(unmeasured)} not measured)` : ""),
      );
    } else if (passing < rule.minPassingTrials) {
      status = "FAIL";
      failures.push(
        `${c.id}: ${String(passing)}/${String(measured.length)} trials passed (${describeRange(rule.pass)}), needs ${String(rule.minPassingTrials)}`,
      );
    }

    if (status !== "ERROR" && passing > 0 && passing < measured.length)
      warnings.push(`${c.id}: trials disagree — ${String(passing)}/${String(measured.length)} passed`);

    let baseline: CaseOutcome["baseline"];
    if (c.baseline !== undefined) {
      const b = c.baseline.filter(isMeasured);
      baseline = { passing: b.filter((v) => inRange(v, rule.pass)).length, measured: b.length };
      // 변경 없이도 같은 비율로 통과하면, 이 케이스는 변경의 효과를 재지 못한다.
      if (status === "PASS" && b.length > 0 && baseline.passing / b.length >= passing / measured.length)
        warnings.push(
          `${c.id}: baseline passes as often (${String(baseline.passing)}/${String(b.length)}) — this case does not show the change helped`,
        );
    }

    return { id: c.id, status, passing, measured: measured.length, unmeasured, rule, ...(baseline !== undefined ? { baseline } : {}) };
  });

  const verdict: Verdict = errors.length > 0 ? "ERROR" : failures.length > 0 ? "FAIL" : "PASS";
  return { verdict, errors, failures, warnings, cases };
}

export const EXIT_CODE: Readonly<Record<Verdict, 0 | 1 | 2>> = { PASS: 0, FAIL: 1, ERROR: 2 };

export function describeRange(r: Range, x = "score"): string {
  if (r.min !== undefined && r.max !== undefined) return `${String(r.min)} ≤ ${x} ≤ ${String(r.max)}`;
  if (r.min !== undefined) return `${x} ≥ ${String(r.min)}`;
  return `${x} ≤ ${String(r.max)}`;
}

const isMeasured = (t: Trial): t is number => t !== null;

const inRange = (v: number, r: Range): boolean => (r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max);
