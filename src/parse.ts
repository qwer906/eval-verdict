import type { CaseResult, CaseRule, Config, Parsed, Range, Report, Trial, Verdict } from "./types.ts";

type Json = Record<string, unknown>;

export const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

export const fail = (issues: readonly string[]): Parsed<never> => ({ ok: false, issues });

const VERDICTS: readonly string[] = ["PASS", "FAIL", "ERROR"] satisfies Verdict[];
const isVerdict = (v: unknown): v is Verdict => typeof v === "string" && VERDICTS.includes(v);

const RULE_KEYS = ["pass", "minPassingTrials", "minTrials"];
const CONFIG_KEYS = [...RULE_KEYS, "model", "minCases", "cases", "guards"];

/**
 * 설정 파일을 검사한다. 문제는 처음 하나에서 멈추지 않고 전부 모아 돌려준다.
 *
 * 모르는 키는 오류다. `minPasingTrials` 같은 오타가 조용히 무시되면
 * 기본값으로 돌아가 게이트가 몰래 약해진다.
 */
export function parseConfig(input: unknown): Parsed<Config> {
  if (!isObject(input)) return fail(["config: expected an object"]);
  const issues: string[] = [];
  rejectUnknownKeys(input, CONFIG_KEYS, "config", issues);

  const pass = parseRange(input.pass, "config.pass", issues);
  const minPassingTrials = parseCount(input.minPassingTrials, "config.minPassingTrials", issues);
  const minTrials = parseCount(input.minTrials, "config.minTrials", issues);
  const minCases = input.minCases === undefined ? 1 : parseCount(input.minCases, "config.minCases", issues);
  const model = input.model === undefined ? undefined : parseName(input.model, "config.model", issues);

  const cases: Record<string, Partial<CaseRule>> = {};
  if (input.cases !== undefined) {
    if (!isObject(input.cases)) issues.push("config.cases: expected an object keyed by case id");
    else
      for (const [id, raw] of Object.entries(input.cases)) {
        const at = `config.cases.${id}`;
        if (!isObject(raw)) {
          issues.push(`${at}: expected an object`);
          continue;
        }
        rejectUnknownKeys(raw, RULE_KEYS, at, issues);
        const casePass = raw.pass === undefined ? undefined : parseRange(raw.pass, `${at}.pass`, issues);
        const caseK = raw.minPassingTrials === undefined ? undefined : parseCount(raw.minPassingTrials, `${at}.minPassingTrials`, issues);
        const caseN = raw.minTrials === undefined ? undefined : parseCount(raw.minTrials, `${at}.minTrials`, issues);
        cases[id] = {
          ...(casePass !== undefined ? { pass: casePass } : {}),
          ...(caseK !== undefined ? { minPassingTrials: caseK } : {}),
          ...(caseN !== undefined ? { minTrials: caseN } : {}),
        };
      }
  }

  const guards: Record<string, Range> = {};
  if (input.guards !== undefined) {
    if (!isObject(input.guards)) issues.push("config.guards: expected an object keyed by sample name");
    else
      for (const [name, raw] of Object.entries(input.guards)) {
        const range = parseRange(raw, `config.guards.${name}`, issues);
        if (range !== undefined) guards[name] = range;
      }
  }

  if (pass === undefined || minPassingTrials === undefined || minTrials === undefined || minCases === undefined || issues.length > 0)
    return fail(issues);

  const config: Config = {
    pass,
    minPassingTrials,
    minTrials,
    minCases,
    cases,
    ...(Object.keys(guards).length > 0 ? { guards } : {}),
    ...(model !== undefined ? { model } : {}) };

  // 최소 표본만 모였을 때 절대 통과할 수 없는 규칙은 설정 실수다.
  for (const id of [undefined, ...Object.keys(cases)]) {
    const rule = id === undefined ? config : ruleFor(config, id);
    if (rule.minPassingTrials > rule.minTrials)
      issues.push(
        `${id === undefined ? "config" : `config.cases.${id}`}: minPassingTrials ${String(rule.minPassingTrials)} > minTrials ${String(rule.minTrials)}`,
      );
  }
  return issues.length > 0 ? fail(issues) : { ok: true, value: config };
}

/**
 * 결과 파일을 검사한다. 설정과 달리 모르는 키는 무시한다 — 평가 하네스가
 * 커밋 SHA·시각 같은 메타데이터를 덧붙여도 깨지지 않게.
 */
