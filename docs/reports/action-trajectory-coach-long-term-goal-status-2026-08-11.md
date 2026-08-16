# 运动轨迹 AI 教练长期目标与执行状态（2026-08-11）

状态：`active / research_candidate_not_promoted`

## 长期目标

依据训练执行评估标准、生物力学研究、现有视频与人工标注，持续构建并验收跨 Web、Android、iOS 的运动视觉教练能力：以 YOLOX + RTMPose Halpe-26 提取真实人体与器械观察，经 Rust Motion SDK 输出唯一 canonical 轨迹，建立版本化运动轨迹数据库与训练/评估闭环，使客户端 Agent 能依据可追溯证据判断动作任务是否完成、是否符合所选变式、是否存在可观察的借力/代偿策略、与经审核目标轨迹的接近程度、训练质量与风险边界，并给出少量、专业、可执行的建议。

该目标受以下边界约束：缺失点保持 `unknown`；镜像、路人或其他人物不得补成训练者；训练集与测试集按来源隔离；个人视频未经技术复核不得作为标准动作；未经完整验收不得生产 promotion。

依据：

- `docs/design/ai-coach-training-execution-assessment-standard-v0.1.md`
- `docs/research/2026-08-09-training-purpose-biomechanics-ai-coach-completion.md`
- `.scratch/realtime-ai-fitness-coach/HANDOFF-data-training-agent.md`

## 当前可复核事实

### 数据底座

- 个人数据：50 个来源视频、54 条动作记录、12 个动作、465 次期望计次，其中 464 次具有人工拖选的 rep 区间。现有 `peakMs` 是旧版 UI 的混合字段，可能来自算法候选、区间中点或人工数值微调，但旧导出没有保存来源，不能整体称为人工 peak 真值。
- MM-Fit：616 个官方切片、6,160 次 set-count 标签；官方 subject split 保持不变。MM-Fit 不含逐次边界和动作质量真值。官方 train RGB 的 10 个会话（w01、w02、w03、w04、w06、w07、w08、w16、w17、w18）均已按 Zenodo 7672767 的官方字节数和 MD5 做只读校验；未下载 validation/test/unseen。原生 RTMPose Halpe-26 train-only 语料已完成 10/10 会话、301 片、68,147 个 10 FPS 目标帧。
- 轨迹数据库：旧版 `data/workflows/action-trajectory-database/halpe26-v1/manifest.json` 保留；新的 research-only 汇总为 `data/workflows/action-trajectory-database/native-halpe26-v2/manifest.json`，SHA-256 `a5b479526284cb8e81b4ed989906748b980a708477f72fbcecca61c2c122cdcf`，状态为 `research_candidate_not_promoted`。该 manifest 已引用三端真实 Halpe-26 bridge parity 报告，但没有改变任何训练指标或 promotion 状态。
- 技术复核队列：`data/workflows/action-trajectory-database/halpe26-v1/technique-review-queue.json.gz`，当前 464/464 为 `pending/unknown`。
- 技术复核入口：`npm run review:recognition`。个人视频右侧已提供 rep 级标准性、借力/代偿、动作策略、训练意图兼容性和证据组标注；识别证据只读，标签以 `technique-review-events-v1.jsonl` append-only 保存。
- 技术训练候选包：`data/workflows/action-trajectory-database/halpe26-v1/technique-training-dataset-v1.json`。当前闸门结果为 `blocked_no_gold_labels`，0/464 rep eligible，`promotionAllowed=false`；只有至少两名 `coach/biomechanics_reviewer` 的结构化标签完全一致才会进入 examples。

### YOLOX + RTMPose Halpe-26 观察质量

- 50/50 个人视频已统一使用 `dominant-continuous-person/v5` 重新提取。
- 人工 rep 时间窗可追踪：463/464，99.78%。
- 现有 `start/peak/end` 时间戳在 ±250ms 内有可用观察：1,391/1,392，99.93%；这只证明该时刻存在骨架观察，不证明 `peakMs` 是人工动作极值真值。
- 唯一不可覆盖边界比物理视频结尾晚约 640ms，应人工修正标注，不能静默裁剪。
- 已定位并修复两类上游错误：中途切换到镜中/背景人物；视频开头误锁小目标后无法重锁主训练者。

