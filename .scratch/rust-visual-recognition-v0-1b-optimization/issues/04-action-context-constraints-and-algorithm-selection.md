# 04 — 以动作上下文约束并选中算法组合

**What to build:** 用户在 set 前选择 exact action context 后，Rust 自动锁定该动作应使用的 Rep topology、关节/身体关系、局部坐标、器械识别模型/Provider 与证据策略；客户端不选择算法，也不能在运行中改变组合。

**Blocked by:** 02 — 完成通用 Rep 识别算法包; 03 — 完成通用器械观测与融合算法包.

**Status:** complete

## Audit context and non-negotiable constraints

- The current view projection effectively treats a relation as observable when its operator is registered. That makes every catalog view installable without proving that the selected action's identity-defining relation is visible in that camera projection. This ticket must replace that behavior with real versioned action×view observation assets.
- Context refusal is allowed only for a malformed contract or an exact visual context that cannot express the identity-defining relation. It is not a persistent “unverified”, “not released” or accuracy-maturity state inside Rust.
- Every selected action×view must choose a `RepTopologyProfile` with primary relation, direction policy, excursion, hysteresis, return tolerance, phase dwell and gap policy. It must not inherit the global candidate thresholds documented in Ticket 02.
- Provider implementation/registry compatibility is structural. A real-time absence, occlusion or failed association after the plan starts remains dynamic evidence and must not make the action unavailable.

## Review remediation — explicit view and topology authority

The earlier `ViewProjectionPlan` implementation incorrectly equated “the
operator is registered” with “this action relation is observable in this
view”. This ticket replaces that shortcut. It does **not** add an SDK maturity
or release tier: a refusal only means the selected exact context cannot
express an identity relation.

Each `ActionMotionDefinition` must carry one versioned `ViewObservationPlan`
for every declared view. At minimum it records:

- visible relation IDs and prohibited signals/relations;
- primary-relation candidates and identity-relation visibility;
- side, equipment and support observability plus declared occlusion risks;
- local-axis policy and dimension availability; and
- one `RepTopologyProfile` consumed by the RepEngine before candidate sealing.

Compilation must fail closed when an identity-defining TaskPrimary is not
explicitly visible, when the topology primary is not that visible TaskPrimary,
or when a required model/provider/operator is unavailable. Optional relation
absence must only constrain the corresponding dimension, never create a new
Rep signal.

### Completion evidence

- A test mutates an otherwise valid exact view so its TaskPrimary is not
  visible and receives a typed context refusal. A second mutation makes an
  optional relation unavailable and proves task Rep semantics remain intact.
- A test proves changing an action×view `RepTopologyProfile` changes the
  runtime profile used by the candidate engine; changing only a post-seal plan
  hash is insufficient.
- The action catalog generator emits these assets and content hashes. It may
  not blanket-mark every relation observable merely because an operator exists.

- [x] exact action context 固定 action、variation、equipment topology、laterality、camera view 与 pose contract，并在 begin_set 前编译为不可变 `CompiledActionAnalysisPlan`。
- [x] `ActionMotionDefinition` 与版本化 `ViewObservationPlan` 选择兼容算法模块、模型/Provider、局部坐标、primary relation、方向策略、参数和动态 evidence policy；同一动作在不同器械或机位可选中不同组合。
- [x] 编译出的计划直接物化为 RepEngine 运行时 segmentation/profile 语义；不允许通用 profile 先产生 Rep、再仅靠 plan hash 或事后 admission 附加动作意义。
- [x] 缺动作定义、schema、模块、类型、事实生产者或不兼容的 declared view 属于结构错误并原子 typed refusal；当前帧缺器械/遮挡/关联不足属于运行时 evidence，不形成 SDK 内动作成熟度或发布等级。
- [x] plan hash、模型/Provider lineage、view plan 与 context key 进入 canonical output/Trace；动作、机位、pose contract、Provider contract 或计划变化必须开始新 set。
- [x] 合同测试证明同一算法库可由不同动作资产驱动，错误 topology/primary relation/profile 无法启动或封存 ConfirmedRep，并且新动作不需要 action-name 分支。

## Completion evidence

`ViewObservationPlan` is now explicit data, not an operator-registration
shortcut. It supplies the visible/prohibited relations and `RepTopologyProfile`;
the compiler binds the resulting topology parameters and dwell state graph into
the `MotionSession` profile before candidate segmentation starts.

The same compiled binding is installed by the Web ABI before its first frame:
it owns the `RepEngine`, local-coordinate strategy, plan authority and selected
Provider as one unit. Legacy profile installation is rejected while that unit
is active, and schema/profile/action replacement is rejected throughout
`Arming`, `Active` and `Paused` lifecycle states. An action/view therefore
cannot degrade into a host-selected generic profile, or silently become a
second action, during one causal set.

The action-plan contract now materialises every compiled installed action×view
through this same binding and asserts that the resulting profile contains that
plan's immutable hash and topology state-graph identity.
