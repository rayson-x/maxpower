import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { CoachContextKind, CoachMessage, CoachSessionStatus, ContextRef } from "../model";
import { APP_DOCK_BODY_HEIGHT, type CoachComposerAnchor } from "../../mobile/ui-kit/AppDock";
import { FocusSurface } from "../../mobile/ui-kit/FocusSurface";
import type {
  CoachArtifactPart,
  CoachStreamSnapshot,
  CoachToolPart,
  CoachUiPart,
} from "./coachStreamProjection";

export interface CoachDrawerProps {
  context: ContextRef;
  stream: CoachStreamSnapshot;
  /** Durable task identity, supplied only by the application-facing shell. */
  session?: {
    id: string;
    status: CoachSessionStatus;
    title?: string;
    context: ContextRef;
  };
  expanded?: boolean;
  initiallyExpanded?: boolean;
  bottomInset?: number;
  horizontalInset?: number;
  /** Bounds of the dock composer that becomes the regular Coach conversation surface. */
  composerAnchor?: CoachComposerAnchor;
  /** Incremented only when the dock entry was tapped, so other Coach openings do not force the keyboard. */
  focusRequest?: number;
  /** The collapsed composer decides whether this conversation opens for typing or voice capture. */
  entryMode?: "text" | "voice";
  dockedComposer?: boolean;
  messages?: readonly CoachMessage[];
  sessions?: readonly {
    id: string;
    status: CoachSessionStatus;
    title?: string;
    context: ContextRef;
    updatedAt: string;
  }[];
  onExpandedChange?: (expanded: boolean) => void;
  onSend?: (message: string, context: ContextRef) => void;
  onSelectSession?: (sessionId: string) => void;
  onStartNew?: () => void;
  onCardAction?: (actionId: string, artifactId: string) => void;
  onHumanAction?: (pendingActionId: string, optionId: string) => void;
}

