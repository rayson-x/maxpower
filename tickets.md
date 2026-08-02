# Tickets: Form Coach

当前 active specs：

- Canonical 移动端骨架连续性 SDK：[`../strength-cut-coach/docs/specs/2026-08-02-canonical-mobile-pose-continuity-sdk-spec.md`](../strength-cut-coach/docs/specs/2026-08-02-canonical-mobile-pose-continuity-sdk-spec.md)
- 骨架运动轨迹 + 规则引擎：[`../strength-cut-coach/docs/specs/2026-08-02-skeleton-trajectory-rule-engine-v1-spec.md`](../strength-cut-coach/docs/specs/2026-08-02-skeleton-trajectory-rule-engine-v1-spec.md)

Work the **frontier**：任何 blockers 已全部完成的 ticket 都可以开工。每个 ticket 是一条可单独演示的 tracer bullet；实现时一次只取一票。

## 恢复连续性测试前沿并登记高位下拉真值

**What to build:** 让现有全部测试重新通过统一入口运行，并把背面高位下拉的原视频、原始关键点和下拉到底挑战帧登记成可重复回放的连续性基线；本票不改变产品轨迹算法。

**Blocked by:** None — can start immediately.

- [x] 统一测试入口实际执行当前所有测试文件，并在任何测试文件未被发现时失败
- [x] 高位下拉 fixture 可通过公开的 fixture loader 按稳定视频 ID 读取，不依赖数组顺序
- [x] 登记 1950/2000 ms 挑战帧及肩、肘、腕的原始 visibility 和当前 predicted 行为
- [x] 回归输出明确区分原始观测事实、当前实现行为和尚未具备人工坐标真值的指标
- [x] 完整类型检查、聚焦测试和全量测试通过

## 并行引入 Canonical Pose Frame

**What to build:** 在保留旧 pose 形态的同时引入版本化 Canonical Pose Frame，并以 raw pass-through 完成第一条端到端路径，使 Web 渲染、动作计数、录制和分析首次消费同一 frame 而不改变算法结果。

**Blocked by:** 恢复连续性测试前沿并登记高位下拉真值.

- [x] Canonical frame 携带版本、frame/sequence/timestamp、schema、坐标空间和图像变换元数据
- [x] 每关节可表达 measured/fused/predicted/unknown、repair flags、uncertainty、renderable 与 usable
- [x] 同一 canonical frame id 和 landmark 内容进入渲染、动作计数、录制与分析
- [x] Raw observation 只通过显式诊断入口保留，不静默替换 canonical
- [x] 旧调用方在 expand 阶段继续工作，测试保持绿色

## 用弱观测融合保持高位下拉手臂连续

**What to build:** 当肩腕可靠、肘部低置信但轨迹和骨链连续时输出 fused 肘部，让高位下拉到底时手臂保持可信连线，同时让客户端与渲染使用同一坐标。

**Blocked by:** 并行引入 Canonical Pose Frame.

- [x] 1950/2000 ms 可靠肩腕 + 弱肘部案例不因固定 0.5 visibility 直接断链
- [x] 弱 raw 肘部、历史方向和肩腕骨链共同决定 fused 坐标与 uncertainty
- [x] 两圆/骨链分支保持同侧连续，不把肘部翻到身体另一侧
- [x] 不通过全局降低 visibility 阈值或无限预测实现连续
- [x] 人工标注挑战帧的位置误差和 arm edge coverage 达到登记门槛

## 让短预测按时间结束并诚实转为 Unknown

**What to build:** 短缺口使用真实毫秒做因果预测，超过证据上限时输出 unknown；不同帧率、seek、large dt 和会话切换不再改变或污染行为。

**Blocked by:** 并行引入 Canonical Pose Frame.

- [x] 50/100/150/250/500 ms 缺口在 20/30/60 fps 下按时间表现一致
- [x] 纯预测超过配置上限后转为 unknown，且不更新 measurement baseline
- [x] Unknown 不进入骨段连线或动作指标，原因和 uncertainty 可审计
- [x] Seek、时间倒退、large dt、sequence/model/schema 切换清理旧状态
- [x] 重新获得观测后不继承陈旧 One Euro/预测残影

## 拒绝高置信飞点但保留真实快速动作

**What to build:** 用 aspect-correct motion、innovation、骨链和整体运动联合判断异常，使高置信错点不再豁免，同时保留真实快速动作的峰值和相位。