export function parseReport(input: unknown): Parsed<Report> {
  if (!isObject(input)) return fail(["report: expected an object"]);
  if (!Array.isArray(input.cases)) return fail(["report.cases: expected an array"]);
  const issues: string[] = [];

  const model = input.model === undefined ? undefined : parseName(input.model, "report.model", issues);
  let verdict: Verdict | undefined;
  if (input.verdict !== undefined) {
    if (isVerdict(input.verdict)) verdict = input.verdict;
    else issues.push(`report.verdict: expected "PASS", "FAIL" or "ERROR", got ${JSON.stringify(input.verdict)}`);
  }

  let samples: Record<string, number | null> | undefined;
  if (input.samples !== undefined) {
    if (!isObject(input.samples)) issues.push("report.samples: expected an object keyed by sample name");
    else {
      samples = {};
      for (const [name, v] of Object.entries(input.samples)) {
        if (v === null || (typeof v === "number" && Number.isFinite(v))) samples[name] = v;
        else issues.push(`report.samples.${name}: expected a finite number, or null for "not counted"`);
      }
    }
  }

  const cases: CaseResult[] = [];
  const seen = new Set<string>();
  input.cases.forEach((raw: unknown, i) => {
    const at = `report.cases[${String(i)}]`;
    if (!isObject(raw)) {
      issues.push(`${at}: expected an object`);
      return;
    }
    const id = parseName(raw.id, `${at}.id`, issues);
    if (id !== undefined) {
      if (seen.has(id)) issues.push(`${at}.id: duplicate case id "${id}"`);
      seen.add(id);
    }
    const trials = parseTrials(raw.trials, `${at}.trials`, issues);
    const baseline = raw.baseline === undefined ? undefined : parseTrials(raw.baseline, `${at}.baseline`, issues);
    if (id !== undefined && trials !== undefined) cases.push({ id, trials, ...(baseline !== undefined ? { baseline } : {}) });
  });

  if (issues.length > 0) return fail(issues);
  return { ok: true, value: {
      cases,
      ...(samples !== undefined ? { samples } : {}),
      ...(model !== undefined ? { model } : {}), ...(verdict !== undefined ? { verdict } : {}) } };
}

/** 케이스 하나에 적용할 규칙: 케이스별 값이 있으면 그것, 없으면 기본값. */
export function ruleFor(config: Config, id: string): CaseRule {
  const own = config.cases[id];
  return {
    pass: own?.pass ?? config.pass,
    minPassingTrials: own?.minPassingTrials ?? config.minPassingTrials,
    minTrials: own?.minTrials ?? config.minTrials,
  };
}

function rejectUnknownKeys(obj: Json, allowed: readonly string[], at: string, issues: string[]): void {
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) issues.push(`${at}.${key}: unknown key`);
}

function parseRange(v: unknown, at: string, issues: string[]): Range | undefined {
  if (!isObject(v)) {
    issues.push(`${at}: expected { "min"?: number, "max"?: number }`);
    return undefined;
  }
  rejectUnknownKeys(v, ["min", "max"], at, issues);
  if (v.min === undefined && v.max === undefined) {
    issues.push(`${at}: set min, max, or both`);
    return undefined;
  }
  const min = v.min === undefined ? undefined : parseNumber(v.min, `${at}.min`, issues);
  const max = v.max === undefined ? undefined : parseNumber(v.max, `${at}.max`, issues);
  if (min !== undefined && max !== undefined && min > max) {
    issues.push(`${at}: min ${String(min)} > max ${String(max)}`);
    return undefined;
  }
  return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
}

function parseTrials(v: unknown, at: string, issues: string[]): Trial[] | undefined {
  if (!Array.isArray(v)) {
    issues.push(`${at}: expected an array of numbers or null`);
    return undefined;
  }
  const trials: Trial[] = [];
  v.forEach((t: unknown, i) => {
    if (t === null || (typeof t === "number" && Number.isFinite(t))) trials.push(t);
    else issues.push(`${at}[${String(i)}]: expected a finite number, or null for "not measured"`);
  });
  return trials;
}

function parseNumber(v: unknown, at: string, issues: string[]): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  issues.push(`${at}: expected a finite number, got ${JSON.stringify(v)}`);
  return undefined;
}

function parseCount(v: unknown, at: string, issues: string[]): number | undefined {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1) return v;
  issues.push(`${at}: expected an integer ≥ 1, got ${JSON.stringify(v)}`);
  return undefined;
}

function parseName(v: unknown, at: string, issues: string[]): string | undefined {
  if (typeof v === "string" && v.trim() !== "") return v;
  issues.push(`${at}: expected a non-empty string`);
  return undefined;
}