export function CoachDrawer({
  context,
  stream,
  session,
  expanded: controlledExpanded,
  initiallyExpanded = false,
  messages = [],
  sessions = [],
  bottomInset = APP_DOCK_BODY_HEIGHT,
  horizontalInset = 8,
  composerAnchor,
  focusRequest = 0,
  entryMode = "text",
  dockedComposer = false,
  onExpandedChange,
  onSend,
  onSelectSession,
  onStartNew,
  onCardAction,
  onHumanAction,
}: CoachDrawerProps) {
  const insets = useSafeAreaInsets();
  const [internalExpanded, setInternalExpanded] = useState(initiallyExpanded);
  const expanded = controlledExpanded ?? internalExpanded;
  const [message, setMessage] = useState("");
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [retainedContext, setRetainedContext] = useState(context);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<"text" | "voice">(entryMode);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [attachmentTrayOpen, setAttachmentTrayOpen] = useState(false);
  const messageInputRef = useRef<TextInput>(null);
  const focusRequestHandled = useRef(focusRequest);

  const focusTextComposer = useCallback(() => {
    messageInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!expanded) setRetainedContext(context);
  }, [context, expanded]);

  useEffect(() => {
    if (expanded && session) setRetainedContext(session.context);
  }, [expanded, session]);

  useEffect(() => {
    if (!expanded) return;
    setComposerMode(entryMode);
    setVoiceRecording(false);
    setAttachmentTrayOpen(false);
  }, [entryMode, expanded]);

  useEffect(() => {
    if (expanded && composerMode === "voice") Keyboard.dismiss();
  }, [composerMode, expanded]);

  const setExpanded = useCallback((next: boolean) => {
    if (controlledExpanded === undefined) setInternalExpanded(next);
    onExpandedChange?.(next);
  }, [controlledExpanded, onExpandedChange]);

  useEffect(() => {
    if (!expanded) {
      Keyboard.dismiss();
      setHistoryOpen(false);
    }
  }, [expanded]);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) => setKeyboardHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (!expanded || composerMode !== "text" || focusRequest === focusRequestHandled.current) return;
    focusRequestHandled.current = focusRequest;
    const frame = requestAnimationFrame(focusTextComposer);
    return () => cancelAnimationFrame(frame);
  }, [composerMode, expanded, focusRequest, focusTextComposer]);

  useEffect(() => {
    if (!dockedComposer || !expanded) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (keyboardHeight > 0) {
        Keyboard.dismiss();
        return true;
      }
      setExpanded(false);
      return true;
    });
    return () => subscription.remove();
  }, [dockedComposer, expanded, keyboardHeight, setExpanded]);

  const submit = () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    onSend?.(trimmed, retainedContext);
    setMessage("");
  };

  const switchToText = () => {
    setComposerMode("text");
    setVoiceRecording(false);
    requestAnimationFrame(focusTextComposer);
  };

  const transcript = messages.filter((item) => item.role !== "tool");
  const completedAssistantRuns = new Set(
    transcript.filter((item) => item.role === "assistant" && item.runId).map((item) => item.runId),
  );
  const liveParts = stream.parts.filter((part) =>
    part.type !== "text" || !completedAssistantRuns.has(part.id.replace(/^text:/, "")),
  );
  const keyboardOffset = keyboardHeight > 0 ? Math.max(0, keyboardHeight - insets.bottom) : 0;
  const surfaceBottomInset = dockedComposer
    ? keyboardOffset > 0 ? keyboardOffset + 6 : Math.max(6, insets.bottom + 6)
    : bottomInset + insets.bottom + keyboardOffset;

  return (
    <FocusSurface
      visible={expanded}
      anchor={dockedComposer ? composerAnchor : undefined}
      bottomInset={surfaceBottomInset}
      horizontalInset={horizontalInset}
      accessibilityLabel="收起 Coach"
      onDismiss={() => setExpanded(false)}
    >
        <View style={styles.panelContent}>
          <View style={styles.panelHeader}>
            <View style={styles.panelTitleBlock}>
              <Text style={styles.panelTitle}>Coach</Text>
              <View style={styles.contextBadge}><Text style={styles.contextBadgeText}>{contextLabel(retainedContext)}</Text></View>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="查看历史对话" onPress={() => { Keyboard.dismiss(); setHistoryOpen((current) => !current); }} style={styles.historyButton}><Text style={styles.historyButtonText}>{historyOpen ? "返回" : "历史"}</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="收起 MaxPower Coach" onPress={() => setExpanded(false)} style={styles.minimizeButton}><Text style={styles.minimizeGlyph}>×</Text></Pressable>
          </View>
          <View style={styles.panelBody}>
            {historyOpen ? (
              <SessionHistory
                activeSessionId={session?.id}
                sessions={sessions}
                onSelect={(sessionId) => { setHistoryOpen(false); onSelectSession?.(sessionId); }}
                onStartNew={() => { setHistoryOpen(false); onStartNew?.(); }}
              />
            ) : (
              <>
                <ScrollView
                  contentContainerStyle={styles.conversationContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  style={styles.streamViewport}
                >
                  {transcript.map((item) => <ConversationMessage key={item.id} message={item} />)}
                  {liveParts.map((part) => <StreamPart key={part.id} part={part} onCardAction={onCardAction} onHumanAction={onHumanAction} />)}
                  {transcript.length === 0 && liveParts.length === 0 ? <EmptyState context={retainedContext.kind} message={stream.emptyMessage} onSelect={(prompt) => onSend?.(prompt, retainedContext)} /> : null}
                </ScrollView>

                <View style={styles.composerArea}>
                  <View style={styles.contextDraft}><View style={styles.contextDraftDot} /><Text numberOfLines={1} style={styles.contextDraftText}>本页 · {contextLabel(retainedContext)}</Text></View>
                  {attachmentTrayOpen ? <View style={styles.attachmentTray}>
                    <Pressable accessibilityRole="button" accessibilityLabel="从相册添加附件" onPress={() => setAttachmentTrayOpen(false)} style={styles.attachmentAction}><Text style={styles.attachmentGlyph}>▧</Text><Text style={styles.attachmentLabel}>相册</Text></Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="拍摄并添加附件" onPress={() => setAttachmentTrayOpen(false)} style={styles.attachmentAction}><Text style={styles.attachmentGlyph}>◉</Text><Text style={styles.attachmentLabel}>相机</Text></Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="添加文件附件" onPress={() => setAttachmentTrayOpen(false)} style={styles.attachmentAction}><Text style={styles.attachmentGlyph}>▤</Text><Text style={styles.attachmentLabel}>文件</Text></Pressable>
                  </View> : null}
                  {composerMode === "text" ? <View style={styles.composer}>
                    <Pressable accessibilityRole="button" accessibilityLabel="添加图片或文件" onPress={() => setAttachmentTrayOpen((open) => !open)} style={({ pressed }) => [styles.composerAction, pressed && styles.buttonPressed]}><Text style={styles.composerActionGlyph}>＋</Text></Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="拍照添加到消息" onPress={() => setAttachmentTrayOpen(true)} style={({ pressed }) => [styles.composerAction, pressed && styles.buttonPressed]}><Text style={styles.composerActionGlyph}>◉</Text></Pressable>
                    <TextInput
                      ref={messageInputRef}
                      accessibilityLabel="发送给 Coach 的消息"
                      multiline
                      onChangeText={setMessage}
                      onFocus={() => setComposerMode("text")}
                      onSubmitEditing={submit}
                      placeholder="问 Coach"
                      placeholderTextColor="#777971"
                      style={styles.input}
                      value={message}
                    />
                    {message.trim() ? <Pressable accessibilityRole="button" accessibilityLabel="发送消息" onPress={submit} style={({ pressed }) => [styles.sendButton, pressed && styles.buttonPressed]}><Text style={styles.sendGlyph}>↑</Text></Pressable> : <Pressable accessibilityRole="button" accessibilityLabel="切换到语音输入" onPress={() => setComposerMode("voice")} style={({ pressed }) => [styles.voiceModeButton, pressed && styles.buttonPressed]}><Text style={styles.voiceModeGlyph}>◖</Text></Pressable>}
                  </View> : <View style={[styles.voiceComposer, voiceRecording && styles.voiceComposerRecording]}>
                    <Pressable accessibilityRole="button" accessibilityLabel="切换到文字输入" onPress={switchToText} style={({ pressed }) => [styles.composerAction, pressed && styles.buttonPressed]}><Text style={styles.composerActionGlyph}>⌨</Text></Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="按住说话"
                      delayLongPress={180}
                      onLongPress={() => setVoiceRecording(true)}
                      onPressOut={() => setVoiceRecording(false)}
                      style={({ pressed }) => [styles.holdToTalk, voiceRecording && styles.holdToTalkRecording, pressed && !voiceRecording && styles.buttonPressed]}
                    >
                      <View style={styles.voiceWave}><View style={styles.voiceWaveBar} /><View style={styles.voiceWaveBarTall} /><View style={styles.voiceWaveBar} /></View>
                      <Text style={styles.holdToTalkText}>{voiceRecording ? "录音中 · 松开结束" : "按住说话"}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="关闭语音输入" onPress={switchToText} style={({ pressed }) => [styles.voiceModeButton, pressed && styles.buttonPressed]}><Text style={styles.voiceModeGlyph}>⌁</Text></Pressable>
                  </View>}
                </View>
              </>
            )}
          </View>
        </View>
    </FocusSurface>
  );
}

