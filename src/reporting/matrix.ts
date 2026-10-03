import { cases, libraries, scenarios } from "./cases.ts";
import type { CaseDefinition, LibraryId, ScenarioId } from "./cases.ts";

export interface AssertionResult {
  status: string;
  fullName: string;
  failureMessages?: string[];
  duration?: number;
  meta?: { matrix?: { scenarioId: string; libraryId: string } };
}

export interface RunnerReport {
  success: boolean;
  startTime?: number;
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  testResults: { name: string; message?: string; assertionResults: AssertionResult[] }[];
}

export type CellStatus = "pass" | "fail" | "skipped" | "not-run" | "not-tested" | "not-applicable";
export interface Cell {
  scenarioId: ScenarioId;
  libraryId: LibraryId;
  status: CellStatus;
  definition?: CaseDefinition;
  failures: string[];
  durationMs?: number;
  trace?: string;
}
export interface Matrix {
  generatedAt: string;
  runtime: string;
  runSuccess: boolean;
  runErrors: string[];
  versions: Record<string, string>;
  counts: Record<CellStatus, number>;
  rows: { id: ScenarioId; title: string; description: string; cells: Cell[] }[];
}

export function buildMatrix(
  report: RunnerReport,
  versions: Record<string, string>,
  runtime = process.version,
): Matrix {
  const observed = new Map<string, AssertionResult>();
  for (const suite of report.testResults) {
    for (const test of suite.assertionResults) {
      const meta = test.meta?.matrix;
      if (!meta) continue; // Harness and reporter self-tests are not library results.
      const key = meta.scenarioId + "/" + meta.libraryId;
      if (!cases.some(item => item.scenarioId === meta.scenarioId && item.libraryId === meta.libraryId)) {
        throw new Error("Unregistered result: " + key);
      }
      const definition = cases.find(item => item.scenarioId === meta.scenarioId && item.libraryId === meta.libraryId);
      if (definition?.notApplicable) throw new Error("Inapplicable result: " + key);
      if (observed.has(key)) throw new Error("Duplicate result: " + key);
      observed.set(key, test);
    }
  }
  const counts: Matrix["counts"] = { pass: 0, fail: 0, skipped: 0, "not-run": 0, "not-tested": 0, "not-applicable": 0 };
  const rows = scenarios.map(scenario => ({
    ...scenario,
    cells: libraries.map(library => {
      const definition = cases.find(item => item.scenarioId === scenario.id && item.libraryId === library.id);
      const test = observed.get(scenario.id + "/" + library.id);
      const status: CellStatus = !definition ? "not-tested" : definition.notApplicable ? "not-applicable" : !test ? "not-run"
        : test.status === "passed" ? "pass"
        : test.status === "failed" ? "fail"
        : ["pending", "skipped", "todo", "disabled"].includes(test.status) ? "skipped"
        : "not-run";
      counts[status]++;
      const cell: Cell = { scenarioId: scenario.id, libraryId: library.id, status, failures: test?.failureMessages ?? [] };
      if (definition) cell.definition = definition;
      if (test?.duration !== undefined) cell.durationMs = test.duration;
      return cell;
    }),
  }));
  return {
    generatedAt: new Date(report.startTime ?? Date.now()).toISOString(),
    runtime, runSuccess: report.success,
    runErrors: report.testResults.filter(suite => suite.message).map(suite => suite.name + ": " + suite.message),
    versions, counts, rows,
  };
}

const labels: Record<CellStatus, string> = {
  pass: "PASS", fail: "FAIL", skipped: "SKIPPED", "not-run": "NOT RUN", "not-tested": "NOT TESTED", "not-applicable": "N/A",
};
const symbols: Record<CellStatus, string> = {
  pass: "✅", fail: "❌", skipped: "⏭️", "not-run": "❓", "not-tested": "⬜", "not-applicable": "➖",
};

const cellLabel = (status: CellStatus) => symbols[status] + "\u00a0" + labels[status];