**Blocked by:** 并行引入 Canonical Pose Frame.

- [x] 高 confidence 瞬移在多证据异常时被拒绝或融合，不再直接采纳
- [x] 快速但连续的真实 hard negative 不被错误冻结
- [x] x/y 速度和骨长使用一致的图像尺度，不受视频长宽比扭曲
- [x] 稳定窗口建立并重置骨长 baseline，不用坏首帧永久锁定
- [x] Provenance 记录 gate 原因，峰值幅度、相位与下游 rep 不退化

## 将已验证的 Pose Continuity Session 迁移到 Rust

**What to build:** 用纯计算 Rust core 重现已验证的 canonical session 行为，并生成 Swift/Kotlin bindings，使相同 fixture 可以在 host 和未来移动 adapter 上得到一致结果。

**Blocked by:** 用弱观测融合保持高位下拉手臂连续, 让短预测按时间结束并诚实转为 Unknown, 拒绝高置信飞点但保留真实快速动作.

- [ ] Rust host 回放全部 canonical fixtures，并在浮点容差内匹配 reference 行为
- [ ] Session 支持 process frame、reset、close 和版本化配置
- [ ] 版本化扁平 buffer 可由 TypeScript、Swift 和 Kotlin 安全解码
- [ ] 非法长度、NaN/Infinity、时间倒退和未知 schema 返回结构化错误
- [ ] Panic 不穿越 FFI，core 不依赖 Expo、相机、Python、OpenCV 或网络

## Android 相机贯通 Canonical Rust Session

**What to build:** Android 原生 MediaPipe 观测先通过 Rust continuity session，再以 canonical event 同时驱动屏幕、rep 计数和录制；用户可在真机复现高位下拉手臂连续性。

**Blocked by:** 将已验证的 Pose Continuity Session 迁移到 Rust.

- [ ] Android 姿态分析工作线程在发 Expo event 前完成 canonical 处理
- [ ] 屏幕、rep 计数和录制共享相同 frame id 与 landmark 内容
- [ ] Measured/fused/predicted/unknown 使用同一坐标并以不同样式表达
- [ ] 高位下拉真机/录像回放不再因弱肘部直接断臂，也不使用长时间假预测
- [ ] 相机、UI 和 JavaScript runtime 不被 continuity core 阻塞

## 提供可复用的 iOS SDK Adapter

**What to build:** iOS 可以集成同一 Rust SDK、管理 session 并回放 fixtures，证明 Android/iOS 复用的是同一个算法核心；完整 iOS 相机界面留到后续。

**Blocked by:** 将已验证的 Pose Continuity Session 迁移到 Rust.

- [ ] iOS adapter 能构建并创建、reset、close session
- [ ] 同一 fixture 的 source/flags/frame 与 Rust host 一致，坐标和 uncertainty 在容差内一致
- [ ] ABI、资源生命周期和错误映射有 contract tests
- [ ] SDK 以可复用 Expo Module/Apple artifact 交付，不把算法复制到 Swift

## 收缩旧 Raw/渲染分叉

**What to build:** 完成 expand–contract 迁移，移除产品路径里的二次平滑、UI visibility gate 和 raw 默认消费，让所有业务消费者只认识 canonical，raw 只保留显式诊断用途。

**Blocked by:** Android 相机贯通 Canonical Rust Session.

- [ ] Web/Android 渲染只做 fit、rotation、mirror 等纯视口变换
- [ ] 动作计数、轨迹缓冲、录制和规则分析不再默认消费 raw
- [ ] 旧 tracker/One Euro 不与 canonical session 串联形成双重处理
- [ ] Raw diagnostic stream 明确标记且不会进入正常业务输出
- [ ] 删除旧形态后类型检查、fixture 和应用 contract 全部绿色

## 完成真机性能验收并发布 SDK V1

**What to build:** 在目标 Android/iPhone 上验证连续性 SDK 的延迟、资源和降级行为，并交付可重复构建的 V1 artifact，使其可以安全进入后续应用迭代。

**Blocked by:** 提供可复用的 iOS SDK Adapter, 收缩旧 Raw/渲染分叉.

- [ ] 最低档 Android、主流 Android 和受支持 iPhone 记录 core/端到端 P50/P95、fps 和内存
- [ ] 真实相机连续运行 10–15 分钟记录掉帧、温升和系统降频
- [ ] 超预算时降级不阻塞相机、UI 或 JS，不输出乱序/过期 frame
- [ ] Android/iOS artifact、contract/config/algorithm version 和构建说明可复现
- [ ] 高位下拉、合成 gap、高置信 spike 和快速 hard negative 构成 V1 发布回归集

