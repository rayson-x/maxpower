# 11 — 补齐叶级动作语义与证据解释

**What to build:** 为 Rust SDK 已安装的全部叶级动作提供可编译、可查询的完整动作定义，明确动作如何被理解、Rep 如何成立、需要哪些器械轨迹、骨架轨迹与关节夹角，以及每项数据为什么需要。

**Blocked by:** 01–04 的算法、Rep、器械 Provider 接口和 action×view 编译机制。

**Status:** complete

## Why this ticket exists

当前 248 个动作都能生成结构合法的 `ActionMotionDefinition`，但多数关节关系与参数仍由 30 个动作族物化；叶级覆盖项主要停留在说明文本。静态审计还发现，222 个带器械或固定支撑的动作中有 83 个使用身体点作为主轨迹，因而还必须保留器械本应提供的轨迹语义和 `cannot_judge` 后果。只生成目录结构不足以证明动作语义已经定义完成。

本票据只补动作知识资产与 Rust SDK 查询/编译契约，不声明视频识别率、质量准确率或动作审核成熟度。数值验收仍由 Ticket 08/10 负责。

## Non-negotiable semantics

- 每个叶级动作必须有且只有一个身份定义 `TaskPrimary`，说明它为什么代表所选动作的可观察任务，以及什么条件构成一次完整往返或阶段周期。SDK 接收的是 set 前锁定的 action + view，不做开放集动作分类；两个动作在单目二维下拥有同一可观察任务时可以复用程序，但所有未被 relation 独立验证的姿态、握法、方向或支撑差异必须保留为受限声明，不能冒充“视觉已验证”。
- 每个 relation 必须同时声明：输入数据、计算 operator、动作含义、为何需要、预期阶段/轨迹关系、是否为 Rep 刚性证据。不能只写一个名称。
- 每个 motion track 必须声明它支持哪些 relation、为何与其他轨迹独立，以及缺失时影响 Rep 还是只影响某个质量维度。
- 能独立观测的杠铃、哑铃和固定器械手柄可以作为主轨迹；骨架只能作为独立佐证，不能生成或修补器械几何。
- 当前不能独立观测的绳索手柄、地雷管、陷阱杠、壶铃、弹力带、杠铃片或通用单负载，可以由动作资产显式选择骨架主关系；但资产仍必须保留精确器械拓扑、期望器械轨迹与 `cannot_judge` 后果。不得把手腕命名为器械轨迹，也不得在运行时静默 fallback。
- `Action evidence explanation` 必须由同一 `ActionMotionDefinition` 派生，禁止维护第二套自然语言动作真相。
- 动作是否已用人工视频验证不进入 Rust SDK；进入 SDK 的资产默认是已注册动作语义，精度由外部冻结评测报告说明。
- 动作名称、姿态、器械、单双侧与机位来自锁定输入上下文；`TaskCompletion` 只表示该定义列出的 required observable relations 完成，不表示 Rust 重新识别了动作名称或验证了所有上下文字段。

## Acceptance

- [x] schema/validator 要求全部 relation 和 track 都有完整 rationale、expected pattern 与已解析的 relation 关联；引用未知 relation、重复身份主关系或空解释 fail closed。
- [x] SDK 提供按 `action_id` 查询的结构化解释，至少分出身份主关系、器械轨迹、骨架轨迹、关节夹角、Rep 边界与缺失后果。
- [x] 248 个叶级动作均通过解释完备性测试；同族不同叶级动作保留 exact identity、器械拓扑、姿态、支撑、单双侧与覆盖项差异。
- [x] 所有非 `none` 器械拓扑均有真实器械/固定支撑的语义声明；当前无 Provider 的动作同时有显式 skeleton-primary 策略与器械 `cannot_judge`，而不是腕点冒充器械。
- [x] 杠铃卧推、杠铃划船、绳索划船、地雷管动作、深蹲、硬拉、侧平举和单侧动作有针对性合同测试，证明主关系、joint inputs、轨迹角色与 Rep 边界符合各自动作定义。
- [x] 新增动作只需注册完整资产；通用编译器、Rep 引擎和解释器没有 action-name 分支。
- [x] 安装动作不存在 reviewed/unreviewed 或长期 capability tier；7 个肩旋转动作由受限声明的二维投影旋转 operator 支持，不能用腕位移或器械端点冒充旋转，也不声称真实三维轴角。
- [x] 复合身份关系是实际 admission 约束而非解释文字：Arnold press 要求手腕相对肩部的归一化过顶位移在投影肩旋转换向附近成立；史密斯动作要求独立测得的杠铃中心留在 exact action×view 的二维约束路径走廊，越界有 typed rejection。
- [x] Rust 全量测试、格式检查与 248-action inventory 通过，并生成不含识别率夸大的动作资产完备摘要。

## Completion evidence

- 248/248 动作有叶级 `variantStatement`，relation 均有 `semanticStatement`、`evidenceRationale` 和 `expectedPattern`，track 均显式绑定 relation。
- 1,984 个 action×view 中 1,680 个可编译，304 个因身份主关系在该投影不可观察而 typed refusal；0 个动作带 SDK 审核/成熟度层级，未借用其他轨迹。
- 222 个含器械或固定支撑的动作全部声明真实器械/锚点语义：139 个由现有 Provider 独立测量器械主轨迹，83 个显式 skeleton-primary 并将未观测器械维度保留为 `cannot_judge`。
- 248 个动作都有骨架轨迹解释；243 个动作声明 joint-angle/投影旋转证据，其中 7 个肩旋转动作明确限制为二维阶段关系，其余动作不制造不需要的角度要求。
- Arnold press 的 `relative_vertical_offset` 与 `projected_shoulder_rotation` 在同一 Rep 换向阶段联合验收；史密斯 `constrained_path_deviation` 逐帧读取独立器械通道，并使用资产中的 `maximumConstrainedPathDeviationMilli` fail closed，不再把“字段存在”当成通过。
- 完整 Rust suite：284 passed，5 governed/local-private tests ignored；交叉步跨零、活动侧抬膝、单腿可见高度差、walking-lunge 阶段/换侧、Arnold 过顶、Smith 路径走廊等代表性正反例均通过。WASM release build 与 `git diff --check` 通过。