这些数字是“观察与人工时间轴可对齐率”，不是新用户动作识别准确率。

### 复核播放器的媒体时钟修复

- 已复现用户截图中的错位：`field-capture-2026-08-02T19-08-40-178Z` 的旧 MediaPipe sidecar 写成 30.070 秒、298 帧，帧间隔中位数 67ms（14.93 FPS），最大空洞 1.2 秒；真实 WebM 是 25.910078 秒、614 个解码帧。旧页面直接用 `video.currentTime` 查这个不同步的侧录时钟，在视频 16.735 秒附近会取到约晚 2.687 秒动作相位的骨架，因此会出现“人体明明正常但骨架突然变形、时间轴完全错位”。Rust 只能处理收到的时间戳，不能修复这类上游双时钟错误。
- 50/50 个人视频已有 YOLOX + RTMPose Halpe-26 sidecar。其姿态时间戳按解码媒体时间推进；50 条末帧与真实媒体结尾的误差中位数 31.294ms、P90 92.813ms、最大 141.896ms，全部在 150ms 内。上述截图视频改为 228 个采样观察帧、0–25.900 秒，距真实结尾只有约 10ms。
- `npm run review:recognition` 的个人视频现优先读取这些 Halpe-26 观察，经 Rust `halpe26` canonical 后绘制，不再读取历史 MediaPipe 侧录；接口显式返回 pose schema、pipeline、时间域、采样间隔和 150ms 最大叠加年龄。页面按 Halpe-26/COCO-17 正确索引连接骨架，超过 150ms 没有邻近观察时停止绘制旧帧，画外点裁剪在真实视频画幅内，`+1F` 按下一姿态观察时间戳跳转。
- Codex 内置浏览器实测该视频原生媒体 `duration=25.910078`、`readyState=4`，播放约 2.2 秒前进 2.446 秒；页面明确区分“视频原速播放”和“姿态约 9.2 FPS 采样”。16.235 秒静止帧的 canonical 与 raw RTMPose 均按同一媒体相位叠加；个人与 MM-Fit 页面控制台错误为 0。该修复只消除复核工具的时钟/拓扑假象，不改变个人 held-out 时序识别指标，也不能当作模型达到 95%。

### Golden 回放与 Temporal 候选模型

- Golden compatibility replay：期望 465、回放 465；旧版区间/peak 字段 464 中匹配 464、±250ms 对齐 463；50/50 来源 set-count 精确。该路径使用同记录模板，只验证标注时间轴可被 canonical/Rust 契约忠实承载，不是模型独立识别，也不证明 peak 来源为人工。
- leave-one-source-out：按旧版 `start/peak/end` 混合口径对齐 156/464（33.62%）；set-count 精确 13/50（26%）；set-count 与旧版时间轴同时精确 2/50（4%）。忽略来源不明的 peak、只验 start/end 与 IoU 时，对齐 184/464（39.66%），仍远低于 95%。
- Rust 与 Python Golden 回放结果一致，证明跨实现契约一致，不证明泛化。

### 2026-08-11 temporal 根因诊断

