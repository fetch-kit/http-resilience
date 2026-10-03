import { createServer } from "node:http";

export async function startHttpServer() {
  const arrivals: string[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let failures = 0;
  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    arrivals.push(path);
    if (path === "/slow") {
      const timer = setTimeout(() => {
        timers.delete(timer);
        response.end("late");
      }, 1_000);
      timers.add(timer);
      response.once("close", () => {
        clearTimeout(timer);
        timers.delete(timer);
      });
      return;
    }
    if (path === "/flaky" && failures++ < 2) {
      response.writeHead(503);
      response.end("overloaded");
      return;
    }
    response.end("ready");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    arrivals,
    async close() {
      timers.forEach(clearTimeout);
      timers.clear();
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
}
