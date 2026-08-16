import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BackHandler,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { CoachMessage, CoachSessionStatus, ContextRef } from "../model";
import type { BaselineInput, ConversationItem } from "../../agent-conversation";
import { intakeField } from "../intakeFields";
import { APP_DOCK_BODY_HEIGHT, type CoachComposerAnchor } from "../../mobile/ui-kit/AppDock";
import { FocusSurface } from "../../mobile/ui-kit/FocusSurface";
import { ProfessionalTermText } from "../../mobile/ui-kit/ProfessionalTermText";

export interface CoachDrawerProps {
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
  dockedComposer?: boolean;
  /** The local Pi module's durable ordered transcript, including cards. */
  conversationItems?: readonly ConversationItem[];
  onSubmitBaseline?: (baseline: Omit<BaselineInput, "userId">) => void;
  onSaveBaselineDraft?: (draft: { ageYears?: string; heightCm?: string; weightKg?: string; goalText?: string }) => void;
  onSubmitIntakeForm?: (item: ConversationItem, values: Readonly<Record<string, string>>) => void;
  onConversationCardAction?: (item: ConversationItem, actionId: string) => void;
  sessions?: readonly {
    id: string;
    status: CoachSessionStatus;
    title?: string;
    context: ContextRef;
    updatedAt: string;
  }[];
  onExpandedChange?: (expanded: boolean) => void;
  onSend?: (message: string) => void;
  onSelectSession?: (sessionId: string) => void;
  onStartNew?: () => void;
  onStop?: () => void;
  running?: boolean;
  /** Before a local profile exists, Coach is the required full-screen entry flow. */
  onboarding?: boolean;
}