## 已完成基线

- [x] Web 端骨架提取、录像和同会话关键点导出
- [x] rep 分割和五项逐 rep 运动学指标
- [x] 确定性规则引擎、字段级拒答、候选规则和版本化阈值
- [x] 用户选择/低置信自动识别的规则门控
- [x] 真实 fixture 测试与统一 `npm test` 入口，当前 47 项通过
- [x] 离线 harness 的信号诊断、轨迹摘要和 rep 输出

## 恢复可发布的 Web 基线

**What to build:** 用户能打开 Web 应用、启动相机并完成一次录像与关键点导出；代码库同时恢复完整类型检查，为后续每条垂直切片提供绿色起点。

**Blocked by:** None — can start immediately.

- [x] 完整 TypeScript 检查通过，不再有跨平台组件解析、provider 类型或 Android pose 契约错误
- [x] 现有 24 项规则与提取器测试继续通过
- [ ] Web 相机可以启动、停止并下载视频和关键点
- [x] 现有示例视频、姿态后端切换和 harness 行为不回退
- [x] 用一次真实浏览器 smoke test 记录验收结果

**验收记录（2026-08-02）：** 完整 TypeScript 检查、24 项自动测试和四段 fixture harness 已通过。Chromium smoke 能加载页面、要求显式动作选择，并启动相机录制状态；默认模拟相机没有可检测人体，真实视频模拟流会使 headless 自动化超时，故视频/关键点下载仍需在 Mac 浏览器以真人画面完成一次手工验收，当前不勾选通过。

## 从开放目录选择动作

**What to build:** 用户可以从开放 registry 选择现有动作或仅目录动作，并在分析前看到动作变式、器械和评分成熟度；新增目录动作不再需要修改引擎的固定动作类型。

**Blocked by:** 恢复可发布的 Web 基线.

- [x] Registry 使用稳定字符串 ID，并支持名称、别名、动作模式、器械和变式关系
- [x] 每个动作显示 `catalog_only / experimental / validated / suspended` 成熟度
- [x] 现有 5 个动作保持历史 ID，并能从 registry 选择
- [x] 至少新增一个 `catalog_only` 动作，证明目录可扩展且不会获得专项分数
- [x] 重复 ID、断裂变式关系和非法成熟度在加载时明确失败
- [x] 动作来源与许可信息保留在目录记录中

## 杠铃划船贯通组后报告

**What to build:** 用户选择杠铃划船并分析一段关键点后，能在一个组后页面看到 rep 边界、五项原始指标、实验性规则结果、覆盖和版本；UI 与 harness 消费同一个分析结果。

**Blocked by:** 从开放目录选择动作.

- [x] 杠铃划船使用版本化运动学 profile 声明分期信号、极点、相位、指标关节和支持机位
- [x] 一个高层分析入口组合 rep 分割、指标提取和规则评分
- [x] 输出包含 rep、逐字段质量、规则四态、分数/partial、覆盖、profile 和 rule 版本
- [x] 组后 UI 展示动作、机位、逐 rep 指标、实验状态和“未检出明显问题”文案
- [x] 每个 rep 可以定位到对应视频时间段
- [x] 同一真实 fixture 在 UI 数据层与 harness 得到相同结构化结果
- [x] 用户选择杠铃划船时覆盖低置信自动识别建议

## 看不清时给出诚实的部分结果

**What to build:** 当杠铃划船所需关节被遮挡或轨迹证据不一致时，用户看到具体字段和规则为何没有判断，系统不输出误导性总分。

**Blocked by:** 杠铃划船贯通组后报告.

- [x] 使用真实或派生的遮挡 fixture，从高层分析入口得到 `partial`
- [x] 应执行规则被拒答时不输出总分；`not_applicable` 不触发 partial
- [x] 数值计算与质量统计使用一致的选侧证据
- [x] 预测/外推关键点降低质量权重或不进入评分指标
- [x] UI 分开展示 passed、deducted、refused 和 not_applicable
- [x] UI 显示所需关节、可用帧比例和拒答原因，不以 0 或绿色对勾代替
- [x] Harness 与 UI 对同一拒答原因保持一致

## 在真实半程 rep 上检出幅度下降