- 新增快速红灯闸门 `npm run gate:personal-halpe26-temporal-generalization`，固定检查来源隔离的人工区间、整组次数、整条区间和 peak 来源；当前稳定返回人工区间 39.66%、exact-set 26%、次数+人工区间整条精确 8%、可追溯人工 peak 覆盖 0%，不会再让同视频 99% 或来源不明 peak 掩盖泛化失败。
- 当前模型用 142 维整段模板 MSE 加贪心非重叠窗口，包含绝对坐标、可见性和逐帧速度。消融后只用关节几何，旧口径对齐从 156 提升到 176，但仍不够；速度通道会降低结果。
- 当前按“动作+朝向”分桶过稀。只按动作共享模板后，预测数 313→427、对齐 156→200、eligible source 38→48，但仍只有 3 个来源同时满足次数和旧版时间轴；稀疏只是部分原因。
- 失败卧推的最高分假候选落在已复核负样本区。该窗口闭环误差 0.476、动作幅度 0.313；8 个真实 rep 的闭环误差 0.005–0.050、幅度 1.76–3.13。现算法没有验证一次动作是否形成完整往返周期，也没有使用已标负样本做判别训练。
- 固定周期缩放和 DTW 没有解决 peak 对齐；动作特异的逐帧相位回归在已知 rep 区间内只能达到 74.4% 的 ±250ms peak 命中率。下一模型必须采用动作特异、镜像不变的相位特征与闭环状态机，不能继续只调当前模板阈值。
- 标注 UI 根因已确认：拖选 rep 时，peak 优先取算法候选，否则自动取区间中点；精确数值编辑虽可人工改 peak，但旧数据不记录是否改过。现有 464 个 peak 中 193 个（41.6%）精确等于区间中点，全部 peak 的监督来源均需视为 `legacy_unattributed`，不能直接用于最终 phase accuracy gate。
- 新的 `personal-cycle-state-halpe26-v1` research candidate 完全不读取旧 peak，也不使用 expectedCount 推理；它从其他源视频的人工 rep 区间学习动作特异、镜像不变主运动轴和闭环状态。按当前 Rust Halpe 低置信度语义重新导出 50 个来源后，48 个具备其他训练来源的 held-out 视频共有 445 条人工区间；模型预测 423、匹配 391，precision 92.43%、recall 87.87%、start/end+IoU 对齐 332/445（74.61%）、exact-set 18/48（37.50%）、次数+整条人工区间精确 6/48（12.50%）。另有 139 个候选进入 `needs_review`。这是 research 红灯，不得把任一单项 precision 称作识别率。
- 已最小化的 101 个原始假周期中，98 个 peak 位于人工复核负窗；setup/exit 孤立周期和侧平举静态幅度是主要类型。端点闭合、多通道方向一致性、峰值相位离散度和相邻周期一致性能够提高 precision，但不能同时达到 95% recall。全局 prominence、固定毫秒偏移、相对幅度 crossing、局部波形 ridge 与统一边界分类器均已被来源隔离实验否定；统一边界分类器还会把原始 start/end 对齐从 84.72% 降至 80.00%，因此未采用。
- 当前最大的时间轴问题不是骨架“有没有点”，而是动作特异的相位/边界表征。肩推 6 个来源中，5 个来源的手腕极值方向与另 1 个来源相反；简单解剖信号无法解释最严重来源。下一模型需要学习逐帧时间状态并显式支持相位约定，而不是继续调一个 profile 阈值；来源不明的旧 peak 仍不能用于该模型的正式监督。
- k-NN 候选按动作拆分进一步证明该结论：正面卧推周期 precision 100%、recall 95.65%，但人工 range 对齐仅 63.04%；肩推 range 对齐 43.18%，器械推胸 68.97%，而高位下拉 96.43%、坐姿划船 95.83%、直臂下压 100%。因此“骨架贴合但时间轴错”是边界状态模型失败，不能再归因于肩肘腕可见性。
- 肩推数据存在相位约定不一致：动作 profile 规定 `wrist_height/min`，即 peak 为画面中手腕最高处；5 条近景旧中点多落在杠铃低位，1 条远景落在高位。标注页现会显示动作特异相位约定，未逐 rep 人工确认黄色 peak 线时禁止批准为逐 rep 真值。

结论：观察层已经能对齐当前视频，但 temporal 候选模型尚不能泛化到未见视频；不得用 Golden 回放 99% 结果宣称真实识别率达到 95%。

## 客户端 Agent 的证据接口

客户端 Agent 只消费 `maxpower-training-execution-assessment/v1`，不直接解释关键点：

- Rust canonical：主体、点位来源、置信度、不确定性、关节角、动作阶段、rep 边界与 lineage。
- 器械观察：只有真实器械检测器输出后才能进入杠铃/哑铃路径判断。
- 训练意图：动作变式、训练目标、计划 ROM、节奏、负荷、RIR/RPE。
- 技术真值：必须来自审核过的 rep 级标签，且借力/代偿至少需要两个独立特征组。
- 无充分证据时必须返回 `cannot_judge`；Agent 不得补造第二套 rep、阶段或生理学事实。

代码接口：`src/motion/trainingExecutionAssessment.ts`。

