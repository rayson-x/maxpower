import { ArtifactCardRegistry } from "../cards";
import type {
  Artifact,
  ArtifactCardModel,
  ArtifactRef,
  CoachRunEvent,
  PresentationStatus,
} from "../model";

export type CoachStreamStatus = "empty" | "streaming" | "ready" | "error";

export interface CoachToolPart {
  type: "dynamic-tool";
  id: string;
  toolCallId: string;
  toolName: string;
  presentationId: string;
  state: "input-streaming" | "output-available" | "output-error";
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

export type CoachUiPart =
  | CoachToolPart
  | CoachArtifactPart
  | CoachErrorPart
  | CoachTextPart
  | CoachLiveCuePart;

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
  private readonly runParts = new Map<string, Set<string>>();

  constructor(
    artifacts: readonly Artifact[] = [],
    cards: ArtifactCardRegistry = new ArtifactCardRegistry(),
  ) {
    artifacts.forEach((artifact) => this.artifacts.set(artifact.id, artifact));
    this.cards = cards;
  }

  accept(event: CoachRunEvent): void {
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

    if (event.type !== "artifact-ready") return;

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
      ? this.cards.render(artifact, event.presentation.status)
      : undefined;
    const card =
      resolvedCard && resolvedCard.renderer === event.presentation.renderer
        ? resolvedCard
        : fallbackCard(
            event.artifactRef,
            event.presentation.renderer,
            event.presentation.status,
          );
    const startedPresentationPartId = this.presentationSlots.get(event.presentation.id);
    const presentationPartId =
      this.artifactSlots.get(event.artifactRef.id) ??
      startedPresentationPartId ??
      `presentation:${event.presentation.id}`;
    if (
      startedPresentationPartId &&
      startedPresentationPartId !== presentationPartId
    ) {
      this.removePart(startedPresentationPartId);
    }
    this.artifactSlots.set(event.artifactRef.id, presentationPartId);
    this.presentationSlots.set(event.presentation.id, presentationPartId);
    this.upsert({
      type: "data-artifact-card",
      id: presentationPartId,
      state: card.status === "error" ? "error" : event.presentation.status,
      data: {
        artifactId: event.artifactRef.id,
        presentationId: event.presentation.id,
        renderer: event.presentation.renderer,
        card,
        message: card.status === "error" ? "卡片内容暂时不可用" : undefined,
      },
    });
    this.rememberRunPart(event.runId, toolPartId);
    this.rememberRunPart(event.runId, presentationPartId);
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