**What to build:** 用户录制一组前几次完整、后一次故意半程的杠铃划船后，报告准确定位半程 rep、展示幅度证据并按实验性相对规则扣分。

**Blocked by:** 杠铃划船贯通组后报告.

- [ ] 采集或登记一段带 rep 级半程标签的视频和关键点 fixture
- [x] Profile 为幅度提供稳定 definition id、单位和关节依赖
- [ ] 已知半程 rep 的幅度显著低于同组稳定基线
- [ ] 正常 rep 不触发对应幅度扣分
- [ ] 扣分可展开到 rep 时间段、观测值、基线、比例、阈值和规则版本
- [ ] 报告注明 experimental 和真实样本量，不将单 fixture 包装成准确率

## 在支持机位上检出明显躯干借力

**What to build:** 用户从规定侧面或斜侧机位录制一组含明显甩动的杠铃划船后，报告定位对应 rep；不支持机位则明确不判。

**Blocked by:** 看不清时给出诚实的部分结果.

- [ ] 采集或登记带 rep 级躯干借力标签的正例和负例 fixture
- [x] Profile 定义躯干漂移所需关节、机位、坐标和 metric definition
- [ ] 支持机位的故意借力 rep 触发实验性 finding，稳定 rep 不触发
- [x] 正面等不支持机位返回 refused/not_applicable，而不是套用侧视阈值
- [ ] Finding 展示时间段、漂移角、阈值、机位、质量和版本
- [ ] Candidate 阈值在未进入实验模式时只能观察，不能静默扣分

## 在正面机位检出明显双侧不对称

**What to build:** 用户从正面或规定斜侧机位录制一组含单侧明显偷懒的杠铃划船后，报告定位对应 rep，并在任一侧不可见时拒答。

**Blocked by:** 看不清时给出诚实的部分结果.

- [ ] 采集或登记带 rep 级不对称标签的正例和负例 fixture
- [x] Profile 定义双侧比较关节、路径、归一化和支持机位
- [ ] 故意不对称 rep 触发实验性 finding，双侧稳定 rep 不触发
- [ ] 任一所需侧长期不可见时拒答，不使用单侧数据猜测
- [ ] Finding 展示双侧运动量、差值比例、阈值、机位和质量
- [x] 对称性实现不再由全局逻辑固定比较手腕

## 在已知相位下检出离心失控

**What to build:** 用户选择动作并录制一组含明显快速回放重量的 rep 后，报告根据 profile 的相位语义定位失控 rep；相位未知时不做该判断。

**Blocked by:** 杠铃划船贯通组后报告, 看不清时给出诚实的部分结果.

- [ ] 采集或登记带 rep 级离心失控标签的正例和负例 fixture
- [x] Profile 明确两个半程的向心/离心语义，不由提取器统一猜测
- [ ] 已知相位时故意失控 rep 触发实验性 finding，稳定 rep 不触发
- [x] 自动动作低置信或 profile 缺失时，相位为 unknown 且规则拒答
- [ ] Finding 展示离心时长、组内基线、比例、阈值和版本
- [ ] 不把普通较快节奏包装成受伤结论

## 迁移旧五动作并移除固定动作映射

**What to build:** 用户可以用相同的 profile 驱动链分析原有五个背部动作；迁移完成后，新增动作不再经过旧固定联合类型或重复信号表。

**Blocked by:** 杠铃划船贯通组后报告, 看不清时给出诚实的部分结果.

- [x] 引体向上、高位下拉、坐姿划船和直臂下压各有版本化 profile
- [x] 每个动作至少一个现有 fixture 或明确记录的测试样本贯通高层分析入口
- [x] 五个动作的分期、相位和指标定义保持可解释的历史行为
- [x] 旧固定动作联合类型和重复动作信号映射完成 contract 删除
- [x] Registry/profile 是动作语义的唯一运行时来源
- [x] 全部测试和 Web 构建保持绿色

## 用深蹲证明非背部动作可扩展

**What to build:** 用户从目录选择深蹲并录制一组动作后，系统使用新的关节、相位和机位定义生成组后原始指标与实验性报告，证明架构不依赖背部动作假设。

**Blocked by:** 迁移旧五动作并移除固定动作映射.

- [ ] 深蹲 profile 使用适合下肢的主信号和关节依赖
- [ ] 站立到最低点标为离心，返回站立标为向心
- [ ] 对称性不使用手腕，机位不支持的三维问题明确不判
- [ ] 正确、故意半程和不可判断各有一个真实 fixture 行为测试
- [ ] 用户能在同一组后 UI 查看深蹲 rep、指标、覆盖和实验状态
- [ ] 杠铃划船与原有四动作结果不回退

