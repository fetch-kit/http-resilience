import { beforeEach, describe, expect, vi } from "vitest";
import { HttpError, CircuitOpenError } from "@fetchkit/ffetch";
import { HttpError as SmartHttpError } from "fetch-smartly";
import { RetryExhaustedError } from "flowshield";
import { circuitAdapter, circuitProfiles } from "../../src/adapters/circuits.js";
import { HttpStatusError } from "../../src/adapters/competitors.js";
import { clientFor, fakeTime, observe, transport } from "../helpers.js";
import { matrixIt } from "../matrix.js";
describe.each(circuitProfiles)("$name: retry accounting", profile => {
  beforeEach(fakeTime);
  matrixIt("circuit-retry-accounting", profile.name, async () => {
    const fixture = transport(profile.name + "-circuit-retry-accounting",
      Array.from({ length: 6 }, () => ({ type: "response" as const, status: 503, body: "busy" })));
    const client = await clientFor(circuitAdapter(profile.name), fixture.fetch, { retries: 2, delayMs: 20 });
    const logicalCalls = profile.accounting === "attempt" ? 1 : 2;
    for (let call = 0; call < logicalCalls; call++) {
      const result = observe(client("https://example.test/circuit"));
      await vi.advanceTimersByTimeAsync(100);
      expect(result.outcome?.ok).toBe(false);
      if (!result.outcome || result.outcome.ok) throw new Error("Expected circuit/retry error");
      const error = result.outcome.error as Error;
      if (profile.accounting === "attempt" || (profile.name === "ffetch" && call === 1)) {
        expect(error.constructor).toBe(profile.error);
      } else switch (profile.name) {
        case "ffetch": expect(error.constructor).toBe(HttpError); expect((error.cause as Response).status).toBe(503); break;
        case "fetch-smartly": expect(error.constructor).toBe(SmartHttpError); expect((error as SmartHttpError).status).toBe(503); break;
        case "flowshield":
          expect(error.constructor).toBe(RetryExhaustedError);
          expect((error as RetryExhaustedError).attempts).toBe(3);
          expect((error.cause as Error).constructor).toBe(HttpStatusError);
          expect((error.cause as HttpStatusError).response.status).toBe(503); break;
        case "fetch-resilience": expect(error.constructor).toBe(HttpStatusError); expect((error as HttpStatusError).response.status).toBe(503); break;
        case "ts-retry-circuit": expect(error.constructor).toBe(Error); expect(error.message).toMatch(/^HTTP 503/); break;
      }
      expect(fixture.attempts).toBe(profile.accounting === "attempt" ? 2 : (call + 1) * 3);
    }
    const before = fixture.attempts;
    const refused = observe(client("https://example.test/circuit"));
    await vi.advanceTimersByTimeAsync(100);
    expect(refused.outcome?.ok).toBe(false);
    if (refused.outcome && !refused.outcome.ok) expect((refused.outcome.error as Error).constructor).toBe(profile.error);
    expect(fixture.attempts).toBe(before);
    expect(fixture.activeAttempts).toBe(0);
    expect(fixture.pendingTimers).toBe(0);
  });
});
