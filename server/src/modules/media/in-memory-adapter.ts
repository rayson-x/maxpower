import {
  emptyMediaLibraryState,
  type MediaLibraryState,
  type MediaLibraryStateAdapter,
} from "./state-adapter.js";

/** Test/development adapter. It stores metadata only and never accepts bytes. */
export class InMemoryMediaLibraryAdapter implements MediaLibraryStateAdapter {
  readonly #states = new Map<string, MediaLibraryState>();
  readonly #tails = new Map<string, Promise<void>>();

  async transact<T>(accountId: string, operation: (state: MediaLibraryState) => T): Promise<T> {
    const previous = this.#tails.get(accountId) ?? Promise.resolve();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.#tails.set(accountId, tail);

    await previous;
    try {
      const committed = this.#states.get(accountId) ?? emptyMediaLibraryState();
      const draft = structuredClone(committed);
      const result = operation(draft);
      this.#states.set(accountId, draft);
      return structuredClone(result);
    } finally {
      release();
      if (this.#tails.get(accountId) === tail) this.#tails.delete(accountId);
    }
  }
}
