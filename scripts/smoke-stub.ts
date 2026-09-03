import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
  "openmeteo",
  "portland.json",
);

async function handle(body: Buffer, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? "").split("?")[0];
  if (req.method === "GET" && path === "/v1/forecast") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: true, reason: "not found" }));
}

async function main(): Promise<void> {
  const port = Number(process.argv[2] ?? "4321");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`smoke-stub: invalid port: ${process.argv[2] ?? ""}`);
    process.exit(1);
  }
  const body = await readFile(FIXTURE_PATH);
  // Validate once at boot so a corrupt fixture fails loudly instead of
  // serving schema-invalid payloads to every smoke invocation.
  JSON.parse(body.toString("utf8"));
  const server = createServer((req, res) => {
    void handle(body, req, res);
  });
  server.on("error", (cause) => {
    console.error(
      `smoke-stub: cannot listen on 127.0.0.1:${port}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`smoke-stub: serving ${FIXTURE_PATH} on http://127.0.0.1:${port}/v1/forecast`);
  });
}

if (import.meta.main) {
  await main();
}
