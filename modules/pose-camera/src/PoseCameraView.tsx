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

let NativeView: React.ComponentType<PoseCameraViewProps> | undefined;
let NativeModule: PoseCameraNativeModule | undefined;

if (Platform.OS !== "web") {
  try {
    NativeView = requireNativeView("PoseCamera") as React.ComponentType<PoseCameraViewProps>;
    NativeModule = requireNativeModule<PoseCameraNativeModule>("PoseCamera");
  } catch {
    // Expo Go or a development client may not contain this optional module.
    // Importing the product shell must remain safe and fall back to manual.
    NativeView = undefined;
    NativeModule = undefined;
  }
}

export interface PoseCameraRuntimeHealth {
  canonicalBridgeReady: boolean;
  runtimeReady: boolean;
  reason: string;
}

const unavailableRuntimeHealth = (reason: string): PoseCameraRuntimeHealth => ({
  canonicalBridgeReady: false,
  runtimeReady: false,
  reason,
});

/**
 * Verifies that the view, Expo module, JNI/Objective-C bridge, and canonical
 * Rust packet contract are live. Presence in the JavaScript bundle alone is
 * never treated as runtime readiness.
 */
export async function readPoseCameraRuntimeHealth(): Promise<PoseCameraRuntimeHealth> {
  if (!NativeView || !NativeModule) return unavailableRuntimeHealth("native_module_unavailable");
  try {
    const health = await NativeModule.runtimeHealth();
    if (
      typeof health?.canonicalBridgeReady !== "boolean"
      || typeof health?.runtimeReady !== "boolean"
      || typeof health?.reason !== "string"
    ) return unavailableRuntimeHealth("invalid_runtime_health_response");
    return health;
  } catch {
    return unavailableRuntimeHealth("runtime_health_query_failed");
  }
}

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
  runtimeHealth(): Promise<PoseCameraRuntimeHealth>;
  listReplayVideos(): Promise<string[]>;
  deleteReplayVideo(path: string): Promise<"deleted" | "not_found">;
}

/**
 * 列出设备上可回放的训练视频（应用私有 Movies 目录下的绝对路径）。
 * Android/iOS 均只返回本机素材；Web 保持空列表。
 */
export function listReplayVideos(): Promise<string[]> {
  if (!NativeModule) return Promise.resolve([]);
  return NativeModule.listReplayVideos();
}

/** Deletes one app-owned training video. Native adapters reject paths outside their private library. */
export function deleteReplayVideo(
  path: string,
): Promise<"deleted" | "not_found"> {
  if (!NativeModule) return Promise.resolve("not_found");
  return NativeModule.deleteReplayVideo(path);
}
