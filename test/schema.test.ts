import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CONFIG_KEYS, parseConfig, RULE_KEYS } from "../src/parse.ts";

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

interface Schema {
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: boolean;
}
const schema = read("../schema/config.schema.json") as Schema;
const caseKeys = Object.keys(
  (schema.properties.cases as { additionalProperties: { properties: Record<string, unknown> } }).additionalProperties.properties,
);

test("스키마와 파서가 받는 키가 같다 — 하나만 고치면 실패한다", () => {
  assert.deepEqual(Object.keys(schema.properties).sort(), [...CONFIG_KEYS].sort());
  assert.deepEqual(caseKeys.sort(), [...RULE_KEYS].sort());
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required.sort(), [...RULE_KEYS].sort());
});

test("$schema 를 적은 예시 설정을 그대로 읽는다", () => {
  assert.ok(parseConfig(read("../examples/config.json")).ok);
});
