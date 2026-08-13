import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { File, Paths } from "expo-file-system";

import { deleteReplayVideo, listReplayVideos } from "../../../modules/pose-camera/src/PoseCameraView";
import type { CoachApplication } from "../../coach";
import { sha256Hex, type MediaBlobReference } from "../../privacy";
import { EXERCISE_REGISTRY } from "../../pose/exerciseRegistry";
import { recommendCapturePosition, type CapturePosition } from "../../pose/viewGating";
import { IncrementalSha256, type CloudMediaAsset, type CloudMediaAssetKind, type CloudMediaLibrary } from "../cloud";
import { resolveRecognitionCapability } from "../exerciseRecognition";
import { colors } from "./theme";

interface CaptureEntry {
  fileName: string;
  modifiedMs: number;
}

export interface ReplaySelection {
  exerciseId: string;
  capturePosition: CapturePosition;
  videoPath: string;
}

/** 回放识别的候选动作：已校准 6 动作 + 常用模拟动作。 */
const REPLAY_EXERCISES: readonly string[] = [
  "march_in_place",
  "side_step_touch",
  "alternating_knee_raise",
  "step_jack",
  "lat_pulldown",
  "seated_shoulder_press",
  "barbell_row",
  "pull_up",
];

function exerciseName(exerciseId: string): string {
  try {
    return EXERCISE_REGISTRY.require(exerciseId).nameZh;
  } catch {
    return exerciseId;
  }
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function asFileUri(path: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(path) ? path : `file://${path}`;
}

function mediaErrorText(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) return `${fallback}（${cause.message}）`;
  return fallback;
}

function mediaKindLabel(kind: CloudMediaAssetKind): string {
  switch (kind) {
    case "video": return "训练视频";
    case "canonical_packet": return "Canonical packet";
    case "keypoints": return "关键点";
    case "nutrition_photo": return "营养照片";
  }
}

function formatBytes(byteSize: number): string {
  if (byteSize < 1_024) return `${byteSize} B`;
  if (byteSize < 1_048_576) return `${(byteSize / 1_024).toFixed(1)} KB`;
  return `${(byteSize / 1_048_576).toFixed(1)} MB`;
}

function imageExtension(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/heic" || mimeType === "image/heif") return "heic";
  return "jpg";
}

