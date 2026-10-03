import { describe, expect } from "vitest";
import { matrixIt } from "../matrix.js";
import { retryAdapters } from "../../src/adapters/index.js";
import { competitorAdapters } from "../../src/adapters/competitors.js";
import { readBody } from "../../src/adapters/types.js";
import { getCase } from "../../src/reporting/cases.js";
import { startHttpServer } from "../../src/harness/http-server.js";
import { capture, clientFor } from "../helpers.js";
import { expectTimeout } from "../contracts.js";

describe.each([...retryAdapters, ...competitorAdapters].filter(adapter => adapter.name !== "ffetch"))("$name: real HTTP", adapter => {
  matrixIt("http-retry", adapter.name, async () => {
    const server = await startHttpServer();
    try {
      const client = await clientFor(adapter, globalThis.fetch, { retries: 2, delayMs: 5 });
      const response = await client(server.url + "/flaky");
      expect(response.status).toBe(200);
      expect(await readBody(response)).toBe("ready");
      expect(server.arrivals).toEqual(["/flaky", "/flaky", "/flaky"]);
    } finally { await server.close(); }
  });
  if (!getCase("http-timeout", adapter.name).notApplicable) {
    matrixIt("http-timeout", adapter.name, async () => {
      const server = await startHttpServer();
      try {
        const client = await clientFor(adapter, globalThis.fetch, { retries: 0, delayMs: 5, timeoutMs: 100 });
        const result = await capture(client(server.url + "/slow"));
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("Expected timeout");
        expectTimeout(adapter.name, result.error);
        expect(await readBody(await client(server.url))).toBe("ready");
      } finally { await server.close(); }
    });
  }
});