function ConversationMessage({ message }: { message: CoachMessage }) {
  const user = message.role === "user";
  return <View style={[styles.conversationRow, user && styles.conversationRowUser]}>
    {!user ? <View style={styles.assistantMark}><Text style={styles.assistantMarkText}>↗</Text></View> : null}
    <View style={[styles.conversationBubble, user ? styles.userBubble : styles.assistantBubble]}>
      <Text style={[styles.conversationText, user && styles.userText]}>{message.content}</Text>
      <Text style={[styles.conversationTime, user && styles.userTime]}>{message.createdAt.slice(11, 16)}</Text>
    </View>
  </View>;
}

function SessionHistory({ sessions, activeSessionId, onSelect, onStartNew }: {
  sessions: NonNullable<CoachDrawerProps["sessions"]>;
  activeSessionId?: string;
  onSelect(sessionId: string): void;
  onStartNew(): void;
}) {
  return <ScrollView contentContainerStyle={styles.historyList} showsVerticalScrollIndicator={false}>
    <Pressable accessibilityRole="button" onPress={onStartNew} style={styles.newConversation}>
      <Text style={styles.newConversationGlyph}>＋</Text><View><Text style={styles.newConversationTitle}>开始新对话</Text><Text style={styles.newConversationMeta}>使用当前页面作为上下文</Text></View>
    </Pressable>
    <Text style={styles.historySectionLabel}>最近对话</Text>
    {sessions.length ? sessions.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: item.id === activeSessionId }} onPress={() => onSelect(item.id)} style={[styles.historyRow, item.id === activeSessionId && styles.historyRowActive]}>
      <View style={styles.historyRowBody}><Text numberOfLines={1} style={styles.historyTitle}>{item.title?.trim() || contextLabel(item.context)}</Text><Text style={styles.historyMeta}>{contextLabel(item.context)} · {item.updatedAt.slice(0, 10)}</Text></View><Text style={styles.historyArrow}>›</Text>
    </Pressable>) : null}
  </ScrollView>;
}

