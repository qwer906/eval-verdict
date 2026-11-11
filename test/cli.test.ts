import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "../src/cli.ts";

const dir = mkdtempSync(join(tmpdir(), "eval-verdict-"));
const file = (name: string, doc: unknown): string => {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(doc));
  return path;
};

const config = file("config.json", {
  pass: { min: 80 },
  minPassingTrials: 1,
  minTrials: 2,
  guards: { "graded-points": { min: 200 } },
});
const good = file("good.json", { verdict: "PASS", cases: [{ id: "exact", trials: [90, 70] }], samples: { "graded-points": 300 } });
const bad = file("bad.json", { verdict: "PASS", cases: [{ id: "exact", trials: [60, 70] }], samples: { "graded-points": 300 } });
const thin = file("thin.json", { cases: [{ id: "exact", trials: [90, 90] }], samples: { "graded-points": 10 } });

function call(...argv: string[]) {
  let out = "";
  let err = "";
  const summary = join(dir, "summary.md");
  writeFileSync(summary, "");
  const code = run(argv, { out: (t) => (out += t), err: (t) => (err += t), env: { GITHUB_STEP_SUMMARY: summary } });
  return { code, out, err, summary: readFileSync(summary, "utf8") };
}

test("check: PASS 0 · FAIL 1 · 표본 부족 ERROR 2", () => {
  assert.equal(call("check", good, "--config", config).code, 0);
  assert.equal(call("check", bad, "--config", config).code, 1);
  const thinRun = call("check", thin, "--config", config);
  assert.equal(thinRun.code, 2);
  assert.match(thinRun.out, /samples\.graded-points: 10 outside guard n ≥ 200/);
});

test("check: GITHUB_STEP_SUMMARY 에 같은 판정을 표로 남긴다", () => {
  assert.match(call("check", good, "--config", config).summary, /^### eval-verdict: PASS/);
});

test("check --json: 판정 객체를 그대로 낸다", () => {
  const r = call("check", bad, "--config", config, "--json");
  assert.equal((JSON.parse(r.out) as { verdict: string }).verdict, "FAIL");
});

test("replay: 기록된 판정이 뒤집히면 exit 1", () => {
  const r = call("replay", good, bad, thin, "--config", config);
  assert.equal(r.code, 1);
  assert.match(r.out, /1 of 2 recorded verdicts would change/);
});

test("입력 오류는 전부 모아 exit 2 — 설정 오타도 오류다", () => {
  const typo = file("typo.json", { pass: { min: 80 }, minPasingTrials: 1, minTrials: 2 });
  const r = call("check", join(dir, "nope.json"), "--config", typo);
  assert.equal(r.code, 2);
  assert.match(r.err, /minPasingTrials: unknown key/);
  assert.match(r.err, /nope\.json: cannot read/);
});

test("임계 플래그는 없다", () => {
  assert.equal(call("check", good, "--config", config, "--min", "50").code, 2);
});
