import { ArtifactCardRegistry } from "../cards";
import type {
  Artifact,
  ArtifactCardModel,
  ArtifactRef,
  CoachRunEvent,
  HumanOption,
  PendingHumanAction,
  PresentationRef,
  PresentationStatus,
} from "../model";

export type CoachStreamStatus = "empty" | "streaming" | "ready" | "error";

export interface CoachToolPart {
  type: "dynamic-tool";
  id: string;
  toolCallId: string;
  toolName: string;
  presentationId: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error";
  output?: {
    artifactId?: string;
    presentationId: string;
  };
  errorText?: string;
}

export interface CoachArtifactPart {
  type: "data-artifact-card";
  id: string;
  state: "loading" | PresentationStatus;
  data: {
    artifactId?: string;
    presentationId: string;
    renderer?: string;
    card?: ArtifactCardModel;
    message?: string;
  };
}

export interface CoachErrorPart {
  type: "data-stream-error";
  id: string;
  state: "error";
  data: { message: string };
}

export interface CoachTextPart {
  type: "text";
  id: string;
  state: "streaming" | "done" | "error";
  text: string;
  errorText?: string;
}

export interface CoachLiveCuePart {
  type: "data-live-cue";
  id: string;
  state: "ready";
  data: { setId: string; message: string };
}

export interface CoachHumanActionPart {
  type: "data-human-action";
  id: string;
  state: "awaiting_user" | "resolved";
  data: {
    pendingActionId: string;
    presentationId: string;
    runId: string;
    toolCallId: string;
    prompt?: string;
    options?: readonly HumanOption[];
  };
}

export type CoachUiPart =
  | CoachToolPart
  | CoachArtifactPart
  | CoachErrorPart
  | CoachTextPart
  | CoachLiveCuePart
  | CoachHumanActionPart;

export interface CoachStreamSnapshot {
  status: CoachStreamStatus;
  parts: readonly CoachUiPart[];
  emptyMessage: string;
}

export interface CoachStreamFailure {
  id: string;
  message: string;
}

export class CoachStreamProjection {
  private readonly artifacts = new Map<string, Artifact>();
  private readonly cards: ArtifactCardRegistry;
  private readonly parts = new Map<string, CoachUiPart>();
  private readonly order: string[] = [];
  private readonly artifactSlots = new Map<string, string>();
  private readonly presentationSlots = new Map<string, string>();
  private readonly persistedPresentations = new Map<string, PresentationRef>();
  private readonly pendingHumanActions = new Map<string, PendingHumanAction>();
  private readonly runParts = new Map<string, Set<string>>();

  constructor(
    artifacts: readonly Artifact[] = [],
    cards: ArtifactCardRegistry = new ArtifactCardRegistry(),
    presentations: readonly PresentationRef[] = [],
    pendingHumanActions: readonly PendingHumanAction[] = [],
  ) {
    artifacts.forEach((artifact) => this.artifacts.set(artifact.id, artifact));
    this.cards = cards;
    presentations.forEach((presentation) => this.persistedPresentations.set(presentation.artifactId, presentation));
    pendingHumanActions.forEach((pending) => this.pendingHumanActions.set(pending.id, pending));
  }

