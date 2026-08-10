import {
  type AccountRuntime,
  type AccountRuntimeFactory,
} from "./model";

export class RuntimeActivationSupersededError extends Error {
  constructor() {
    super("account_runtime_activation_superseded");
    this.name = "RuntimeActivationSupersededError";
  }
}

/** Owns the sole account runtime and makes switch/logout teardown atomic. */
export class AccountRuntimeCoordinator<TRuntime extends AccountRuntime = AccountRuntime> {
  private generation = 0;
  private active?: TRuntime;
  private activeController?: AbortController;
  private pending?: AbortController;

  constructor(private readonly factory: AccountRuntimeFactory<TRuntime>) {}

  current(): TRuntime | undefined {
    return this.active;
  }

  async activate(input: { accountId: string; accessToken(): string }): Promise<TRuntime> {
    const generation = ++this.generation;
    this.pending?.abort();
    this.activeController?.abort();
    this.activeController = undefined;
    const controller = new AbortController();
    this.pending = controller;

    const previous = this.active;
    this.active = undefined;
    if (previous) await previous.dispose();
    this.assertCurrent(generation);

    const created = await this.factory.create({
      accountId: input.accountId,
      accessToken: input.accessToken,
      signal: controller.signal,
    });
    if (generation !== this.generation || controller.signal.aborted) {
      await created.dispose();
      throw new RuntimeActivationSupersededError();
    }
    if (created.accountId !== input.accountId) {
      await created.dispose();
      throw new Error("account_runtime_account_mismatch");
    }

    this.pending = undefined;
    this.activeController = controller;
    this.active = created;
    return created;
  }

  async stop(): Promise<void> {
    ++this.generation;
    this.pending?.abort();
    this.pending = undefined;
    this.activeController?.abort();
    this.activeController = undefined;
    const previous = this.active;
    this.active = undefined;
    if (previous) await previous.dispose();
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation) throw new RuntimeActivationSupersededError();
  }
}
