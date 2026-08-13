import { useCallback, useMemo, useRef, useState } from "react";

import {
  FileSystemCaptureStore,
  type CaptureFileRef,
  type CaptureSessionMeta,
  type CaptureStore,
} from "./captureStore";

// UI 侧只需要从 hook 一个入口拿类型，这里统一转出。
export { InMemoryCaptureStore } from "./captureStore";
export type {
  CaptureFileRef,
  CaptureFrame,
  CaptureSessionMeta,
  CaptureStore,
} from "./captureStore";

/**
 * onPose nativeEvent 的最小结构（与 modules/pose-camera 的 PoseEvent 对齐，
 * 这里只做结构化声明，避免 hook 反向依赖原生模块源码）。
 */
export interface CapturePoseEvent {
  timestampMs: number;
  packetBase64?: string;
  error?: string;
}

export interface UseCaptureSession {
  /** 是否正在录制（驱动 UI 按钮态）。 */
  recording: boolean;
  /** 开始录制；已有进行中的会话时由 store 抛错。 */
  startRecording: (meta: CaptureSessionMeta) => void;
  /** 从 onPose 事件提取 canonical packet 与时间戳；未录制或空帧时静默忽略。 */
  ingestPoseEvent: (nativeEvent: CapturePoseEvent) => void;
  /** 结束并落盘；未在录制时返回 null。落盘失败时会话已被清空，错误原样抛给调用方。 */
  stopRecording: () => Promise<CaptureFileRef | null>;
  /** 放弃本次录制（不落盘）；未在录制时为空操作。 */
  discardRecording: () => void;
}

/**
 * 持有当前 CaptureStore 会话的 hook。
 * store 通过参数注入（默认 FileSystemCaptureStore）；仅在首次渲染时读取，
 * 之后更换入参不会生效——测试 / UI 开发时传入 InMemoryCaptureStore 即可。
 */
export function useCaptureSession(store?: CaptureStore): UseCaptureSession {
  const storeRef = useRef<CaptureStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = store ?? new FileSystemCaptureStore();
  }

  const [recording, setRecording] = useState(false);
  // 录制标记同时放 ref：ingestPoseEvent 在每帧回调里读取，不能依赖渲染周期。
  const activeRef = useRef(false);

  const startRecording = useCallback((meta: CaptureSessionMeta) => {
    storeRef.current!.begin(meta);
    activeRef.current = true;
    setRecording(true);
  }, []);

  const ingestPoseEvent = useCallback((nativeEvent: CapturePoseEvent) => {
    if (!activeRef.current) return;
    // 原生侧的错误帧 / 无 packet 的空帧不录入。
    if (nativeEvent.error || !nativeEvent.packetBase64) return;
    storeRef.current!.append({
      timestampMs: nativeEvent.timestampMs,
      packetBase64: nativeEvent.packetBase64,
    });
  }, []);

  const stopRecording = useCallback(async (): Promise<CaptureFileRef | null> => {
    if (!activeRef.current) return null;
    activeRef.current = false;
    setRecording(false);
    try {
      return await storeRef.current!.finalize();
    } catch (error) {
      // finalize 已实现"先清状态再落盘"，这里只需把错误透传给 UI 展示。
      throw error;
    }
  }, []);

  const discardRecording = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setRecording(false);
    storeRef.current!.abort();
  }, []);

  // 返回值整体 memo：回调全部稳定，仅 recording 翻转时换引用，
  // 避免使用方把 capture 放进 useCallback 依赖后每帧重建。
  return useMemo(
    () => ({ recording, startRecording, ingestPoseEvent, stopRecording, discardRecording }),
    [recording, startRecording, ingestPoseEvent, stopRecording, discardRecording],
  );
}