  accept(event: CoachRunEvent): void {
    if (event.type === "tool-state") {
      const id = `tool:${event.toolCallId}`;
      const current = this.parts.get(id);
      this.upsert({
        type: "dynamic-tool",
        id,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        presentationId:
          current?.type === "dynamic-tool"
            ? current.presentationId
            : `tool-presentation:${event.toolCallId}`,
        state:
          event.state === "output-error"
            ? "output-error"
            : event.state === "output-available"
              ? "output-available"
              : event.state,
        ...(event.errorCode ? { errorText: event.errorCode } : {}),
      });
      this.rememberRunPart(event.runId, id);
      return;
    }

    if (event.type === "hitl-suspended" || event.type === "hitl-resumed") {
      const id = `human-action:${event.pendingActionId}`;
      const pending = this.pendingHumanActions.get(event.pendingActionId);
      this.upsert({
        type: "data-human-action",
        id,
        state: event.type === "hitl-suspended" ? "awaiting_user" : "resolved",
        data: {
          pendingActionId: event.pendingActionId,
          presentationId: event.presentationId,
          runId: event.runId,
          toolCallId: event.toolCallId,
          ...(pending ? { prompt: pending.prompt, options: pending.options } : {}),
        },
      });
      this.rememberRunPart(event.runId, id);
      return;
    }

    if (event.type === "action-receipt") {
      const toolId = `tool:${event.toolCallId}`;
      const current = this.parts.get(toolId);
      if (current?.type === "dynamic-tool") {
        this.upsert({
          ...current,
          state: "output-available",
          output: {
            artifactId: event.artifactRef.id,
            presentationId: current.presentationId,
          },
        });
      }
      this.upsertReceiptCard(event);
      return;
    }

    if (event.type === "tool-started") {
      const toolPart: CoachToolPart = {
        type: "dynamic-tool",
        id: `tool:${event.toolCallId}`,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        presentationId: event.presentationId,
        state: "input-streaming",
      };
      this.upsert(toolPart);
      const presentationPartId =
        this.presentationSlots.get(event.presentationId) ??
        `presentation:${event.presentationId}`;
      const presentationPart: CoachArtifactPart = {
        type: "data-artifact-card",
        id: presentationPartId,
        state: "loading",
        data: {
          presentationId: event.presentationId,
          message: "正在准备…",
        },
      };
      this.presentationSlots.set(event.presentationId, presentationPartId);
      this.upsert(presentationPart);
      this.rememberRunPart(event.runId, toolPart.id);
      this.rememberRunPart(event.runId, presentationPart.id);
      return;
    }

    if (event.type === "text-delta") {
      const id = `text:${event.runId}`;
      const current = this.parts.get(id);
      this.upsert({
        type: "text",
        id,
        state: "streaming",
        text: `${current?.type === "text" ? current.text : ""}${event.delta}`,
      });
      this.rememberRunPart(event.runId, id);
      return;
    }

    if (event.type === "run-completed") {
      const id = `text:${event.runId}`;
      const current = this.parts.get(id);
      if (current?.type === "text") this.upsert({ ...current, state: "done" });
      return;
    }

    if (event.type === "run-error") {
      this.failRun(event.runId, event.message);
      return;
    }

    if (event.type === "live-cue") {
      this.upsert({
        type: "data-live-cue",
        id: `presentation:${event.presentationId}`,
        state: "ready",
        data: { setId: event.setId, message: event.message },
      });
      this.rememberRunPart(event.runId, `presentation:${event.presentationId}`);
      return;
    }

    if (event.type !== "artifact-ready" && event.type !== "artifact-updated") return;

    const toolPartId = `tool:${event.toolCallId}`;
    const existingTool = this.parts.get(toolPartId);
    this.upsert({
      type: "dynamic-tool",
      id: toolPartId,
      toolCallId: event.toolCallId,
      toolName: existingTool?.type === "dynamic-tool" ? existingTool.toolName : "unknown",
      presentationId: event.presentation.id,
      state: "output-available",
      output: {
        artifactId: event.artifactRef.id,
        presentationId: event.presentation.id,
      },
    });

    const persistedPresentation = this.persistedPresentations.get(event.artifactRef.id);
    const presentation = persistedPresentation?.id === event.presentation.id
      ? persistedPresentation
      : event.presentation;
    const cachedArtifact = this.artifacts.get(event.artifactRef.id);
    const artifact =
      cachedArtifact &&
      cachedArtifact.kind === event.artifactRef.kind &&
      cachedArtifact.schemaVersion === event.artifactRef.schemaVersion &&
      cachedArtifact.hash === event.artifactRef.hash &&
      event.presentation.artifactId === event.artifactRef.id
        ? cachedArtifact
        : undefined;
    const resolvedCard = artifact
      ? this.cards.render(artifact, presentation.status)
      : undefined;
    const card =
      resolvedCard && resolvedCard.renderer === presentation.renderer
        ? resolvedCard
        : fallbackCard(
            event.artifactRef,
            presentation.renderer,
            presentation.status,
          );
    const startedPresentationPartId = this.presentationSlots.get(presentation.id);
    const presentationPartId =
      this.artifactSlots.get(event.artifactRef.id) ??
      startedPresentationPartId ??
      `presentation:${presentation.id}`;
    if (
      startedPresentationPartId &&
      startedPresentationPartId !== presentationPartId
    ) {
      this.removePart(startedPresentationPartId);
    }
    this.artifactSlots.set(event.artifactRef.id, presentationPartId);
    this.presentationSlots.set(presentation.id, presentationPartId);
    this.upsert({
      type: "data-artifact-card",
      id: presentationPartId,
      state: card.status === "error" ? "error" : presentation.status,
      data: {
        artifactId: event.artifactRef.id,
        presentationId: presentation.id,
        renderer: presentation.renderer,
        card,
        message: card.status === "error" ? "卡片内容暂时不可用" : undefined,
      },
    });
    this.rememberRunPart(event.runId, toolPartId);
    this.rememberRunPart(event.runId, presentationPartId);
  }

