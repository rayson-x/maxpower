# Tickets: Rust Motion Recognition SDK V1（PC Web）

将 [`Rust Motion Recognition SDK V1`](../strength-cut-coach/docs/specs/2026-08-03-rust-motion-recognition-sdk-spec.md) 迁移为 PC Web 的唯一动作识别数据链；Android、iOS 与真机性能不在本轮。

Work the **frontier**：任何 blockers 已全部完成的 ticket 都可以开工。每票必须通过 `MotionSession` 或真实 Web 产品路径形成可独立验证的 tracer bullet。

## 贯通 Rust MotionSession 回放链路

**What to build:** 让固定录像数据可以经 Fixture Adapter 进入 Rust MotionSession，输出版本化二进制 MotionPacket，再由 TypeScript 解码并展示会话摘要，形成首条可运行的跨语言纵向路径。

**Blocked by:** None — can start immediately.

- [x] MotionSession 支持 open、控制命令、帧输入与 close summary，调用方不编排内部算法阶段
- [x] Fixture Frame、Recorded Inference 与 Collecting Output Adapter 可通过同一公开 seam 替换
- [x] TypeScript 能解码带 lineage、版本、frame ID、target snapshot 和 canonical payload 的二进制 packet
- [x] Adapter capability 与 contract major 不兼容时 open 明确失败，minor 墑字段可被旧解码器忽略
- [x] FrameLease 在接受、丢弃、失败和关闭路径上都只释放一次
- [x] 非法输入与 Rust panic 被转换为稳定结构化错误，不跨越跨语言边界

## 迁移 Canonical continuity 并达到 TypeScript parity

**What to build:** 让 Rust MotionSession 重放同一真实与合成输入时，生成与冻结 TypeScript 参考行为一致的 Canonical Pose，覆盖高位下拉底部弱肘和按真实毫秒定义的丢点边界。

**Blocked by:** 贯通 Rust MotionSession 回放链路。

- [x] 冻结 TypeScript canonical fixture、算法版本、离散字段与浮点容差，避免迁移中改变参考行为
- [ ] measured、fused、predicted、unknown、repair reason、reset 和 refusal 逐帧 parity
- [x] 50、100、150、250、500、700ms 丢点在 20/30/60fps 下按时间而非帧数产生一致语义
- [x] 高位下拉弱肘、飞点、快速动作、seek、large dt 与乱序 fixture 均可通过 MotionSession 重放
- [x] 无坐标真值的真实 fixture 只断言行为不变量，不包装成准确率结论
- [x] 迁移阶段未切换 Web 正式输出，Rust 先作为对照路径验证；随后由原子切换票接管

## PC Web 影子双跑 Rust Canonical

**What to build:** 让 PC Web 的实时摄像头与已录录像同时运行 TS 和 Rust Canonical，保持 TS 为正式输出，并保存每一帧可解释的 parity 分歧。

**Blocked by:** 迁移 Canonical continuity 并达到 TypeScript parity。

- [x] 实时摄像头和本地录像回放都可把同一 observation 输入 Rust shadow session
- [x] 影子阶段产品渲染、计数与录制仍只消费 TS 正式输出；随后由原子切换票接管
- [x] shadow 记录首次离散语义分叉、连续数值差异、算法版本和 fixture/capture 标识
- [x] 正常预览只保留有界摘要，完整诊断仅在录制或显式调试时落盘
- [x] Rust 失败不会打断正式 TS 路径，并产生可定位的结构化故障事件

## 原子切换 Web 到统一 MotionPacket

**What to build:** 将 PC Web 的 Canonical seam 原子切换到 Rust，使渲染、录像、计数和分析消费同一个不可变 MotionPacket，并删除对应的 TS 产品 continuity 路径。

**Blocked by:** PC Web 影子双跑 Rust Canonical。

- [x] 同一 packet 的 frame ID 与 canonical content hash 进入 renderer、recorder、counter 和 analyzer
- [x] measured、fused、predicted、unknown 在画面上使用可区分样式，unknown 不被绘制为旧坐标
- [x] 录像 sidecar 与导出数据保存屏幕实际使用的 canonical 点位和版本
- [x] 客户端只做旋转、镜像和视口映射，不再次平滑或修复点位
- [x] Rust authoritative 后删除 Web 产品中的旧 continuity 调用与重复状态，保留 golden fixture decoder

