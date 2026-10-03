import { beforeEach, describe, expect, vi } from "vitest";
import { FetchError } from "ofetch";
import { NetworkError } from "fetch-smartly";
import { RetryExhaustedError } from "flowshield";
import { retryAdapters } from "../../src/adapters/index.js";
import { competitorAdapters } from "../../src/adapters/competitors.js";
import { readBody } from "../../src/adapters/types.js";
import { clientFor, fakeTime, observe, transport } from "../helpers.js";
import { matrixIt } from "../matrix.js";

const url = "https://example.test/payload";
const payload = "payload: café / 123";
const bytes = [...new TextEncoder().encode(payload)];
describe.each([...retryAdapters, ...competitorAdapters])("$name: body replay", adapter => {
  beforeEach(fakeTime);
  matrixIt("retry-body-replay", adapter.name, async () => {
    const variants = ["text", "stream", ...(["wretch", "fetch-smartly"].includes(adapter.name) ? [] : ["request"])];
    for (const variant of variants) {
      const fixture = transport(adapter.name + "-retry-body-replay", [
        { type: "response", status: 503 },
        { type: "response", body: "ready" },
      ]);
      const client = await clientFor(adapter, fixture.fetch, { retries: 1, delayMs: 20, retryPosts: true });
      const body = variant === "stream" ? new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(bytes)); controller.close(); },
      }) : payload;
      const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half" };
      const input = variant === "request" ? new Request(url, init) : url;
      const result = observe(client(input, variant === "request" ? undefined : init));
      for (let tick = 0; tick < 20 && !result.outcome; tick++) await vi.advanceTimersByTimeAsync(50);
      const outcome = result.outcome;
      expect(outcome, variant + " must settle").toBeDefined();
      if (!outcome) throw new Error("Body replay did not settle");
      const bodies = fixture.trace.events.filter(event => event.type === "request:body").map(event => event.data.bytes);
      for (const actual of bodies) expect(actual).toEqual(bytes);
      const promisesReplay = variant === "text" ||
        (variant === "request" && ["ffetch", "ky", "fetch-retry", "resilient-fetch-client"].includes(adapter.name)) ||
        (variant === "stream" && ["ffetch", "ky"].includes(adapter.name));
      if (outcome.ok) {
        expect(outcome.value.status).toBe(200);
        expect(await readBody(outcome.value)).toBe("ready");
        expect(bodies).toHaveLength(2);
        expect(fixture.attempts).toBe(2);
      } else {
        expect.soft(promisesReplay, variant + " is promised replayable").toBe(false);
        let cause: unknown = outcome.error;
        if (adapter.name === "ofetch") {
          expect((cause as Error).constructor).toBe(FetchError); cause = (cause as Error).cause;
        } else if (adapter.name === "fetch-smartly") {
          expect((cause as Error).constructor).toBe(NetworkError); cause = (cause as Error).cause;
        } else if (adapter.name === "flowshield") {
          expect((cause as Error).constructor).toBe(RetryExhaustedError); cause = (cause as Error).cause;
        }
        expect((cause as Error).constructor).toBe(TypeError);
        expect(bodies).toHaveLength(1);
      }
      await vi.advanceTimersByTimeAsync(500);
      expect(fixture.activeAttempts).toBe(0);
      expect(fixture.pendingTimers).toBe(0);
    }
  });
});
