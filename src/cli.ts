import { appendFileSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { formatMarkdown, formatReplay, formatText } from "./format.ts";
import { EXIT_CODE, judge } from "./judge.ts";
import { parseConfig, parseReport } from "./parse.ts";
import { replay } from "./replay.ts";
import type { Parsed } from "./types.ts";

export const HELP = `eval-verdict — turn repeated LLM eval results into one verdict

Usage:
  eval-verdict check  <report.json>     --config <config.json> [--json]
  eval-verdict replay <report.json>...  --config <config.json> [--json]

Exit codes:
  check   0 PASS · 1 FAIL · 2 ERROR (not enough measured, or bad input)
  replay  0 no recorded verdict changes · 1 some would change · 2 bad input

Thresholds live only in the config file, on purpose: a gate whose knobs
change per run is not a gate. See docs/design.md.
`;

export interface Io {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** CLI 본체. 프로세스를 끝내지 않고 exit code 를 돌려준다(테스트에서 그대로 부른다). */
export function run(argv: readonly string[], io: Io): number {
  let args;
  try {
    args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        config: { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (e) {
    return usage(io, errorMessage(e));
  }
  const { values, positionals } = args;
  const [command, ...files] = positionals;

  if (values.help) {
    io.out(HELP);
    return 0;
  }
  if (command !== "check" && command !== "replay") return usage(io, command === undefined ? "missing command" : `unknown command "${command}"`);
  if (values.config === undefined) return usage(io, "--config is required");
  if (files.length === 0) return usage(io, "missing report file");
  if (command === "check" && files.length > 1) return usage(io, "check takes one report; use replay for many");

  const config = load(values.config, parseConfig);
  const reports = files.map((name) => ({ name, parsed: load(name, parseReport) }));
  const issues = [config, ...reports.map((r) => r.parsed)].flatMap((p) => (p.ok ? [] : p.issues));
  if (!config.ok || issues.length > 0) {
    if (values.json) io.out(`${JSON.stringify({ verdict: "ERROR", errors: issues }, null, 2)}\n`);
    else io.err(`eval-verdict: ERROR — bad input\n${issues.map((s) => `  - ${s}`).join("\n")}\n`);
    return 2;
  }
  const loaded = reports.flatMap(({ name, parsed }) => (parsed.ok ? [{ name, report: parsed.value }] : []));

  if (command === "replay") {
    const r = replay(config.value, loaded);
    io.out(values.json ? `${JSON.stringify(r, null, 2)}\n` : formatReplay(r));
    return r.flipped.length > 0 ? 1 : 0;
  }

  const [only] = loaded;
  if (only === undefined) return usage(io, "missing report file");
  const j = judge(config.value, only.report);
  io.out(values.json ? `${JSON.stringify(j, null, 2)}\n` : formatText(j));

  // GitHub Actions 에서는 같은 결과를 job summary 표로도 남긴다. 실패해도 판정은 바꾸지 않는다.
  const summary = io.env.GITHUB_STEP_SUMMARY;
  if (summary !== undefined && summary !== "") {
    try {
      appendFileSync(summary, formatMarkdown(j));
    } catch (e) {
      io.err(`eval-verdict: could not write GITHUB_STEP_SUMMARY (${errorMessage(e)})\n`);
    }
  }
  return EXIT_CODE[j.verdict];
}

function load<T>(file: string, parse: (doc: unknown) => Parsed<T>): Parsed<T> {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    return { ok: false, issues: [`${file}: cannot read (${errorMessage(e)})`] };
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { ok: false, issues: [`${file}: not valid JSON (${errorMessage(e)})`] };
  }
  const parsed = parse(doc);
  return parsed.ok ? parsed : { ok: false, issues: parsed.issues.map((s) => `${file}: ${s}`) };
}

function usage(io: Io, problem: string): number {
  io.err(`eval-verdict: ${problem}\n\n${HELP}`);
  return 2;
}

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
