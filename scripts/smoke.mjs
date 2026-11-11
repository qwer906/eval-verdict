// 빌드된 CLI(dist/bin.js)를 예시 파일로 실제 실행해 exit code를 확인한다.
// 단위 테스트는 run()을 직접 부르므로, 여기서는 bin 진입점·빌드 결과·예시 파일이 맞물리는지만 본다.
import { spawnSync } from "node:child_process";

const cases = [
  [["check", "examples/reports/report.json"], 0],
  [["check", "examples/reports/report-thin.json"], 2],
  [["replay", "examples/reports/report.json", "examples/reports/report-thin.json"], 1],
  [["check", "examples/reports/report.json", "--min", "50"], 2],
];

let failed = 0;
for (const [args, want] of cases) {
  const r = spawnSync(process.execPath, ["dist/bin.js", ...args, "--config", "examples/config.json"], { encoding: "utf8" });
  const ok = r.status === want;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} eval-verdict ${args.join(" ")} → exit ${String(r.status)} (want ${String(want)})`);
}
process.exitCode = failed > 0 ? 1 : 0;