async function sha256FileHex(file: File, onProgress: (bytesRead: number) => void): Promise<string> {
  const handle = file.open();
  const digest = new IncrementalSha256();
  let bytesRead = 0;
  try {
    while (bytesRead < file.size) {
      const chunk = handle.readBytes(Math.min(1024 * 1024, file.size - bytesRead));
      if (chunk.byteLength === 0) throw new Error("local_media_read_incomplete");
      digest.update(chunk);
      bytesRead += chunk.byteLength;
      onProgress(bytesRead);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return digest.digestHex();
  } finally {
    handle.close();
  }
}

/** 进展页：本机 captures/ 落盘文件列表 + 训练视频入口。 */
export function ProgressScreen(props: {
  application?: CoachApplication;
  userId?: string;
  cloudMediaLibrary?: CloudMediaLibrary;
  onOpenReplay?: (selection: ReplaySelection) => void;
}) {
  const [entries, setEntries] = useState<CaptureEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [videos, setVideos] = useState<string[]>([]);
  // 非 null 时为该视频展开动作选择器
  const [pickerVideo, setPickerVideo] = useState<string | null>(null);
  const [cloudAssets, setCloudAssets] = useState<readonly CloudMediaAsset[]>([]);
  const [localNutritionMedia, setLocalNutritionMedia] = useState<readonly MediaBlobReference[]>([]);
  const [cloudLoading, setCloudLoading] = useState(Boolean(props.cloudMediaLibrary));
  const [cloudAction, setCloudAction] = useState<string>();
  const [cloudProgress, setCloudProgress] = useState<string>();
  // Android 的回放仍会通过 Rust bridge 重新生成 canonical packet；iOS 目前
  // 只提供本机视频播放，不能把 AVFoundation 播放误称为动作识别。
  const supportsReplayAnalysis = Platform.OS === "android";

  useEffect(() => {
    try {
      const dir = Paths.document;
      const captures = dir.list().filter((entry) => entry.name === "captures")[0];
      if (!captures) {
        setEntries([]);
        return;
      }
      const files = (captures as unknown as { list(): File[] }).list()
        .filter((f) => f.name.endsWith(".json"))
        .map((f) => ({ fileName: f.name, modifiedMs: f.modificationTime ?? 0 }))
        .sort((a, b) => b.modifiedMs - a.modifiedMs);
      setEntries(files);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshCloudAssets = useCallback(async () => {
    if (!props.cloudMediaLibrary) return;
    setCloudLoading(true);
    try {
      const assets: CloudMediaAsset[] = [];
      let cursor: string | undefined;
      do {
        const page = await props.cloudMediaLibrary.listAssets({ limit: 100, ...(cursor ? { cursor } : {}) });
        assets.push(...page.data);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      setCloudAssets(assets);
      setError(null);
    } catch (cause) {
      setError(mediaErrorText(cause, "无法读取云端资料库。"));
    } finally {
      setCloudLoading(false);
    }
  }, [props.cloudMediaLibrary]);

  useEffect(() => {
    void refreshCloudAssets();
  }, [refreshCloudAssets]);

  useEffect(() => {
    if (!props.application || !props.userId) return;
    void props.application.listMedia({ userId: props.userId, lifecycle: "active" })
      .then((items) => setLocalNutritionMedia(items.filter(({ mimeType }) => mimeType.startsWith("image/"))))
      .catch(() => setLocalNutritionMedia([]));
  }, [props.application, props.userId]);

  const uploadFile = async (input: {
    actionId: string;
    kind: CloudMediaAssetKind;
    uri: string;
    fileName: string;
    contentType: string;
  }) => {
    if (!props.cloudMediaLibrary) return;
    setCloudAction(input.actionId);
    setCloudProgress("正在校验文件…");
    try {
      const file = new File(asFileUri(input.uri));
      const byteSize = file.size;
      if (!file.exists || !byteSize) throw new Error("local_media_unavailable");
      const sha256 = await sha256FileHex(file, (bytesRead) => {
        setCloudProgress(`正在校验文件 ${Math.round((bytesRead / byteSize) * 100)}%`);
      });
      await props.cloudMediaLibrary.upload({
        decision: "upload",
        kind: input.kind,
        source: { kind: "uri", uri: file.uri },
        fileName: input.fileName,
        contentType: input.contentType,
        byteSize,
        sha256,
        idempotencyKey: `library:${input.kind}:${sha256}`,
      }, {
        maxTransferAttempts: 3,
        onProgress: ({ phase, bytesSent, totalBytes }) => {
          const percent = totalBytes ? Math.round((bytesSent / totalBytes) * 100) : 0;
          setCloudProgress(phase === "uploading" ? `上传中 ${percent}%` : phase === "ready" ? "已保存" : "正在确认…");
        },
      });
      await refreshCloudAssets();
    } catch (cause) {
      setError(mediaErrorText(cause, "上传没有完成，本机文件仍然保留。"));
    } finally {
      setCloudAction(undefined);
      setCloudProgress(undefined);
    }
  };

  const uploadNutritionPhoto = async (reference: MediaBlobReference) => {
    if (!props.application || !props.userId || !props.cloudMediaLibrary) return;
    setCloudAction(reference.id);
    setCloudProgress("正在准备营养照片…");
    try {
      const media = await props.application.getMedia({ userId: props.userId, id: reference.id });
      if (!media) throw new Error("local_media_unavailable");
      const sha256 = reference.contentHash.slice("sha256-".length);
      await props.cloudMediaLibrary.upload({
        decision: "upload",
        kind: "nutrition_photo",
        source: { kind: "bytes", bytes: media.bytes },
        fileName: `${reference.id}.${imageExtension(reference.mimeType)}`,
        contentType: reference.mimeType,
        byteSize: reference.byteLength,
        sha256,
        idempotencyKey: `library:nutrition_photo:${sha256}`,
      }, {
        maxTransferAttempts: 3,
        onProgress: ({ phase, bytesSent, totalBytes }) => {
          const percent = totalBytes ? Math.round((bytesSent / totalBytes) * 100) : 0;
          setCloudProgress(phase === "uploading" ? `上传中 ${percent}%` : phase === "ready" ? "已保存" : "正在确认…");
        },
      });
      await refreshCloudAssets();
    } catch (cause) {
      setError(mediaErrorText(cause, "营养照片上传没有完成。"));
    } finally {
      setCloudAction(undefined);
      setCloudProgress(undefined);
    }
  };

  const requestCloudDelete = (asset: CloudMediaAsset) => {
    if (!props.cloudMediaLibrary) return;
    Alert.alert("删除云端资料？", "会同时删除原件和它的派生资料，本机文件不会被删除。", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          setCloudAction(asset.id);
          void props.cloudMediaLibrary!.deleteAsset({
            assetId: asset.id,
            expectedRevision: asset.revision,
            idempotencyKey: `library:delete:${asset.id}:r${asset.revision}`,
          }).then(refreshCloudAssets)
            .catch((cause) => setError(mediaErrorText(cause, "无法删除云端资料。")))
            .finally(() => setCloudAction(undefined));
        },
      },
    ]);
  };

  useEffect(() => {
    if (Platform.OS === "web") return;
    listReplayVideos()
      .then(setVideos)
      .catch(() => setVideos([]));
  }, []);

  const pickExercise = (exerciseId: string) => {
    if (!pickerVideo || !props.onOpenReplay) return;
    const capturePosition = recommendCapturePosition(exerciseId)?.position ?? "front";
    props.onOpenReplay({
      exerciseId,
      capturePosition,
      videoPath: pickerVideo,
    });
    setPickerVideo(null);
  };

  const openPlayback = (videoPath: string) => {
    if (supportsReplayAnalysis) {
      setPickerVideo(pickerVideo === videoPath ? null : videoPath);
      return;
    }
    props.onOpenReplay?.({
      exerciseId: "local_video_playback",
      capturePosition: "front",
      videoPath,
    });
  };

  const requestDelete = (videoPath: string) => {
    Alert.alert(
      "删除这段训练视频？",
      "只会删除这台设备上的本机录像，无法恢复。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "删除",
          style: "destructive",
          onPress: () => {
            void deleteReplayVideo(videoPath)
              .then(() => {
                setVideos((current) => current.filter((item) => item !== videoPath));
                setPickerVideo((current) => current === videoPath ? null : current);
              })
              .catch(() => setError("无法删除这段训练视频。"));
          },
        },
      ],
    );
  };

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.brand}>进<Text style={styles.accent}>展</Text></Text>
        <Text style={styles.sub}>本机录制素材 · {entries.length} 组 · 云端资料 {cloudAssets.length} 项</Text>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {props.cloudMediaLibrary ? (
          <View style={styles.replaySection}>
            <Text style={styles.sectionTitle}>个人云端资料库</Text>
            <Text style={styles.sectionDesc}>只有你主动点“上传”后，视频、packet、关键点或营养照片才会保存到云端。</Text>
            {cloudLoading ? <ActivityIndicator color={colors.limeDeep} /> : null}
            {!cloudLoading && cloudAssets.length === 0 ? <Text style={styles.cloudEmpty}>还没有上传任何资料。</Text> : null}
            {cloudAssets.map((asset) => (
              <View key={asset.id} style={styles.cloudRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{asset.fileName}</Text>
                  <Text style={styles.rowMeta}>{mediaKindLabel(asset.kind)} · {asset.status === "ready" ? "已保存" : "上传中"} · {formatBytes(asset.byteSize)}</Text>
                </View>
                <TouchableOpacity disabled={Boolean(cloudAction)} onPress={() => requestCloudDelete(asset)} style={styles.deleteButtonInline}>
                  <Text style={styles.deleteButtonText}>{cloudAction === asset.id ? "处理中" : "删除"}</Text>
                </TouchableOpacity>
              </View>
            ))}
            {cloudProgress ? <Text style={styles.cloudProgress}>{cloudProgress}</Text> : null}
          </View>
        ) : null}

        {/* Android 重新分析 / iOS 本机播放 */}
        {videos.length > 0 && (
          <View style={styles.replaySection}>
            <Text style={styles.sectionTitle}>{supportsReplayAnalysis ? "视频回放识别" : "训练视频"}</Text>
            <Text style={styles.sectionDesc}>
              {supportsReplayAnalysis
                ? "把设备上的训练视频重新跑过识别管线；只有具备 exact profile 的动作才会显示计数。"
                : "保存在本机的训练录像。当前版本仅播放，尚不从 iOS 视频生成动作计数或技术结论。"}
            </Text>
            {videos.map((video) => (
              <View key={video}>
                <View style={styles.videoRow}>
                  <TouchableOpacity style={styles.videoOpen} onPress={() => openPlayback(video)}>
                    <View style={styles.rowIcon}><Text>🎬</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName} numberOfLines={1}>{fileName(video)}</Text>
                      <Text style={styles.rowMeta}>
                        {supportsReplayAnalysis ? "点击选择动作重新分析" : "点击播放本机视频"}
                      </Text>
                    </View>
                    <Text style={styles.rowChevron}>{supportsReplayAnalysis && pickerVideo === video ? "▾" : "▸"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`删除训练视频 ${fileName(video)}`}
                    style={styles.deleteButton}
                    onPress={() => requestDelete(video)}
                  >
                    <Text style={styles.deleteButtonText}>删除</Text>
                  </TouchableOpacity>
                  {props.cloudMediaLibrary ? (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`上传训练视频 ${fileName(video)}`}
                      disabled={Boolean(cloudAction)}
                      style={styles.cloudUploadButton}
                      onPress={() => void uploadFile({
                        actionId: video,
                        kind: "video",
                        uri: video,
                        fileName: fileName(video),
                        contentType: video.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4",
                      })}
                    >
                      <Text style={styles.cloudUploadButtonText}>{cloudAction === video ? "正在上传" : "上传到资料库"}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {supportsReplayAnalysis && pickerVideo === video && (
                  <View style={styles.picker}>
                    {REPLAY_EXERCISES.map((exerciseId) => {
                      const capturePosition = recommendCapturePosition(exerciseId)?.position ?? "front";
                      const recognition = resolveRecognitionCapability(exerciseId, capturePosition);
                      return (
                        <TouchableOpacity
                          key={exerciseId}
                          style={styles.pickerRow}
                          onPress={() => pickExercise(exerciseId)}
                        >
                          <Text style={styles.pickerName}>{exerciseName(exerciseId)}</Text>
                          <Text
                            style={[
                              styles.pickerTag,
                              recognition.canCount ? styles.pickerTagCalibrated : styles.pickerTagSimulated,
                            ]}
                          >
                            {recognition.canCount ? "可计数" : "无 profile"}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}
        {!error && entries.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>还没有录制素材</Text>
            <Text style={styles.emptyDesc}>
              去动作库选一个动作，完成一组训练后素材会自动落盘到这里。
            </Text>
          </View>
        )}
        {entries.map((entry) => {
          const captureFile = new File(Paths.document, "captures", entry.fileName);
          return (
            <View key={entry.fileName} style={styles.captureCard}>
              <View style={styles.row}>
                <View style={styles.rowIcon}><Text>🎞️</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{entry.fileName}</Text>
                  <Text style={styles.rowMeta}>{new Date(entry.modifiedMs).toLocaleString()} · 本机 captures/</Text>
                </View>
              </View>
              {props.cloudMediaLibrary ? (
                <View style={styles.captureActions}>
                  <TouchableOpacity disabled={Boolean(cloudAction)} style={styles.cloudUploadButton} onPress={() => void uploadFile({ actionId: `${entry.fileName}:packet`, kind: "canonical_packet", uri: captureFile.uri, fileName: entry.fileName, contentType: "application/json" })}>
                    <Text style={styles.cloudUploadButtonText}>{cloudAction === `${entry.fileName}:packet` ? "上传中" : "上传 packet"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity disabled={Boolean(cloudAction)} style={styles.cloudUploadButton} onPress={() => void uploadFile({ actionId: `${entry.fileName}:keypoints`, kind: "keypoints", uri: captureFile.uri, fileName: entry.fileName.replace(/\.json$/i, "-keypoints.json"), contentType: "application/json" })}>
                    <Text style={styles.cloudUploadButtonText}>{cloudAction === `${entry.fileName}:keypoints` ? "上传中" : "上传关键点"}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          );
        })}

        {props.cloudMediaLibrary && localNutritionMedia.length > 0 ? (
          <View style={styles.replaySection}>
            <Text style={styles.sectionTitle}>本机营养照片</Text>
            <Text style={styles.sectionDesc}>照片默认只在本机；逐张选择后才进入资料库。</Text>
            {localNutritionMedia.map((reference) => (
              <View key={reference.id} style={styles.cloudRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{reference.id}</Text>
                  <Text style={styles.rowMeta}>{reference.mimeType} · {formatBytes(reference.byteLength)}</Text>
                </View>
                <TouchableOpacity disabled={Boolean(cloudAction)} style={styles.cloudUploadButton} onPress={() => void uploadNutritionPhoto(reference)}>
                  <Text style={styles.cloudUploadButtonText}>{cloudAction === reference.id ? "上传中" : "上传"}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: 24, paddingTop: 8 },
  brand: { fontSize: 30, fontWeight: "900", color: colors.ink, letterSpacing: 2 },
  accent: { color: colors.limeDeep },
  sub: { fontSize: 12, color: colors.ink2, marginTop: 4 },
  list: { paddingHorizontal: 24, paddingTop: 18, paddingBottom: 24 },
  replaySection: { marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontWeight: "900", color: colors.ink },
  sectionDesc: { fontSize: 12, color: colors.ink2, marginTop: 4, marginBottom: 10, lineHeight: 18 },
  cloudEmpty: { fontSize: 12, color: colors.ink3, paddingVertical: 10 },
  cloudRow: {
    backgroundColor: colors.white, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 13,
    flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8,
  },
  cloudProgress: { fontSize: 12, color: colors.limeDeep, fontWeight: "800", marginTop: 4 },
  deleteButtonInline: { paddingHorizontal: 10, paddingVertical: 7 },
  cloudUploadButton: {
    alignSelf: "flex-start", backgroundColor: colors.dark2, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 8, marginHorizontal: 14, marginBottom: 12,
  },
  cloudUploadButtonText: { color: colors.white, fontSize: 11, fontWeight: "900" },
  captureCard: { marginBottom: 8 },
  captureActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  picker: {
    backgroundColor: colors.paper2, borderRadius: 14, marginTop: -4, marginBottom: 8,
    paddingHorizontal: 8, paddingVertical: 6,
  },
  pickerRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 10, paddingVertical: 10,
  },
  pickerName: { fontSize: 14, fontWeight: "700", color: colors.ink },
  pickerTag: { fontSize: 10, fontWeight: "900", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: "hidden" },
  pickerTagCalibrated: { backgroundColor: colors.lime, color: colors.limeInk },
  pickerTagSimulated: { backgroundColor: colors.terraSoft, color: colors.terra },
  rowChevron: { fontSize: 14, color: colors.ink3, fontWeight: "900" },
  error: { color: colors.terra, fontSize: 12 },
  empty: { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: "900", color: colors.ink },
  emptyDesc: { fontSize: 13, color: colors.ink2, textAlign: "center", lineHeight: 20, paddingHorizontal: 24 },
  row: {
    backgroundColor: colors.white, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 13,
    flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8,
  },
  videoRow: {
    backgroundColor: colors.white, borderRadius: 16, marginBottom: 8, overflow: "hidden",
  },
  videoOpen: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  deleteButton: { alignSelf: "flex-end", marginRight: 14, marginBottom: 12, paddingHorizontal: 10, paddingVertical: 5 },
  deleteButtonText: { color: colors.terra, fontWeight: "800", fontSize: 12 },
  rowIcon: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: colors.dark2,
    alignItems: "center", justifyContent: "center",
  },
  rowName: { fontSize: 13, fontWeight: "700", color: colors.ink },
  rowMeta: { fontSize: 11, color: colors.ink3, marginTop: 3, fontFamily: "monospace" },
});
