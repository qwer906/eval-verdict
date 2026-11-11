import assert from "node:assert/strict";
import { test } from "node:test";
import { replay } from "../src/replay.ts";
import type { Config, Report } from "../src/types.ts";

const withMin = (min: number): Config => ({ pass: { min }, minPassingTrials: 1, minTrials: 2, minCases: 1, cases: {} });

/** 임계 85 일 때 기록된 이력. 가장 낮았던 PASS 가 정확히 85 — 여유가 0 이다. */
const history: { name: string; report: Report }[] = [
  { name: "run-1", report: { verdict: "PASS", cases: [{ id: "exact-hit-pct", trials: [85, 85] }] } },
  { name: "run-2", report: { verdict: "PASS", cases: [{ id: "exact-hit-pct", trials: [92, 100] }] } },
  { name: "run-3", report: { verdict: "FAIL", cases: [{ id: "exact-hit-pct", trials: [42, 0] }] } },
  { name: "run-4", report: { cases: [{ id: "exact-hit-pct", trials: [70, 71] }] } },
];

test("임계를 85 → 80 으로 내려도 기록된 판정은 하나도 안 뒤집힌다", () => {
  const r = replay(withMin(80), history);
  assert.deepEqual(r.flipped, []);
  assert.deepEqual(
    r.rows.map((row) => row.now),
    ["PASS", "PASS", "FAIL", "FAIL"],
  );
});

test("임계를 90 으로 올리면 그때 PASS 였던 run-1 이 뒤집힌다", () => {
  const r = replay(withMin(90), history);
  assert.deepEqual(r.flipped, [{ name: "run-1", recorded: "PASS", now: "FAIL" }]);
});

test("판정이 기록되지 않은 결과는 비교하지 않는다", () => {
  const r = replay(withMin(0), history);
  assert.equal(r.rows[3]?.recorded, undefined);
  assert.equal(r.flipped.length, 1); // run-3: FAIL → PASS
});
