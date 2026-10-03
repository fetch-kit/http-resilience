import { beforeEach, describe, expect, vi } from "vitest";
import { matrixIt } from "../matrix.js";
import { retryAdapters } from "../../src/adapters/index.js";
import { competitorAdapters } from "../../src/adapters/competitors.js";
import { readBody } from "../../src/adapters/types.js";
import { getCase } from "../../src/reporting/cases.js";
import { expectAbort, expectCircuit, expectHttpOutcome } from "../contracts.js";
import { capture, fakeTime, transport, clientFor, observe } from "../helpers.js";

const url = "https://example.test/resource";
const adapters = [...retryAdapters, ...competitorAdapters].filter(adapter => adapter.name !== "ffetch");
describe.each(adapters)("$name: combinations", adapter => {
  beforeEach(fakeTime);
  matrixIt("retry-backoff-abort", adapter.name, async () => {
    const fixture = transport(adapter.name + "-retry-backoff-abort", [
      { type: "response", status: 503 },
      ...Array.from({ length: 3 }, () => ({ type: "response" as const, body: "healthy" })),
    ]);
    const client = await clientFor(adapter, fixture.fetch, { retries: 2, delayMs: 100 });
    const controller = new AbortController();
    const result = observe(client(url, { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(20);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    const prompt = result.outcome;
    // Drain before assertions so failures cannot leave a retry running into another test.
    await vi.advanceTimersByTimeAsync(1_000);
    const attemptsAfterAbort = fixture.attempts;
    expect.soft(prompt, "Cancellation must settle during backoff").toBeDefined();
    const final = result.outcome;
    expect(final, "Cancelled request must settle after draining timers").toBeDefined();
    if (final) {
      expect(final.ok).toBe(false);
      if (!final.ok) expectAbort(adapter.name, final.error, controller.signal.reason);
    }
    expect.soft(attemptsAfterAbort, "No dispatch after cancellation").toBe(1);
    const followup = capture(client(url));
    await vi.advanceTimersByTimeAsync(1_000);
    const outcome = await followup;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw outcome.error;
    expect(await readBody(outcome.value)).toBe("healthy");
    expect(fixture.attempts).toBe(2);
    expect(fixture.activeAttempts).toBe(0);
    expect(fixture.pendingTimers).toBe(0);
  });
  if (!getCase("bulkhead-queued-abort", adapter.name).notApplicable) {
    matrixIt("bulkhead-queued-abort", adapter.name, async () => {
      const fixture = transport(adapter.name + "-bulkhead-queued-abort", [
        { type: "response", delayMs: 100, body: "first" },
        { type: "response", body: "replacement" },
      ]);
      const client = await clientFor(adapter, fixture.fetch, { retries: 0, delayMs: 20, combination: "bulkhead" });
      const first = capture(client(url + "/first"));
      await vi.advanceTimersByTimeAsync(0);
      const controller = new AbortController();
      const queued = observe(client(url + "/cancelled", { signal: controller.signal }));
      await vi.advanceTimersByTimeAsync(20);
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      const prompt = queued.outcome;
      const replacement = capture(client(url + "/replacement"));
      await vi.advanceTimersByTimeAsync(200);
      expect.soft(prompt, "Queued cancellation must settle before slot handoff").toBeDefined();
      const cancelled = queued.outcome;
      expect(cancelled, "Queued request must eventually settle").toBeDefined();
      if (cancelled) {
        expect(cancelled.ok).toBe(false);
        if (!cancelled.ok) expectAbort(adapter.name, cancelled.error, controller.signal.reason);
      }
      expect.soft((await first).ok).toBe(true);
      const next = await replacement;
      expect.soft(next.ok, "Cancelled queue entry must release queue capacity").toBe(true);
      if (next.ok) expect(await readBody(next.value)).toBe("replacement");
      expect(fixture.attempts).toBe(2);
      const urls = fixture.trace.events.filter(event => event.type === "request").map(event => event.data.url);
      expect(urls).not.toContain(url + "/cancelled");
      expect(fixture.activeAttempts).toBe(0);
      expect(fixture.pendingTimers).toBe(0);
    });
  }
  if (!getCase("hedge-stream-winner", adapter.name).notApplicable) {
    matrixIt("hedge-stream-winner", adapter.name, async () => {
      const fixture = transport(adapter.name + "-hedge-stream-winner", [
        { type: "hang" },
        { type: "response", body: [{ afterMs: 20, text: "win" }, { afterMs: 20, text: "ner" }] },
      ]);
      const client = await clientFor(adapter, fixture.fetch, { retries: 0, delayMs: 20, combination: "hedge" });
      const controller = new AbortController();
      const result = capture(client(url, { signal: controller.signal }));
      await vi.advanceTimersByTimeAsync(10);
      const outcome = await result;
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw outcome.error;
      const body = capture(readBody(outcome.value));
      await vi.advanceTimersByTimeAsync(100);
      expect(await body).toEqual({ ok: true, value: "winner" });
      if (adapter.name === "flowshield") {
        // Its documented hedge discards the loser result; cancellation belongs to the caller.
        expect(fixture.activeAttempts).toBe(1);
        controller.abort();
        await vi.advanceTimersByTimeAsync(0);
      } else {
        expect(fixture.trace.events.some(event => event.attempt === 1 && event.type === "attempt:abort")).toBe(true);
      }
      expect(fixture.attempts).toBe(2);
      expect.soft(fixture.activeAttempts).toBe(0);
      expect(fixture.activeBodies).toBe(0);
      expect(fixture.pendingTimers).toBe(0);
    });
    matrixIt("circuit-hedge", adapter.name, async () => {
      const fixture = transport(adapter.name + "-circuit-hedge", [
        { type: "response", status: 503, delayMs: 15 },
        { type: "response", delayMs: 20, body: "winner" },
        { type: "response", body: "healthy" },
        { type: "response", status: 503, body: "busy" },
        ...(adapter.name === "@resili/fetch" ? [{ type: "response" as const, status: 503, body: "busy" }] : []),
      ]);
      const client = await clientFor(adapter, fixture.fetch, { retries: 0, delayMs: 20, combination: "circuit-hedge" });
      const controller = new AbortController();
      const result = capture(client(url, { signal: controller.signal }));
      await vi.advanceTimersByTimeAsync(100);
      const outcome = await result;
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw outcome.error;
      expect(await readBody(outcome.value)).toBe("winner");
      expect(await readBody(await client(url))).toBe("healthy");
      const failureResult = capture(client(url, { method: "POST" }));
      await vi.advanceTimersByTimeAsync(100);
      const failure = await failureResult;
      if (adapter.name === "@resili/fetch") {
        expect(failure.ok).toBe(false);
        if (failure.ok) throw new Error("Expected all hedges to fail");
        expect((failure.error as Error).constructor).toBe(Error);
        expect((failure.error as Error).message).toBe("No acceptable hedged result completed.");
      } else {
        await expectHttpOutcome(adapter.name, failure, 1, "busy");
      }
      const refusalResult = capture(client(url));
      await vi.advanceTimersByTimeAsync(100);
      const refusal = await refusalResult;
      expect(refusal.ok).toBe(false);
      if (refusal.ok) throw new Error("Expected circuit rejection");
      expectCircuit(adapter.name, refusal.error);
      expect(fixture.attempts).toBe(adapter.name === "@resili/fetch" ? 5 : 4);
    });
  }
});