该接口现已提供共享构建器 `buildAgentTrainingExecutionAssessment`：动作完成证据与技术标准性分开生成；没有审核参考时即使 Rust 已确认 rep，`techniqueAdherence` 与 `standardExecution` 仍为 `cannot_judge`；借力/策略偏移只有在至少两个独立特征组和两条证据引用同时存在时才进入 Agent inference。对应 5 个契约测试通过。

## 跨端视觉运行时状态

- Web：YOLOX HumanArt 人体候选 + RTMPose-M Halpe-26 已接入 Rust WASM；候选人选择、短时连续性、动作阶段和计次由 Rust 负责。
- Android：ONNX Runtime 原生 Adapter 已执行同一 YOLOX + RTMPose Halpe-26 管线，并把全部人体候选交给 Rust multi-candidate ABI；`pose-camera` Kotlin 编译通过。
- iOS：ONNX Runtime Objective-C Adapter 已覆盖实时相机与本地视频回放，二者共用同一像素预处理、YOLOX、RTMPose 和 Rust bridge；`pose-camera` target 与完整 App 的 arm64 Simulator 构建通过。
- 冻结真实跨端夹具：取个人正面卧推 `b8af1ab860d6bbb43cd3f2cadc71506c` 的 20.5–21.8 秒，共 14 帧；5 帧存在多个人体候选，单帧最高 5 个候选，画面包含镜面和健身房路人。每个候选均由 RTMPose 独立生成 26 个实测点，没有跨人补点或合成点；Rust 14/14 帧均选择主训练者 candidate 0，镜像/路人替换为 0。
- Web 的正式 `RustCanonicalWasmSession`、Android PHK110/Android 15 真机 JNI bridge、iPhone 17 Pro/iOS 26.5 Simulator Objective-C bridge 对上述 14 帧的 `MOTN/1.6` packet 均达到 14/14 字节一致。原生与 WASM 的 `acos/hypot` 曾令一个发布角度相差最多 0.0001°；现仅在 packet 的客户端角度扩展量化到 0.001°，内部 canonical、选人、计次和轨迹逻辑未改变。证据报告为 `docs/reports/real-halpe26-cross-platform-runtime-parity-2026-08-11.json`，SHA-256 `4b50a34d8db839639d5ef111b99b7373f39a83c770a70638643b4ea40e63efe1`。
- 当前 Rust packet 已升级为 `MOTN/1.7`，新增不改写人体点位的 `EQP1` 器械证据。Web、Android JNI 与 iOS `MPMotionBridge` 已通过同一个 pose+equipment 帧接口提交器械候选，Rust 统一负责锁定主体关联、显式镜像/静态拒绝、稳定 track id 和 `cannot_judge`；附有 research-only 杠铃轴观察的真实卧推夹具在 Web 与 iOS Simulator 均达到 14/14 原生 packet 字节一致。Android 四 ABI 与 `pose-camera` C++/Kotlin debug AAR 已构建通过，但本轮没有连接 Android 真机，因此上述 `MOTN/1.6` 真机报告不能冒充 v1.7 真机验收；v1.7 三端完整 parity 仍为 pending。机器可读证据为 `docs/reports/real-halpe26-pose-equipment-adapter-parity-2026-08-11.json`，SHA-256 `f80c355c6ddb282cea954e412543a7c976487344ab8b842d43558f077ae68a16`。
- 客户端骨架叠加层只绘制 Rust 选定主体的 canonical 点位，不再直接绘制“第一个 YOLO 人框”，避免界面在镜像人物/路人出现时展示错误主体。
- 三端都保留 Halpe-26 前 17 点的 COCO-17 索引语义。旧 MM-Fit 官方 OpenPose 映射中不存在的附加点保持 `unknown`；新的 MM-Fit RGB 则直接运行同版 RTMPose-M Halpe-26，产生原生 26 点，不再把 OpenPose 映射数据冒充 RTMPose 训练域。
- Rust `raw` canonical 曾把 0 置信度缺失哨兵错误标为 `measured`；现已在底层修复为 `source=unknown`、坐标 `null`、`renderable=false`、`usable=false`。w04:4 烟雾回放的 9 个空帧因此精确产生 234 个 unknown 点、0 个预测点、0 个伪造训练点；Web/Android/iOS 共用该语义。