function StreamPart({
  part,
  onCardAction,
  onHumanAction,
}: {
  part: CoachUiPart;
  onCardAction?: CoachDrawerProps["onCardAction"];
  onHumanAction?: CoachDrawerProps["onHumanAction"];
}) {
  if (part.type === "dynamic-tool") return <ToolState part={part} />;
  if (part.type === "data-stream-error") {
    return (
      <View style={styles.errorNotice}>
        <Text style={styles.errorTitle}>暂时没有完成</Text>
        <Text style={styles.errorText}>{part.data.message}</Text>
      </View>
    );
  }
  if (part.type === "text") {
    return (
      <View style={[styles.messageBubble, part.state === "error" && styles.messageBubbleError]}>
        <Text style={styles.messageText}>{part.text}</Text>
        {part.errorText ? <Text style={styles.messageError}>{part.errorText}</Text> : null}
      </View>
    );
  }
  if (part.type === "data-live-cue") {
    return (
      <View style={styles.liveCue}>
        <View style={styles.liveCueDot} />
        <Text style={styles.liveCueText}>{part.data.message}</Text>
      </View>
    );
  }
  if (part.type === "data-human-action") {
    return (
      <View style={styles.humanActionNotice}>
        <Text style={styles.humanActionTitle}>
          {part.state === "awaiting_user" ? "等待你的确认" : "已收到你的选择"}
        </Text>
        <Text style={styles.humanActionText}>
          {part.state === "awaiting_user" ? part.data.prompt ?? "请补充所需信息后继续。" : "Coach 正在继续处理。"}
        </Text>
        {part.state === "awaiting_user" && part.data.options?.length ? <View style={styles.humanActionOptions}>{part.data.options.map((option) => <Pressable key={option.id} accessibilityRole="button" accessibilityLabel={option.label} disabled={!onHumanAction} onPress={() => onHumanAction?.(part.data.pendingActionId, option.id)} style={[styles.humanActionOption, !onHumanAction && styles.humanActionOptionDisabled]}><Text style={styles.humanActionOptionLabel}>{option.label}</Text></Pressable>)}</View> : null}
      </View>
    );
  }
  return <ArtifactState part={part} onCardAction={onCardAction} />;
}

function ToolState({ part }: { part: CoachToolPart }) {
  // A ready artifact card is the useful outcome. Keeping every completed tool
  // call beside it turns one answer into a stack of redundant "已完成" rows.
  if (part.state === "output-available") return null;

  const copy =
    part.state === "output-error" ? "未能完成" : "正在读取与整理";
  return (
    <View style={styles.toolState}>
      <View style={[styles.stateDot, part.state === "output-error" && styles.stateDotError]} />
      <Text style={styles.toolText}>{copy}</Text>
    </View>
  );
}