## 由 Rust 调度 Web MediaPipe 与背压

**What to build:** 让 Rust 决定 AcquireMulti、TrackTarget、RefreshCandidates 和 SkipFrame，Web MediaPipe Adapter 只执行请求；慢推理时保持实时且不污染已发布数据。

**Blocked by:** 原子切换 Web 到统一 MotionPacket。

- [x] Adapter 在 open 时声明多人、ROI、时间戳、格式和并发能力，不支持能力时显式拒绝或安全降级
- [x] 在途推理、待处理帧和输出队列均有固定上限，未推理旧帧遵循 latest-frame-wins
- [x] 已生成 canonical frame 不重排、不覆盖，所有跳帧和 data gap 显式记录
- [ ] 旧 completion、reset 前 completion 和模型 epoch 过期结果被诊断并丢弃
- [x] close during inference、慢输出、队列溢出和 Adapter failure 均释放资源且返回稳定摘要
- [ ] MediaPipe、Rust core、跨语言解码和写盘耗时分别统计

## 自动锁定中央稳定主体

**What to build:** 让录制开始后 Rust 从最多四名候选中锁定中央、较大且短时稳定的主体；无法确定身份时输出明确状态并暂停业务骨架与计数。

**Blocked by:** 由 Rust 调度 Web MediaPipe 与背压。

- [x] Web MediaPipe 多人获取与刷新返回候选集合，不再直接使用模型第一人
- [x] 初始锁定联合中央距离、躯干面积和约 500ms 稳定性，不要求脸朝镜头
- [x] target 状态至少覆盖 acquiring、locked、uncertain、lost、reacquiring
- [x] uncertain/lost 期间正式 canonical 业务点为 unknown，不能形成业务 rep
- [x] 调试流显示候选人数、bbox、评分分量、选择与拒绝原因，正式流只发布锁定主体
- [x] 合成中央主体、边缘路人、主体离开和错误候选场景通过 MotionSession seam

## 主体保持、重捕获与手动换人

**What to build:** 让已锁定主体在路人穿越和短暂离开时保持身份；自动恢复失败时用户可点击人物换人，并获得可追溯的新 subject epoch。

**Blocked by:** 自动锁定中央稳定主体。

- [x] 身份保持联合位置、尺度、身体比例、运动连续性和会话内临时躯干颜色证据
- [x] 两人交叉、相似衣服 hard negative 和路人遮挡不会仅凭单一特征切换主体
- [x] 目标返回后先确认身份再恢复 canonical 和计数，不使用最近候选兜底
- [x] 归一化点击坐标可选择候选；空区域或歧义点击返回结构化拒绝原因
- [x] 成功换人创建 subject epoch、中止未完成 rep，并保留旧 epoch 已 sealed reps
- [x] reset/close 清除临时外观描述符，正式 packet 和长期存储不包含人脸或衣服档案

## 用 ExerciseProfile 驱动高位下拉 RepTrajectory

**What to build:** 让版本化 provisional ExerciseProfile 经 Rust 校验后驱动高位下拉准备、下拉、底部、还原和 sealed rep，在 Web 中先作为影子计数显示。

**Blocked by:** 主体保持、重捕获与手动换人。

- [ ] Profile bundle 校验 schema、identity、hash、关节、单位、状态可达性、冲突转移和 required capabilities
- [x] ExerciseProfile 与 ReferenceTrajectoryProfile 使用独立 schema、identity 和 maturity
- [x] 高位下拉由多关节方向、幅度、持续时间、迟滞和顺序形成完整周期，不由单一角度决定
- [x] candidate rep 在有限窗口内可修正边界或否决；sealed rep 携带稳定 ID、start/peak/end、revision 和 canonical slice hash
- [x] provisional profile 只能输出明确实验标记的分段与计数，不能产生正式动作质量结论
- [x] 同一组冻结 profile bundle hash，更新 profile 不修改历史版本

## 处理丢点、半程与非动作干扰

**What to build:** 让高位下拉 RepTrajectory 在关键点短暂消失时正确恢复，在长遮挡、半程、底部抖动、走动和器械调整时拒绝错误计数。