### MM-Fit 原生 Halpe-26 弱监督链路

- 新提取器：`tools/external-fitness-data/extract_mmfit_rgb_halpe26.py`。它只接受官方 train split、按官方 RGB 全局帧号以 10 FPS 采样、每片独立主体 tracker、输出原生 Halpe-26，并保留 `set_count` 与空 `repBounds`。
- 新 canonical 导出器：`tools/recognition-profile/exportMmfitHalpe26CanonicalSequences.ts`。每片先校验 SHA-256，再经 Rust WASM `raw` canonical；只有 `source=measured && usable=true` 的点可作为训练观察，缺失点不参与训练。
- 新周期/动作先验：`tools/recognition-profile/trainMmfitHalpe26Priors.py`。它训练/评估整组周期、弱周期时长和 set-level 动作身份；周期推理没有 `expectedCount` 参数，动作推理没有 `exerciseId` 输入。交替动作的 5↔10 二次谐波只允许使用其他 train subject 学到的低计数 ×2 校准，不允许常量 10 或 ±1 修正。动作分类使用统计量加 4/8 个时间分箱，并在每个外层 held-out subject 内通过内层 subject isolation 选择分箱和 ridge 正则。
- 全量 LOSO 动作身份已经过 95% 门槛：301 片 accuracy 99.3355%、macro-F1 99.3376%，10 个动作的 recall 均 ≥96.6667%；只有 w16:30 jumping jack 与 w17:20 sit-up 两片分类错误。该结论只适用于 MM-Fit official-train 的 subject-isolated research 评测，不等于外部数据集或客户端真机准确率。
- 全量 LOSO 次数仍未过门槛：2,999 truth reps、2,939 predicted reps，exact-set 90.3654%、±1 次 96.3455%、MAE 0.2392。交替弯举从 3.70% 提升到 96.30%，交替弓步从 17.24% 提升到 96.55%；但肩推 83.33%、开合跳 76.67%、三头伸展 90.32%、仰卧起坐 75.00%、站姿哑铃划船 90.32%，因此 `npm run gate:mmfit-halpe26-periodicity` 仍按设计返回 exit 1。时长估计、连续频率、局部频率细化、单通道选择、弱监督 phase 回归与自相关均在同一 subject-isolated 数据上不如当前方案，未采用。
- 官方 set 前后包含上下文帧。canonical 现保留 set-level `startFrame/endFrame`，周期评测只使用该窗口，不制造逐 rep 边界。w04:4 push-up 烟雾样本由错误的 11 次恢复为官方 10 次。
- 全量审计：301 片、68,147 帧；YOLOX 直接检出率 96.7394%，空帧率 0.0924%，COCO 前缀不足率 0.0998%，最大相邻主体框中心跳变 0.114438，没有 >0.15 的主体跳变。11 片进入视觉复核队列，全部集中在低机位俯卧撑/仰卧起坐的 detector hold；抽检最差 w17:20/w17:21 只见同一训练者，没有镜像或旁人替换。审计报告 SHA-256 `7d133e893452cbb8e9fbe9db55f08b4add0f1ed7f9eb0afad0715a87eb86b7c7`。
- 审计器全量运行曾暴露 `hashlib.update()` 错误链式调用；已先加回归测试复现，再拆成独立更新调用。逐片哈希、split 隔离、监督边界和主体连续性现均通过。
- Rust canonical 已完成 301/301，SHA-256 `47f75662a7715381653135aa342d0ea00ee3f7e7ac61bd689992240bc7fc4be2`。1,771,822 个关键点中 measured 1,770,184、unknown 1,638、predicted 0；unknown 坐标全部为 `null`，不合资格却进入训练的点为 0。
- 新数据库构建器 `tools/action-trajectory-database/build_native_halpe26_v2.py` 用 SHA-256 引用个人与 MM-Fit 的 Rust canonical、模型、held-out 报告和三端 runtime parity。构建器会拒绝非真实视频、无多人候选、任一端 packet 覆盖不完整或发生镜像/路人切换的 runtime 报告；生成结果仍保持个人 range 与 MM-Fit set-count 两种监督分离，写入红色次数门禁，并在 0 技术金标时强制写入 `blocked_no_gold_labels`。

