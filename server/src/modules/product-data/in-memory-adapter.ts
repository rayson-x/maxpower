import {
  emptyProductDataState,
  type ProductDataState,
  type ProductDataStateAdapter,
} from "./state-adapter.js";

/** Test/development adapter. Each transaction is atomic per account. */
export class InMemoryProductDataAdapter implements ProductDataStateAdapter {
  readonly #states = new Map<string, ProductDataState>();
  readonly #tails = new Map<string, Promise<void>>();

  async transact<T>(accountId: string, operation: (state: ProductDataState) => T): Promise<T> {
    const previous = this.#tails.get(accountId) ?? Promise.resolve();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.#tails.set(accountId, tail);

    await previous;
    try {
      const committed = this.#states.get(accountId) ?? emptyProductDataState();
      const draft = structuredClone(committed);
      const result = operation(draft);
      this.#states.set(accountId, draft);
      return structuredClone(result);
    } finally {
      release();
      if (this.#tails.get(accountId) === tail) {
        this.#tails.delete(accountId);
      }
    }
  }
}
