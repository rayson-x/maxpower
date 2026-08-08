import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import type { CoachContextKind, ContextRef } from "../model";
import type {
  CoachArtifactPart,
  CoachStreamSnapshot,
  CoachToolPart,
  CoachUiPart,
} from "./coachStreamProjection";

export interface CoachDrawerProps {
  context: ContextRef;
  stream: CoachStreamSnapshot;
  expanded?: boolean;
  initiallyExpanded?: boolean;
  bottomInset?: number;
  horizontalInset?: number;
  onExpandedChange?: (expanded: boolean) => void;
  onSend?: (message: string, context: ContextRef) => void;
  onCardAction?: (actionId: string, artifactId: string) => void;
}

export function CoachDrawer({
  context,
  stream,
  expanded: controlledExpanded,
  initiallyExpanded = false,
  bottomInset = 16,
  horizontalInset = 12,
  onExpandedChange,
  onSend,
  onCardAction,
}: CoachDrawerProps) {
  const { width, height } = useWindowDimensions();
  const [internalExpanded, setInternalExpanded] = useState(initiallyExpanded);
  const [message, setMessage] = useState("");
  const [reduceMotion, setReduceMotion] = useState(false);
  const [retainedContext, setRetainedContext] = useState(context);
  const expanded = controlledExpanded ?? internalExpanded;
  const progress = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: expanded ? 1 : 0,
      duration: reduceMotion ? 0 : expanded ? 380 : 300,
      easing: expanded ? Easing.out(Easing.cubic) : Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [expanded, progress, reduceMotion]);

  useEffect(() => {
    if (!expanded && stream.parts.length === 0) setRetainedContext(context);
  }, [context.kind, context.ref, expanded, stream.parts.length]);

  if (context.kind === "profile") return null;

  const setExpanded = (next: boolean) => {
    if (controlledExpanded === undefined) setInternalExpanded(next);
    onExpandedChange?.(next);
  };
  const submit = () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    onSend?.(trimmed, retainedContext);
    setMessage("");
  };
  const safeBottomInset = Math.max(
    0,
    Math.min(bottomInset, Math.max(0, height - 1)),
  );
  const safeHorizontalInset = Math.max(0, Math.min(horizontalInset, Math.max(0, width / 2 - 1)));
  const availableWidth = Math.max(1, width - safeHorizontalInset * 2);
  const maximumDrawerHeight = Math.max(1, height - safeBottomInset - 12);
  const collapsedSize = Math.min(58, availableWidth, maximumDrawerHeight);
  const drawerWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [collapsedSize, availableWidth],
  });
  const expandedDrawerHeight = Math.min(
    Math.max(360, height * 0.8),
    maximumDrawerHeight,
  );
  const drawerHeight = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [collapsedSize, expandedDrawerHeight],
  });
  const drawerRadius = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [collapsedSize / 2, 30],
  });
  const collapsedOpacity = progress.interpolate({
    inputRange: [0, 0.55, 1],
    outputRange: [1, 0, 0],
  });
  const expandedOpacity = progress.interpolate({
    inputRange: [0, 0.35, 1],
    outputRange: [0, 0, 1],
  });

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        pointerEvents={expanded ? "auto" : "none"}
        style={[styles.scrim, { opacity: progress }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="收起 Coach"
          onPress={() => setExpanded(false)}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.drawer,
          {
            bottom: safeBottomInset,
            left: safeHorizontalInset,
            width: drawerWidth,
            height: drawerHeight,
            borderRadius: drawerRadius,
          },
        ]}
      >
        <Animated.View
          pointerEvents={expanded ? "none" : "auto"}
          style={[styles.collapsedLayer, { opacity: collapsedOpacity }]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`打开 Coach，当前上下文：${contextLabel(retainedContext)}`}
            onPress={() => setExpanded(true)}
            style={styles.coachBubble}
          >
            <View style={styles.coachDot} />
            <Text style={styles.bubbleGlyph}>↗</Text>
          </Pressable>
        </Animated.View>

        <Animated.View
          pointerEvents={expanded ? "auto" : "none"}
          style={[styles.expandedLayer, { opacity: expandedOpacity }]}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.brandMark}>
              <Text style={styles.brandGlyph}>↗</Text>
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Power Coach</Text>
              <Text numberOfLines={1} style={styles.context}>
                {contextLabel(retainedContext)} · {retainedContext.ref}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="最小化 Coach"
              onPress={() => setExpanded(false)}
              style={styles.minimizeButton}
            >
              <Text style={styles.minimizeGlyph}>−</Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.streamViewport}
          >
            {stream.parts.length === 0 ? (
              <EmptyState message={stream.emptyMessage} />
            ) : (
              stream.parts.map((part) => (
                <StreamPart key={part.id} part={part} onCardAction={onCardAction} />
              ))
            )}
          </ScrollView>

          <View style={styles.composerArea}>
            <View style={styles.contextPills}>
              <Text style={styles.contextPill}>{contextPrompt(retainedContext)}</Text>
            </View>
            <View style={styles.composer}>
              <TextInput
                accessibilityLabel="发送给 Coach 的消息"
                onChangeText={setMessage}
                onSubmitEditing={submit}
                placeholder="问计划、进展或恢复…"
                placeholderTextColor="#777971"
                returnKeyType="send"
                style={styles.input}
                value={message}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="发送消息"
                disabled={!message.trim()}
                onPress={submit}
                style={({ pressed }) => [
                  styles.sendButton,
                  !message.trim() && styles.sendButtonDisabled,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.sendGlyph}>↑</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function StreamPart({
  part,
  onCardAction,
}: {
  part: CoachUiPart;
  onCardAction?: CoachDrawerProps["onCardAction"];
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
  return <ArtifactState part={part} onCardAction={onCardAction} />;
}

function ToolState({ part }: { part: CoachToolPart }) {
  const copy =
    part.state === "input-streaming"
      ? "正在读取与整理"
      : part.state === "output-error"
        ? "未能完成"
        : "已完成";
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
              disabled={!action.enabled}
              key={action.id}
              onPress={() => onCardAction?.(action.id, card.artifactId)}
              style={[styles.cardAction, !action.enabled && styles.cardActionDisabled]}
            >
              <Text style={styles.cardActionLabel}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>从当前页面开始</Text>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

const contextCopy: Record<CoachContextKind, { label: string; prompt: string }> = {
  today: { label: "今天", prompt: "今日计划" },
  calendar: { label: "日历", prompt: "本周安排" },
  progress: { label: "进展", prompt: "目标进展" },
  workout: { label: "训练中", prompt: "下一组" },
  profile: { label: "我的", prompt: "个人设置" },
};

function contextLabel(context: ContextRef): string {
  return contextCopy[context.kind].label;
}

function contextPrompt(context: ContextRef): string {
  return contextCopy[context.kind].prompt;
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(10, 12, 10, 0.36)",
  },
  drawer: {
    position: "absolute",
    overflow: "hidden",
    backgroundColor: "#F7F6F1",
    borderColor: "#D8D6CC",
    borderWidth: 1,
    shadowColor: "#000000",
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 18,
  },
  collapsedLayer: {
    ...StyleSheet.absoluteFill,
  },
  coachBubble: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#15171A",
  },
  coachDot: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#C8FF21",
  },
  bubbleGlyph: {
    color: "#C8FF21",
    fontSize: 24,
    fontWeight: "800",
  },
  expandedLayer: {
    ...StyleSheet.absoluteFill,
  },
  handle: {
    alignSelf: "center",
    width: 42,
    height: 5,
    borderRadius: 3,
    marginTop: 10,
    backgroundColor: "#D0CEC5",
  },
  header: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    borderBottomColor: "#E1DFD6",
    borderBottomWidth: 1,
  },
  brandMark: {
    width: 42,
    height: 42,
    borderRadius: 14,
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
    marginHorizontal: 12,
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
  minimizeButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ECEAE3",
  },
  minimizeGlyph: {
    color: "#181A1D",
    fontSize: 24,
    lineHeight: 25,
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
  emptyState: {
    minHeight: 170,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    borderRadius: 24,
    borderColor: "#D8D6CC",
    borderWidth: 1,
    borderStyle: "dashed",
    backgroundColor: "#FBFAF7",
  },
  emptyTitle: {
    color: "#25272A",
    fontSize: 17,
    fontWeight: "800",
  },
  emptyText: {
    marginTop: 6,
    color: "#777971",
    fontSize: 12,
  },
  composerArea: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
    borderTopColor: "#E1DFD6",
    borderTopWidth: 1,
    backgroundColor: "#F7F6F1",
  },
  contextPills: {
    flexDirection: "row",
    gap: 7,
    marginBottom: 8,
  },
  contextPill: {
    overflow: "hidden",
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    color: "#555850",
    fontSize: 11,
    fontWeight: "700",
    backgroundColor: "#E9E7DF",
  },
  composer: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingLeft: 15,
    paddingRight: 5,
    borderRadius: 19,
    borderColor: "#D8D6CC",
    borderWidth: 1,
    backgroundColor: "#FFFFFF",
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: "#181A1D",
    fontSize: 15,
    paddingVertical: 12,
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