## 用独立样本晋级一条绝对规则

**What to build:** 用户能看到至少一条动作专项规则从 experimental 晋级 validated，其验证样本、准确性和拒答率可审计，旧版本历史结果仍可解释。

**Blocked by:** 在支持机位上检出明显躯干借力, 用深蹲证明非背部动作可扩展.

- [ ] 调参集和验证集使用不同受试者或不同采集批次
- [ ] 验证前冻结 profile、metric definition、rule 和 threshold version
- [ ] 逐规则报告样本量、precision、recall、误报率和拒答率
- [ ] 保存 tuning dataset id、validation dataset id、日期和晋级决策
- [ ] 未达到准入门槛时保持 experimental，不为完成 ticket 强行晋级
- [ ] UI 显示 validated 状态、样本量和规则版本
- [ ] 历史 experimental 结果继续引用旧版本，不被重算冒充已验证结果

## 扩展首批下肢动作包

**What to build:** 用户可以选择并分析一组代表深蹲、髋铰链和弓步模式的常见动作；每个动作至少提供诚实的实验性轨迹报告，无法测量的问题保持未覆盖。

**Blocked by:** 用深蹲证明非背部动作可扩展.

- [ ] 增加 4–6 个下肢动作或关键变式
- [ ] 每个动作规定一个首选机位、profile 和至少一段真实 fixture
- [ ] 每个动作从用户选择贯通到同一组后 UI
- [ ] 只复用 metric definition 和规则前提相同的动作模式逻辑
- [ ] 不可可靠判断的膝内扣、脊柱分节或器械阻力问题明确列为未覆盖
- [ ] 每个动作公开 experimental/validated 规则数和验证样本量

## 扩展首批上肢推动作包

**What to build:** 用户可以选择并分析一组代表水平推、垂直推和基础伸肘模式的常见动作，并获得与当前证据范围一致的组后报告。

**Blocked by:** 迁移旧五动作并移除固定动作映射, 用深蹲证明非背部动作可扩展.

- [ ] 增加 4–6 个上肢推动作或关键变式
- [ ] 每个动作规定一个首选机位、profile 和至少一段真实 fixture
- [ ] 每个动作从用户选择贯通到同一组后 UI
- [ ] 器械、凳面和遮挡导致的不可测字段结构化拒答
- [ ] 不从普通骨架声称肩胛或真实负载结论
- [ ] 每个动作公开 experimental/validated 规则数和验证样本量

## 扩展首批上肢拉与单关节动作包

**What to build:** 用户可以选择并分析常见上肢拉、屈肘和肩部单关节动作，使 V1 达到 12–20 个代表性动作的透明覆盖。

**Blocked by:** 迁移旧五动作并移除固定动作映射, 用深蹲证明非背部动作可扩展.

- [ ] 在原有五动作之外增加足量动作，使总覆盖达到 12–20 个
- [ ] 每个新增动作规定一个首选机位、profile 和至少一段真实 fixture
- [ ] 每个动作从用户选择贯通到同一组后 UI
- [ ] 单侧/交替动作使用显式策略，不套用双侧同步规则
- [ ] 肩胛运动和肌肉激活不进入 V1 评分声明
- [ ] 每个动作公开 experimental/validated 规则数和验证样本量

## 发布 V1 覆盖与验证报告

**What to build:** 用户拿到一个可长期个人使用的 V1，并能在产品内外清楚看到每个动作能判断什么、不能判断什么、依据多少样本以及当前版本。

**Blocked by:** 用独立样本晋级一条绝对规则, 扩展首批下肢动作包, 扩展首批上肢推动作包, 扩展首批上肢拉与单关节动作包.

- [ ] Web 构建、完整类型检查和全部自动测试通过
- [ ] 12–20 个动作的 profile、首选机位、规则覆盖和成熟度清单完整
- [ ] 每个动作显示未覆盖问题，不以目录数量冒充标准度能力
- [ ] 发布逐规则样本量、precision、recall、误报率和拒答率
- [ ] 满分、partial、拒答和 experimental/validated 文案符合 source spec
- [ ] 本地视频/关键点/报告导出和删除流程通过手工验收
- [ ] 3D、肌肉模型、实时纠错和伤害判断继续明确标为后续范围