**Blocked by:** 用 ExerciseProfile 驱动高位下拉 RepTrajectory。

- [x] 不超过约 150ms 的连续性预测可参与轨迹并保留 source/uncertainty
- [x] 150–700ms 不虚构坐标；身份可信时相位可冻结，恢复闭合的 rep 带 recovered-gap evidence
- [x] 超过恢复上限、身份歧义或 subject epoch 变化会中止未完成 rep
- [x] 半程记录为 partial attempt；完整但偏离参考的动作仍计入正式 rep
- [x] 走动、拿器械、调整握把、停顿、底部抖动和快速正常动作拥有成对回归场景
- [x] 测试覆盖不同帧率、肩肘腕局部缺失和整人缺失，不能通过永远暂停获得虚假高准确率

## 切换 Web 计数到唯一 SealedRep

**What to build:** 将 Web 正式次数切换到 Rust SealedRep，使画面次数、视频区间、控制台、sidecar 和导出使用完全一致的 rep 对象，并删除对应 TS 产品分段路径。

**Blocked by:** 处理丢点、半程与非动作干扰。

- [x] UI、录像 sidecar、导出、控制台和后续 matcher 接收相同 rep ID、revision 和 boundary content
- [x] matcher 与评分模块没有修改 sealed boundary 或删除完整 rep 的接口
- [ ] 人工修订创建新 revision，不原地覆盖 sealed rep 和历史算法结果
- [x] TS/Rust 影子报告解释逐 capture 数量与首次边界分歧，达到批准门后才切换正式输出
- [x] 切换后删除迁移动作的 TS 产品计数/分段调用，保留人工真值和跨语言 golden fixtures

## 通过数据 Profile 增加坐姿推肩

**What to build:** 通过新的 Evidence Manifest 与 provisional ExerciseProfile 增加坐姿推肩实验计数，证明普通新动作无需修改 Rust interface 或新增硬编码状态机。

**Blocked by:** 切换 Web 计数到唯一 SealedRep。

- [x] 坐姿推肩 profile 明确动作、机位、器械、变式、训练侧、pose model、来源和工程假设
- [x] 安装大量 profile 不增加当前每帧复杂度；一组只激活用户选中的动作 profile
- [x] 已有标注用于分段与抗干扰评估，不被包装成标准姿势轨迹
- [x] 输出始终标记 provisional/experimental，quality verdict 为空
- [x] 无法由有限状态图表达的配置在加载时拒绝，而不是执行任意动态代码
- [x] 新版本以新 identity/hash 安装，旧录像仍可绑定原 profile 重放

## 统一身体坐标与阶段轨迹注册

**What to build:** 从同一 sealed canonical slice 生成可审计的身体相对轨迹，在 Web 叠加标准化前后结果，为参考比较消除可解释的画面平移、尺度、方向和速度差异。

**Blocked by:** 切换 Web 计数到唯一 SealedRep。

- [x] 归一化明确记录 body origin、profile 指定的稳定 body scale、镜像决策、坐标系和算法版本
- [x] 平移与尺度分开处理；单位化坐标允许超出 ±1，不能裁剪掉真实幅度偏差
- [x] 相机 mirrored、实际机位与 training side 优先于骨架方向推断；歧义时拒绝而非静默翻转
- [x] start→peak 与 peak→end 分阶段固定节点重采样，原始向心、离心、停顿和总时长同时保留
- [x] 正式 V1 不使用无限制 DTW；受约束 DTW 只能在同阶段 shadow 诊断，限制 warp window 并输出 warp ratio/cost
- [x] 归一化是同一 canonical 轨迹的派生证据，不创建第二套可修改 rep boundary 的来源

## 迁移高位下拉 provisional reference matcher

**What to build:** 让 Rust 只读取 sealed 高位下拉轨迹，通过严格 profile identity 和分阶段节点比较输出描述性偏离证据或拒答，与现有 TypeScript golden behavior 一致。

**Blocked by:** 统一身体坐标与阶段轨迹注册。

