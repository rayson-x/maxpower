# Fitbod 式下一次训练生成与 Agent Harness 设计

_研究日期：2026-08-08。范围：训练历史、器材约束、肌群恢复、历史负荷和 RIR 如何进入下一次训练；动作替代；离线优先与可选云同步；Agent tool contracts。只做研究与设计，不是实现规范或医疗建议。_

## 结论先行

MaxPower 不应该复制一个不可解释的“Fitbod 分数”，而应该建立一个可回放的事件链：

> 训练事实与约束事件 → 本地 projection → 确定性 Workout Planner → 带依据的计划变更 → 按 Coaching Mandate 自动提交或等待确认 → 新的不可变 Plan Revision。

建议把外部 **Seam** 放在 `WorkoutPlanningHarness`：调用方只需要学习三个入口，训练生成、替代、权限判断、离线存储、云同步和 canonical packet 证据规则全部隐藏在 **Implementation** 内。

```ts
interface WorkoutPlanningHarness {
  execute(command: WorkoutCommand): Promise<CommandResult>;
  read(query: WorkoutQuery): Promise<WorkoutProjection>;
  synchronize(request: SyncRequest): Promise<SyncResult>;
}
```

Agent 看到的是这个深模块上方的一组窄 tool contracts，不会拿到数据库、任意 JSON Patch 或 canonical packet 重计算工具。普通用户可以授予“托管”权限，让低风险修改自动写入；专业用户可以改为“协同”或“手动”。完全离线时，计划生成、训练记录、权限规则、撤销和解释模板都必须可用；云端只是可选副本、跨设备同步和可选算力，不是业务真值的唯一所在地。

## 1. Fitbod 官方资料能确认什么

以下是 Fitbod 自己公开说明的产品行为，不代表其内部算法、系数或有效性已经公开。

### 1.1 下一次训练的输入

