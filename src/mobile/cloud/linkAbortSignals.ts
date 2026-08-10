export interface LinkedAbortSignal {
  signal?: AbortSignal;
  dispose(): void;
}

/** Combines request and account lifetimes without retaining listeners. */
export function linkAbortSignals(
  ...signals: readonly (AbortSignal | undefined)[]
): LinkedAbortSignal {
  const active = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (active.length === 0) return { dispose() {} };
  if (active.length === 1) return { signal: active[0], dispose() {} };
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of active) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose() {
      for (const signal of active) signal.removeEventListener("abort", abort);
    },
  };
}
