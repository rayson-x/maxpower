/** Landmarks in `poseSchema` order as [x, y, z, score], normalized to the analysis frame. */
export interface PoseEvent {
  landmarks: Array<[number, number, number, number]>;
  width: number;
  height: number;
  timestampMs: number;
  model: string;
  poseSchema?: "blazepose33" | "halpe26";
  /** Front-camera preview is mirrored while canonical coordinates are not. */
  previewMirrored?: boolean;
  error?: string;
  /** Base64 encoded Rust canonical packet produced from this observation. */
  packetBase64?: string;
  /**
   * Opaque host projection of the additive MOTN QLT1 envelope. The JSON and
   * hashes originate in Rust; clients must not derive Rep, endpoints or
   * quality from this object.
   */
  qualityProjection?: RustQualityProjection;
  processedFrames?: number;
  validFrames?: number;
  processedFps?: number;
  /** Actual native delegate; CPU means GPU initialization fell back. */
  delegate?: "GPU" | "CPU" | "initializing" | "unavailable";
  preprocessMs?: number;
  previewMs?: number;
  inferenceMs?: number;
  equipmentInferenceMs?: number;
  rustMs?: number;
  /** Current causal detector state. Predicted axes are rendered but not submitted as measured Rust evidence. */
  equipmentAxis?: {
    kind: "barbell_shaft";
    source: "measured" | "fused" | "predicted";
    confidence: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    centerY: number;
    submittedToRust: boolean;
  };
  droppedFrames?: number | null;
  maxBacklogFrames?: number;
  replayPositionMs?: number;
  replayDurationMs?: number;
  replayEnded?: boolean;
}

export type RustQualityProposalJson = Readonly<Record<string, unknown>>;

export interface RustQualityProjection {
  marker: "QLT1";
  schemaVersion: string;
  /** Exact UTF-8 QLT1 payload text copied from the canonical packet. */
  payloadJson: string;
  proposals: readonly RustQualityProposalJson[];
  proposalIds: readonly string[];
  proposalHashes: readonly string[];
}

/** A video event always refers to an app-private local recording. */
export interface PoseVideoEvent {
  /** `saved` means the MP4/MOV is complete and safe to replay. */
  status: "saved" | "error";
  path?: string;
  uri?: string;
  fileName?: string;
  durationMs?: number;
  bytes?: number;
  error?: string;
}
