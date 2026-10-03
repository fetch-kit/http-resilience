import { describe, expect, it, vi } from "vitest";
import { ScriptExhaustedError } from "../../src/harness/scripted-fetch.js";
import { capture, fakeTime, transport } from "../helpers.js";

const url = "https://example.test/resource";

describe("scripted fetch", () => {
  it("fails on unexpected traffic instead of inventing a response", async () => {
    const fixture = transport("harness-exhaustion", []);
    const outcome = await capture(fixture.fetch(url));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBeInstanceOf(ScriptExhaustedError);
    expect(fixture.attempts).toBe(1);
  });

  it("aborts pending headers and removes their timer", async () => {
    fakeTime();
    const fixture = transport("harness-abort", [
      { type: "response", delayMs: 100, body: "late" },
    ]);
    const controller = new AbortController();
    const outcome = capture(fixture.fetch(url, { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(10);
    const reason = new DOMException("caller cancelled", "AbortError");
    controller.abort(reason);
    expect(await outcome).toEqual({ ok: false, error: reason });
    await vi.advanceTimersByTimeAsync(200);
    expect(fixture.activeAttempts).toBe(0);
    expect(fixture.pendingTimers).toBe(0);
    expect(fixture.trace.events.some(event => event.type === "response:headers")).toBe(false);
  });

  it("keeps cancellation connected after response headers", async () => {
    fakeTime();
    const fixture = transport("harness-stream-abort", [{
      type: "response",
      body: [{ afterMs: 20, text: "late" }],
    }]);
    const controller = new AbortController();
    const response = await fixture.fetch(url, { signal: controller.signal });
    const body = capture(response.text());
    const reason = new DOMException("body cancelled", "AbortError");
    controller.abort(reason);
    expect(await body).toEqual({ ok: false, error: reason });
    expect(fixture.activeBodies).toBe(0);
    expect(fixture.pendingTimers).toBe(0);
  });

  it("records consumed request bytes and cancels unused response bodies", async () => {
    fakeTime();
    const fixture = transport("harness-body", [{
      type: "response",
      body: [{ afterMs: 20, text: "unused" }],
    }]);
    const response = await fixture.fetch(url, { method: "POST", body: "payload" });
    expect(fixture.trace.events.find(event => event.type === "request:body")?.data.bytes)
      .toEqual([...new TextEncoder().encode("payload")]);
    await response.body?.cancel();
    expect(fixture.activeBodies).toBe(0);
    expect(fixture.pendingTimers).toBe(0);
  });
});