  private upsertReceiptCard(event: Extract<CoachRunEvent, { type: "action-receipt" }>): void {
    const artifact = this.artifacts.get(event.artifactRef.id);
    const presentation = this.persistedPresentations.get(event.artifactRef.id);
    if (!artifact || !presentation) return;
    const card = this.cards.render(artifact, presentation.status);
    const id = this.artifactSlots.get(artifact.id) ?? `presentation:${presentation.id}`;
    this.artifactSlots.set(artifact.id, id);
    this.presentationSlots.set(presentation.id, id);
    this.upsert({
      type: "data-artifact-card",
      id,
      state: card.status === "error" ? "error" : presentation.status,
      data: {
        artifactId: artifact.id,
        presentationId: presentation.id,
        renderer: presentation.renderer,
        card,
        ...(card.status === "error" ? { message: "卡片内容暂时不可用" } : {}),
      },
    });
    this.rememberRunPart(event.runId, id);
  }

  fail(failure: CoachStreamFailure): void {
    this.upsert({
      type: "data-stream-error",
      id: `error:${failure.id}`,
      state: "error",
      data: { message: failure.message },
    });
  }

  private failRun(runId: string, message: string): void {
    const partIds = this.runParts.get(runId);
    let reconciled = false;
    partIds?.forEach((partId) => {
      const part = this.parts.get(partId);
      if (part?.type === "dynamic-tool" && part.state === "input-streaming") {
        this.upsert({ ...part, state: "output-error", errorText: message });
        reconciled = true;
      } else if (part?.type === "data-artifact-card" && part.state === "loading") {
        this.upsert({
          ...part,
          state: "error",
          data: { ...part.data, message },
        });
        reconciled = true;
      } else if (part?.type === "text" && part.state === "streaming") {
        this.upsert({ ...part, state: "error", errorText: message });
        reconciled = true;
      }
    });
    if (!reconciled) this.fail({ id: `run:${runId}`, message });
  }

  snapshot(): CoachStreamSnapshot {
    const parts = this.order.flatMap((id) => {
      const part = this.parts.get(id);
      return part ? [part] : [];
    });
    let status: CoachStreamStatus = "ready";
    if (parts.length === 0) status = "empty";
    else if (parts.some((part) => part.state === "error" || part.state === "output-error")) {
      status = "error";
    } else if (
      parts.some(
        (part) =>
          part.state === "loading" ||
          part.state === "input-streaming" ||
          part.state === "input-available" ||
          part.state === "awaiting_user" ||
          part.state === "streaming",
      )
    ) {
      status = "streaming";
    }
    return { status, parts, emptyMessage: "还没有 Coach 内容" };
  }

  private upsert(part: CoachUiPart): void {
    if (!this.parts.has(part.id)) this.order.push(part.id);
    this.parts.set(part.id, part);
  }

  private rememberRunPart(runId: string, partId: string): void {
    const ids = this.runParts.get(runId) ?? new Set<string>();
    ids.add(partId);
    this.runParts.set(runId, ids);
  }

  private removePart(partId: string): void {
    if (!this.parts.delete(partId)) return;
    const index = this.order.indexOf(partId);
    if (index >= 0) this.order.splice(index, 1);
  }
}

function fallbackCard(
  artifact: ArtifactRef,
  renderer: string,
  status: PresentationStatus,
): ArtifactCardModel {
  return {
    renderer: "artifact-fallback/v1",
    eyebrow: "无法显示",
    artifactId: artifact.id,
    title: "暂不支持的卡片",
    subtitle: `${artifact.kind} · schema v${artifact.schemaVersion} · ${status}`,
    metrics: [],
    taskList: [],
    actions: [],
    status: "error",
    evidenceLabels: [],
    capabilityBoundary: [
      `renderer ${renderer} 无法安全渲染此版本，已禁止操作`,
    ],
  };
}
