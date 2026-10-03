import { AbortError, CircuitOpenError } from "@fetchkit/ffetch";
import { bulkheadPlugin } from "@fetchkit/ffetch/plugins/bulkhead";
import { circuitPlugin } from "@fetchkit/ffetch/plugins/circuit";
import { hedgePlugin } from "@fetchkit/ffetch/plugins/hedge";
import { beforeEach, describe, expect, vi } from "vitest";
import { matrixIt } from "../matrix.js";
import { createFfetchClient } from "../../src/adapters/ffetch.js";
import { capture, fakeTime, transport } from "../helpers.js";

const url = "https://example.test/resource";

describe("ffetch: combinations", () => {
  beforeEach(fakeTime);

  matrixIt("retry-backoff-abort", "ffetch", async () => {
    const fixture = transport("ffetch-retry-abort", [
      { type: "response", status: 503 },
      { type: "response", body: "healthy" },
    ]);
    const client = createFfetchClient(fixture.fetch, { retries: 2, retryDelay: 100 });
    const controller = new AbortController();
    const result = capture(client(url, { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(20);
    controller.abort();
    const outcome = await result;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("Expected cancellation");
    expect((outcome.error as Error).constructor).toBe(AbortError);
    await vi.advanceTimersByTimeAsync(250);
    expect(fixture.attempts).toBe(1);
    expect(await (await client(url)).text()).toBe("healthy");
    expect(fixture.attempts).toBe(2);
    expect(client.pendingRequests).toHaveLength(0);
  });

  matrixIt("bulkhead-queued-abort", "ffetch", async () => {
    const fixture = transport("ffetch-bulkhead-abort", [
      { type: "response", delayMs: 100, body: "first" },
      { type: "response", body: "replacement" },
    ]);
    const client = createFfetchClient(fixture.fetch, {
      plugins: [bulkheadPlugin({ maxConcurrent: 1, maxQueue: 1 })],
    });
    const first = capture(client(url + "/first"));
    await vi.advanceTimersByTimeAsync(0);
    const controller = new AbortController();
    const queued = capture(client(url + "/cancelled", { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(20);
    controller.abort();
    const outcome = await queued;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("Expected cancellation");
    expect((outcome.error as Error).constructor).toBe(AbortError);
    const replacement = capture(client(url + "/replacement"));
    await vi.advanceTimersByTimeAsync(200);
    expect((await first).ok).toBe(true);
    expect((await replacement).ok).toBe(true);
    expect(fixture.attempts).toBe(2);
    const urls = fixture.trace.events.filter(event => event.type === "request").map(event => event.data.url);
    expect(urls).not.toContain(url + "/cancelled");
    expect(client.pendingRequests).toHaveLength(0);
  });

  matrixIt("hedge-stream-winner", "ffetch", async () => {
    const fixture = transport("ffetch-hedge-stream", [
      { type: "hang" },
      { type: "response", body: [{ afterMs: 20, text: "win" }, { afterMs: 20, text: "ner" }] },
    ]);
    const client = createFfetchClient(fixture.fetch, {
      plugins: [hedgePlugin({ delay: 10, maxHedges: 1 })],
    });
    const result = capture(client(url));
    await vi.advanceTimersByTimeAsync(10);
    const outcome = await result;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw outcome.error;
    const body = capture(outcome.value.text());
    await vi.advanceTimersByTimeAsync(100);
    expect(await body).toEqual({ ok: true, value: "winner" });
    expect(fixture.trace.events.some(event => event.attempt === 1 && event.type === "attempt:abort")).toBe(true);
    expect(fixture.attempts).toBe(2);
    expect(fixture.activeBodies).toBe(0);
    expect(fixture.pendingTimers).toBe(0);
  });

  matrixIt("circuit-hedge", "ffetch", async () => {
    const fixture = transport("ffetch-circuit-hedge", [
      { type: "response", status: 503, delayMs: 15 },
      { type: "response", delayMs: 20, body: "winner" },
      { type: "response", body: "healthy" },
      { type: "response", status: 503 },
    ]);
    const client = createFfetchClient(fixture.fetch, {
      plugins: [
        hedgePlugin({ delay: 10, maxHedges: 1 }),
        circuitPlugin({ threshold: 1, reset: 1_000 }),
      ],
    });
    const race = capture(client(url));
    await vi.advanceTimersByTimeAsync(100);
    const outcome = await race;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw outcome.error;
    expect(await outcome.value.text()).toBe("winner");
    expect(await (await client(url)).text()).toBe("healthy");
    // Disable hedging for the deliberate failure, then verify the open-circuit error.
    const failure = await capture(client(url, { method: "POST" }));
    expect(failure.ok).toBe(false);
    if (failure.ok) throw new Error("Expected the threshold-crossing error");
    expect((failure.error as Error).constructor).toBe(CircuitOpenError);
    const rejected = await capture(client(url));
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("Expected circuit rejection");
    expect((rejected.error as Error).constructor).toBe(CircuitOpenError);
    expect(fixture.attempts).toBe(4);
  });
});
