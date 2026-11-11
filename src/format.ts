import { describeRange } from "./judge.ts";
import type { Replay } from "./replay.ts";
import type { CaseOutcome, Judgement } from "./types.ts";

const MARK = { PASS: "ok", FAIL: "FAIL", ERROR: "ERROR" } as const;

const passed = (c: CaseOutcome): string =>
  `${String(c.passing)}/${String(c.measured)}${c.unmeasured > 0 ? ` (+${String(c.unmeasured)} n/m)` : ""}`;

const need = (c: CaseOutcome): string => `≥${String(c.rule.minPassingTrials)} of ≥${String(c.rule.minTrials)}, ${describeRange(c.rule.pass)}`;

const base = (c: CaseOutcome): string => (c.baseline ? `${String(c.baseline.passing)}/${String(c.baseline.measured)}` : "-");

/** 터미널용. */
export function formatText(j: Judgement): string {
  const rows = [["", "case", "passed", "rule", "baseline"], ...j.cases.map((c) => [MARK[c.status], c.id, passed(c), need(c), base(c)])];
  const widths = rows[0]?.map((_, col) => Math.max(...rows.map((r) => (r[col] ?? "").length))) ?? [];
  const table = rows.map((r) => r.map((cell, col) => cell.padEnd(widths[col] ?? 0)).join("  ").trimEnd());
  return [
    `eval-verdict: ${j.verdict}`,
    "",
    ...table,
    ...section("errors — not measured, so no PASS/FAIL", j.errors),
    ...section("failures", j.failures),
    ...section("warnings", j.warnings),
    "",
  ].join("\n");
}

/** GitHub Actions job summary 용. */
export function formatMarkdown(j: Judgement): string {
  return [
    `### eval-verdict: ${j.verdict}`,
    "",
    "| | case | passed | rule | baseline |",
    "|---|---|---|---|---|",
    ...j.cases.map((c) => `| ${MARK[c.status]} | \`${c.id}\` | ${passed(c)} | ${need(c)} | ${base(c)} |`),
    ...mdSection("Errors", j.errors),
    ...mdSection("Failures", j.failures),
    ...mdSection("Warnings", j.warnings),
    "",
  ].join("\n");
}

export function formatReplay(r: Replay): string {
  const lines = r.rows.map((row) => {
    const flip = row.recorded !== undefined && row.recorded !== row.now;
    return `${flip ? "FLIP" : "    "}  ${row.name}  ${row.recorded ?? "(not recorded)"} → ${row.now}`;
  });
  const compared = r.rows.filter((row) => row.recorded !== undefined).length;
  return [...lines, "", `${String(r.flipped.length)} of ${String(compared)} recorded verdicts would change.`, ""].join("\n");
}

const section = (title: string, items: readonly string[]): string[] =>
  items.length > 0 ? ["", `${title}:`, ...items.map((s) => `  - ${s}`)] : [];

const mdSection = (title: string, items: readonly string[]): string[] =>
  items.length > 0 ? ["", `**${title}**`, ...items.map((s) => `- ${s}`)] : [];