Fitbod 官方说明训练生成会使用目标、经验、可用器材、训练时长、训练拆分、历史训练、动作偏好和肌群恢复。动作选择只纳入所选器材可完成的动作，并优先较新鲜的肌群；跳过、替换、删除、手工添加以及 more/less/exclude 都会继续影响推荐。[Fitbod: How Fitbod Creates Your Workout](https://help.fitbod.me/hc/en-us/articles/360004429814-How-Fitbod-Creates-Your-Workout)

Fitbod 将“选什么动作”和“做多少”视为不同问题：历史中的重量、次数和组数影响未来的重量、次数和组数；持续轻松完成时会逐渐增加重量或次数，完成困难时可能下调。Fitbod 还使用历史表现估计 exercise-specific strength，并通过自动安排的 Max Effort Day 重新校准。[Fitbod: How Fitbod Creates Your Workout](https://help.fitbod.me/hc/en-us/articles/360004429814-How-Fitbod-Creates-Your-Workout) [Fitbod: Max Effort Day](https://help.fitbod.me/hc/en-us/articles/360033675553-Max-Effort-Day)

Fitbod 的 Estimated Strength 对负重动作表示估计 1RM，对徒手动作表示单组最大次数；官方说明它基于随时间积累的 sets、reps、weight，并会考虑近期活动和停训。自定义动作即使有肌群标签，也不会自动进入其重量、次数或渐进推荐，说明动作身份和可信历史必须精确，不能只靠一个肌群名称拼接。[Fitbod: Metrics & Records](https://help.fitbod.me/hc/en-us/articles/12732749777047-Fitbod-Metrics-Records)

### 1.2 RIR 与实际完成情况

Fitbod 让用户以 RiR 表示还可以完成多少次，并公开说明未来会据此调整重量和次数；持续报告较高 RiR 时，可能增加重量或次数。官方同时披露一个重要边界：superset/circuit 中的 RiR 目前按“该动作在新鲜状态完成”处理，不会回溯修正前序动作造成的疲劳，而且未来建议更偏重最强、较新的表现。[Fitbod: Reps in Reserve](https://help.fitbod.me/hc/en-us/sections/1500000505721-Workout-Schedule-Logging)

这对 MaxPower 的启示不是照搬，而是必须把 `setContext` 纳入事实：普通直组、superset、circuit、drop set、warm-up 和 AMRAP 的 RIR 不应默认可比较。

### 1.3 肌群恢复

Fitbod 根据已记录动作的 sets、reps 和 weight 估计每个肌群受到的影响，展示 0–100% 恢复，并将导入的跑步、游泳、徒步、划船等活动映射到肌群恢复；训练越长或越强，影响越大。用户可以手工修改恢复值，推荐通常绕开完全疲劳的肌群，但训练拆分等约束可能优先。[Fitbod: Muscle Recovery](https://help.fitbod.me/hc/en-us/articles/360006269014-Muscle-Recovery)

需要明确：Fitbod 没有公开 0–100 的计算公式、个体校准误差或前瞻性疗效验证。其官方文章也提醒用户不要过度关注精确百分比。[Fitbod: How Muscle Recovery Impacts Your Next Workout](https://fitbod.me/blog/muscle-recovery/) 因此 MaxPower 应保存恢复的因素、来源、新鲜度和不确定性，用 `fresh / trainable / limited / unknown` 等可解释区间驱动风险降级，不把“73%”包装成生理测量。

### 1.4 动作替代与器材限制

Fitbod 支持在训练前或训练中添加、替换、删除和重排动作；替换候选可按 Best Replacements、历史频率和器材过滤，包括“我的器材、无器材、同器材、不同器材”。缺少必要器材时，有些肌群可能根本没有可行候选。[Fitbod: Editing Workouts](https://help.fitbod.me/hc/en-us/articles/360006335593-Editing-Workouts-in-Fitbod)

More/Less 是软偏好，Exclude 是推荐硬约束；被 exclude 的动作仍可由用户手工加入。这一点值得保留：`用户不能做`、`用户不喜欢`、`今天器材不可用`、`不希望 Agent 推荐` 是四种不同语义，不能共用一个布尔值。[Fitbod: Recommend More, Less, or Exclude](https://help.fitbod.me/hc/en-us/articles/9093233634711-Recommend-More-Less-or-Exclude-Exercises)

### 1.5 离线与同步

Fitbod 官方说明可以离线运行本地算法、生成建议、记录并保存训练，恢复联网后同步；但 Focus Exercises、未缓存视频、完整历史和部分记录依赖网络，离线生成甚至可能不遵循预期 split/rotation。[Fitbod: Using Fitbod without an internet connection](https://help.fitbod.me/hc/en-us/articles/360006572594-Can-I-use-Fitbod-without-an-internet-connection)

MaxPower 的目标应更严格：离线不能只是“还能生成一点东西”，而应保证当前 Goal Contract、Coaching Mandate、Plan Revision、计划规则、动作目录快照和必要训练历史都在本地，因此同一输入快照得到同一结构化处方。云端独有内容可以不可用，但核心计划不能静默换算法或偏离训练周期。

## 2. Fitbod 值得吸收与不应复制的部分

| 吸收 | 原因 | 不复制 |
|---|---|---|
| 先筛选动作，再计算 sets/reps/load | 将可行性与强度处方分离，错误更容易定位 | 不复制未公开的候选分数或 mStrength 系数 |
| 精确动作历史影响未来处方 | 相同肌群不代表负荷能力可以互换 | 不把不同 variation/equipment 的重量历史混为一条 |
| 器材是硬约束，偏好是软约束 | 可以可靠生成居家、酒店和健身房计划 | 不用“同肌群”作为唯一替代条件 |
| RiR 和手工修改是反馈 | 用户主观用力程度补足纯日志 | 不忽略 superset、疼痛、睡眠等上下文 |
| 用户可手工修改 recovery | 设备估计不能反证身体感受 | 不展示伪精确恢复百分比 |
| 本地生成、稍后同步 | 与用户的离线目标一致 | 不允许云端完整历史缺失改变本地周期语义 |

## 3. 领域模型：planned、performed、observed 必须分开

建议新增以下领域词；它们是本报告提案，尚未写入 `CONTEXT.md`：

- **Goal Contract**：目标、期限、成功指标、训练频率和长期硬限制的版本化约定。
- **Coaching Mandate**：用户授予 Agent 的自动修改领域、幅度、锁定字段和有效期。
- **Plan Revision**：不可变的完整计划版本；新修改产生新 revision，不覆盖历史。
- **Session Prescription**：某次计划训练，含多个 `Stimulus Slot`。
- **Stimulus Slot**：训练意图而非动作名称，例如“水平推、胸主导、稳定器械、8–12 次、2 RIR”。
- **Exercise Variant**：`exercise × variation × equipment × setup` 的精确身份。
- **Session Outcome**：用户实际完成的动作、组、次数、重量、RIR、休息和上下文。
- **Evidence Envelope**：所有用户输入、设备数据、派生值或 canonical packet 引用的来源、新鲜度、置信度与授权范围。
- **Recovery Projection**：从事件重放得到的可解释恢复状态，不是原始生理测量。
- **Workout Proposal**：计划 diff、依据、规则版本、风险和执行策略。

三类事实不能互相覆盖：

```text
Session Prescription: 计划 60 kg × 8–10 × 3 @ 2 RIR
Session Outcome:      实际 60 kg × 10/9/8，最后组 1 RIR
Canonical evidence:   该上下文中 confirmed 9、needs-review 1
```

只有 `confirmed rep` 可以作为正式观测次数；`needs-review` 在用户批准前不进入正式训练量；Tier 2/profile code 0 不得产生 rep、phase、form 或 correctness。用户手工日志依然可以声明实际完成 10 次，但必须保留 `user_reported` 来源，不能伪装成摄像头确认。

## 4. Event-first 深模块

### 4.1 外部 Interface

```ts
interface WorkoutPlanningHarness {
  execute(command: WorkoutCommand): Promise<CommandResult>;
  read(query: WorkoutQuery): Promise<WorkoutProjection>;
  synchronize(request: SyncRequest): Promise<SyncResult>;
}
```

为什么是三个入口：

- `execute` 接受所有本地可完成的领域命令，返回事件和新 revision，不直接产生任意副作用。
- `read` 返回由事件重放得到的 projection；UI、Agent 和测试共享同一个读取面。
- `synchronize` 是可选云副本 seam。它必须显式存在，因为生产有 cloud adapter，而本地模式有 disabled/no-op adapter，测试还有 in-memory peer adapter。

如果删除该模块，训练生成、器材替代、权限判断、事件幂等、冲突合并、恢复派生和 canonical evidence gate 会重新散落到 UI、LLM、同步层与平台代码中，因此它通过 deletion test。

### 4.2 Command

```ts
type WorkoutCommand =
  | DefineGoalContract
  | ChangeCoachingMandate
  | ReviseEquipmentProfile
  | RecordExercisePreference
  | RecordSessionOutcome
  | CorrectRecordedSet
  | LinkCanonicalEvidence
  | RecordRecoveryEvidence
  | GenerateNextWorkout
  | ProposeExerciseSubstitution
  | CommitProposal
  | RejectProposal
  | UndoCommittedChange;

interface CommandMeta {
  commandId: string;
  actor: { type: "user" | "coach" | "device" | "import"; id: string };
  deviceId: string;
  basePlanRevision?: string;
  idempotencyKey: string;
  occurredAt: string;
  mandateRevision: string;
}
```

每个写命令必须带 `idempotencyKey`；计划修改必须带 `basePlanRevision`；Agent 自动命令必须带实际生效的 `mandateRevision`。时间只能用于展示和窗口计算，不能单独解决多设备并发。

### 4.3 Event envelope

```ts
interface DomainEvent<TType extends string, TPayload> {
  eventId: string;
  streamId: string;
  type: TType;
  schemaVersion: number;
  payload: TPayload;

  actor: CommandMeta["actor"];
  deviceId: string;
  commandId: string;
  idempotencyKey: string;
  causalParents: readonly string[];
  hybridLogicalTime: string;
  occurredAt: string;
  recordedAt: string;

  provenance: "user_reported" | "canonical_packet" | "health_platform" | "derived";
  evidenceRefs: readonly EvidenceRef[];
  replicationScope: "local_only" | "private_sync" | "cloud_coach";
  policyVersion?: string;
  catalogVersion?: string;
}
```

推荐事件：

| 事件 | 语义 |
|---|---|
| `GoalContractDefined` | 新目标版本 |
| `CoachingMandateChanged` | 权限或自动修改额度改变 |
| `EquipmentProfileRevised` | 某地点器材清单的新 revision |
| `ExercisePreferenceRecorded` | more/less/exclude、疼痛回避或用户锁定 |
| `WorkoutGenerationRequested` | 记录生成时所用快照 |
| `WorkoutProposalCreated` | 候选处方、diff、依据和风险 |
| `PlanRevisionCommitted` | proposal 成为活动计划 |
| `ExerciseSubstituted` | slot 中的动作被替换，保留原 stimulus contract |
| `SetPerformed` | 一组实际完成事实 |
| `SetCorrected` | 更正旧事件，不覆盖或删除它 |
| `CanonicalEvidenceLinked` | 只引用不可变 packet/hash/profile/disposition |
| `SubjectiveEffortReported` | RIR、疼痛、局部酸痛、总体负担 |
| `ExternalActivityImported` | HealthKit/Health Connect 等活动 |
| `RecoveryEstimateDerived` | 基于已声明规则版本的派生结果 |
| `PlanChangeUndone` | 补偿性 revision，不删除历史 |
| `SyncConflictDetected/Resolved` | 语义冲突可见、可审计 |

派生 projection 可以丢弃并从事件重建；原始事件和历史 Plan Revision 不可静默改写。

### 4.4 Projection

`read()` 至少支持：

```ts
type WorkoutQuery =
  | { kind: "today"; asOf: string; locationId?: string }
  | { kind: "active-plan" }
  | { kind: "exercise-history"; exerciseVariantId: string }
  | { kind: "recovery"; asOf: string }
  | { kind: "equipment"; locationId: string; asOf: string }
  | { kind: "proposal"; proposalId: string }
  | { kind: "audit"; cursor?: string }
  | { kind: "sync-status" };
```

内部 projection：

- `CurrentGoalProjection`
- `EffectiveMandateProjection`
- `AvailableEquipmentProjection`
- `ExerciseEligibilityIndex`
- `ExerciseHistoryProjection`
- `ExerciseCapabilityProjection`
- `RecoveryProjection`
- `WeeklyStimulusProjection`
- `ActivePlanProjection`
- `TodayWorkoutProjection`
- `SyncStatusProjection`

projection 必须携带 `asOfEventId`、输入缺失和规则版本。Agent 不能拿一个没有版本的“当前状态”生成修改。

## 5. 下一次训练生成管线

同一 `event frontier + goal revision + mandate revision + rule bundle + catalog version + request` 必须生成相同结构化 proposal；自然语言解释不参与结果哈希。

### 5.1 第一步：建立训练快照

快照读取：

- Goal Contract 和当前训练周期阶段；
- 当前 Plan Revision、已完成/错过/重排的 session；
- 地点、时间、噪音、器材和可用负重档位；
- 精确 Exercise Variant 历史；
- 每肌群近期有效组、局部反馈和 Recovery Projection；
- 用户锁定、exclude、more/less 与最近替换行为；
- canonical packet 能力和证据，但不重算 packet；
- 数据缺失、事件冲突和同步新鲜度。

### 5.2 第二步：选择今天的 stimulus

先决定动作模式和肌群刺激，再决定具体 Exercise Variant：

1. 遵守计划拆分、每周目标和用户锁定。
2. 处理 missed session 和日程，而不是把“最近没练”自动等同于更需要加量。
3. Recovery 为 `limited` 或 unknown 时，规则只能降级、换非冲突肌群或保持计划并提示不确定性。
4. 对新手维持少量稳定动作，避免为了“变化”频繁替换；高级用户可选择更高变化率。
5. 疼痛是用户安全事实，优先级高于设备 recovery 或骨架表现。

### 5.3 第三步：Exercise Variant eligibility

动作候选先经过硬过滤：

- 目标 location 的器材和重量档位可用；
- 无用户禁止/疼痛诱发/临时禁忌；
- 与训练目标、经验、动作模式、训练方式相容；
- 能满足处方模式，例如 `weighted_reps`、`bodyweight_reps`、`timed`；
- supersets 的器材占用、场地距离和转换时间可行；
- 若用户要求 camera-guided，则必须有精确 `exercise × variation × equipment × camera position` 能力；普通日志不要求姿态校准。

硬过滤后再排序：

- 刺激相似度和 primary/secondary muscle coverage；
- 近期连续性、用户掌握度和历史可用性；
- more/less 与替换行为；
- 器材转换成本、训练时长；
- novelty budget；
- 可选的 canonical observation capability，只能作为体验加分，不能凌驾于训练适配。

### 5.4 第四步：sets、reps、load 和 RIR

每个 Exercise Variant 独立建立 `PerformanceBaseline`：

```ts
interface PerformanceBaseline {
  exerciseVariantId: string;
  comparableContext: {
    setStyle: "straight" | "superset" | "circuit" | "drop" | "amrap";
    equipmentSetupId: string;
    unit: "kg" | "lb" | "bodyweight";
  };
  recentSets: readonly ComparableSet[];
  estimatedStrength?: { value: number; confidence: "low" | "medium" | "high" };
  lastReliableRir?: number;
  detrainingGapDays?: number;
}
```

处方原则：

- 新动作、换器材或历史不可比：使用保守 cold start，并要求用户校准，不迁移绝对重量。
- 历史可比：从最近的可靠表现、目标 rep range 和目标 RIR 推导候选负荷，再按实际器材档位取整。
- 只在多次表现达到规则门槛、无疼痛且数据完整时增加负荷或次数。
- 一次主要推进一个变量，避免同时增加重量、次数和组数。
- 超目标 RIR 可小幅进阶；低于目标、未完成或技术证据不足时维持或降级。
- `needs-review` 不计入 camera-confirmed volume；用户可以确认或保留为 user-reported。
- 不从骨架轨迹推断实际重量、RIR、肌肉激活或伤病。

Fitbod 的公开材料只证明它使用这些输入，并未公开上述门槛；MaxPower 的具体规则需要由独立训练策略版本定义和验证。

## 6. 动作替代与器材建模

### 6.1 Equipment Profile 不是字符串数组

```ts
interface EquipmentProfileRevision {
  revisionId: string;
  locationId: string;
  validFrom: string;
  inventory: readonly EquipmentInstance[];
}

interface EquipmentInstance {
  equipmentTypeId: string;
  capabilities: readonly string[];
  loadRange?: { min: number; max: number; increment: number; unit: "kg" | "lb" };
  quantities?: number;
  attachments?: readonly string[];
  availability?: "available" | "busy" | "broken" | "unknown";
}
```

必须能表达：一对哑铃的实际档位、杠铃与片、固定器械堆栈档位、长短弹力带、凳子角度、拉力器附件、引体杆，以及“今天这台器械被占用”的临时事实。

### 6.2 Stimulus Contract

替代不是 `sameMuscle(exercise)`，而是尽量保持 slot 的训练意图：

```ts
interface StimulusContract {
  movementPattern: string;
  primaryMuscles: readonly string[];
  secondaryMuscles: readonly string[];
  stabilityDemand: "supported" | "free" | "either";
  unilateral: boolean | "either";
  prescriptionMode: "weighted_reps" | "bodyweight_reps" | "timed";
  repRange?: [number, number];
  targetRir?: number;
  fatigueCostBand: "low" | "medium" | "high";
  lockedFields: readonly string[];
}
```

替换结果应返回：

- 候选动作与满足/偏离的字段；
- 所需器材和可行重量；
- 是否有可比历史；
- 处方是否需要重新 cold start；
- 对 weekly stimulus、时间和疲劳的影响；
- 是否支持 camera observation，以及其精确能力边界；
- reason codes，而不是只有自然语言。

动作替换永远不能把原动作 60 kg 直接复制到哑铃、拉力器或另一台机器。

## 7. Agent tool contracts

Agent tools 是 Harness Interface 的薄类型化 facade，而不是新的业务实现。所有 tool 返回结构化事实、依据、权限决策和可撤销标识。

### 7.1 读取工具

```ts
get_training_context({
  asOf,
  locationId?,
  fields: ["goal", "mandate", "today", "history", "equipment", "recovery"]
}) -> {
  snapshotId,
  planRevision,
  projections,
  missing,
  conflicts,
  freshness
}
```

只读工具可在所有权限模式使用。返回摘要而非整库事件，避免把隐私数据或超长历史交给模型。

### 7.2 生成工具

```ts
generate_next_workout({
  snapshotId,
  date,
  locationId,
  constraints?: { minutes?, unavailableEquipment?, temporaryLimitations? }
}) -> WorkoutProposal
```

`WorkoutProposal` 必须包含 `basePlanRevision`、每个 slot 的处方、输入 evidence refs、missing/unknown、规则和 catalog 版本、risk class、execution policy、proposal hash。

### 7.3 替代工具

```ts
propose_exercise_substitutions({
  snapshotId,
  sessionId,
  slotId,
  reason: "equipment_busy" | "no_equipment" | "preference" | "pain" | "manual",
  transientConstraints?: object
}) -> {
  candidates: SubstitutionCandidate[];
  noFeasibleCandidate?: NoFeasibleCandidate;
}
```

疼痛 reason 会提高风险级别并限制候选，但 tool 不诊断疼痛原因。

### 7.4 记录训练工具

```ts
record_session_outcome({
  sessionId,
  actualSets,
  subjective,
  canonicalPacketRefs?,
  idempotencyKey
}) -> {
  appendedEventIds,
  formalVolume,
  reviewRequired,
  adaptationEligibleAfter
}
```

`canonicalPacketRefs` 只接受 packet hash、version、profile identity、maturity 和 rep revisions；Harness 校验 exact context，不允许 Agent 上传自己计算的 rep count。

### 7.5 提交与撤销工具

```ts
apply_workout_proposal({
  proposalId,
  expectedPlanRevision,
  authorization: { mandateRevision, userConfirmationToken? },
  idempotencyKey
}) -> CommitResult

undo_plan_change({
  mutationId,
  expectedPlanRevision,
  idempotencyKey
}) -> CommitResult
```

Agent 不能直接传 JSON Patch；只能提交已由 Harness 产生、未过期、与当前 revision 一致的 proposal。

### 7.6 解释工具

```ts
explain_workout_proposal({ proposalId, locale, detailLevel }) -> {
  structuredReasons,
  renderedText,
  uncertainties,
  safetyNotices
}
```

离线使用 reason-code 模板；联网时 LLM adapter 可以润色，但不得添加 proposal 中不存在的因果关系或生理结论。

## 8. Coaching Mandate 与自动写入

```ts
interface CoachingMandate {
  mode: "managed" | "collaborative" | "manual";
  scopes: {
    dailyExerciseSwap: Permission;
    loadAndRepProgression: Permission;
    setVolume: Permission;
    weeklySchedule: Permission;
  };
  limits: {
    maxLoadIncreasePercent: number;
    maxWeeklySetChange: number;
    maxScheduleShiftDays: number;
  };
  lockedFields: readonly PlanField[];
  revisionId: string;
  expiresAt?: string;
}
```

执行策略：

| 模式 | 低风险且在额度内 | 中风险 | 高风险/越权 |
|---|---|---|---|
| managed | 自动提交、通知、一键撤销 | 按授权细分；默认确认 | confirmation / safety hold |
| collaborative | 可自动处理明确预授权的小替换 | 确认 | confirmation / safety hold |
| manual | 只提案 | 只提案 | safety hold |

用户确认的是授权模式、目标和边界，不需要逐次审核专业处方。动作被占用时换为已授权的等价变式可以自动提交；改变周频率、越过 load/volume budget、修改锁定动作、响应疼痛或改变目标仍需要确认或进入 safety hold。

## 9. 本地版本、私密同步与云端版本

### 9.1 三种数据运行模式

1. **Local only**
   - 不要求账号；事件、projection、catalog、规则和媒体都留在本机。
   - Planner、权限、撤销、审计和模板解释完全离线。
   - 云同步 adapter 为 disabled，不发生隐式网络请求。

2. **Private sync**
   - 客户端仍完成计划计算；云端只保存端到端加密事件块和附件。
   - 多设备共享事件，但服务器不拥有可用于 Coach 推理的明文。
   - 密钥恢复是产品必须明确解决的用户流程；不能声称“可恢复”却持有隐形后门。

3. **Cloud coach**
   - 用户按 scope 授权上传结构化训练、恢复或媒体派生数据。
   - 云端可运行更大模型、跨设备 projection 和内容服务。
   - 本机仍保留可执行的 plan/rule/catalog snapshot；断网不影响核心训练。

每个事件都有 `replicationScope`。原始视频、完整 canonical packet 流、健康数据和计划可以分别授权，不能用一个“同步全部”开关偷换范围。默认应同步结构化日志和 plan events，原始视频保持本地，除非用户单独同意。

### 9.2 云端不是第二套业务真值

- 本地和云端重放同一种事件 schema 和规则 bundle。
- 云端返回的建议仍是 `WorkoutProposal`，不是直接覆盖本地计划。
- server-assigned ID 不得替换 device-generated event ID。
- 离线提交先写本地事务与 outbox；联网后按 event ID 幂等上传。
- 同步成功只增加 acknowledgement，不改变原始事件。
- 删除/隐私请求以 tombstone 或 key destruction 等明确策略处理，同时保留合法审计要求；具体方案需要隐私与法律评审。

## 10. 冲突处理

禁止用 wall-clock last-write-wins 静默覆盖计划或训练事实。

| 冲突 | 处理 |
|---|---|
| 同一事件重复上传 | `eventId + idempotencyKey` 去重 |
| 两设备新增不同 completed set | append-only 合并 |
| 用户更正与设备观测不同 | 两条事实共存；projection 选择用户更正用于日志，同时保留 canonical observation |
| 同一 set 被两次更正 | 按 causal parent 判断；并发时产生 `SyncConflictDetected`，要求选择或产生新的 resolution event |
| 两设备从同一 Plan Revision 提交不同 proposal | 第一条提交后第二条成为 `stale_plan_revision`；重新基于新 revision 生成，不自动套 patch |
| 不相交的器材或偏好修改 | 在 schema 明确可交换时自动合并，产生一个合并 revision |
| Goal Contract 或 Coaching Mandate 并发修改 | 不自动合并；用户选择有效 revision |
| 规则/catalog 版本不同 | 保留生成时版本；活动周期不静默迁移，升级产生 migration proposal |
| 时钟漂移 | Hybrid Logical Clock + causal parents 排序，业务冲突不用物理时间裁决 |

已完成训练和历史 canonical packet 不可被同步删除后“仿佛从未发生”；更正、撤销和删除都产生新事件。

## 11. Error modes 与降级

```ts
type HarnessError =
  | { kind: "permission_denied"; requiredScope: string }
  | { kind: "stale_plan_revision"; expected: string; actual: string }
  | { kind: "stale_snapshot"; snapshotId: string }
  | { kind: "insufficient_evidence"; missing: string[] }
  | { kind: "no_feasible_exercise"; unsatisfied: string[] }
  | { kind: "equipment_constraint_unsatisfied"; equipment: string[] }
  | { kind: "safety_hold"; reasonCodes: string[] }
  | { kind: "canonical_evidence_invalid"; packetRef: string; reason: string }
  | { kind: "capability_unavailable"; exactContext: string }
  | { kind: "conflicting_events"; conflictId: string }
  | { kind: "schema_version_unsupported"; version: number }
  | { kind: "rule_bundle_unavailable"; version: string }
  | { kind: "catalog_version_unavailable"; version: string }
  | { kind: "local_storage_unavailable"; retryable: boolean }
  | { kind: "sync_disabled" }
  | { kind: "sync_auth_required" }
  | { kind: "remote_unavailable"; retryable: boolean };
```

降级原则：

- LLM、网络、云同步、健康平台或日历不可用：使用本地结构化入口和 reason templates，不阻断训练。
- Recovery 数据缺失：显示 unknown，使用保守计划，不伪造恢复值。
- 无可行替代：保留 slot 为 unresolved 或跳过并重算 session 目标，不推荐不存在的器材。
- rule/catalog 版本缺失：不随机使用最新版；保留当前可执行 plan 并提示需要恢复 snapshot。
- 本地事务失败：绝不先在 UI 显示“已提交”。
- 疼痛或健康风险：返回可展示的 `safety_hold`，而不是普通技术错误。

## 12. Internal seams 与 Adapters

| 依赖类别 | Module 内行为 | 合理 Adapters |
|---|---|---|
| In-process | eligibility、substitution、progression、recovery derivation、risk/mandate、proposal diff | 不暴露外部 seam；直接通过 Harness Interface 测试 |
| Local-substitutable | event log、projection、outbox、catalog/rule snapshot、packet index | SQLite adapter + in-memory adapter；filesystem packet adapter + fixture adapter |
| Remote but owned | event replication、账号、规则/catalog 分发、可选云 projection | owned HTTP/queue adapter + in-memory peer adapter |
| True external | HealthKit、Health Connect、日历、LLM、通知 | 对应 platform adapter + deterministic/manual/fake adapter |

具体建议：

- `LocalEventStoreAdapter`：SQLite transaction；记录 event、outbox 和 projection checkpoint。
- `InMemoryEventStoreAdapter`：测试与事件重放。
- `CloudReplicaAdapter` / `DisabledReplicaAdapter` / `InMemoryPeerAdapter`。
- `RustCanonicalEvidenceAdapter` / `CanonicalFixtureAdapter`：只验证和索引 packet，不重算动作。
- `HealthKitEvidenceAdapter` / `HealthConnectEvidenceAdapter` / `ManualRecoveryAdapter`。
- `BundledCatalogAdapter` / `SignedCatalogUpdateAdapter`。
- `RemoteLanguageAdapter` / `OfflineTemplateLanguageAdapter`。
- `DeviceKeyAdapter` / `TestKeyAdapter`。

Adapter 只翻译和传输；不能决定下一次练什么、加多少重量或是否接受一个 rep。

## 13. 验证方案

### 13.1 Interface contract tests

同一 fixture 在 Android、iOS、cloud 和 in-memory adapter 上必须得到同一结构化结果：

- event schema 和 migration；
- command 幂等；
- stale revision 拒绝；
- proposal hash；
- mandate 风险矩阵；
- plan undo 产生补偿 revision；
- local-only 模式无网络调用。

### 13.2 Deterministic replay

- 从空 event log 重放，projection 与增量 checkpoint 一致。
- 相同 event frontier、rule bundle 和 catalog 生成同一 plan。
- 规则升级在 shadow replay 中比较 proposal diff，不直接迁移活动周期。
- 任意自然语言渲染变化不改变 prescription hash。

### 13.3 Property / generative tests

- 生成的每个动作都满足器材硬约束。
- exclude 动作永不由 Agent 推荐，但用户手工动作可以记录。
- 动作替代不复制不可比的绝对负荷。
- weekly stimulus 与 mutation budget 不越界。
- confirmed/needs-review/rejected volume 规则永不破坏。
- Tier 2/profile code 0 永不产生 camera-confirmed reps 或 correctness。
- missing 一直是 unknown，不能在 replay 后变成推断事实。

### 13.4 分区和并发

- 两设备离线一周、分别完成训练再同步。
- 两设备同时修改计划、Goal Contract 和 Coaching Mandate。
- 重复、乱序、延迟和部分 event batch。
- 设备时钟快/慢数天。
- 上传成功但 acknowledgement 丢失。
- app 在写 event/outbox/checkpoint 各阶段崩溃。

### 13.5 训练生成 golden cases

至少覆盖：

- 居家无器材新手，无历史；
- 只有一对哑铃且重量档位有限；
- 旅行酒店器材临时变化；
- 健身房器械被占用；
- 连续多次达到 rep range 且高 RiR；
- 未完成、低 RiR、长时间停训；
- superset RIR 不与直组静默混用；
- 用户强烈偏好与 exclude；
- imported long run 使腿部 Recovery 降级；
- manual recovery 与 wearable 估计冲突；
- 有 planned 10 reps、user-reported 10、canonical confirmed 9 + needs-review 1；
- 同名动作不同 equipment/variation 的历史隔离。

### 13.6 有效性验证

正确运行不等于有效。上线前应先做 expert-reviewed shadow plans，再做分层试点，观察：

- 生成计划的器材可执行率和手工替换率；
- 推荐负荷被用户即时改低/改高的比例；
- RIR 进入目标范围所需 session 数；
- 计划完成率、动作连续性和异常疼痛退出；
- 4/8/12 周 performance trend；
- managed 模式自动修改的撤销率和越权率；
- 离线与云端对同一 snapshot 的 proposal parity。

不能用使用时长或留存单独证明训练处方有效。

## 14. 对当前 MaxPower 的落地次序

当前项目只有本地 capture JSON 和组报告；尚无训练计划、训练历史、器材 profile、RIR、恢复 projection 或同步。65 个 catalog 条目也不等于 65 个 calibrated observation contexts。优先顺序应为：

1. 先定义 event envelope、Exercise Variant、Plan Revision、Session Prescription/Outcome 与 Coaching Mandate。
2. 本地 SQLite event log + projection + transaction/outbox；先不接云。
3. 建立精确器材 profile、Stimulus Slot 和动作替代 hard filters。
4. 记录实际 sets/reps/load/RIR/setContext，并把现有 set report 通过 packet ref 连接到 Session Outcome。
5. 建立确定性 next-workout generator、proposal diff、权限判断和 undo。
6. 用 in-memory peer 完成分区/冲突测试后再接 owned cloud replica。
7. 再接 Health Connect/HealthKit、可选 LLM 和内容服务。

不应先做：让当前 `src/agent/coach.ts` 获得数据库写权限、用 LLM 自由生成 Exercise ID/重量、把组内相对幅度变成 progression score、或为了“云端版”维护第二套计划规则。

## 来源

- [Fitbod — How Fitbod Creates Your Workout](https://help.fitbod.me/hc/en-us/articles/360004429814-How-Fitbod-Creates-Your-Workout)
- [Fitbod — Editing Workouts in Fitbod](https://help.fitbod.me/hc/en-us/articles/360006335593-Editing-Workouts-in-Fitbod)
- [Fitbod — Recommend More, Less, or Exclude Exercises](https://help.fitbod.me/hc/en-us/articles/9093233634711-Recommend-More-Less-or-Exclude-Exercises)
- [Fitbod — Muscle Recovery](https://help.fitbod.me/hc/en-us/articles/360006269014-Muscle-Recovery)
- [Fitbod — How Muscle Recovery Impacts Your Next Workout](https://fitbod.me/blog/muscle-recovery/)
- [Fitbod — Reps in Reserve](https://help.fitbod.me/hc/en-us/sections/1500000505721-Workout-Schedule-Logging)
- [Fitbod — Max Effort Day](https://help.fitbod.me/hc/en-us/articles/360033675553-Max-Effort-Day)
- [Fitbod — Metrics & Records](https://help.fitbod.me/hc/en-us/articles/12732749777047-Fitbod-Metrics-Records)
- [Fitbod — Using Fitbod without an internet connection](https://help.fitbod.me/hc/en-us/articles/360006572594-Can-I-use-Fitbod-without-an-internet-connection)
- [Fitbod — What kind of data do we store?](https://help.fitbod.me/hc/en-us/articles/360004702573-What-kind-of-data-do-we-store)
