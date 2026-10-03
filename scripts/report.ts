import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { libraries } from "../src/reporting/cases.ts";
import { buildMatrix, renderHtml, renderMarkdown, renderTerminal } from "../src/reporting/matrix.ts";
import type { RunnerReport } from "../src/reporting/matrix.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "results");
const rawPath = join(output, "report.json");
const runPath = "runs/" + randomUUID() + "/traces";
const traceDirectory = resolve(output, runPath);
mkdirSync(traceDirectory, { recursive: true });
// A crashed runner must never reuse an old passing report.
rmSync(rawPath, { force: true });
const vitestPackage = fileURLToPath(import.meta.resolve("vitest/package.json"));
const child = spawnSync(process.execPath, [
  join(dirname(vitestPackage), "vitest.mjs"), "run", ...process.argv.slice(2),
  "--reporter=default", "--reporter=json", "--outputFile=" + rawPath,
], {
  cwd: root, stdio: "inherit",
  env: { ...process.env, RESILIENCY_TRACE_DIR: traceDirectory },
});

let report: RunnerReport;
let runnerError: string | undefined;
try {
  const parsed: unknown = JSON.parse(readFileSync(rawPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || !("testResults" in parsed) ||
      !Array.isArray(parsed.testResults) || !("success" in parsed) || typeof parsed.success !== "boolean") {
    throw new Error("Invalid Vitest JSON report");
  }
  report = parsed as RunnerReport;
} catch (error) {
  runnerError = String(error);
  report = { success: false, testResults: [] };
}

const versions: Record<string, string> = {};
for (const library of libraries) {
  const packagePath = join(root, "node_modules", ...library.package.split("/"), "package.json");
  const metadata = JSON.parse(readFileSync(packagePath, "utf8")) as { version: string };
  versions[library.id] = metadata.version;
}
let matrix;
try {
  matrix = buildMatrix(report, versions);
} catch (error) {
  matrix = buildMatrix({ success: false, testResults: [] }, versions);
  matrix.runErrors.push(String(error));
}
if (child.status !== 0 || child.error || child.signal) matrix.runSuccess = false;
if (runnerError) matrix.runErrors.push(runnerError);
if (child.error) matrix.runErrors.push(String(child.error));
if (child.signal) matrix.runErrors.push("Test runner terminated by " + child.signal);
for (const row of matrix.rows) for (const cell of row.cells) {
  const filename = cell.definition?.traceFile;
  if (cell.status === "fail" && filename && existsSync(join(traceDirectory, filename))) {
    cell.trace = runPath + "/" + filename;
  }
}
writeFileSync(join(output, "matrix.json"), JSON.stringify(matrix, null, 2) + "\n");
writeFileSync(join(output, "matrix.md"), renderMarkdown(matrix));
writeFileSync(join(output, "matrix.html"), renderHtml(matrix));
console.log(renderTerminal(matrix));
console.log("\nMatrix: results/matrix.html");
console.log("Markdown: results/matrix.md");
console.log("Data: results/matrix.json");
process.exitCode = matrix.runSuccess ? 0 : 1;
