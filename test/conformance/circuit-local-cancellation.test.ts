import { beforeEach, describe, expect, vi } from "vitest";
import { circuitAdapter, circuitProfiles } from "../../src/adapters/circuits.js";
import { HttpStatusError } from "../../src/adapters/competitors.js";
import { readBody } from "../../src/adapters/types.js";
import { expectAbort, expectHttpOutcome } from "../contracts.js";
import { clientFor, fakeTime, observe, transport } from "../helpers.js";
import { matrixIt } from "../matrix.js";

describe.each(circuitProfiles)("$name: local cancellation", profile => {
  beforeEach(fakeTime);
  matrixIt("circuit-local-cancellation", profile.name, async () => {
    const label = profile.name + "-circuit-local-cancellation";
    // An abort of an active call must follow the configured error classifier.
    const active = transport(label, [
      { type: "hang" }, { type: "response", body: "healthy" },
    ]);
    const client = await clientFor(circuitAdapter(profile.name, 1, 10_000), active.fetch, { retries: 0, delayMs: 100 });
    const controller = new AbortController();
    const cancelled = observe(client("https://example.test/active", { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(20);
    controller.abort(new DOMException("Caller stopped active fetch", "AbortError"));
    await vi.advanceTimersByTimeAsync(0);
    expect.soft(cancelled.outcome, "active fetch must settle promptly").toBeDefined();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(cancelled.outcome?.ok).toBe(false);
    if (cancelled.outcome && !cancelled.outcome.ok) expectAbort(profile.name, cancelled.outcome.error, controller.signal.reason);
    expect.soft(active.attempts, "active cancellation must not retry").toBe(1);
    expect(active.activeAttempts).toBe(0);
    expect(active.pendingTimers).toBe(0);
    if (profile.abortCounts) {
      const refused = observe(client("https://example.test/health-after-abort"));
      await vi.advanceTimersByTimeAsync(0);
      expect(refused.outcome?.ok).toBe(false);
      if (refused.outcome && !refused.outcome.ok) expect((refused.outcome.error as Error).constructor).toBe(profile.error);
      expect(active.attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(10_001);
    }
    const healthy = observe(client("https://example.test/health-after-abort"));
    await vi.advanceTimersByTimeAsync(0);
    expect(healthy.outcome?.ok).toBe(true);
    if (healthy.outcome?.ok) expect(await readBody(healthy.outcome.value)).toBe("healthy");

    expect(active.attempts).toBe(2);
    expect(active.activeAttempts).toBe(0);
    expect(active.pendingTimers).toBe(0);

    // In backoff, the earlier 503 still counts where the circuit wraps attempts.
    const abortTransport = transport(label, Array.from({ length: 4 }, () => ({
      type: "response" as const, status: 503, body: "busy",
    })));
    const logicalFailures = profile.accounting === "attempt" || profile.abortCounts ? 1 : 2;
    // Resili records the aborted attempt as a nonfailure sample in its two-call rate window.
    const expectedFailures = profile.name === "@resili/fetch" ? 2 : profile.accounting === "attempt" ? 1 : logicalFailures * 2;
    const health = transport(label, [
      ...Array.from({ length: expectedFailures }, () => ({ type: "response" as const, status: 503, body: "busy" })),
      { type: "response", body: "recovered" },
    ]);
    const request = await clientFor(circuitAdapter(profile.name, 2, 10_000),
      (input, init) => (input instanceof Request ? input.url : String(input)).endsWith("/cancelled") ? abortTransport.fetch(input, init) : health.fetch(input, init),
      { retries: 1, delayMs: 100 });
    const backoffController = new AbortController();
    const backoff = observe(request("https://example.test/cancelled", { signal: backoffController.signal }));
    await vi.advanceTimersByTimeAsync(10);
    expect(abortTransport.attempts).toBe(1);
    backoffController.abort(new DOMException("Caller stopped retry backoff", "AbortError"));
    await vi.advanceTimersByTimeAsync(0);
    expect.soft(backoff.outcome, "backoff cancellation must settle promptly").toBeDefined();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(backoff.outcome?.ok).toBe(false);
    if (backoff.outcome && !backoff.outcome.ok) expectAbort(profile.name, backoff.outcome.error, backoffController.signal.reason);
    expect.soft(abortTransport.attempts, "no dispatch after backoff cancellation").toBe(1);
    expect(abortTransport.activeAttempts).toBe(0);
    expect(abortTransport.pendingTimers).toBe(0);
    for (let failure = 0; failure < logicalFailures; failure++) {
      const result = observe(request("https://example.test/dependency-failure"));
      await vi.advanceTimersByTimeAsync(200);
      expect(result.outcome).toBeDefined();
      if (!result.outcome) throw new Error("Failure request did not settle");
      if ((profile.accounting === "attempt" && profile.name !== "@resili/fetch") || (profile.name === "ffetch" && failure === logicalFailures - 1)) {
        expect(result.outcome.ok).toBe(false);
        if (!result.outcome.ok) expect((result.outcome.error as Error).constructor).toBe(profile.error);
      } else if (profile.name === "fetch-resilience") {
        expect(result.outcome.ok).toBe(false);
        if (!result.outcome.ok) {
          expect((result.outcome.error as Error).constructor).toBe(HttpStatusError);
          expect((result.outcome.error as HttpStatusError).response.status).toBe(503);
        }
      } else await expectHttpOutcome(profile.name, result.outcome, 2, "busy");
      expect(health.attempts).toBe(profile.accounting === "attempt" ? expectedFailures : (failure + 1) * 2);
    }
    const refused = observe(request("https://example.test/refused"));
    await vi.advanceTimersByTimeAsync(0);
    expect(refused.outcome?.ok).toBe(false);
    if (refused.outcome && !refused.outcome.ok) expect((refused.outcome.error as Error).constructor).toBe(profile.error);
    expect(health.attempts).toBe(expectedFailures);
    await vi.advanceTimersByTimeAsync(10_001);
    const recovered = observe(request("https://example.test/recovered"));
    await vi.advanceTimersByTimeAsync(0);
    expect(recovered.outcome?.ok).toBe(true);
    if (recovered.outcome?.ok) expect(await readBody(recovered.outcome.value)).toBe("recovered");
    expect(health.attempts).toBe(expectedFailures + 1);
    expect(health.activeAttempts).toBe(0);
    expect(health.pendingTimers).toBe(0);
  });
});