export function CoachDrawer({
  session,
  expanded: controlledExpanded,
  initiallyExpanded = false,
  conversationItems = [],
  onSubmitBaseline,
  onSaveBaselineDraft,
  onSubmitIntakeForm,
  onConversationCardAction,
  sessions = [],
  bottomInset = APP_DOCK_BODY_HEIGHT,
  horizontalInset = 8,
  composerAnchor,
  focusRequest = 0,
  dockedComposer = false,
  onExpandedChange,
  onSend,
  onSelectSession,
  onStartNew,
  onStop,
  running = false,
  onboarding = false,
}: CoachDrawerProps) {
  const insets = useSafeAreaInsets();
  const [internalExpanded, setInternalExpanded] = useState(initiallyExpanded);
  const expanded = controlledExpanded ?? internalExpanded;
  const [message, setMessage] = useState("");
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const messageInputRef = useRef<TextInput>(null);
  const conversationListRef = useRef<FlatList<ConversationItem>>(null);
  const focusRequestHandled = useRef(focusRequest);

  const focusTextComposer = useCallback(() => {
    messageInputRef.current?.focus();
  }, []);

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
    if (!expanded || focusRequest === focusRequestHandled.current) return;
    focusRequestHandled.current = focusRequest;
    const frame = requestAnimationFrame(focusTextComposer);
    return () => cancelAnimationFrame(frame);
  }, [expanded, focusRequest, focusTextComposer]);

  useEffect(() => {
    if (!dockedComposer || !expanded) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (onboarding) return true;
      if (keyboardHeight > 0) {
        Keyboard.dismiss();
        return true;
      }
      setExpanded(false);
      return true;
    });
    return () => subscription.remove();
  }, [dockedComposer, expanded, keyboardHeight, onboarding, setExpanded]);

  useEffect(() => {
    if (!expanded || historyOpen || !conversationItems.length) return;
    const frame = requestAnimationFrame(() => conversationListRef.current?.scrollToEnd({ animated: true }));
    return () => cancelAnimationFrame(frame);
  }, [conversationItems.length, expanded, historyOpen]);

  const submit = () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    onSend?.(trimmed);
    setMessage("");
  };

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
      onDismiss={() => { if (!onboarding) setExpanded(false); }}
      dismissible={!onboarding}
    >
        <View style={styles.panelContent}>
          <View style={styles.panelHeader}>
            <View style={styles.panelTitleBlock}>
              <Text style={styles.panelTitle}>Coach</Text>
              <View style={styles.contextBadge}><Text style={styles.contextBadgeText}>对话</Text></View>
            </View>
            {running ? <Pressable accessibilityRole="button" accessibilityLabel="停止 Coach" onPress={onStop} style={styles.stopButton}><Text style={styles.stopButtonText}>停止</Text></Pressable> : null}
            {!onboarding ? <Pressable accessibilityRole="button" accessibilityLabel="查看历史对话" onPress={() => { Keyboard.dismiss(); setHistoryOpen((current) => !current); }} style={styles.historyButton}><Text style={styles.historyButtonText}>{historyOpen ? "返回" : "历史"}</Text></Pressable> : null}
            {!onboarding ? <Pressable accessibilityRole="button" accessibilityLabel="收起 MaxPower Coach" onPress={() => setExpanded(false)} style={styles.minimizeButton}><Text style={styles.minimizeGlyph}>×</Text></Pressable> : null}
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
                <FlatList
                  ref={conversationListRef}
                  data={conversationItems}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => <ConversationItemView item={item} onSubmitBaseline={onSubmitBaseline} onSaveBaselineDraft={onSaveBaselineDraft} onSubmitIntakeForm={onSubmitIntakeForm} onAction={onConversationCardAction} />}
                  contentContainerStyle={styles.conversationContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  style={styles.streamViewport}
                  ListEmptyComponent={<EmptyState onSelect={(prompt) => onSend?.(prompt)} />}
                />

                <View style={styles.composerArea}>
                  <View style={styles.contextDraft}><View style={styles.contextDraftDot} /><Text numberOfLines={1} style={styles.contextDraftText}>当前对话</Text></View>
                  <View style={styles.composer}>
                    <TextInput
                      ref={messageInputRef}
                      accessibilityLabel="发送给 Coach 的消息"
                      multiline
                      onChangeText={setMessage}
                      onSubmitEditing={submit}
                      placeholder="问 Coach"
                      placeholderTextColor="#777971"
                      style={styles.input}
                      value={message}
                    />
                    <Pressable accessibilityRole="button" accessibilityLabel="发送消息" disabled={!message.trim()} onPress={submit} style={({ pressed }) => [styles.sendButton, !message.trim() && styles.sendButtonDisabled, pressed && styles.buttonPressed]}><Text style={styles.sendGlyph}>↑</Text></Pressable>
                  </View>
                </View>
              </>
            )}
          </View>
        </View>
    </FocusSurface>
  );
}

function BaselineForm({ draft, onSubmit, onSaveDraft }: { draft?: NonNullable<ConversationItem["form"]>["draft"]; onSubmit?: CoachDrawerProps["onSubmitBaseline"]; onSaveDraft?: CoachDrawerProps["onSaveBaselineDraft"] }) {
  const [ageYears, setAgeYears] = useState(draft?.ageYears ?? "");
  const [heightCm, setHeightCm] = useState(draft?.heightCm ?? "");
  const [weightKg, setWeightKg] = useState(draft?.weightKg ?? "");
  const [goalText, setGoalText] = useState(draft?.goalText ?? "");
  const valid = Number.isInteger(Number(ageYears)) && Number(heightCm) > 0 && Number(weightKg) > 0;
  const saveDraft = () => onSaveDraft?.({ ...(ageYears ? { ageYears } : {}), ...(heightCm ? { heightCm } : {}), ...(weightKg ? { weightKg } : {}), ...(goalText ? { goalText } : {}) });
  return <View style={styles.baselineForm}>
    <Text style={styles.baselineTitle}>先建立你的基础档案</Text>
    <Text style={styles.baselineHint}>只需要年龄、身高和当前体重。目标可以先用自己的话说。</Text>
    <View style={styles.baselineRow}>
      <TextInput accessibilityLabel="年龄" keyboardType="number-pad" placeholder="年龄" value={ageYears} onChangeText={setAgeYears} onEndEditing={saveDraft} style={styles.baselineInput} />
      <TextInput accessibilityLabel="身高厘米" keyboardType="decimal-pad" placeholder="身高 cm" value={heightCm} onChangeText={setHeightCm} onEndEditing={saveDraft} style={styles.baselineInput} />
      <TextInput accessibilityLabel="体重千克" keyboardType="decimal-pad" placeholder="体重 kg" value={weightKg} onChangeText={setWeightKg} onEndEditing={saveDraft} style={styles.baselineInput} />
    </View>
    <TextInput accessibilityLabel="你的目标" placeholder="例如：想增肌，但不想生活变得太极端" value={goalText} onChangeText={setGoalText} onEndEditing={saveDraft} style={styles.baselineGoal} multiline />
    <Pressable accessibilityRole="button" disabled={!valid} onPress={() => onSubmit?.({ ageYears: Number(ageYears), heightCm: Number(heightCm), weightKg: Number(weightKg), ...(goalText.trim() ? { goalText: goalText.trim() } : {}) })} style={[styles.baselineSubmit, !valid && styles.baselineSubmitDisabled]}><Text style={styles.baselineSubmitText}>保存并继续</Text></Pressable>
  </View>;
}

