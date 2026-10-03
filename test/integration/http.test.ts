import { TimeoutError } from "@fetchkit/ffetch";
import { describe, expect } from "vitest";
import { matrixIt } from "../matrix.js";
import { createFfetchClient } from "../../src/adapters/ffetch.js";
import { startHttpServer } from "../../src/harness/http-server.js";
import { capture } from "../helpers.js";

describe("ffetch: real HTTP", () => {
  matrixIt("http-retry", "ffetch", async () => {
    const server = await startHttpServer();
    try {
      const client = createFfetchClient(globalThis.fetch, { retries: 2, retryDelay: 5 });
      const response = await client(server.url + "/flaky");
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("ready");
      expect(server.arrivals).toEqual(["/flaky", "/flaky", "/flaky"]);
      expect(client.pendingRequests).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  matrixIt("http-timeout", "ffetch", async () => {
    const server = await startHttpServer();
    try {
      const client = createFfetchClient(globalThis.fetch, { timeout: 100 });
      const outcome = await capture(client(server.url + "/slow"));
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("Expected timeout");
      expect((outcome.error as Error).constructor).toBe(TimeoutError);
      expect(await (await client(server.url)).text()).toBe("ready");
      expect(client.pendingRequests).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});
