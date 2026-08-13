import { requireNativeModule, requireNativeView } from "expo";
import { Platform, type ViewProps, type ViewStyle } from "react-native";
import type * as React from "react";
import { projectPoseEventQuality } from "./qualityProjection";
import type { PoseEvent, PoseVideoEvent } from "./types";

export {
  projectPoseEventQuality,
  projectRustQualityFromBase64,
  projectRustQualityFromPacket,
} from "./qualityProjection";
export type {
  PoseEvent,
  PoseVideoEvent,
  RustQualityProjection,
  RustQualityProposalJson,
} from "./types";

export interface PoseCameraViewProps extends ViewProps {
  /** Legacy model selector; Android now reports the frozen RTMPose-m Halpe-26 model. */
  model: string;
  /**
   * Versioned, opaque recognition selection produced by the shared TS
   * resolver. Android installs either a built-in code or a complete data
   * profile into Rust; profile interpretation never happens per frame.
   */
  recognitionProfile?: string;
  /** Legacy context props retained for older callers; they do not select a profile. */
  exerciseId?: string;
  capturePosition?: string;
  /** "front"（默认，预览镜像）| "back"。切换时原生侧重绑 CameraX。 */
  lensFacing?: "front" | "back";
  recognitionActive: boolean;
  /** Opt-in MP4 recording; analysis packets remain a separate local artifact. */
  videoRecording?: boolean;
  /** 视频回放识别：设置绝对路径即开始回放（与相机互斥），清空/undefined 恢复相机。 */
  replayPath?: string | null;
  /** 回放暂停开关。 */
  replayPaused?: boolean;
  onPose?: (event: { nativeEvent: PoseEvent }) => void;
  onVideo?: (event: { nativeEvent: PoseVideoEvent }) => void;
  style?: ViewStyle;
}

const NativeView =
  Platform.OS === "web"
    ? undefined
    : (requireNativeView(
        "PoseCamera",
      ) as React.ComponentType<PoseCameraViewProps>);

export function PoseCameraView(props: PoseCameraViewProps) {
  if (!NativeView) return null;
  const onPose =
    props.onPose === undefined
      ? undefined
      : (event: { nativeEvent: PoseEvent }) =>
          props.onPose?.({
            nativeEvent: projectPoseEventQuality(event.nativeEvent),
          });
  return <NativeView {...props} onPose={onPose} />;
}

interface PoseCameraNativeModule {
  listReplayVideos(): Promise<string[]>;
  deleteReplayVideo(path: string): Promise<"deleted" | "not_found">;
}

const NativeModule =
  Platform.OS === "web"
    ? undefined
    : requireNativeModule<PoseCameraNativeModule>("PoseCamera");

/**
 * 列出设备上可回放的训练视频（应用私有 Movies 目录下的绝对路径）。
 * Android/iOS 均只返回本机素材；Web 保持空列表。
 */
export function listReplayVideos(): Promise<string[]> {
  if (Platform.OS === "web") return Promise.resolve([]);
  return NativeModule!.listReplayVideos();
}

/** Deletes one app-owned training video. Native adapters reject paths outside their private library. */
export function deleteReplayVideo(
  path: string,
): Promise<"deleted" | "not_found"> {
  if (Platform.OS === "web") return Promise.resolve("not_found");
  return NativeModule!.deleteReplayVideo(path);
}