上述状态已经证明同一真实多候选 Halpe-26 观察经 Web、Android 真机和 iOS Simulator bridge 后的 Rust packet 一致；尚未证明相同原始像素经三端 YOLOX/RTMPose 预处理后的候选数值一致性、iOS 真机执行或真实设备持续时延/热稳定性，也没有改变个人闭环模型 recall 87.87%、人工 range 对齐 74.61% 的红灯事实。现有 peak 全部为 `legacy_unattributed`，合格 peak 真值为 0/40，峰值准确率必须显示未测量。

## 验收门槛

以下门槛必须在冻结的来源隔离测试集上同时满足：

1. 镜面/多人主体集身份误切换为 0；无法确认主体时输出 `unknown`。
2. 动作身份 macro-F1 ≥ 95%，且每个支持动作均单独报告。
3. rep 计数 exact-set ≥ 95%；人工拖选区间的 start/end + IoU 对齐率 ≥ 95%；只有 `peakSource=human_adjusted` 的冻结测试标签才进入 peak ±250ms 指标，三项分别报告。
4. 标准性和借力/代偿的 precision、recall 均 ≥ 95%，并按动作、机位、主体和错误类型分层报告。
5. Web、Android、iOS 对同一冻结观察序列的 Rust canonical/rep 输出 100% 一致。
6. 不支持生理或医疗断言的自动拒绝率为 100%；证据不足时 `cannot_judge` 传播正确。
7. 训练/验证/测试来源无泄漏，模型、标签、阈值、数据哈希和失败样本可追溯。

## 当前阻塞与下一里程碑

