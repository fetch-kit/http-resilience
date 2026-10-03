import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { libraries, scenarios } from "../src/reporting/cases.ts";
import type { CellStatus, Matrix } from "../src/reporting/matrix.ts";

// Publishing gate for the correctness matrix.
//
// Failing assertions are this repo's data, so the report command exits nonzero
// on purpose. What must never be published is a *crash*: a runner that died
// still writes matrix.json, with every cell "not-run", and deploying that would
// replace a real matrix with an empty one. So publishing is gated on the report
// accounting for every registered case.

const root = fileURLToPath(new URL("../", import.meta.url));
const display: [CellStatus, string][] = [
  ["pass", "PASS"], ["fail", "FAIL"], ["skipped", "SKIPPED"], ["not-run", "NOT RUN"],
  ["not-tested", "NOT TESTED"], ["not-applicable", "N/A"],
];

let parsed: Matrix | undefined;
let parseError: string | undefined;
try {
  parsed = JSON.parse(readFileSync(join(root, "results", "matrix.json"), "utf8")) as Matrix;
} catch (error) {
  parseError = String(error);
}
const matrix = parsed;

if (!matrix) {
  console.error("Refusing to publish an incomplete matrix: results/matrix.json unreadable: " + parseError);
  process.exitCode = 1;
} else {
  const problems: string[] = [];
  const expected = libraries.length * scenarios.length;
  const total = display.reduce((sum, [status]) => sum + matrix.counts[status], 0);
  if (matrix.rows.length !== scenarios.length) {
    problems.push("rows=" + matrix.rows.length + " expected=" + scenarios.length);
  }
  if (total !== expected) problems.push("cells=" + total + " expected=" + expected);
  for (const status of ["skipped", "not-run", "not-tested"] as const) {
    if (matrix.counts[status] > 0) problems.push(status + "=" + matrix.counts[status]);
  }
  if (matrix.counts.pass + matrix.counts.fail === 0) problems.push("no correctness assertion executed");
  if (matrix.runErrors.length > 0) problems.push("runErrors: " + matrix.runErrors.join("; "));

  const pinned = Object.keys(matrix.versions).length;
  const failures = matrix.rows.reduce(
    (count, row) => count + row.cells.filter(cell => cell.status === "fail").length, 0);
  console.log("### Correctness matrix");
  console.log("");
  console.log("Generated " + matrix.generatedAt + " on Node " + matrix.runtime +
    ", " + pinned + " libraries pinned across " + matrix.rows.length + " scenarios.");
  console.log("");
  console.log("| " + display.map(([, label]) => label).join(" | ") + " |");
  console.log("| " + display.map(() => "---").join(" | ") + " |");
  console.log("| " + display.map(([status]) => matrix.counts[status]).join(" | ") + " |");
  console.log("");
  console.log(failures + " failing cells are the matrix's data: each one links to its configuration, " +
    "expected contract and failure trace.");

  if (problems.length > 0) {
    console.error("Refusing to publish an incomplete matrix: " + problems.join("; "));
    process.exitCode = 1;
  }
}