- [ ] 保持现有 piecewise normalization、固定特征顺序、nearest-source tie-break、translation/scale separation 和 JSON null 语义
- [x] 动作、机位、变式、训练侧、器械、坐标系、feature schema 或 pose model 不匹配即 profile_mismatch
- [x] 远侧肘等局部缺失只拒答依赖特征，其他可观察特征继续比较
- [x] 未校准 reference 只输出 coverage、outside nodes、excess 和连续偏离证据，qualityVerdict 必须为空
- [x] matcher 不能修改 rep ID、revision、start、peak、end 或 canonical slice hash
- [x] TypeScript/Rust golden parity 覆盖 partial unknown、percentile、非法数值和禁止无限制 DTW

## 联通错误分析面板与差异导出

**What to build:** 让调试使用者在一个本地 Web 面板中同步查看视频、人工真值、TS/Rust 输出和完整诊断，并跳转到主体或轨迹首次出错的位置。

**Blocked by:** 主体保持、重捕获与手动换人；切换 Web 计数到唯一 SealedRep；迁移高位下拉 provisional reference matcher。

- [x] 时间轴可跳转 acquiring、uncertain、lost、reacquiring、repair、partial、sealed 和首次 TS/Rust 分叉事件
- [x] 面板显示候选 bbox/评分、subject epoch、关节 source/uncertainty/reason、phase 和 profile/version
- [x] 视频、人工边界、旧计数、Rust 计数和 reference evidence 使用同一时间基准
- [x] 完整诊断仅在录制或显式调试时保存；普通预览只保留有界摘要
- [x] 导出使用本地序号并隐藏可枚举训练时间，原始 capture 路径和个人 bundle 留在 Git 忽略目录
- [x] 面板不把 provisional comparison 展示成标准分、正确概率或医疗结论

## 运行真实标注数据的独立评估与 promotion gate

**What to build:** 使用现有人工逐 rep 数据和审核后的非 rep 窗口评估 Rust 分段、计数、抗干扰与 matcher parity，并生成用户可审批的本地报告。

**Blocked by:** 通过数据 Profile 增加坐姿推肩；迁移高位下拉 provisional reference matcher；联通错误分析面板与差异导出。

- [ ] 39 组、375 个标注区间按 capture 分离调参、held-out 和 challenge，禁止同组泄漏
- [ ] reviewed negative windows 参与 raw trigger、产品过滤后 FP、FN、F1、exact count 和边界误差统计
- [ ] 报告逐动作、机位、profile/version 和 capture 展示 TS/Rust/人工差异及首次状态分叉
- [x] 没有坐标或质量真值的数据只用于允许的行为指标，不声明标准轨迹准确率
- [x] promotion gate 未通过时输出零 promotion，并继续保留上一条正式路径或 provisional 标记
- [x] 重复运行同一视频只验证确定性，不冒充新增验证样本

## 收口 PC Web V1 契约与性能

**What to build:** 完成 PC Web 范围内的错误、资源、版本、性能与 replace-don't-layer 验收，使 Rust SDK 可以稳定用于真实本地录像与摄像头测试，同时不宣称未测移动端能力。

**Blocked by:** 运行真实标注数据的独立评估与 promotion gate。

- [x] 损坏 packet、非法长度、NaN/Infinity、时间倒退、未知 schema、重复释放和 Adapter failure 返回稳定错误
- [ ] contract/profile/algorithm/config/inference/diagnostic 版本进入 packet 与导出，major 不兼容拒绝打开
- [x] Host benchmark 分离 core、sealed-rep matcher；PC Web 分离 MediaPipe、Rust、解码、渲染与写盘
- [ ] 正常模式和 full diagnostics 分开报告 P50/P95、packet age、drop、内存与处理倍率
- [ ] 超预算时只降低多人刷新、输入分辨率或模型等级，不关闭身份、时间顺序、unknown 和 refusal
- [ ] 清除剩余重复 TS 产品算法与双重状态，完整类型检查、全量测试、代码审查和本地演示通过
- [x] 报告明确 PC Web 实测结果；Android、iOS 和真机温升/降频仍标记未实施、未验证

## Historical tickets

清理前票据已归档至 [`docs/archive/tickets/2026-08-03-pre-rust-motion-sdk-tickets.md`](./docs/archive/tickets/2026-08-03-pre-rust-motion-sdk-tickets.md)，仅供追溯，不得作为当前 frontier。