- 当前个人标注提供动作、朝向、计次、rep 区间和负样本，但旧 peak 来源不可追溯，也没有经复核的“标准/偏差/借力/刺激兼容性”真值。不能仅靠现有标签训练专业技术判断。
- 标注页已加入可拖动黄色 peak 手柄和 `human_adjusted / algorithm_candidate / range_midpoint / legacy_unattributed` 来源字段；新导出会显式统计来源。现有原始标注未重写，需先冻结来源隔离测试集，再人工校正该测试集的 peak，避免用测试标签调参。
- 闭环候选已写入 `data/workflows/motion-profile/personal-halpe26-v1/run-2026-08-11/candidates/personal-cycle-state-halpe26-v1.json`，对应 leave-one-source-out 诊断为 `diagnostics/personal-cycle-state-halpe26-v1-loo.json`；artifact 明确标记 `researchOnly=true`、`productionPromotion=false`、非因果整段归一化，尚未接入 Rust streaming。
- MM-Fit 原生 train-only 轨迹、Rust canonical、周期/动作先验和 LOSO 报告已写入 `data/external/mm-fit/native-rtmpose-halpe26` 与 `data/workflows/motion-profile/mmfit-halpe26-v1/run-2026-08-11`。模型 SHA-256 为 `38555b66fc1f9f0281b75927c9a6ca85e4bf3ef0fd49910d9f3aac87356f1e03`，LOSO 报告 SHA-256 为 `f0f65c27ab81a8bd5825ec56b017f79976995077719f87edabf4d460cefa9b9e`。这些产物均为 research-only，MM-Fit 的 set total 不得转写成 rep phase 或 technique truth。
- 复核工具已经可用，但正式事件仍为 0；需要专业复核 464 个 rep，并补充明确的非标准、借力、正常个体差异、不同机位与跨用户数据。确认借力至少需要两个独立特征组；个人数据不会通过单次复核自动标为标准参考。
- YOLOX HumanArt 权重只检测人物。器械路径需要另行标注杠铃/哑铃框并训练器械检测器。
- 器械人工真值链路已经建立：6 条个人卧推来源冻结为 554 帧，按来源隔离为 train 155、validation 69、test 330；139 帧为高优先级。复核页可拖动杠铃轴并标记真实杠铃、无目标、仅镜像、仅静态架位和无法确认，事件为 append-only，保留 queue/manifest/video/image/split/frame/timestamp lineage。当前正式提交为 0，训练数据闸门按设计返回 exit 2，并报告 `blocked_no_human_labels`、训练来源不足、单人数据和无 unseen-subject test；不得用 554 个几何 proposal 直接训练。
- 器械标签后的 detector 流水线也已冻结为 `EquipmentDetectorCorpus` Module：它只接受人工提交且无复核冲突的事件，逐图验证 SHA-256，拒绝来源或重复图像跨 split，将人工杠铃轴转换为 COCO bbox + 两端点几何真值，并把 no-target / reflection-only / static-rack-only 保留为 hard-negative image；`ambiguous` 一律排除。标准 YOLOX 只训练类别、框与分数，两端点仅用于框内线段后处理的校准和冻结 path 评测；长边中心线兜底必须标记 `derived_geometry`，不得冒充 detector measured。训练进程只允许读取 train/validation，冻结 test input 不含标签，test truth 单独哈希并只供预测后评测。当前空标签 corpus SHA-256 为 `2fc02592341bf4b13fedb9c7134a011c3293c4e015b1b2c2622dbe79f8c6b73c`，门禁按设计返回 exit 2；YOLOX-Nano 416×416 训练计划与 ONNX 输出契约已生成，但没有标签和权重时不会启动伪训练。
- MM-Fit train-only 哑铃复核队列已物化并通过逐图 SHA-256 校验：301 个官方 train 切片、10 个 train subject 共 1,036 帧，其中哑铃动作 882 帧、非哑铃动作 hard-negative 候选 154 帧；内部按完整 subject 隔离为 train 602、validation 220、test 214，未读取官方 validation/test/unseen。队列连续两次构建 SHA-256 均为 `687d4d9a408d95d41e46284df63f5c8395d6e99ebc247d5adf59ca12fbbab64f`，1,036 张图片缺失 0、哈希错误 0。OpenPose 手腕框仅为 `humanTruth=false` 标注提示，MM-Fit 的 set-count 保持组级标签且 `repBounds=[]`；在人工提交哑铃框前不得进入 detector 训练。
- Rust 器械融合接口已经落地，契约为 `docs/design/rust-pose-equipment-fusion-contract-v0.1.md`；它不会从器械补造手腕。Android JNI/iOS bridge 的输入参数已接通，但实时相机仍提交空器械列表，且 detector 本身未训练，所以产品端器械维度继续 `cannot_judge`。
- Web、Android、iOS 的 YOLOX + RTMPose Halpe-26 → Rust canonical 实现均已接通；真实观察 bridge parity 已在 Web、Android 真机和 iOS Simulator 通过。剩余跨端闸门是同一原始像素的三端视觉推理 parity、iOS 真机、主体身份长序列、热性能和端到端延迟；未通过前不声称完整设备验收完成。
- 下一训练里程碑是：完成技术标签规范和首批双人复核金标，再训练按动作/机位分层的序列模型，并用 held-out subject 验收，而不是继续调同来源 profile。

## 2026-08-11 回归证据

