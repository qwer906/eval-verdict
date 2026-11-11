import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { judge } from "../src/judge.ts";
import type { Config } from "../src/types.ts";

/** 3번 돌려 2번 이상 PASS(=1) 여야 통과하는 스킬 평가 프로파일. */
const twoOfThree: Config = { pass: { min: 1 }, minPassingTrials: 2, minTrials: 3, minCases: 1, cases: {} };

/** 두 run 이 모두 나쁠 때만 FAIL 인 회귀 게이트 프로파일(run 하나의 흔들림으로 막지 않는다). */
const allRunsBad: Config = {
  pass: { min: 80 },
  minPassingTrials: 1,
  minTrials: 2,
  minCases: 1,
  cases: { "false-correct-pct": { pass: { max: 10 } } },
};

describe("n번 중 k번", () => {
  test("3번 중 2번 통과하면 PASS 이고, 엇갈렸다고 경고한다", () => {
    const j = judge(twoOfThree, { cases: [{ id: "nested-ternary", trials: [1, 0.5, 1] }] });
    assert.equal(j.verdict, "PASS");
    assert.deepEqual(j.warnings, ["nested-ternary: trials disagree — 2/3 passed"]);
  });

  test("3번 중 1번만 통과하면 FAIL", () => {
    const j = judge(twoOfThree, { cases: [{ id: "nested-ternary", trials: [1, 0, 0.5] }] });
    assert.equal(j.verdict, "FAIL");
    assert.match(j.failures[0] ?? "", /^nested-ternary: 1\/3 trials passed \(score ≥ 1\), needs 2$/);
  });

  test("범위 양 끝은 통과다 — 임계와 같은 값을 실패로 치지 않는다", () => {
    const j = judge(allRunsBad, { cases: [{ id: "exact-hit-pct", trials: [80, 80] }, { id: "false-correct-pct", trials: [10, 10] }] });
    assert.equal(j.verdict, "PASS");
  });
});

describe("run 하나의 흔들림", () => {
  test("두 run 이 모두 임계를 넘으면 FAIL — 실제 회귀", () => {
    const j = judge(allRunsBad, { cases: [{ id: "false-correct-pct", trials: [31, 27] }] });
    assert.equal(j.verdict, "FAIL");
  });

  test("한 run 만 넘으면 PASS 지만 경고를 남긴다 — 평균(19.5%)으로 막지 않는다", () => {
    const j = judge(allRunsBad, { cases: [{ id: "false-correct-pct", trials: [36, 3] }] });
    assert.equal(j.verdict, "PASS");
    assert.equal(j.warnings.length, 1);
  });
});

describe("못 잰 것은 실패가 아니라 ERROR", () => {
  test("null trial 은 표본에서 빠진다: 3개 중 2개만 재면 minTrials 3 미달로 ERROR", () => {
    const j = judge(twoOfThree, { cases: [{ id: "a", trials: [0, 0, null] }] });
    assert.equal(j.verdict, "ERROR");
    assert.deepEqual(j.failures, []);
    assert.deepEqual(j.errors, ["a: 2 measured trials < minTrials 3 (1 not measured)"]);
  });

  test("빈 결과는 통과가 아니다", () => {
    assert.equal(judge(twoOfThree, { cases: [] }).verdict, "ERROR");
  });

  test("설정에 적힌 케이스가 결과에서 빠지면 ERROR — 조용히 덜 재지 않는다", () => {
    const j = judge(allRunsBad, { cases: [{ id: "exact-hit-pct", trials: [95, 92] }] });
    assert.equal(j.verdict, "ERROR");
    assert.deepEqual(j.errors, ["false-correct-pct: named in config but missing from report"]);
  });

  test("임계를 정한 모델과 다른 모델의 결과는 ERROR", () => {
    const config: Config = { ...twoOfThree, model: "claude-haiku-4-5" };
    const ok = { cases: [{ id: "a", trials: [1, 1, 1] }] };
    assert.equal(judge(config, { ...ok, model: "claude-haiku-4-5" }).verdict, "PASS");
    assert.equal(judge(config, { ...ok, model: "claude-sonnet-5" }).verdict, "ERROR");
    assert.equal(judge(config, ok).verdict, "ERROR");
  });

  test("ERROR 와 FAIL 이 같이 있으면 ERROR 가 앞선다", () => {
    const j = judge(twoOfThree, { cases: [{ id: "bad", trials: [0, 0, 0] }, { id: "broken", trials: [null, null, null] }] });
    assert.equal(j.verdict, "ERROR");
    assert.equal(j.failures.length, 1);
    assert.equal(j.errors.length, 1);
  });
});

test("문제는 한 번에 전부 모은다", () => {
  const j = judge(twoOfThree, { cases: [{ id: "a", trials: [0, 0, 0] }, { id: "b", trials: [1, 0, 0] }] });
  assert.equal(j.failures.length, 2);
});

describe("기준선", () => {
  test("변경 없이도 같은 비율로 통과하면 경고한다 — 이 케이스는 효과를 못 잰다", () => {
    const j = judge(twoOfThree, { cases: [{ id: "a", trials: [1, 1, 1], baseline: [1, 1, 1] }] });
    assert.equal(j.verdict, "PASS");
    assert.match(j.warnings[0] ?? "", /baseline passes as often \(3\/3\)/);
  });

  test("기준선보다 나으면 경고하지 않는다", () => {
    const j = judge(twoOfThree, { cases: [{ id: "a", trials: [1, 1, 1], baseline: [0, 1, 0] }] });
    assert.deepEqual(j.warnings, []);
    assert.deepEqual(j.cases[0]?.baseline, { passing: 1, measured: 3 });
  });
});

describe("표본 수 가드", () => {
  const guarded: Config = { ...allRunsBad, guards: { "graded-points": { min: 200 } } };
  const ok = [{ id: "false-correct-pct", trials: [2, 3] }];

  test("표본이 범위 안이면 판정에 영향이 없다", () => {
    assert.equal(judge(guarded, { cases: ok, samples: { "graded-points": 200 } }).verdict, "PASS");
  });

  test("표본이 모자라면 점수가 좋아도 ERROR", () => {
    const j = judge(guarded, { cases: ok, samples: { "graded-points": 150 } });
    assert.equal(j.verdict, "ERROR");
    assert.deepEqual(j.errors, ["samples.graded-points: 150 outside guard n ≥ 200"]);
  });

  test("표본이 없거나 null 이면 ERROR", () => {
    assert.equal(judge(guarded, { cases: ok }).verdict, "ERROR");
    assert.equal(judge(guarded, { cases: ok, samples: { "graded-points": null } }).verdict, "ERROR");
  });

  test("표본 부족은 FAIL 보다 앞선다", () => {
    const j = judge(guarded, { cases: [{ id: "false-correct-pct", trials: [30, 40] }], samples: { "graded-points": 10 } });
    assert.equal(j.verdict, "ERROR");
    assert.equal(j.failures.length, 1);
  });
});
