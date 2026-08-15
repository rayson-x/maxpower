# 03 — 建立通用主体、器械轨迹与 Rep 共识

**What to build:** 让动作计划按器械拓扑选择真正的主轨迹和独立佐证，并把 raw detection、主体关联、接触/握持与 Rep eligibility 建模为不同证据阶段。本轮器械识别支持自由刚体杠铃、复用同一刚体杠追踪的史密斯杠、一个或两个独立哑铃、联动或独立的固定器械用户接触把手。Rep 必须来自动作定义授权且已建立归属/握持的主体与器械证据共识，不得在器械证据缺失时回退到手腕。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] 动作定义能够为 `FreeRigidBarbell`、`SmithGuidedBar`、`IndependentDumbbell` 和 `ConstrainedMachineHandle` 声明 primary track、corroborating track、左右/单双侧语义、允许冲突和 Rep consensus policy。
- [ ] `FreeRigidBarbell` 与 `SmithGuidedBar` 复用刚体杠轴、中心和端点 observation；Smith 额外绑定导轨路径约束，并使用独立 exact identity、ExecutionContract、RulePack 与 Reference，不直接继承自由杠铃质量语义。
- [ ] pose 与 equipment 保持独立 provenance 后再融合；缺失、遮挡、预测、测量和相互冲突均保留为 typed evidence，不静默选择更方便的轨迹。
- [ ] Adapter 输出 raw detected、unassociated、contact candidate、grip established、released/conflict 或等价强类型 lifecycle。单帧手腕距离最多进入 contact candidate；grip established 要求连续接近、稳定相对几何和受治理时间窗内的人体—器械共同运动。
- [ ] `Measured` 器械轴、中心、端点和视觉长度只来自真实视觉/传感器 observation。手腕可以约束主体关联和接触残差，但不得生成 measured geometry、决定完整视觉长度或把背景横线升级为用户器械。
- [ ] Adapter 将 image-derived raw geometry 与 pose-assisted association 作为不同类型和 provenance 输出。相同图像/ROI 下扰动手腕不会移动、旋转或裁剪 raw shaft；固定手腕而移除视觉 shaft 时 raw detection 必须消失。
- [ ] raw geometry 区分可见 shaft segment 与未知的物理全长。双腕握距只用于 association/grip residual，不得把握距扩展线作为视觉杠铃长度或端点测量。
- [ ] 只有 `grip_established` 的非预测、非手腕生成 observation 可以进入 fusion/turnaround/Rep eligibility。既有 track 的短时遮挡可以保留 display-only continuity，但不得建立/恢复 grip 或成为 Rule/Rep 因果证据。
- [ ] `PoseBridgeDisplayEstimate` / prediction 必须携带原视觉 track ID、source frame、age 与 uncertainty growth，并从 raw/canonical equipment、Reference、Rule、Rep 和 accuracy 统计中排除；SDK 输出足以让客户端明确显示为估计而非真实杠铃轨迹。
- [ ] ExecutionContract 定义 setup、working-cycle activation 和 release/rack；接近、抓握、解铃、出架、回架或释放不会单独封存 ConfirmedRep，释放后的轨迹不能继续推进当前 Rep。
- [ ] 杠铃、哑铃与固定器械把手被合同声明为必要主轨迹时，缺少该证据不能由腕部或其他人体点接管 Rep。
- [ ] 双独立负载、独立机器手柄、单侧与交替动作具有明确的 side lifecycle，不假设所有双侧动作共享一个合并轨迹。
- [ ] 运行期丢失必要主轨迹时不封存 `ConfirmedRep`，但保留已观察到的 source、坐标、融合、冲突和拒绝事实。
- [ ] 多帧率执行保留 v11 的独立 cadence：视频帧驱动器械 tracker，Pose 只在真实 Pose timestamp 更新；使用最新因果 Pose context 必须受 ActionObservationPlan 最大年龄约束，不产生 synthetic Pose packet。
- [ ] 四种受支持拓扑各至少有一个代表性 fixture 通过完整 assessment lifecycle，并输出可审核的 Rep、质量维度和 Trace；固定器械 fixture 同时覆盖联动把手与独立把手语义。
- [ ] 器械代表性 fixture 从公开 Rust EquipmentAdapter/Provider 的视频帧入口运行到 canonical packet，再进入真实 `ExecutionAssessmentEngine` set lifecycle；不得用测试直接构造 `grip_established` track 绕过 detector、association 和 contact lifecycle。
- [ ] 绳索/滑轮、地雷管/T 杠、陷阱杠、壶铃、弹力带及其他未列出拓扑没有设备 Adapter：器械为 identity-defining required primary 时返回 `UnsupportedEquipmentTopology` 并保持 catalog-only；独立人体 required motion 足以确认身份和 Rep 时只允许 pose-supported limited plan，器械相关维度全部 `cannot_judge`，且不计入 supported-equipment coverage。
- [ ] 徒手或无需器械主轨迹的动作不虚构器械 observation，其执行能力由骨架 operator 与 exact view 单独决定。
- [ ] 同一动作语义换器械拓扑时必须解析到不同 exact identity 或显式能力状态，不能依赖模糊 equipment 字符串切换算法。
- [ ] 冻结 pre-contact regression frame 允许显示 unassociated raw bar，但必须拒绝 fusion/turnaround/Rep eligibility；另覆盖双腕经过背景杆、真实握持建立、短时遮挡、单/双手释放、回架和重新握持，且 native/WASM 输出等价 lifecycle 与 Trace。
- [ ] 冻结 pose-bridge honesty frame 只允许 display estimate，不产生 raw/canonical equipment 或动作结论；视觉几何 differential fixture 证明 detector 准确性可以脱离手腕关联单独评价和替换。