- Rust Motion SDK：新增客户端发布角度跨平台稳定性回归，覆盖原生/WASM `f32` 数学的已观测漂移；其余 Halpe-26 schema、主体连续性、raw 缺失点保持 unknown、短时预测上限、异常点拒绝、阶段/计次、轨迹比较和 native ABI 继续通过。
- Rust Motion SDK 的 `MOTN/1.7` 器械模块现有 7 个专用契约测试（含原生/Wasm 关联置信度字节稳定性）和 1 个 Web ABI 入口测试；完整 Rust 单元/集成测试 91 项通过，doc test 通过。TypeScript packet/Agent/角度契约 15 项通过；Web 真实卧推 pose+equipment 测试 3 项通过。Apple XCFramework 与 Android 四 ABI 已重新生成，iOS Simulator pose+equipment 夹具保持 14/14 packet parity，Android `pose-camera` debug AAR 构建通过。
- 外部训练数据与移动能力：57 个测试通过，覆盖 MM-Fit 标签边界、split 防泄漏、Android/iOS RTMPose source contract 和能力降级。
- Web ↔ Rust parity：原有 54 帧坐标容差 `1e-5` 继续通过；新增真实正面卧推镜面夹具经 Web client WASM wrapper 14/14 packet 字节一致。
- Android：`MotionNativeRealHalpe26ParityTest` 在 PHK110/Android 15 真机通过，1 test、0 failure、0 error；14/14 packet 字节一致。
- iOS：Objective-C `MPMotionBridge` 在 iPhone 17 Pro/iOS 26.5 Simulator 通过，14/14 packet 字节一致；仍待 iOS 物理设备与时延测试。
- 技术复核工具：10 个数据/事件契约测试通过；真实浏览器已验证视频播放、rep 定位、临时草稿追加与 MM-Fit 技术标签拒绝。验收草稿写入临时目录后已删除，没有污染正式复核数据。
- 器械复核工具：新增 3 个事件/轴线/路径安全契约测试，识别复核合计 14 项通过；Codex 内置浏览器已验证 554 帧队列、图片与画布、临时提交后不跳帧、330 帧 TEST 来源隔离和零控制台错误。临时器械事件已删除，正式提交仍为 0；训练数据构建连续两次 SHA-256 均为 `7ceb74acf70ae8593ae2d95a3d3331b797e0f35ef2a3f325700ccab6243c7f33`。
- 器械 detector corpus：新增 3 个 Module Interface 测试，覆盖确定性 COCO 导出、source/image split 泄漏拒绝、测试真值封存、F1/track coverage/shaft endpoint PCK/hard-negative false-positive/identity-switch 冻结评测；识别/技术/器械复核与 detector corpus 合计 17 项通过。当前真实空标签构建连续两次得到相同 corpus SHA-256 `2fc02592341bf4b13fedb9c7134a011c3293c4e015b1b2c2622dbe79f8c6b73c`。
- 识别复核播放器：当前索引不再把 50/50 同录像模板回放作为默认识别结果。默认固定种子随机抽查一条训练时排除的视频，橙色显示 source-held-out 预测，青色仅保留同录像回放作 Rust/播放器链路基线；全部来源留出聚合明确显示 precision 92.43%、recall 87.87%、exact-set 18/48、人工区间 332/445、exact timeline 6/48 和 `FAIL / NO PROMOTION`。识别/技术/器械复核合计 14 个契约测试通过；Codex 内置浏览器已验证默认随机抽查、48 条 held-out 切换、视频原速播放、10 FPS 姿态叠加和零控制台错误，未使用 headless 浏览器作为本轮可视验收依据。
- 技术训练闸门：连续两次构建得到相同 SHA-256 `c07de2335160b8279724b6c0dff8350d6c3a7d661b754577aacb0add87757030`；`--require-eligible` 在 0 金标时按设计返回 exit 2。
- Temporal 快速闸门按设计返回 exit 1；新的盲测闸门同样返回 exit 1，并明确报告 precision 92.43%、recall 87.87%、人工 range 对齐 74.61%、exact-set 37.50%、exact timeline 12.50%，以及合格人工 peak 真值 0/40，防止只展示 precision 或把区间中点当动作极值。MM-Fit 动作分类已过 95%，但次数门禁以 exact-set 90.37% 返回 exit 1。卧推器械可观测性对照另证明器械路径能把候选计次从 41/46 提升到 46/46，但完整区间仍只有 39/46（84.78%），且未训练 detector，因此不能 promotion。
- 全仓测试 720 项中 717 通过、2 跳过；本次视觉迁移、标注 provenance、temporal 闸门和闭环候选相关测试全部通过。剩余一项既存 Workout/Timeline 断言仍与该分支新增的逐组 `historicalSet` 写入不一致（实现产生一条 session + 两条 set 记录，旧断言仍期待一条），与骨架迁移无关，未在本工作中擅自改写其产品语义。

## 不得跨越的停止条件

- 没有技术真值时，停止训练“标准/借力”分类器，只保留轨迹与待复核队列。
- 没有器械检测器时，依赖杠铃/哑铃路径的维度返回 `cannot_judge`。
- leave-one-source-out 或 held-out subject 未达门槛时，不做生产 promotion。
- 不修改 `public/archives/confirmed-captures/recognition-profiles.json`。
