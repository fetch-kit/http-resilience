import { cases } from "../../src/reporting/cases.ts";
import { describe, expect, it } from "vitest";
import { buildMatrix, renderHtml, renderMarkdown, renderTerminal } from "../../src/reporting/matrix.ts";
import type { AssertionResult, RunnerReport } from "../../src/reporting/matrix.ts";

const versions = { ffetch: "5.7.1", ky: "2.1.0", "fetch-retry": "6.0.0" };
const assertion = (status: string): AssertionResult => ({
  fullName: "An arbitrary test title", status,
  meta: { matrix: { scenarioId: "retry-exhaustion", libraryId: "ffetch" } },
});
const report = (assertionResults: AssertionResult[], success = true): RunnerReport => ({
  success, startTime: 0, testResults: [{ name: "retry.test.ts", assertionResults }],
});

describe("correctness matrix reporter", () => {
  it("uses stable metadata and excludes harness results", () => {
    const matrix = buildMatrix(report([
      assertion("passed"), { fullName: "harness self-test", status: "passed" },
    ]), versions);
    const cell = matrix.rows.find(row => row.id === "retry-exhaustion")!.cells[0]!;
    expect(cell.status).toBe("pass");
    expect(cell.definition?.expected).toContain("Exact HttpError");
    expect(matrix.counts.pass).toBe(1);
    expect(renderTerminal(matrix)).toContain("ffetch 5.7.1");
  });

  it("shows the generation time and runtime without a run status header", () => {
    const matrix = buildMatrix(report([]), versions);
    const header = matrix.generatedAt + " - Node " + matrix.runtime;
    expect(renderMarkdown(matrix)).toContain(header);
    expect(renderHtml(matrix)).toContain(header);
    expect(renderMarkdown(matrix)).not.toContain("Run: ");
    expect(renderHtml(matrix)).not.toContain("Run: ");
  });

  it("preserves assertion failures in a failing matrix", () => {
    const failed = assertion("failed");
    failed.failureMessages = ["Expected HttpError, received TimeoutError"];
    const matrix = buildMatrix(report([failed], false), versions);
    expect(matrix.runSuccess).toBe(false);
    expect(matrix.counts.fail).toBe(1);
    expect(renderMarkdown(matrix)).toContain("Expected HttpError, received TimeoutError");
    expect(renderHtml(matrix)).toContain('class="fail"');
  });

  it("keeps pass, fail and N/A labels and adds symbols in the Markdown matrix", () => {
    expect(renderMarkdown(buildMatrix(report([assertion("passed")]), versions))).toContain("✅\u00a0PASS");

    const failed = assertion("failed");
    failed.failureMessages = ["boom"];
    const failing = renderMarkdown(buildMatrix(report([failed], false), versions));
    expect(failing).toContain("❌\u00a0FAIL");
    expect(failing).toContain("### Retry exhaustion / ffetch - ❌\u00a0FAIL");

    // A run with no results leaves the inapplicable combinations as N/A.
    expect(renderMarkdown(buildMatrix(report([]), versions))).toContain("➖\u00a0N/A");
  });

  it("distinguishes missing registered results from inapplicable combinations", () => {
    const matrix = buildMatrix(report([]), versions);
    expect(matrix.rows[0]!.cells[0]!.status).toBe("not-run");
    expect(matrix.rows.find(row => row.id === "bulkhead-queued-abort")!.cells[1]!.status).toBe("not-applicable");
    expect(matrix.counts["not-run"]).toBe(cases.filter(item => !item.notApplicable).length);
    expect(matrix.counts["not-tested"]).toBe(0);
    expect(matrix.counts["not-applicable"]).toBe(cases.filter(item => item.notApplicable).length);
  });

  it("reports skipped cases without treating them as passes", () => {
    const matrix = buildMatrix(report([assertion("pending")]), versions);
    expect(matrix.counts.pass).toBe(0);
    expect(matrix.counts.skipped).toBe(1);
  });

  it("rejects duplicate and unknown cell metadata", () => {
    expect(() => buildMatrix(report([assertion("passed"), assertion("failed")]), versions)).toThrow("Duplicate");
    const unknown = assertion("passed");
    unknown.meta = { matrix: { scenarioId: "unknown", libraryId: "ffetch" } };
    expect(() => buildMatrix(report([unknown]), versions)).toThrow("Unregistered");
    const inapplicable = assertion("passed");
    inapplicable.meta = { matrix: { scenarioId: "bulkhead-queued-abort", libraryId: "ky" } };
    expect(() => buildMatrix(report([inapplicable]), versions)).toThrow("Inapplicable");
  });

  it("escapes failure content and retains trace links", () => {
    const failed = assertion("failed");
    failed.failureMessages = ['<script>alert("bad")</script> | failure'];
    const matrix = buildMatrix(report([failed], false), versions);
    matrix.rows.find(row => row.id === "retry-exhaustion")!.cells[0]!.trace = "runs/id/traces/failed.json";
    const html = renderHtml(matrix);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('<script>alert("bad")');
    expect(html).toContain('href="runs/id/traces/failed.json"');
    expect(renderMarkdown(matrix)).toContain("[Failure trace](runs/id/traces/failed.json)");
  });
});
