import { requireNativeView } from "expo";
import type { ViewProps, ViewStyle } from "react-native";
import type * as React from "react";

export interface PoseEvent {
  /** 33 landmarks as [x, y, z, visibility] normalized to the analysis frame. */
  landmarks: Array<[number, number, number, number]>;
  width: number;
  height: number;
  timestampMs: number;
  model: string;
  error?: string;
  /** Base64 encoded Rust canonical packet produced from this observation. */
  packetBase64?: string;
  processedFrames?: number;
  validFrames?: number;
  processedFps?: number;
  droppedFrames?: number | null;
  maxBacklogFrames?: number;
}

export interface PoseCameraViewProps extends ViewProps {
  /** "lite" | "full" | "heavy" — selects models/pose_landmarker_<id>.task in assets. */
  model: string;
  exerciseId: string;
  recognitionActive: boolean;
  onPose?: (event: { nativeEvent: PoseEvent }) => void;
  style?: ViewStyle;
}

const NativeView = requireNativeView("PoseCamera") as React.ComponentType<PoseCameraViewProps>;

export function PoseCameraView(props: PoseCameraViewProps) {
  return <NativeView {...props} />;
}