/** An Agent-composed dynamic intake form. Every field is optional: the user
 * may answer any subset and leave the rest unknown. */
function IntakeForm({ card, onSubmit }: {
  card: Extract<NonNullable<ConversationItem["card"]>, { kind: "intake_form" }>;
  onSubmit?: (values: Readonly<Record<string, string>>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  if (card.status === "submitted") {
    return <View style={styles.receiptCard}>
      <Text style={styles.receiptTitle}>补充信息已保存</Text>
      {Object.entries(card.values ?? {}).map(([fieldId, value]) => {
        const spec = intakeField(fieldId);
        const display = spec?.kind === "single_choice" ? spec.options?.find((option) => option.id === value)?.label ?? value : spec?.unit ? `${value} ${spec.unit}` : value;
        return <Text key={fieldId} style={styles.receiptDetail}>{spec?.label ?? fieldId}：{display}</Text>;
      })}
    </View>;
  }
  return <View style={styles.baselineForm}>
    <Text style={styles.baselineTitle}>补充信息</Text>
    <Text style={styles.baselineHint}>{card.reason}（都可跳过）</Text>
    {card.fields.map((fieldId) => {
      const spec = intakeField(fieldId);
      if (!spec) return null;
      if (spec.kind === "single_choice") {
        return <View key={fieldId} style={styles.intakeField}>
          <Text style={styles.intakeLabel}>{spec.label}</Text>
          <View style={styles.intakeOptions}>
            {spec.options?.map((option) => {
              const selected = values[fieldId] === option.id;
              return <Pressable key={option.id} accessibilityRole="button" onPress={() => setValues((current) => ({ ...current, [fieldId]: selected ? "" : option.id }))} style={[styles.intakeOption, selected && styles.intakeOptionSelected]}>
                <Text style={[styles.intakeOptionText, selected && styles.intakeOptionTextSelected]}>{option.label}</Text>
              </Pressable>;
            })}
          </View>
        </View>;
      }
      return <View key={fieldId} style={styles.intakeField}>
        <Text style={styles.intakeLabel}>{spec.label}{spec.unit ? `（${spec.unit}）` : ""}</Text>
        <TextInput accessibilityLabel={spec.label} keyboardType={spec.kind === "number" ? "decimal-pad" : "default"} placeholder="可跳过" value={values[fieldId] ?? ""} onChangeText={(text) => setValues((current) => ({ ...current, [fieldId]: text }))} style={styles.baselineInput} />
      </View>;
    })}
    <Pressable accessibilityRole="button" onPress={() => onSubmit?.(values)} style={styles.baselineSubmit}><Text style={styles.baselineSubmitText}>保存并继续</Text></Pressable>
  </View>;
}

function ToolActivity({ item }: { item: ConversationItem }) {  return <View style={styles.toolActivity}>
    <Text style={styles.toolActivityTitle}>{item.state === "working" ? "正在使用工具" : item.state === "failed" ? "工具未完成" : "已读取"}</Text>
    <Text style={styles.toolActivityBody}>{toolActivityLabel(item.toolName ?? item.content)}</Text>
  </View>;
}

function toolActivityLabel(name: string): string {
  return ({
    "coach.read_profile": "读取当前档案",
    "coach.read_context": "读取当前记录与上下文",
    "goal.propose_path": "比较目标路径",
    "coach.choose_record_only": "设置仅记录模式",
    "plan.read_fixed_input": "核对固定计划依据",
    "plan.propose_current_stage": "校验当前阶段方案",
    "timeline.record_body_weight": "记录体重",
    "timeline.record_explicit": "记录已确认事实",
    "timeline.correct_explicit": "更正已确认记录",
    "knowledge.search_installed": "检索已安装知识",
    "intake.request_form": "整理补充信息表单",
  } as Record<string, string>)[name] ?? "执行本地操作";
}

function ConversationItemView({ item, onSubmitBaseline, onSaveBaselineDraft, onSubmitIntakeForm, onAction }: {
  item: ConversationItem;
  onSubmitBaseline?: CoachDrawerProps["onSubmitBaseline"];
  onSaveBaselineDraft?: CoachDrawerProps["onSaveBaselineDraft"];
  onSubmitIntakeForm?: CoachDrawerProps["onSubmitIntakeForm"];
  onAction?: CoachDrawerProps["onConversationCardAction"];
}) {
  if (item.kind === "message") {
    return <ConversationMessage message={{ id: item.id, sessionId: "conversation", userId: "", role: item.role ?? "assistant", content: item.content, ...(item.runId ? { runId: item.runId } : {}), createdAt: item.createdAt }} />;
  }
  if (item.kind === "tool_activity") return <ToolActivity item={item} />;
  // A fixed factual correction invalidates the presentation, not the
  // transcript. Keep the original card in place and make its non-actionable
  // state explicit rather than silently hiding it or leaving a live button.
  if (item.card && "status" in item.card && item.card.status === "stale") {
    return <View style={styles.staleCard}>
      <Text style={styles.staleCardTitle}>这张卡需要重新生成</Text>
      <Text style={styles.staleCardDetail}>它依赖的记录、目标或安全边界已经变化。原计划没有被这张过期卡修改；请直接告诉 Coach 要继续复核。</Text>
    </View>;
  }
  if (item.kind === "form" && item.form?.kind === "baseline" && item.form.status === "ready") return <BaselineForm draft={item.form.draft} onSubmit={onSubmitBaseline} onSaveDraft={onSaveBaselineDraft} />;
  if (item.card?.kind === "intake_form") return <IntakeForm card={item.card} onSubmit={(values) => onSubmitIntakeForm?.(item, values)} />;
  if (item.card?.kind === "baseline" && item.card.status === "submitted" && item.card.submitted) {
    const baseline = item.card.submitted;
    return <View style={styles.receiptCard}>
      <Text style={styles.receiptTitle}>基础档案已保存</Text>
      <Text style={styles.receiptDetail}>{baseline.ageYears} 岁 · {baseline.heightCm} cm · {baseline.weightKg} kg</Text>
      {baseline.goalText ? <Text style={styles.receiptDetail}>目标原话：{baseline.goalText}</Text> : null}
    </View>;
  }
  if (item.card?.kind === "goal_path") {
    return <View style={styles.structuredCard}>
      <Text style={styles.structuredCardTitle}>确认目标路径</Text>
      {item.card.options.map((option) => <Pressable key={option.id} accessibilityRole="button" disabled={!option.feasible || item.card?.status !== "awaiting_confirmation"} onPress={() => onAction?.(item, option.id)} style={[styles.cardOption, (!option.feasible || item.card?.status !== "awaiting_confirmation") && styles.cardOptionDisabled]}>
        <Text style={styles.cardOptionTitle}>{option.id === "gradual" ? "渐进" : option.id === "balanced" ? "平衡" : "更快"} · {option.targetWeeks} 周</Text>
        <Text style={styles.cardOptionDetail}>行为负担 {option.behaviorBurden} · 训练负担 {option.trainingBurden}</Text>
      </Pressable>)}
      {item.card.status !== "awaiting_confirmation" ? <Text style={styles.structuredCardHint}>{item.card.status === "confirmed" ? "已确认" : "需要重新生成"}</Text> : null}
    </View>;
  }
  if (item.card?.kind === "choice") {
    return <View style={styles.structuredCard}>
      <Text style={styles.structuredCardTitle}>{item.content}</Text><Text style={styles.structuredCardHint}>{item.card.prompt}</Text>
      {item.card.options.map((option) => <Pressable key={option.id} accessibilityRole="button" disabled={item.card?.status !== "ready"} onPress={() => onAction?.(item, option.id)} style={[styles.cardOption, item.card?.status !== "ready" && styles.cardOptionDisabled]}><Text style={styles.cardOptionTitle}>{option.label}</Text>{option.detail ? <Text style={styles.cardOptionDetail}>{option.detail}</Text> : null}</Pressable>)}
    </View>;
  }
  if (item.card?.kind === "plan_candidate") {
    return <View style={styles.structuredCard}>
      <Text style={styles.structuredCardTitle}>{item.card.title}</Text>
      {item.card.summary.map((line) => <Text key={line} style={styles.structuredCardHint}>{line}</Text>)}
      {item.card.details ? <PlanCandidateDetails details={item.card.details} /> : null}
      {item.card.status === "awaiting_confirmation" ? <View style={styles.cardActionRow}>
        <Pressable accessibilityRole="button" onPress={() => onAction?.(item, "confirm")} style={styles.cardConfirm}><Text style={styles.cardConfirmText}>确认当前阶段</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => onAction?.(item, "reject")} style={styles.cardReject}><Text style={styles.cardRejectText}>暂不采用</Text></Pressable>
      </View> : <Text style={styles.structuredCardHint}>{item.card.status === "confirmed" ? "已确认" : item.card.status === "invalid" ? "未通过固定校验" : "需要重新生成"}</Text>}
    </View>;
  }
  if (item.card?.kind === "record_confirmation") {
    return <View style={styles.structuredCard}>
      <Text style={styles.structuredCardTitle}>{item.card.label}</Text>
      {item.card.status === "awaiting_confirmation" ? <View style={styles.cardActionRow}>
        <Pressable accessibilityRole="button" onPress={() => onAction?.(item, "confirm")} style={styles.cardConfirm}><Text style={styles.cardConfirmText}>确认记录</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => onAction?.(item, "reject")} style={styles.cardReject}><Text style={styles.cardRejectText}>不记录</Text></Pressable>
      </View> : <Text style={styles.structuredCardHint}>{item.card.status === "confirmed" ? "已确认" : "未写入"}</Text>}
    </View>;
  }
  if (item.card?.kind === "receipt") return <View style={styles.receiptCard}>
    <Text style={styles.receiptTitle}>{item.card.label}</Text>
    {item.card.detail ? <Text style={styles.receiptDetail}>{item.card.detail}</Text> : null}
    {item.card.correctable && item.card.status === "recorded" ? <Pressable accessibilityRole="button" accessibilityLabel="更正这条记录" onPress={() => onAction?.(item, "correct_record")}><Text style={styles.receiptCorrection}>记错了？更正</Text></Pressable> : null}
  </View>;
  return null;
}

