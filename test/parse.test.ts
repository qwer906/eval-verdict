import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseConfig, parseReport } from "../src/parse.ts";

const base = { pass: { min: 1 }, minPassingTrials: 2, minTrials: 3 };

describe("parseConfig", () => {
  test("최소 설정을 받고 minCases 기본값은 1", () => {
    const p = parseConfig(base);
    assert.ok(p.ok);
    assert.equal(p.value.minCases, 1);
    assert.deepEqual(p.value.cases, {});
  });

  test("모르는 키는 오류 — 오타가 조용히 기본값으로 돌아가지 않게", () => {
    const p = parseConfig({ ...base, minPasingTrials: 3 });
    assert.ok(!p.ok);
    assert.deepEqual(p.issues, ["config.minPasingTrials: unknown key"]);
  });

  test("최소 표본으로는 절대 통과할 수 없는 규칙은 오류", () => {
    const p = parseConfig({ ...base, cases: { a: { minPassingTrials: 4 } } });
    assert.ok(!p.ok);
    assert.deepEqual(p.issues, ["config.cases.a: minPassingTrials 4 > minTrials 3"]);
  });

  test("문제를 전부 모아서 돌려준다", () => {
    const p = parseConfig({ pass: { min: 2, max: 1 }, minPassingTrials: 0, minTrials: 1.5 });
    assert.ok(!p.ok);
    assert.equal(p.issues.length, 3);
  });

  test("범위는 min·max 중 하나는 있어야 한다", () => {
    const p = parseConfig({ ...base, pass: {} });
    assert.ok(!p.ok);
    assert.deepEqual(p.issues, ["config.pass: set min, max, or both"]);
  });
});

describe("parseReport", () => {
  test("null 은 못 잰 trial 로 받고, 모르는 키(메타데이터)는 무시한다", () => {
    const p = parseReport({ sha: "abc123", cases: [{ id: "a", trials: [1, null, 0.5] }] });
    assert.ok(p.ok);
    assert.deepEqual(p.value, { cases: [{ id: "a", trials: [1, null, 0.5] }] });
  });

  test("숫자가 아닌 trial·NaN·Infinity 는 오류", () => {
    const p = parseReport({ cases: [{ id: "a", trials: [1, "PASS", Number.NaN, Infinity] }] });
    assert.ok(!p.ok);
    assert.equal(p.issues.length, 3);
  });

  test("케이스 id 중복은 오류", () => {
    const p = parseReport({ cases: [{ id: "a", trials: [1] }, { id: "a", trials: [1] }] });
    assert.ok(!p.ok);
    assert.deepEqual(p.issues, ['report.cases[1].id: duplicate case id "a"']);
  });

  test("기록된 판정은 PASS·FAIL·ERROR 만", () => {
    assert.ok(parseReport({ verdict: "FAIL", cases: [] }).ok);
    assert.ok(!parseReport({ verdict: "pass", cases: [] }).ok);
  });
});

describe("samples·guards", () => {
  const base = { pass: { min: 80 }, minPassingTrials: 1, minTrials: 2 };

  test("guards 는 범위로 읽는다", () => {
    const r = parseConfig({ ...base, guards: { "graded-points": { min: 200 } } });
    assert.ok(r.ok);
    assert.deepEqual(r.value.guards, { "graded-points": { min: 200 } });
  });

  test("guards 범위가 잘못되면 오류", () => {
    const r = parseConfig({ ...base, guards: { "graded-points": 200 } });
    assert.ok(!r.ok);
  });

  test("samples 는 숫자 또는 null, 그 밖은 오류", () => {
    assert.ok(parseReport({ cases: [], samples: { a: 3, b: null } }).ok);
    const r = parseReport({ cases: [], samples: { a: "3" } });
    assert.ok(!r.ok);
    assert.deepEqual(r.issues, ['report.samples.a: expected a finite number, or null for "not counted"']);
  });
});
