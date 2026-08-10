import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { serve } from "@hono/node-server";

import {
  ProductionConfigurationError,
  parseProductionConfig,
} from "./config/production-config.js";
import { createMemoryRuntime } from "./runtime/memory-runtime.js";
import { createProductionRuntime } from "./runtime/production/production-runtime.js";

async function main(): Promise<void> {
  const runtimeName = process.env.MAXPOWER_RUNTIME ?? "memory";
  if (runtimeName === "production") {
    const config = parseProductionConfig(process.env);
    const runtime = await createProductionRuntime(config);
    const server = serve({ fetch: runtime.app.fetch, port: runtime.port }, (info) => {
      process.stdout.write(`${JSON.stringify({
        event: "maxpower_server_listening",
        runtime: "production",
        port: info.port,
      })}\n`);
    });
    installShutdown(server, runtime.close);
    return;
  }
  if (runtimeName !== "memory") {
    throw new Error("MAXPOWER_RUNTIME must be memory or production.");
  }
  const runtime = createMemoryRuntime({ production: process.env.NODE_ENV === "production" });
  const port = parsePort(process.env.PORT);
  serve({ fetch: runtime.app.fetch, port }, (info) => {
    process.stdout.write(`${JSON.stringify({
      event: "maxpower_server_listening",
      runtime: "memory",
      port: info.port,
    })}\n`);
  });
}

function installShutdown(
  server: { close(callback: (error?: Error) => void): void },
  closeRuntime: () => Promise<void>,
): void {
  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    server.close(() => {
      void closeRuntime().finally(() => {
        process.exitCode = 0;
      });
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return 8787;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isMainModule()) {
  void main().catch((error: unknown) => {
    process.stderr.write(error instanceof ProductionConfigurationError
      ? `${error.message}\n`
      : "MaxPower server failed to start.\n");
    process.exitCode = 1;
  });
}