function PlanCandidateDetails({ details }: { details: NonNullable<Extract<NonNullable<ConversationItem["card"]>, { kind: "plan_candidate" }>["details"]> }) {
  const validationLabel = details.validation.status === "valid"
    ? `固定校验通过 · ${details.validation.impact === "low" ? "低影响" : "较大调整"}`
    : "固定校验未通过";
  return <View style={styles.planDetails}>
    <PlanDetailSection title="近期安排" lines={details.sessions.map((session) => `${session.date.slice(5)} · ${session.title} · ${session.taskCount} 个动作/${session.setCount} 组${session.durationMinutes ? ` · 约 ${session.durationMinutes} 分钟` : ""}`)} />
    {details.nutrition ? <PlanDetailSection title="营养策略" lines={[
      ...(details.nutrition.calorieRange ? [`能量 ${details.nutrition.calorieRange.min}–${details.nutrition.calorieRange.max} ${details.nutrition.calorieRange.unit}`] : []),
      ...(details.nutrition.macronutrients ?? []),
      ...(details.nutrition.nutrientTargets ?? []),
      ...(details.nutrition.reviewWindow ? [`复核：${details.nutrition.reviewWindow}`] : []),
    ]} /> : null}
    <PlanDetailSection title="行为与观察" lines={[
      ...details.behaviorChanges.map((change) => `${change.instruction}（${change.burden === "low" ? "低负担" : change.burden === "moderate" ? "中等负担" : "高负担"}）`),
      ...details.observation,
    ]} />
    <PlanDetailSection title="为什么这样安排" lines={details.rationale} />
    <PlanDetailSection title="代价与变化" lines={[...details.tradeoffs, ...details.diff]} />
    <PlanDetailSection title={validationLabel} lines={details.validation.issues.length ? details.validation.issues : [details.validation.resolution === "confirmation_required" ? "需要你的明确确认后才会写入。" : "符合你已授予的自动调整权限。"]} />
  </View>;
}

