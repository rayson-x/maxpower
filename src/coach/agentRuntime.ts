import { ContextAssembler, type LLMProvider } from "./adapters/provider";
import type { CoachLedger } from "./ledger";
import type { CoachRunEvent, RuntimeServices } from "./model";
import type { CoachToolRegistry } from "./toolRegistry";

/** Owns provider streaming and canonical event normalization; never commits domain facts. */
export class AgentRuntime {
  private remoteProviderRequests = 0;

  constructor(
    private readonly ledger: CoachLedger,
    private readonly runtime: RuntimeServices,
    private readonly provider?: LLMProvider,
    private readonly contextAssembler = new ContextAssembler(),
    private readonly tools?: CoachToolRegistry,
  ) {}

  status(): { mode: "local-only" | "remote-provider"; remoteProviderRequests: number } {
    return {
      mode: this.provider?.usesNetwork ? "remote-provider" : "local-only",
      remoteProviderRequests: this.remoteProviderRequests,
    };
  }

  async sendTurn(input: { sessionId: string; text: string }): Promise<readonly CoachRunEvent[]> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new Error(`CoachSession not found: ${input.sessionId}`);
    const now = this.runtime.now();
    const runId = this.runtime.nextId("coach-run");
    const events: CoachRunEvent[] = [];
    const presentationOnlyEvents = new Set<CoachRunEvent>();
    if (!this.provider) {
      events.push({
        type: "text-delta",
        sessionId: session.id,
        runId,
        delta: "当前未配置语言模型；本地计划、记录与撤销仍可使用。",
        occurredAt: now,
      });
    } else {
      const assembled = this.contextAssembler.assemble(snapshot, session.userId);
      if (this.provider.usesNetwork) this.remoteProviderRequests += 1;
      try {
        for await (const event of this.provider.stream({
          sessionId: session.id,
          runId,
          userText: input.text,
          ...assembled,
        })) {
          if (event.type === "text-delta") {
            events.push({
              type: "text-delta",
              sessionId: session.id,
              runId,
              delta: event.delta,
              occurredAt: this.runtime.now(),
            });
          } else if (event.type === "completed") {
            events.push({
              type: "run-completed",
              sessionId: session.id,
              runId,
              occurredAt: this.runtime.now(),
            });
          } else if (this.tools) {
            try {
              const toolEvents = await this.tools.invoke({
                  sessionId: session.id,
                  runId,
                  call: event,
                });
              toolEvents.forEach((toolEvent) => presentationOnlyEvents.add(toolEvent));
              events.push(...toolEvents);
            } catch (error) {
              events.push({
                type: "run-error",
                sessionId: session.id,
                runId,
                code: "invalid_tool_call",
                message: error instanceof Error ? error.message : "非法 ToolCall",
                occurredAt: this.runtime.now(),
              });
            }
          } else {
            events.push({
              type: "run-error",
              sessionId: session.id,
              runId,
              code: "invalid_tool_call",
              message: `未注册的 ToolCall: ${event.toolName}`,
              occurredAt: this.runtime.now(),
            });
          }
        }
      } catch (error) {
        events.push(
          {
            type: "run-error",
            sessionId: session.id,
            runId,
            code: "provider_error",
            message: error instanceof Error ? error.message : "Provider unavailable",
            occurredAt: this.runtime.now(),
          },
          {
            type: "text-delta",
            sessionId: session.id,
            runId,
            delta: "语言模型暂时不可用；本地计划仍可用，你可以继续记录、调整或撤销。",
            occurredAt: this.runtime.now(),
          },
        );
      }
    }
    const latest = await this.ledger.read();
    await this.ledger.replace({
      ...latest,
      runEvents: [
        ...latest.runEvents,
        ...events.filter((event) => !presentationOnlyEvents.has(event)),
      ],
    });
    return events;
  }
}