const anchor = (cell: Cell) => "case-" + cell.scenarioId + "-" + cell.libraryId;
const html = (value: string) => value.replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]!));
const md = (value: string) => html(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const heading = (matrix: Matrix, id: string) => id + " " + (matrix.versions[id] ?? "unknown");
const summary = (matrix: Matrix) =>
  `${matrix.counts.pass} passed, ${matrix.counts.fail} failed, ${matrix.counts.skipped} skipped, ${matrix.counts["not-run"]} not run; ${matrix.counts["not-tested"]} cells have no implemented test; ${matrix.counts["not-applicable"]} N/A.`;

export function renderTerminal(matrix: Matrix): string {
  const header = ["Scenario", ...libraries.map(library => heading(matrix, library.id))];
  const rows = matrix.rows.map(row => [row.title, ...row.cells.map(cell => labels[cell.status])]);
  const widths = header.map((_, index) => Math.max(...[header, ...rows].map(row => row[index]!.length)));
  const format = (row: string[]) => "| " + row.map((value, index) => value.padEnd(widths[index]!)).join(" | ") + " |";
  return [
    "\nCorrectness matrix",
    format(header),
    "|" + widths.map(width => "-".repeat(width + 2)).join("|") + "|",
    ...rows.map(format),
    summary(matrix),
    "N/A = combination unavailable (see cell reason); NOT TESTED = unimplemented; NOT RUN = missing result.",
    ...(matrix.runSuccess ? [] : ["Test run failed. See matrix.html for assertion/run errors."]),
  ].join("\n");
}

export function renderMarkdown(matrix: Matrix): string {
  const lines = [
    "# Fetch resilience correctness matrix", "",
    `${matrix.generatedAt} - Node ${matrix.runtime}`, "",
    "| Scenario | " + libraries.map(library => md(heading(matrix, library.id))).join(" | ") + " |",
    "| --- | " + libraries.map(() => "---").join(" | ") + " |",
    ...matrix.rows.map(row => "| " + md(row.title) + " | " + row.cells.map(cell =>
      cell.definition ? "[" + cellLabel(cell.status) + "](#" + anchor(cell) + ")" : cellLabel(cell.status),
    ).join(" | ") + " |"),
    "", summary(matrix), "",
    "N/A means this combination is unavailable; each cell explains why. NOT TESTED means unimplemented; NOT RUN means a registered case was absent from this run.", "",
    "## Case details", "",
  ];
  for (const row of matrix.rows) for (const cell of row.cells) {
    if (!cell.definition) continue;
    lines.push(
      '<a id="' + anchor(cell) + '"></a>', "",
      "### " + md(row.title + " / " + cell.libraryId) + " - " + cellLabel(cell.status), "",
      "**Configuration:** " + md(cell.definition.configuration), "",
      "**Expected:** " + md(cell.definition.expected), "",
    );
    if (cell.trace) lines.push("[Failure trace](" + cell.trace + ")", "");
    for (const failure of cell.failures) lines.push(...failure.split("\n").map(line => "    " + line), "");
  }
  if (matrix.runErrors.length) {
    lines.push("## Run errors", "");
    for (const error of matrix.runErrors) lines.push(...error.split("\n").map(line => "    " + line), "");
  }
  return lines.join("\n") + "\n";
}

export function renderHtml(matrix: Matrix): string {
  const headers = libraries.map(library => "<th>" + html(heading(matrix, library.id)) + "</th>").join("");
  const rows = matrix.rows.map(row => "<tr><th scope=\"row\" title=\"" + html(row.description) + "\">" +
    html(row.title) + "</th>" + row.cells.map(cell =>
      '<td class="' + cell.status + '">' + (cell.definition
        ? '<a href="#' + anchor(cell) + '">' + labels[cell.status] + "</a>"
        : labels[cell.status]) + "</td>",
    ).join("") + "</tr>").join("\n");
  const details = matrix.rows.flatMap(row => row.cells.filter(cell => cell.definition).map(cell =>
    '<details id="' + anchor(cell) + '"><summary>' + html(row.title + " / " + cell.libraryId) +
    " - " + labels[cell.status] + "</summary><p><strong>Configuration:</strong> " +
    html(cell.definition!.configuration) + "</p><p><strong>Expected:</strong> " +
    html(cell.definition!.expected) + "</p>" +
    cell.failures.map(failure => "<pre>" + html(failure) + "</pre>").join("") +
    (cell.trace ? '<p><a href="' + html(cell.trace) + '">Failure trace</a></p>' : "") + "</details>",
  )).join("\n");
  const errors = matrix.runErrors.map(error => "<pre>" + html(error) + "</pre>").join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fetch resilience correctness matrix</title>
<style>
body{font:16px system-ui,sans-serif;margin:32px auto;padding:0 20px;max-width:1100px;color:#172033;background:#f8fafc}
h1{font-size:26px}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;background:white}
th,td{border:1px solid #cbd5e1;padding:12px;text-align:left}td{font:13px ui-monospace,monospace;text-align:center}
td a{color:inherit;font-weight:700}.pass{background:#dcfce7;color:#166534}.fail{background:#fee2e2;color:#991b1b}
.skipped,.not-run{background:#fef3c7;color:#92400e}.not-applicable,.not-tested{color:#64748b;background:#f1f5f9}
details{margin:12px 0;background:white;padding:14px;border:1px solid #cbd5e1;border-radius:6px}
summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f5f9;padding:12px}
.note{color:#475569}a{color:#1d4ed8}details:target{outline:2px solid #2563eb}
</style></head><body>
<h1>Fetch resilience correctness matrix</h1>
<p>${html(matrix.generatedAt)} - Node ${html(matrix.runtime)}</p>
<div class="scroll"><table><thead><tr><th>Scenario</th>${headers}</tr></thead><tbody>${rows}</tbody></table></div>
<p>${html(summary(matrix))}</p>
<p class="note">N/A means this combination is unavailable; each cell explains why. NOT TESTED means unimplemented; NOT RUN means a registered case was absent from this run. Cells link to configurations, expected behavior, and failure details.</p>
<h2>Case details</h2>${details}
${errors ? "<h2>Run errors</h2>" + errors : ""}
<script>function openTarget(){const target=document.getElementById(location.hash.slice(1));if(target instanceof HTMLDetailsElement)target.open=true}addEventListener("hashchange",openTarget);openTarget();</script>
</body></html>\n`;
}
