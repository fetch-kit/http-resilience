import { beforeEach, describe, expect, vi } from "vitest";
import { matrixIt } from "../matrix.js";
import { retryAdapters } from "../../src/adapters/index.js";
import { competitorAdapters } from "../../src/adapters/competitors.js";
import { readBody } from "../../src/adapters/types.js";
import { expectHttpOutcome } from "../contracts.js";
import { capture, fakeTime, transport, clientFor } from "../helpers.js";

const url = "https://example.test/resource";
describe.each([...retryAdapters, ...competitorAdapters])("$name: retry", adapter => {
  beforeEach(fakeTime);
  matrixIt("retry-recovery", adapter.name, async () => {
    const fixture = transport(adapter.name + "-retry-recovery", [
      { type: "response", status: 503, body: "busy" },
      { type: "response", status: 503, body: "busy" },
      { type: "response", body: "ready" },
    ]);
    const client = await clientFor(adapter, fixture.fetch, { retries: 2, delayMs: 20 });
    const result = capture(client(url));
    await vi.advanceTimersByTimeAsync(100);
    const outcome = await result;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw outcome.error;
    expect(outcome.value.status).toBe(200);
    expect(await readBody(outcome.value)).toBe("ready");
    expect(fixture.attempts).toBe(3);
    await vi.advanceTimersByTimeAsync(500);
    expect(fixture.attempts).toBe(3);
    expect(fixture.activeAttempts).toBe(0);
    expect(fixture.pendingTimers).toBe(0);
  });
  matrixIt("retry-exhaustion", adapter.name, async () => {
    const fixture = transport(adapter.name + "-retry-exhaustion", Array.from({ length: 3 }, () => ({
      type: "response" as const, status: 503, body: "overloaded",
    })));
    const client = await clientFor(adapter, fixture.fetch, { retries: 2, delayMs: 20 });
    const result = capture(client(url));
    await vi.advanceTimersByTimeAsync(100);
    await expectHttpOutcome(adapter.name, await result, 3, "overloaded");
    await vi.advanceTimersByTimeAsync(500);
    expect(fixture.attempts).toBe(3);
    expect(fixture.pendingTimers).toBe(0);
  });
  matrixIt("retry-disabled", adapter.name, async () => {
    const fixture = transport(adapter.name + "-zero-retries", [{ type: "response", status: 503, body: "busy" }]);
    const client = await clientFor(adapter, fixture.fetch, { retries: 0, delayMs: 20 });
    const result = capture(client(url));
    await vi.advanceTimersByTimeAsync(200);
    await expectHttpOutcome(adapter.name, await result, 1, "busy");
    expect(fixture.attempts).toBe(1);
    expect(fixture.pendingTimers).toBe(0);
  });
});
