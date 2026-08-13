import { COACH_STREAM_COPY, getT } from "../../i18n";
import type {
  CoachArtifactPart,
  CoachStreamSnapshot,
  CoachUiPart,
} from "../../coach/ui/coachStreamProjection";

export type CameraCaptionSource = "local_vision" | "user" | "coach" | "system";
export type CameraCaptionState = "previous" | "active" | "streaming";

export interface CameraCaptionLine {
  id: string;
  source: CameraCaptionSource;
  label: string;
  text: string;
  state: CameraCaptionState;
}

export type CameraCoachAction =
  | {
      kind: "artifact";
      id: string;
      label: string;
      artifactId: string;
      prompt: string;
    }
  | {
      kind: "human";
      id: string;
      label: string;
      pendingActionId: string;
      prompt: string;
    };

export interface CameraCoachPresentation {
  captions: readonly CameraCaptionLine[];
  statusLabel?: string;
  actions: readonly CameraCoachAction[];
  actionPrompt?: string;
  receipt?: {
    title: string;
    detail?: string;
  };
}

export interface CameraCoachPresentationInput {
  stream: CoachStreamSnapshot;
  localCue?: string;
  userMessage?: string;
  provisionalTranscript?: string;
  /** From profile.locale; falls back to English when unknown. */
  locale?: string;
}

/**
 * Maps the generic Coach stream into the camera's deliberately small overlay
 * contract. The last three utterances become rolling captions; no text part
 * can turn into a write without an explicit artifact/HITL action.
 */
export function projectCameraCoachPresentation(
  input: CameraCoachPresentationInput,
): CameraCoachPresentation {
  const t = getT(COACH_STREAM_COPY, input.locale);
  const captions: CameraCaptionLine[] = [];
  const localCue = input.localCue?.trim();
  if (localCue) {
    captions.push({
      id: "local-vision:current",
      source: "local_vision",
      label: "LOCAL VISION · LIVE",
      text: localCue,
      state: "active",
    });
  }

  const userMessage = input.userMessage?.trim();
  if (userMessage) {
    captions.push({
      id: "user:latest",
      source: "user",
      label: t("caption.label.user"),
      text: userMessage,
      state: "active",
    });
  }

  const provisionalTranscript = input.provisionalTranscript?.trim();
  if (provisionalTranscript) {
    captions.push({
      id: "user:provisional",
      source: "user",
      label: t("caption.label.userListening"),
      text: provisionalTranscript,
      state: "streaming",
    });
  }

  for (const part of input.stream.parts) {
    const line = captionFromPart(part, input.locale);
    if (line) captions.push(line);
  }

  const visibleCaptions = dedupeCaptionLines(captions).slice(-3).map<CameraCaptionLine>((line, index, lines) => ({
    ...line,
    state: line.state === "streaming" ? "streaming" : index === lines.length - 1 ? "active" : "previous",
  }));
  const awaitingHuman = [...input.stream.parts].reverse().find(
    (part) => part.type === "data-human-action" && part.state === "awaiting_user",
  );
  const actionableArtifact = [...input.stream.parts].reverse().find(
    (part): part is CoachArtifactPart =>
      part.type === "data-artifact-card" &&
      part.state !== "loading" &&
      Boolean(part.data.card?.actions.some((action) => action.enabled)),
  );
  const actions = awaitingHuman?.type === "data-human-action"
    ? (awaitingHuman.data.options ?? []).map((option) => ({
        kind: "human" as const,
        id: option.id,
        label: option.label,
        pendingActionId: awaitingHuman.data.pendingActionId,
        prompt: awaitingHuman.data.prompt ?? t("action.confirmPrompt"),
      }))
    : artifactActions(actionableArtifact);
  const receiptPart = [...input.stream.parts].reverse().find(
    (part): part is CoachArtifactPart =>
      part.type === "data-artifact-card" &&
      part.state !== "loading" &&
      part.data.card?.renderer === "action-receipt/v1",
  );

  return {
    captions: visibleCaptions,
    ...(streamStatusLabel(input.stream, input.locale) ? { statusLabel: streamStatusLabel(input.stream, input.locale) } : {}),
    actions,
    ...(actions[0] ? { actionPrompt: actions[0].prompt } : {}),
    ...(receiptPart?.data.card
      ? {
          receipt: {
            title: receiptPart.data.card.title,
            ...(receiptPart.data.card.subtitle ? { detail: receiptPart.data.card.subtitle } : {}),
          },
        }
      : {}),
  };
}

function captionFromPart(part: CoachUiPart, locale?: string): CameraCaptionLine | undefined {
  if (part.type === "text" && part.text.trim()) {
    return {
      id: part.id,
      source: "coach",
      label: part.state === "streaming" ? "COACH · STREAMING" : "COACH",
      text: part.text.trim(),
      state: part.state === "streaming" ? "streaming" : "active",
    };
  }
  if (part.type === "data-live-cue" && part.data.message.trim()) {
    return {
      id: part.id,
      source: "local_vision",
      label: "LOCAL VISION · LIVE",
      text: part.data.message.trim(),
      state: "active",
    };
  }
  if (part.type === "data-stream-error") {
    return {
      id: part.id,
      source: "system",
      label: getT(COACH_STREAM_COPY, locale)("caption.label.streamError"),
      text: part.data.message,
      state: "active",
    };
  }
  return undefined;
}

function artifactActions(part?: CoachArtifactPart): CameraCoachAction[] {
  const card = part?.data.card;
  if (!card) return [];
  return card.actions.filter((action) => action.enabled).map((action) => ({
    kind: "artifact" as const,
    id: action.id,
    label: action.label,
    artifactId: card.artifactId,
    prompt: card.subtitle ?? card.title,
  }));
}

function streamStatusLabel(stream: CoachStreamSnapshot, locale?: string): string | undefined {
  const t = getT(COACH_STREAM_COPY, locale);
  const pendingTool = [...stream.parts].reverse().find(
    (part) => part.type === "dynamic-tool" && part.state !== "output-available",
  );
  if (pendingTool?.type === "dynamic-tool") {
    return t(pendingTool.state === "output-error" ? "status.toolIncomplete" : "status.toolRunning");
  }
  if (stream.status === "streaming") return t("status.replying");
  if (stream.status === "error") return t("status.connectionError");
  return undefined;
}

function dedupeCaptionLines(lines: readonly CameraCaptionLine[]): CameraCaptionLine[] {
  const seen = new Set<string>();
  const result: CameraCaptionLine[] = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) continue;
    const key = `${line.source}:${line.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.unshift(line);
  }
  return result;
}
