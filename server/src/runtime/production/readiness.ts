export interface ReadinessPostgres {
  query(text: string): Promise<{ rows: unknown[] }>;
}

export interface ReadinessRedis {
  sendCommand(command: string[]): Promise<unknown>;
}

export interface InfrastructureReadinessDependencies {
  postgres: ReadinessPostgres;
  rateLimitRedis: ReadinessRedis;
  streamRedis: ReadinessRedis;
  timeoutMs?: number;
}

/** Returns only a boolean so dependency URLs and errors never enter an HTTP response. */
export function createInfrastructureReadiness(
  dependencies: InfrastructureReadinessDependencies,
): () => Promise<boolean> {
  const timeoutMs = dependencies.timeoutMs ?? 2_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Readiness timeout must be a positive integer.");
  }

  return async () => {
    try {
      return await withTimeout(async () => {
        await dependencies.postgres.query("SELECT 1 AS ok");
        if (!isPong(await dependencies.rateLimitRedis.sendCommand(["PING"]))) return false;
        if (!isPong(await dependencies.streamRedis.sendCommand(["PING"]))) return false;
        return true;
      }, timeoutMs);
    } catch {
      return false;
    }
  };
}

async function withTimeout<T>(operation: () => Promise<T>, milliseconds: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Readiness timed out.")), milliseconds);
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function isPong(value: unknown): boolean {
  if (value === "PONG") return true;
  return value instanceof Uint8Array && new TextDecoder().decode(value) === "PONG";
}