function PlanDetailSection({ title, lines }: { title: string; lines: readonly string[] }) {
  if (!lines.length) return null;
  return <View style={styles.planDetailSection}>
    <Text style={styles.planDetailTitle}>{title}</Text>
    {lines.map((line, index) => <Text key={`${title}:${index}:${line}`} style={styles.planDetailLine}>{line}</Text>)}
  </View>;
}

function ConversationMessage({ message }: { message: CoachMessage }) {
  const user = message.role === "user";
  return <View style={[styles.conversationRow, user && styles.conversationRowUser]}>
    {!user ? <View style={styles.assistantMark}><Text style={styles.assistantMarkText}>↗</Text></View> : null}
    <View style={[styles.conversationBubble, user ? styles.userBubble : styles.assistantBubble]}>
      <ProfessionalTermText text={message.content} style={[styles.conversationText, user && styles.userText]} />
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
      <Text style={styles.newConversationGlyph}>＋</Text><View><Text style={styles.newConversationTitle}>开始新对话</Text><Text style={styles.newConversationMeta}>从已确认资料和相关历史继续</Text></View>
    </Pressable>
    <Text style={styles.historySectionLabel}>最近对话</Text>
    {sessions.length ? sessions.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: item.id === activeSessionId }} onPress={() => onSelect(item.id)} style={[styles.historyRow, item.id === activeSessionId && styles.historyRowActive]}>
      <View style={styles.historyRowBody}><Text numberOfLines={1} style={styles.historyTitle}>{item.title?.trim() || "新对话"}</Text><Text style={styles.historyMeta}>对话 · {item.updatedAt.slice(0, 10)}</Text></View><Text style={styles.historyArrow}>›</Text>
    </Pressable>) : null}
  </ScrollView>;
}