function ArtifactState({
  part,
  onCardAction,
}: {
  part: CoachArtifactPart;
  onCardAction?: CoachDrawerProps["onCardAction"];
}) {
  if (part.state === "loading") {
    return (
      <View style={styles.loadingCard}>
        <View style={styles.loadingLineWide} />
        <View style={styles.loadingLine} />
        <Text style={styles.loadingText}>{part.data.message}</Text>
      </View>
    );
  }
  const card = part.data.card;
  if (!card) {
    return <EmptyState message={part.data.message ?? "卡片内容暂时不可用"} />;
  }
  return (
    <View style={[styles.card, card.status === "error" && styles.cardError]}>
      <Text style={styles.cardEyebrow}>
        {card.eyebrow}
      </Text>
      <Text style={styles.cardTitle}>{card.title}</Text>
      {card.subtitle ? <Text style={styles.cardSubtitle}>{card.subtitle}</Text> : null}
      {card.metrics.length > 0 ? (
        <View style={styles.metrics}>
          {card.metrics.map((metric) => (
            <View key={`${metric.label}:${metric.value}`} style={styles.metric}>
              <Text style={styles.metricValue}>{metric.value}</Text>
              <Text style={styles.metricLabel}>{metric.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {card.taskList.length > 0 ? (
        <View style={styles.taskList}>
          {card.taskList.map((task) => (
            <View key={task.id} style={styles.taskRow}>
              <Text numberOfLines={1} style={styles.taskName}>
                {task.name}
              </Text>
              <Text style={styles.taskDose}>
                {task.sets} × {task.reps}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {card.capabilityBoundary.map((boundary) => (
        <Text key={boundary} style={styles.boundary}>
          {boundary}
        </Text>
      ))}
      {card.evidenceLabels.length > 0 ? (
        <View style={styles.evidence}>
          <Text style={styles.evidenceTitle}>依据</Text>
          <Text style={styles.evidenceText}>{card.evidenceLabels.join(" · ")}</Text>
        </View>
      ) : null}
      {card.actions.length > 0 ? (
        <View style={styles.actions}>
          {card.actions.map((action) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !action.enabled || !onCardAction }}
              disabled={!action.enabled || !onCardAction}
              key={action.id}
              onPress={() => onCardAction?.(action.id, card.artifactId)}
              style={[styles.cardAction, (!action.enabled || !onCardAction) && styles.cardActionDisabled]}
            >
              <Text style={styles.cardActionLabel}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function EmptyState({ context, message, onSelect }: { context?: CoachContextKind; message: string; onSelect?: (prompt: string) => void }) {
  const prompts = context && onSelect ? quickPrompts[context] : [];
  if (context && onSelect) {
    return <View style={styles.emptyConversation}>
      <View style={styles.quickPromptList}>{prompts.map((prompt) => <Pressable accessibilityRole="button" key={prompt} onPress={() => onSelect(prompt)} style={({ pressed }) => [styles.quickPrompt, pressed && styles.quickPromptPressed]}><Text style={styles.quickPromptText}>{prompt}</Text><Text style={styles.quickPromptArrow}>→</Text></Pressable>)}</View>
    </View>;
  }
  return (
    <View style={styles.emptyMessage}><Text style={styles.emptyText}>{message}</Text></View>
  );
}

const contextCopy: Record<CoachContextKind, { label: string }> = {
  today: { label: "今天" },
  calendar: { label: "日历" },
  plan: { label: "计划" },
  progress: { label: "进展" },
  workout: { label: "训练中" },
  profile: { label: "我的" },
};

const quickPrompts: Record<CoachContextKind, readonly string[]> = {
  today: ["解释今天的训练", "我今天还能吃多少？", "状态不好，怎么调整？"],
  calendar: ["总结本周安排", "帮我移动一次训练", "哪天适合恢复？"],
  plan: ["解释训练与摄入计划", "为什么今天可以多吃？", "调整本周计划"],
  progress: ["总结最近趋势", "下一步该推进什么？", "还缺哪些记录？"],
  workout: ["解释下一组", "这个动作怎么调整？", "我想降低强度"],
  profile: ["解释我的设置", "管理 Coach 记忆", "查看数据权限"],
};

function contextLabel(context: ContextRef): string {
  return contextCopy[context.kind].label;
}

const styles = StyleSheet.create({
  panelContent: { flex: 1, minHeight: 0 },
  panelHeader: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#D8D6CC",
  },
  panelTitleBlock: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  panelTitle: { color: "#181A1D", fontSize: 17, fontWeight: "900", letterSpacing: -0.25 },
  contextBadge: { minHeight: 24, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "#EAE8E0" },
  contextBadgeText: { color: "#64675F", fontSize: 10, fontWeight: "800" },
  panelBody: { flex: 1, minHeight: 0 },
  minimizeButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#E7E5DD",
  },
  minimizeGlyph: { marginTop: -2, color: "#181A1D", fontSize: 22, lineHeight: 24, fontWeight: "500" },
  historyButton: {
    minWidth: 48,
    height: 34,
    paddingHorizontal: 9,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#E7E5DD",
  },
  historyButtonText: {
    color: "#181A1D",
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "800",
  },
  conversationContent: {
    flexGrow: 1,
    gap: 12,
    paddingHorizontal: 15,
    paddingTop: 16,
    paddingBottom: 22,
  },
  conversationRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  conversationRowUser: {
    justifyContent: "flex-end",
  },
  assistantMark: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#181A1D",
  },
  assistantMarkText: {
    color: "#C8FF21",
    fontSize: 15,
    fontWeight: "900",
  },
  conversationBubble: {
    maxWidth: "82%",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 18,
  },
  assistantBubble: {
    borderBottomLeftRadius: 5,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E1DFD6",
  },
  userBubble: {
    borderBottomRightRadius: 5,
    backgroundColor: "#181A1D",
  },
  conversationText: {
    color: "#181A1D",
    fontSize: 14,
    lineHeight: 21,
  },
  userText: { color: "#FFFFFF" },
  conversationTime: {
    marginTop: 5,
    color: "#9A9C95",
    fontSize: 9,
  },
  userTime: { color: "#A9ADA3", textAlign: "right" },
  historyList: {
    gap: 8,
    padding: 16,
    paddingBottom: 30,
  },
  newConversation: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: "#C8FF21",
  },
  newConversationGlyph: { color: "#181A1D", fontSize: 25, fontWeight: "600" },
  newConversationTitle: { color: "#181A1D", fontSize: 15, fontWeight: "900" },
  newConversationMeta: { marginTop: 2, color: "#545B42", fontSize: 10 },
  historySectionLabel: { marginTop: 14, marginBottom: 3, color: "#777971", fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  historyRow: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E1DFD6",
    backgroundColor: "#FFFFFF",
  },
  historyRowActive: { borderColor: "#181A1D", borderLeftWidth: 5 },
  historyRowBody: { flex: 1, minWidth: 0 },
  historyTitle: { color: "#181A1D", fontSize: 14, fontWeight: "800" },
  historyMeta: { marginTop: 4, color: "#777971", fontSize: 10 },
  historyArrow: { color: "#777971", fontSize: 24 },
  coachScreen: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "#F7F6F1",
    zIndex: 90,
    elevation: 30,
  },
  header: {
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 10,
    borderBottomColor: "#E1DFD6",
    borderBottomWidth: 1,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#D8D6CC",
    backgroundColor: "#FFFFFF",
  },
  backGlyph: {
    color: "#181A1D",
    fontSize: 30,
    lineHeight: 31,
    marginTop: -2,
  },
  brandMark: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#15171A",
  },
  brandGlyph: {
    color: "#C8FF21",
    fontSize: 20,
    fontWeight: "900",
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: "#181A1D",
    fontSize: 17,
    fontWeight: "800",
  },
  context: {
    marginTop: 3,
    color: "#777971",
    fontSize: 12,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#9ECC19",
  },
  connectionDotError: {
    backgroundColor: "#FF6F50",
  },
  content: {
    flexGrow: 1,
    gap: 12,
    padding: 16,
    paddingBottom: 20,
  },
  streamViewport: {
    flex: 1,
  },
  toolState: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 13,
    borderRadius: 16,
    backgroundColor: "#171A16",
  },
  stateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#C8FF21",
  },
  stateDotError: {
    backgroundColor: "#FF6F50",
  },
  toolText: {
    color: "#F7F6F1",
    fontSize: 13,
    fontWeight: "700",
  },
  loadingCard: {
    minHeight: 150,
    padding: 18,
    borderRadius: 24,
    borderColor: "#D8D6CC",
    borderWidth: 1,
    backgroundColor: "#FFFFFF",
  },
  loadingLineWide: {
    width: "62%",
    height: 22,
    borderRadius: 8,
    backgroundColor: "#ECEAE3",
  },
  loadingLine: {
    width: "40%",
    height: 12,
    borderRadius: 6,
    marginTop: 12,
    backgroundColor: "#F0EFEA",
  },
  loadingText: {
    marginTop: 42,
    color: "#777971",
    fontSize: 12,
  },
  card: {
    padding: 18,
    borderRadius: 24,
    borderColor: "#D8D6CC",
    borderWidth: 1,
    borderLeftColor: "#9ECC19",
    borderLeftWidth: 5,
    backgroundColor: "#FFFFFF",
  },
  cardError: {
    borderLeftColor: "#FF6F50",
  },
  cardEyebrow: {
    color: "#E05D42",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  cardTitle: {
    marginTop: 5,
    color: "#181A1D",
    fontSize: 24,
    fontWeight: "900",
  },
  cardSubtitle: {
    marginTop: 4,
    color: "#777971",
    fontSize: 13,
  },
  metrics: {
    flexDirection: "row",
    marginTop: 16,
    overflow: "hidden",
    borderRadius: 16,
    backgroundColor: "#F0EFEA",
  },
  metric: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 13,
    borderRightColor: "#D8D6CC",
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  metricValue: {
    color: "#181A1D",
    fontSize: 17,
    fontWeight: "900",
  },
  metricLabel: {
    marginTop: 4,
    color: "#8B8D85",
    fontSize: 10,
  },
  taskList: {
    marginTop: 14,
    overflow: "hidden",
    borderRadius: 16,
    borderColor: "#E1DFD6",
    borderWidth: 1,
  },
  taskRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 13,
    borderBottomColor: "#E1DFD6",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  taskName: {
    flex: 1,
    color: "#25272A",
    fontSize: 13,
    fontWeight: "700",
  },
  taskDose: {
    color: "#5D6059",
    fontSize: 12,
    fontWeight: "700",
  },
  boundary: {
    marginTop: 11,
    color: "#777971",
    fontSize: 11,
    lineHeight: 16,
  },
  evidence: {
    marginTop: 12,
    paddingTop: 11,
    borderTopColor: "#E1DFD6",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  evidenceTitle: {
    color: "#555850",
    fontSize: 10,
    fontWeight: "800",
  },
  evidenceText: {
    marginTop: 4,
    color: "#777971",
    fontSize: 11,
    lineHeight: 16,
  },
  actions: {
    flexDirection: "row",
    gap: 9,
    marginTop: 16,
  },
  cardAction: {
    minHeight: 44,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "#181A1D",
  },
  cardActionDisabled: {
    opacity: 0.38,
  },
  cardActionLabel: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  errorNotice: {
    padding: 16,
    borderRadius: 20,
    borderColor: "#F0B5A7",
    borderWidth: 1,
    backgroundColor: "#FFF3EF",
  },
  messageBubble: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderRadius: 18,
    borderColor: "#D8D6CC",
    borderWidth: 1,
    backgroundColor: "#FFFFFF",
  },
  messageText: {
    color: "#25272A",
    fontSize: 14,
    lineHeight: 21,
  },
  messageBubbleError: {
    borderColor: "#F0B5A7",
    backgroundColor: "#FFF3EF",
  },
  messageError: {
    marginTop: 7,
    color: "#8D2F1B",
    fontSize: 11,
  },
  liveCue: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: "#171A16",
  },
  liveCueDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#C8FF21",
  },
  liveCueText: {
    flex: 1,
    color: "#F7F6F1",
    fontSize: 13,
    fontWeight: "700",
  },
  humanActionNotice: {
    padding: 14,
    gap: 4,
    borderRadius: 16,
    backgroundColor: "#F4F1E8",
  },
  humanActionTitle: {
    color: "#181A1D",
    fontSize: 15,
    fontWeight: "800",
  },
  humanActionText: {
    color: "#5A5E66",
    fontSize: 13,
    lineHeight: 18,
  },
  humanActionOptions: {
    gap: 8,
    marginTop: 8,
  },
  humanActionOption: {
    minHeight: 42,
    borderRadius: 12,
    justifyContent: "center",
    paddingHorizontal: 13,
    backgroundColor: "#15171A",
  },
  humanActionOptionDisabled: {
    opacity: 0.42,
  },
  humanActionOptionLabel: {
    color: "#C8FF21",
    fontSize: 13,
    fontWeight: "800",
  },
  errorTitle: {
    color: "#8D2F1B",
    fontSize: 14,
    fontWeight: "800",
  },
  errorText: {
    marginTop: 5,
    color: "#74483F",
    fontSize: 12,
    lineHeight: 18,
  },
  emptyConversation: { flex: 1, minHeight: 182, justifyContent: "flex-end" },
  emptyMessage: { paddingHorizontal: 18, paddingVertical: 14 },
  emptyText: {
    color: "#777971",
    fontSize: 12,
    lineHeight: 18,
  },
  quickPromptList: {
    gap: 8,
  },
  quickPrompt: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    borderColor: "#E1DFD6",
    borderWidth: 1,
  },
  quickPromptPressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  quickPromptText: {
    color: "#25272A",
    fontSize: 12,
    fontWeight: "800",
  },
  quickPromptArrow: {
    color: "#778E1D",
    fontSize: 16,
    fontWeight: "900",
  },
  composerArea: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: "#F7F6F1",
    gap: 8,
  },
  contextDraft: {
    alignSelf: "flex-start",
    minHeight: 27,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: "#EBEAE4",
  },
  contextDraftDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#9ECC19",
  },
  contextDraftText: {
    maxWidth: 180,
    color: "#5A5D57",
    fontSize: 11,
    fontWeight: "800",
  },
  attachmentTray: {
    flexDirection: "row",
    gap: 8,
  },
  attachmentAction: {
    flex: 1,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#DFDDD4",
    backgroundColor: "#FFFFFF",
  },
  attachmentGlyph: {
    color: "#181A1D",
    fontSize: 17,
    fontWeight: "800",
  },
  attachmentLabel: {
    color: "#5E605C",
    fontSize: 10,
    fontWeight: "800",
  },
  composer: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingLeft: 5,
    paddingRight: 5,
    borderRadius: 19,
    borderColor: "#D8D6CC",
    borderWidth: 1,
    backgroundColor: "#FFFFFF",
  },
  composerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#9ECC19" },
  composerAction: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: "#F0EFE9",
  },
  composerActionGlyph: {
    color: "#343733",
    fontSize: 18,
    fontWeight: "800",
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: "#181A1D",
    fontSize: 15,
    paddingVertical: 12,
  },
  voiceModeButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "#181A1D",
  },
  voiceModeGlyph: {
    color: "#C8FF21",
    fontSize: 21,
    fontWeight: "900",
  },
  voiceComposer: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 5,
    borderRadius: 19,
    borderColor: "#D8D6CC",
    borderWidth: 1,
    backgroundColor: "#FFFFFF",
  },
  voiceComposerRecording: {
    borderColor: "#99C60F",
    backgroundColor: "#F7FFD9",
  },
  holdToTalk: {
    flex: 1,
    minWidth: 0,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderRadius: 14,
    backgroundColor: "#181A1D",
  },
  holdToTalkRecording: {
    backgroundColor: "#8DBB0B",
  },
  holdToTalkText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  voiceWave: {
    height: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  voiceWaveBar: {
    width: 3,
    height: 8,
    borderRadius: 2,
    backgroundColor: "#C8FF21",
  },
  voiceWaveBarTall: {
    width: 3,
    height: 16,
    borderRadius: 2,
    backgroundColor: "#C8FF21",
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#181A1D",
  },
  sendButtonDisabled: {
    opacity: 0.32,
  },
  buttonPressed: {
    transform: [{ scale: 0.96 }],
  },
  sendGlyph: {
    color: "#C8FF21",
    fontSize: 22,
    fontWeight: "900",
  },
});