function EmptyState({ message = "开始一条新的 Coach 对话", onSelect }: { message?: string; onSelect?: (prompt: string) => void }) {
  if (onSelect) {
    return <View style={styles.emptyConversation}>
      <View style={styles.quickPromptList}>{quickPrompts.map((prompt) => <Pressable accessibilityRole="button" key={prompt} onPress={() => onSelect(prompt)} style={({ pressed }) => [styles.quickPrompt, pressed && styles.quickPromptPressed]}><Text style={styles.quickPromptText}>{prompt}</Text><Text style={styles.quickPromptArrow}>→</Text></Pressable>)}</View>
    </View>;
  }
  return (
    <View style={styles.emptyMessage}><Text style={styles.emptyText}>{message}</Text></View>
  );
}

const quickPrompts = ["记录我刚刚做的事", "帮我梳理目标", "我想聊聊下一步"] as const;

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
  toolActivity: { alignSelf: "flex-start", marginLeft: 38, maxWidth: "78%", paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, backgroundColor: "#ECEBE5", gap: 2 },
  toolActivityTitle: { color: "#666960", fontSize: 10, fontWeight: "800" },
  toolActivityBody: { color: "#30332F", fontSize: 12, fontWeight: "700" },
  structuredCard: { gap: 9, padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: "#D8D6CC", backgroundColor: "#F1F0EA" },
  staleCard: { gap: 5, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: "#E4B9A9", backgroundColor: "#FFF3EE" },
  staleCardTitle: { color: "#873D2A", fontSize: 15, fontWeight: "900" },
  staleCardDetail: { color: "#754E42", fontSize: 13, lineHeight: 19 },
  structuredCardTitle: { color: "#1C1F1A", fontSize: 15, fontWeight: "900" },
  structuredCardHint: { color: "#5D6259", fontSize: 13, lineHeight: 19 },
  planDetails: { gap: 10, marginTop: 2 },
  planDetailSection: { gap: 3, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#D8D6CC" },
  planDetailTitle: { color: "#3E443B", fontSize: 12, fontWeight: "900" },
  planDetailLine: { color: "#5D6259", fontSize: 12, lineHeight: 18 },
  cardOption: { gap: 3, padding: 11, borderRadius: 12, borderWidth: 1, borderColor: "#D7D8CC", backgroundColor: "#FFFFFF" },
  cardOptionDisabled: { opacity: 0.48 },
  cardOptionTitle: { color: "#242721", fontSize: 14, fontWeight: "800" },
  cardOptionDetail: { color: "#666B61", fontSize: 12 },
  cardActionRow: { flexDirection: "row", gap: 8 },
  cardConfirm: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "#284A2D" },
  cardConfirmText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  cardReject: { minHeight: 40, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "#E4E3DC" },
  cardRejectText: { color: "#454943", fontSize: 13, fontWeight: "800" },
  receiptCard: { gap: 3, alignSelf: "flex-start", paddingHorizontal: 13, paddingVertical: 10, borderRadius: 14, backgroundColor: "#E6F1C8" },
  receiptTitle: { color: "#2A4211", fontSize: 13, fontWeight: "900" },
  receiptDetail: { color: "#466225", fontSize: 12 },
  baselineForm: { gap: 9, padding: 14, borderRadius: 16, backgroundColor: "#F1F0EA", borderWidth: StyleSheet.hairlineWidth, borderColor: "#D8D6CC" },
  baselineTitle: { color: "#20221E", fontSize: 15, fontWeight: "900" },
  baselineHint: { color: "#61655C", fontSize: 12, lineHeight: 17 },
  baselineRow: { flexDirection: "row", gap: 7 },
  baselineInput: { flex: 1, minHeight: 40, paddingHorizontal: 9, borderRadius: 10, backgroundColor: "#FFF", color: "#20221E", fontSize: 13 },
  baselineGoal: { minHeight: 58, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10, backgroundColor: "#FFF", color: "#20221E", fontSize: 13, textAlignVertical: "top" },
  baselineSubmit: { minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: "#2B4A2F" },
  baselineSubmitDisabled: { opacity: 0.42 },
  baselineSubmitText: { color: "#FFF", fontSize: 13, fontWeight: "900" },
  intakeField: { gap: 5 },
  intakeLabel: { color: "#3B3E38", fontSize: 12, fontWeight: "700" },
  intakeOptions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  intakeOption: { minHeight: 32, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: "#FFF", borderWidth: StyleSheet.hairlineWidth, borderColor: "#D8D6CC" },
  intakeOptionSelected: { backgroundColor: "#2B4A2F", borderColor: "#2B4A2F" },
  intakeOptionText: { color: "#3B3E38", fontSize: 12, fontWeight: "600" },
  intakeOptionTextSelected: { color: "#FFF" },
  receiptCorrection: { color: "#4A5D4E", fontSize: 12, fontWeight: "700", marginTop: 4, textDecorationLine: "underline" },
  stopButton: { minHeight: 30, paddingHorizontal: 9, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "#F5DED8" },
  stopButtonText: { color: "#7D3021", fontSize: 12, fontWeight: "800" },
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
