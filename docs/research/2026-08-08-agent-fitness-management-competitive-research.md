# Android 优先的 Agent 健身管理：竞品能力与产品路线调研

日期：2026-08-08  
范围：中国的 Keep、训记及海外代表性训练、动作识别、恢复与营养产品。  
证据口径：只采用产品官方页面、官方帮助中心、应用商店开发者描述、平台官方文档，以及论文/指南原文。产品方的功能声明只证明“官方宣称或文档化”，不等同于独立效果验证。

## 结论先行

用户想要的并不是一个“会聊健身的 AI”，而是一个能完成闭环的 **计划执行 Agent**：读到目标、日程、设备、训练表现、恢复、饮食和身体趋势；通过受约束的训练/营养引擎生成方案；在有权限、可解释、可撤销的前提下，真正写回后续计划。

截至本次调研，市场上最接近这个完整形态的是 2026 年的 **Google Health Coach**：官方帮助明确支持用对话创建或更新 fitness plan、替换当天训练、生成可立即播放或保存的结构化训练，并允许调整计划中的 targets、reps、sets、duration；计划与完成数据进入同一产品界面。[Google Health Coach 官方帮助](https://support.google.com/googlehealth/answer/16961408?hl=en) 与 [Google Health App 变更说明](https://support.google.com/googlehealth/answer/17068213?hl=en) 都给出了可核验的“对话 → 修改计划对象”证据。它应成为本项目 Agent 体验的主要基准，而不是只以 Keep 或 WHOOP 的聊天界面为基准。

不同产品各自解决了闭环的一段：

- **Fitbod、Freeletics、RP Hypertrophy**：擅长把历史表现、恢复或主观反馈转成下一次的动作、组次、重量或训练量，核心更接近受约束的处方引擎，而不是自由聊天。
- **Peloton IQ、Tempo、MAGIC**：擅长“正在练”这一分钟内的计数、幅度/姿势提示、重量建议，但通常受硬件、动作白名单或课程模式约束。
- **WHOOP Coach**：擅长把恢复、睡眠、strain 等生理数据解释成建议；官方资料没有证明它能直接改写一套可执行的力量训练计划。
- **MacroFactor、Carbon、RP Diet Coach**：真正把体重趋势、摄入与依从性写回下一周热量/宏量目标，是营养闭环最成熟的一组。
- **Future**：是真人教练服务。它证明用户期待的是“每周建计划、周中按生活变化改计划、持续沟通”，但不能作为 AI 自动化成熟度证据。
- **Keep** 已有计划定制、日程、吃练睡解析、食物识别与更新记录中的计划修改能力；**训记** 的优势则是高自由度训练记录、模板和数据开放。二者都提供了重要本地产品参照，但现有官方证据仍不足以证明已完成“相机实时表现 → 自动修改训练与饮食未来计划”的完整闭环。

对本项目最合理的产品决策是：**Android 首版先做“计划系统 + 有界写入 Agent + 现有相机动作闭环”，不要先做一个无权限边界的万能聊天框。** LLM 负责理解意图、追问、解释和编排工具；训练量、热量、宏量营养、动作替换和安全下限由可测试的确定性引擎与策略层决定。

## 能力成熟度口径

为避免把所有带 “AI” 的产品混为一谈，本报告使用下列层级：

| 层级 | 定义 | 可验证行为 |
| --- | --- | --- |
| L0 内容/营销 | 静态课程、模板或只声称 AI | 没有个人数据驱动的行为证据 |
| L1 AI 文案 | 能回答、总结、鼓励、解释数据 | 输出文字，但不生成或写入结构化计划 |
| L2 个性化推荐 | 按目标、历史、恢复、设备或偏好给建议 | 推荐会变，但用户仍需手工落实到计划 |
| L3 受约束自动调整 | 系统自动生成/重生成训练或热量宏量目标 | 能改变持久化的未来处方，通常有确认或固定规则 |
| L4 可执行 Agent | 对话/事件触发真实计划变更，具备权限、差异预览、审计和撤销 | “帮我把今天上肢改成 4 英里跑”会实际修改可执行计划 |

L3/L4 才对应本项目第 4 项需求。一个能自然回答“今天该怎么练”的聊天机器人，若不能写入 `plan/session/nutrition target`，仍然只算 L1/L2。

## 竞品矩阵

“未证明”表示本次检索的官方资料没有给出该行为，不代表产品绝对没有隐藏功能。

| 产品 | 实时动作/轨迹 | 训练计划与增肌减脂 | 饮食协同 | 是否真实修改未来计划 | 判断 |
| --- | --- | --- | --- | --- | --- |
| **Google Health Coach** | 可记录 reps/weights、执行结构化 workout；未见手机相机姿态纠错证据 | 对话共同创建周计划、targets 与 workouts；可改 reps/sets/duration | 可记录饮食，给 personalized meal plans / macro targets | **是**：官方例子可替换今日训练、更新 fitness plan、保存自定义 workout | **L4，当前最接近目标的产品基准**。[官方帮助](https://support.google.com/googlehealth/answer/16961408?hl=en)、[产品变更说明](https://support.google.com/googlehealth/answer/17068213?hl=en) |
| **Keep** | 官方称 AI 语音指导；版本历史记录“动作视频识别和专属能力测试”，但当前页面未给出动作白名单、误差或实时纠错边界 | 周期计划、健身房计划、目标与日程；覆盖增肌、减脂、塑形 | 食物拍照、热量缺口、吃练睡解析 | **部分证明**：8.6.1 版本历史写明计划支持修改和调整；未证明会根据相机表现自动改未来训练 | **L3（计划侧），动作闭环待实测**。[App Store 开发者描述与版本历史](https://apps.apple.com/cn/app/keep-ai-%E8%BF%90%E5%8A%A8%E6%95%99%E7%BB%83/id952694580) |
| **训记** | 以记录重量、次数、容量和图表分析为主，未见实时相机纠错的官方证据 | 官方/自定义计划、模板、自动顺延、智能递增；偏硬核记录工具 | 已加入饮食、TDEE 规划、运动消耗叠加饮食 | 官方更新证明向 Agent 开放训练/饮食/身体数据并允许读取官方计划；**未证明 Agent 自动写回计划** | **L2，优秀数据与可编辑计划底座**。[App Store](https://apps.apple.com/cn/app/%E8%AE%AD%E8%AE%B0-%E8%AE%AD%E7%BB%83%E8%AE%A1%E5%88%92%E4%B8%93%E5%AE%B6/id1464915553) |
| **Fitbod** | 无相机轨迹纠错 | 按目标、经验、设备、历史、肌肉恢复生成动作、组、次、重量；RiR 和中断会影响后续 | 非核心；可读取 Health Connect/Apple Health 活动影响恢复 | **是**：表现、手工调重、休训会影响后续推荐 | **L3，力量处方引擎标杆**。[Fitbod 算法说明](https://help.fitbod.me/hc/en-us/articles/360004429814-How-Fitbod-Creates-Your-Workout)、[肌肉恢复](https://help.fitbod.me/hc/en-us/articles/360006269014-Muscle-Recovery) |
| **Freeletics** | 以示范与用户反馈为主，未见相机轨迹纠错 | 增肌、减脂、力量、跑步 Journey；按表现和反馈持续调整 | 有独立 Nutrition Coach，但训练/饮食联动证据有限 | **是**：Adapt Session 可按时间、器械、空间、噪声、身体部位、难度重生成当天训练 | **L3，日程突发调整交互标杆**。[Journey](https://help.freeletics.com/hc/en-us/articles/360001805519-Choose-your-Freeletics-Training-Journey)、[Adapt Session](https://help.freeletics.com/hc/en-us/articles/360003933780-Adapt-your-Bodyweight-training-session)、[并非真人](https://help.freeletics.com/hc/en-us/articles/360004957019-Can-I-talk-to-the-Coach) |
| **RP Hypertrophy** | 无相机动作分析 | 依据重量进度、RIR、pump、soreness、workload feedback 调整重量、次数、组数和未来训练量 | 与 RP Diet 是分开的产品/登录 | **是**：每次反馈影响后续 session，允许手动覆盖 | **L3，增肌训练量调节标杆**。[调整逻辑](https://help.rpstrength.com/hc/en-us/articles/32600173777815-How-does-the-app-determine-when-to-add-weight-reps-and-sets)、[用户覆盖](https://help.rpstrength.com/hc/en-us/articles/32434237175447-Shouldn-t-I-be-doing-more-sets-or-weight) |
| **WHOOP Coach** | 不做相机动作纠错；分析心率、strain、stress 等 | 给 daily outlook、strain/recovery/sleep targets 和自然语言建议 | 可给水分与恢复建议，非宏量处方闭环 | **未证明**：官方资料是 targets/insights/advice，不是结构化力量计划写入 | **L2，恢复解释标杆而非计划 Agent**。[官方帮助](https://support.whoop.com/s/article/How-to-Use-the-AI-Powered-WHOOP-Coach) |
| **Future Pro** | 无自动相机反馈；训练数据来自记录/手表 | 真人教练每周构建新训练计划，根据地点、器械、目标安排 | 非核心 | **是，由真人完成**；用户可实时要求改动 | **人类 L4 服务标杆，不是 AI 竞品能力**。[官方 FAQ](https://www.future.co/frequently-asked-questions)、[Google Play 开发者描述](https://play.google.com/store/apps/details?id=co.future.future) |
| **Zing Coach** | 营销页声称 computer vision/form tracking；但 2026 开发者文档把 exercise form-analysis 写为 future releases | 目标、历史、设备、日程、测试和疲劳驱动训练 | 官网声称热量与宏量目标 | 声称自适应 progression；具体写入与动作覆盖未透明 | **L2/L3 待实测；一手来源内部冲突**。[官网](https://www.zing.coach/)、[开发者平台](https://developer.zing.coach/) |
| **Tempo** | iPhone/Tempo 硬件跟踪关节、ROM、rep、姿势；可按心率延长休息 | 有课程和重量建议，RIR 会影响下一组 | 非核心 | **局部是**：下一组重量/休息调整；不等于完整周计划 Agent | **L3（单次训练内），且当前强项偏 iOS/硬件**。[Tempo App 官方页](https://tempo.fit/tempo-app)、[3D Form Feedback](https://support.tempo.fit/support/solutions/articles/151000154714-3d-tempo-vision-form-feedback) |
| **Peloton IQ** | 新 Plus 硬件相机支持 real-time form feedback、rep tracking、建议重量 | Workout Generator、自定/周计划、performance estimates | 非核心 | **局部是**：根据 form/rep 推荐升降重量，用户说/点 Accept；计划推荐随历史变化 | **L3，硬件绑定的实时训练标杆**；旧 Guide 已被新 Peloton IQ 取代。[Peloton IQ 官方说明](https://www.onepeloton.com/blog/what-is-peloton-iq)、[设备范围](https://www.onepeloton.com/peloton-iq) |
| **MAGIC AI Mirror** | 官方声称近 400 动作可实时计数、动作/ROM 纠正 | 每周按能力和目标自动更新计划 | 非核心 | 官方声称按表现自动更新周计划与重量指导 | **L3 声明，但主要证据为销售页且硬件绑定**。[官方产品页](https://magic.fit/products/magic-ai-fitness-smart-mirror)、[FAQ](https://magic.fit/pages/faq) |
| **MacroFactor** | 无动作分析 | 不提供训练计划 | 按摄入、trend weight、目标和 expenditure 每周建议更新热量/宏量；支持高训练日移热量 | **是**：check-in 提议更新，用户可拒绝；Coached/Collaborative/Manual 权限清晰 | **L3，营养审批与安全护栏标杆**。[Check-in](https://help.macrofactorapp.com/en/articles/247-introduction-to-check-ins-and-coaching-modules)、[Program Styles](https://help.macrofactorapp.com/en/articles/91-program-styles)、[调整逻辑](https://help.macrofactorapp.com/en/articles/222-how-does-macrofactor-make-adjustments-for-a-weight-gain-or-weight-loss-goal) |
| **Carbon Diet Coach** | 无 | 不提供训练计划 | 按实际摄入、体重趋势、目标速度和依从性在每周 check-in 自动调整热量/宏量；支持 reduced-carb/keto 等偏好 | **是**：提交周检后写入下一周目标 | **L3，营养反馈闭环标杆**。[Weekly Check-in](https://help.joincarbon.com/en/articles/6004812-weekly-check-in-in-carbon-how-it-works-and-what-to-expect)、[Diet Preferences](https://help.joincarbon.com/en/articles/6004831-diet-preferences-in-carbon-customize-your-macro-ratios) |
| **RP Diet Coach** | 无 | 训练 schedule 是营养输入，不生成训练计划 | 根据身体、睡眠、训练日程、日常活动生成按餐宏量；周度调节；意外进食后可自动重分配当天剩余 meals | **是**：周度营养目标与日内剩余餐会变更 | **L3，吃练日程协同标杆**。[安全与周调节](https://help.rpstrength.com/hc/en-us/articles/33327568055447-How-does-the-app-keep-me-safe-while-dieting)、[Day Balance](https://help.rpstrength.com/hc/en-us/articles/35041947892631-Diet-App-Update-1-5) |
| **MyFitnessPal Premium+** | 无 | 不提供适应性训练计划 | 按目标、宏量、饮食偏好、过敏、预算、烹饪时间生成 meal plan 和购物清单；支持 low-carb/keto 等 | 可换餐、改 portion/targets；**未证明根据体重表现自动校准下一周热量** | **L2，计划到采购执行体验标杆**。[Meal Planner](https://support.myfitnesspal.com/hc/en-us/articles/34347103172877-Meal-Planner) |

## 四类目标能力的市场判断

### 1. 实时分析运动轨迹并给建议

成熟产品并不是对任意运动说一段通用建议，而是：**动作白名单 + 明确可观测错误 + 低延迟反馈 + 用户可修正记录**。

- Tempo 明确表示反馈只覆盖部分基础动作，并且不会每次错误都弹；单个“动作 × 错误类型”需要数万次 reps 和数百名不同参与者标注、训练和测试。[Tempo 官方帮助](https://support.tempo.fit/support/solutions/articles/151000154714-3d-tempo-vision-form-feedback)
- Peloton IQ 将实时 form、rep、重量建议限制在带 Movement-Tracking Camera 的指定 Plus 设备；结束后还提供短时间人工修正 rep 的入口。[Peloton IQ](https://www.onepeloton.com/en-CA/blog/peloton-iq-strength-training-features)
- MAGIC 声称近 400 个支持动作，但证据仍来自销售页；Zing 的官网和开发者文档对“已上线的实时动作纠正”存在冲突。它们可以作为方向，不应直接当准确率基准。

本项目已有相机 → 骨架 → Rust packet → HUD/报告链，应沿这一条继续，而不是另起一套聊天视觉。Android MVP 的正确范围是：

1. 先把已有 Tier 1 动作做成可验收的白名单，每个 cue 都绑定 `exercise_id + viewpoint + observable + threshold/version`。
2. 实时只播一个最高优先级、能立即执行的 cue；组后再解释 rep 级证据。
3. 用户可以修正 rep、标记“反馈不对”，这些修改同时进入训练记录和模型校准数据。
4. 不用“纠正即可防伤”做承诺。相机只能观察画面中的运动学代理量，不能判断疼痛、组织负荷、病史或内部关节受力。

### 2. 增肌/减脂训练计划

Fitbod 与 RP Hypertrophy 表明，可靠的“AI 计划”核心是结构化处方与反馈变量，而非生成式文字：动作、肌群、训练日、sets、reps、load、RIR、rest、progression、deload、替代动作和设备约束都必须是可读写对象。Fitbod 用历史、目标、设备和恢复生成下一训练；RP 明确用 pump、soreness、workload perception 和 RIR 调节未来 volume。[Fitbod](https://help.fitbod.me/hc/en-us/articles/360004429814-How-Fitbod-Creates-Your-Workout)、[RP](https://help.rpstrength.com/hc/en-us/articles/32600173777815-How-does-the-app-determine-when-to-add-weight-reps-and-sets)

首版建议只提供两个主目标：

- **增肌**：训练进展以目标 rep range、RIR、完成率、动作质量、肌群周量和恢复为输入。
- **减脂保肌**：仍以力量训练计划为主体，另加有氧/步数与热量缺口；不要把减脂计划退化成随机 HIIT 课程。

所有计划先由确定性模板/规则生成，再允许 Agent 用工具进行受约束的替换和调度。自由文本模型不能直接发明不存在的动作 ID、重量、宏量下限或恢复结论。

### 3. 碳循环、低碳等饮食与训练配合

竞品中真正成熟的做法不是宣传某种饮食“更燃脂”，而是把 **周预算、训练日差异、偏好和依从性** 分开：

- MacroFactor 的周热量预算固定；用户可以把更多热量移到高强度训练日，同时从其他日扣回。其 Collaborative 模式明确支持训练日高碳，但也说明该模式缺少 Coached 模式的部分安全护栏。[MacroFactor Weekly Budget](https://help.macrofactorapp.com/en/articles/92-weekly-budget)、[Program Styles](https://help.macrofactorapp.com/en/articles/91-program-styles)
- Carbon 支持 balanced、reduced-carb、ketogenic 等偏好；周检调整总热量时保持用户选择的宏量比例，而不是声称低碳天然更优。[Carbon Diet Preferences](https://help.joincarbon.com/en/articles/6004831-diet-preferences-in-carbon-customize-your-macro-ratios)
- RP Diet 以训练日程和 daily activity 生成按餐目标，并允许意外进食后自动重分配其余餐，是“日程变化 → 真实修改剩余计划”的好例子。[RP Diet](https://help.rpstrength.com/hc/en-us/articles/35041947892631-Diet-App-Update-1-5)

科学边界同样重要：ISSN 立场文件认为从低脂到低碳/生酮的多种方案都可以改善体成分；DIETFITS 12 个月随机试验没有发现健康低脂与健康低碳在减重上存在显著差异。[ISSN 立场文件](https://pubmed.ncbi.nlm.nih.gov/28630601/)、[DIETFITS RCT](https://pubmed.ncbi.nlm.nih.gov/29466592/)

因此产品上应将“碳循环/低碳”定义为 **饮食偏好或训练日能量分配策略**，而不是默认处方或代谢优势承诺。Android MVP 可提供：均匀分配、训练日偏高碳、低碳偏好三种受约束 preset；极低碳/生酮、极端热量缺口、医学饮食不应由 Agent 自动开启。

### 4. 根据表现、行为与日程实时修改计划

这是市场真正的空位，也是最容易做成伪 Agent 的地方。应拆成三种速度：

| 时间尺度 | 触发 | 可修改对象 | 竞品参照 |
| --- | --- | --- | --- |
| 组内/组间 | 完成 reps、动作质量、RIR、心率、疼痛/异常反馈 | 下一组重量、次数、休息、停止本动作 | Tempo、Peloton IQ |
| 当天 | 时间减少、设备变化、场地/噪声、疲劳、临时日程 | 缩短 session、同肌群换动作、改为恢复日、移动训练 | Freeletics Adapt Session、Google Health Coach |
| 周/周期 | 完成率、负荷趋势、RIR、恢复、体重/围度、摄入依从性 | 周频率、肌群周量、progression、deload、热量/宏量与训练日分配 | Fitbod、RP Hypertrophy、MacroFactor、Carbon |

Google Health Coach 的关键交互不是“给你建议”，而是用户可以说“Replace today's upper-body workout with a 4-mile run”，系统实际更新计划。[Google Health Coach](https://support.google.com/googlehealth/answer/16961408?hl=en) 本项目也应要求每条 Agent 回复落到以下两种之一：

- **只读回答**：解释数据或建议，不产生计划变更；
- **变更提案/已提交变更**：显示具体 diff、原因、使用的数据、风险、审批状态和撤销入口。

## 可借鉴的交互

1. **今日卡片先于聊天框**：首页显示今日训练、饮食目标、恢复/日程冲突和一个最重要行动；对话是修改入口，不是唯一入口。Google Health、Keep 都把日程与日内消息前置。
2. **变化条件用快捷选项表达**：`只有 20 分钟`、`没器械`、`膝不舒服`、`昨晚没睡好`、`今天出差`。Freeletics 的 Adapt Session 证明这种交互比让用户写 prompt 更稳定。
3. **先展示计划 diff 再执行**：如“卧推 4×8@40kg → 哑铃卧推 3×10@RIR 3；总胸部目标组 -1；原因：无杠铃且时间减少”。MacroFactor 的 check-in 接受/拒绝模式值得直接借鉴。
4. **小改动可预授权，重大改动逐次确认**：用户可设置“允许本周内自动顺延”和“允许同肌群同难度替换”，但新目标、明显降热量、增加训练日等必须确认。
5. **调整后保留解释和撤销**：每次 mutation 保存 `before/after/rationale/evidence/policy/version`，并提供“一键恢复”。
6. **数据不足就暂停调整**：MacroFactor 在摄入或体重记录不足时会 hold，而不是伪造精确结论。[MacroFactor expenditure 说明](https://help.macrofactorapp.com/en/articles/26-how-should-i-interpret-changes-to-my-energy-expenditure)
7. **用户可纠错传感器结果**：Peloton IQ 允许修正 reps；本项目应允许修正计数、重量和误判 cue，并把“人工修正后数据”作为更高可信事实。
8. **计划和实际分离**：计划 session、实际 session、Agent 变更不是同一条记录；完成后用关联 ID 对照差异。Android Health Connect 已有 `PlannedExerciseSessionRecord` 与 completed session 的关联模型可参考。[Android training plans](https://developer.android.com/health-and-fitness/health-connect/features/training-plans)

## 不能照搬的营销与错误抽象

- **“AI 教练”不等于 Agent**：WHOOP 的自然语言解释、Future 的真人服务、Fitbod 的算法和 Peloton 的视觉模型属于不同产品，不应放在同一个 AI 标签下比较。
- **“实时”不等于实时改计划**：实时语音鼓励、实时 rep count、实时动作纠错、下一组重量调整是四种不同能力。
- **“个性化”不等于持续学习**：只用 onboarding 问卷生成一次模板属于 L2 初始推荐，不是表现闭环。
- **“能看动作”不等于能判断安全**：Tempo 自己公开了动作/错误白名单和数据门槛；本项目也必须对每个 cue 做动作、机位、置信度和错误率验收。
- **“防伤”不可作为未经验证的因果承诺**：Peloton、Zing、MAGIC 的销售文案会使用 prevent injury 等表述；本项目目前只能说“帮助发现已验证的可观测动作偏差”，不能声称避免伤病。
- **不要把碳循环包装成更优减脂法**：当前一手研究支持多种饮食都可能有效，核心是可持续的能量平衡、蛋白与依从性，而不是宏量分配的营销名称。
- **不要用 readiness 分数伪装诊断**：睡眠、HRV、RHR、主观疲劳只能形成不确定的恢复建议；单日异常不应自动取消关键计划或做疾病判断。
- **不要在数据不足时自动“精调”**：缺少完整摄入、重量趋势、真实训练完成度时应 hold 或询问，而不是给出个位数热量和精确重量变化。

## 建议的 Android 优先产品架构

### 不是一个模型，而是五层系统

| 层 | 职责 | 是否允许直接写计划 |
| --- | --- | --- |
| Motion evaluator | 从相机/Rust packet 产出 rep、phase、ROM、已验证 finding、质量与置信度 | 否，只写 observation |
| Training engine | 模板、动作约束、周量、progression、RIR、deload、替代规则 | 生成候选 prescription |
| Nutrition engine | TDEE 初值、目标速度、周预算、蛋白/脂肪下限、训练日分配、趋势更新 | 生成候选 targets |
| Agent orchestrator | 理解自然语言、调用数据分析/训练/营养工具、追问、解释 | 只能提交 typed mutation proposal |
| Policy & commit layer | 权限、安全约束、审批、版本、事务、审计、撤销 | 唯一能 commit 的层 |

Google Research 的 Personal Health Agent 原型也把任务拆成 data science、domain expert、health coach 三个角色，并使用独立人类/专家评估；研究团队同时强调该框架不等同于已上市医疗产品。[Google Research PHA](https://www.research.google/blog/the-anatomy-of-a-personal-health-agent/) 本项目未必需要部署多个 LLM，但应保持同样的职责分离：计算事实、领域处方、行为教练不能混成一次自由生成。

### Agent 必须可读的对象

| 对象 | 关键字段 |
| --- | --- |
| `UserProfile` | 年龄范围、身高体重、经验、时区、语言、单位、同意状态 |
| `Goal` | 增肌/减脂/维持、优先级、目标速度、期限、成功指标、状态 |
| `Constraint` | 设备、地点、可训练天数、单次时长、动作禁忌、饮食偏好、过敏；医疗信息只做限制，不由 Agent 解释诊断 |
| `Availability` | 日期、可用时段、旅行/忙碌、训练地点；日历只读授权单独管理 |
| `ExerciseDefinition` | canonical ID、肌群、动作模式、设备、难度、替代组、支持的相机机位与 cue 白名单 |
| `Plan` / `PlanVersion` | 周期、训练日、目标周量、nutrition strategy、版本、生效日期、创建来源 |
| `PlannedSession` | 动作顺序、sets、reps、load/RIR、rest、duration、可替换规则 |
| `CompletedSession` | 实际动作、组次重量、RIR、完成度、开始结束时间、设备/来源 |
| `RepObservation` | rep ID、轨迹摘要、ROM、tempo、findings、置信度、模型/规则版本、用户修正 |
| `RecoverySnapshot` | sleep、HR/HRV、近期 load、soreness、fatigue、stress、数据来源与新鲜度 |
| `NutritionTarget` | 周热量预算、每日 calories/protein/carbs/fat、训练日策略、floor/ceiling、来源 |
| `FoodLog` / `BodyMetric` | 摄入、记录完整性、体重趋势、围度/体脂来源与可信度 |
| `AdherenceSummary` | 计划/实际差异、缺失数据、连续性、目标趋势 |
| `MutationProposal` | before、after、reason、evidence、confidence、policy result、approval、rollback ID |

### Agent 可写对象与审批边界

| 写操作 | 默认边界 |
| --- | --- |
| 记录完成 reps/weight/RIR、补充日记、把相机 observation 关联 session | 可自动，必须可纠错 |
| 在同一周内顺延未完成训练 | 用户首次开启“自动顺延”后可自动；通知并可撤销 |
| 在同肌群、同动作模式、设备可用且无禁忌范围内换动作 | 先给 diff；用户可对这类替换设置预授权 |
| 减少当天 1 个动作、降低 1 档负荷、延长休息 | 可在疲劳/时间不足时建议；预授权后可执行 |
| 增加训练量、训练天数或重量 | 默认确认；必须满足 progression 规则，不能仅因一次好表现大幅增加 |
| 创建完整周期计划或切换增肌/减脂目标 | 明确确认后提交 |
| 改周热量、蛋白、碳水/脂肪分配 | 展示当前趋势、数据完整性与变更幅度；用户确认后提交 |
| 极低热量、生酮/极低碳、快速减重、疾病/孕期/未成年人方案 | Agent 禁止自动开启，转专业人员/专门流程 |
| 疼痛、眩晕、胸痛、急性伤病信号后的继续训练建议 | 禁止；停止训练并提供适当的求助提示 |
| 写入 Health Connect 或外部日历 | 需要平台权限；健康数据与日历分别授权，可随时撤销 |

每次修改必须是事务：验证 `plan_version` 未过期 → 运行安全规则 → 生成 diff → 获取所需审批 → commit 新版本 → 更新日程/通知 → 写审计事件。不能让聊天模型直接对数据库做任意 `update`。

### PlanStore 与 Agent 工具合同

建议新增独立 `PlanStore`，把“计划事实”从聊天记录、UI state 和模型 prompt 中剥离。最低接口如下：

| 工具 | 行为 | 副作用/审批 |
| --- | --- | --- |
| `get_user_context(as_of)` | 读取目标、限制、设备、日程、授权和数据新鲜度 | 只读 |
| `get_active_plan(version?)` | 读取当前周期与 session；可按版本回看 | 只读 |
| `get_performance_summary(window)` | 汇总实际训练、RIR、轨迹 finding、恢复、营养/体重完整性 | 只读；必须返回 missingness 与来源 |
| `generate_plan_draft(goal, constraints)` | 调用确定性训练/营养引擎生成草案 | 只写 draft，不生效 |
| `adapt_session_draft(session_id, reason, constraints)` | 生成缩时、换器械、降级或移动 session 的 diff | 只写 proposal |
| `propose_exercise_replacement(...)` | 仅从 canonical replacement set 选项中生成替换 | 只写 proposal |
| `propose_progression(...)` | 基于完成、RIR、恢复与策略生成 sets/reps/load 变化 | 只写 proposal |
| `propose_nutrition_update(...)` | 运行趋势/安全下限规则，生成周预算与每日宏量 diff | 只写 proposal |
| `approve_mutation(proposal_id)` | 记录用户或预授权 policy 的审批 | 不直接绕过二次校验 |
| `commit_mutation(proposal_id, expected_plan_version, idempotency_key)` | 校验、原子提交新 `PlanVersion`，发出日程/通知事件 | 唯一正式写入口 |
| `rollback_mutation(mutation_id)` | 生成并提交反向版本，不删除历史 | 明确用户操作；保留审计 |
| `log_completed_session(...)` | 保存实际执行并关联 planned session/capture | 可自动；允许人工纠错 |
| `sync_health_connect(scope)` | 按授权读写聚合结果或 completed/planned session | 平台权限；失败不能破坏本地事实源 |

所有有副作用的工具都要接收 `actor`、`reason`、`expected_version`、`idempotency_key`，返回 `mutation_id/new_version/audit_event`；禁止提供 `execute_sql`、任意 JSON patch 或“让 LLM 自己拼完整 Plan 覆盖保存”的工具。聊天历史只保存解释与 tool reference，不作为计划的唯一记录。

## Android 集成建议

Android 首版应把本地数据库作为计划事实源，Health Connect 作为经授权的数据交换层：

- 优先读取/写入 `ExerciseSession`、Weight、Sleep、Nutrition、Heart Rate 等必要类型；按功能逐项请求权限，不要一次索取全部健康数据。Health Connect 官方要求 read/write 权限与 Play Console 声明匹配，用户可以随时撤销。[Health Connect 入门](https://developer.android.com/health-and-fitness/health-connect/get-started)、[读写权限](https://developer.android.com/health-and-fitness/health-connect/write-data)
- `PlannedExerciseSessionRecord` 能表达未来 session、blocks、steps、completion goal 和 performance target，并能关联 completed session，适合作为跨应用训练计划桥；但必须先检查 `FEATURE_PLANNED_EXERCISE`，不可假设所有 Android 设备都支持。[Training Plans](https://developer.android.com/health-and-fitness/health-connect/features/training-plans)、[API reference](https://developer.android.com/reference/androidx/health/connect/client/records/PlannedExerciseSessionRecord)
- Health Connect 不是实时相机数据总线。高频 rep/trajectory 留在应用内；训练结束后再写 session/summary。
- 读取第三方数据时保留 `data origin`、时间范围和新鲜度，避免手表、App 与手工记录重复计算。
- 国内 Android 设备可能没有 Google Play services；核心计划、相机与 Agent 不能依赖 Health Connect 才可运行，需要本地记录和导入/导出降级路径。

## 分阶段路线

### P0：先补现有 Android 动作闭环的可信基础

这一步是后续 Agent 的输入质量门槛，而不是另一个功能支线：

1. 解决 release 导出、final packet、文件冲突和写盘错误，让每组 observation 可回放、可校准。
2. 完成前/后摄、Tier 1 动作计数、FPS、8 分钟稳定性和 cue 白名单验收。
3. 把 UI 的“已校准/权威”改成与真实验收一致的能力标签。
4. 定义 `CompletedSession + RepObservation + user correction` 合同，供计划引擎消费。

### P1：Agent Fitness MVP（Android 首个可交付闭环）

目标不是覆盖所有健身场景，而是完成一次真正的计划写入循环：

1. Onboarding：目标（增肌/减脂）、经验、每周天数、时长、设备、地点、动作限制、饮食偏好。
2. 生成 4 周力量计划与 1 周可执行日程；每个动作有 sets/reps/RIR/rest 和替代组。
3. 今日页执行计划；支持现有相机白名单动作，其余动作手工记录。
4. 组后收集实际重量、RIR、疼痛/不适、完成度；相机 findings 只作为一个输入，不直接决定处方。
5. 当天结束生成“下次修改提案”，展示 diff，用户批准后真实写入下一 session。
6. 周检基于完成率、表现趋势、RIR、主观恢复和数据完整性修改下一周计划；数据不足则 hold。
7. 营养先做热量/蛋白/宏量目标与三种分配 preset，不先做庞大食物库；允许手工总量或接入现有可信数据源。

**P1 验收例子**：用户说“周三加班，周四只有哑铃”，Agent 展示把周三训练移到周四、替换不可用器械动作、保持目标肌群周量的 diff；用户确认后，日历与计划页都真实改变，旧版本可恢复。

### P2：日程与恢复自适应

1. Health Connect 接入 Weight、Sleep、Exercise、HR/HRV（按设备可用性）；显示来源和缺失。
2. 增加“20 分钟/无器械/旅行/睡眠差/肌肉酸痛”等 Adapt Session 工具。
3. 支持用户预授权的低风险自动顺延、等价替换和降级 session。
4. 加入训练周量、deload、休训后降载和回归策略。
5. Agent 日内消息仅在有行动价值时触发，避免把每个波动都变成提醒。

### P3：训练与营养联动闭环

1. 使用至少 2–3 周的完整体重和摄入趋势后再校准 expenditure；记录不足就暂停调整。
2. 周检调整热量和宏量，设置变更幅度、蛋白/脂肪/热量安全下限。
3. 支持训练日偏高碳、均匀分配、低碳偏好；保持周预算和目标速度。
4. 日程改变时同步重排训练日与营养日，而不是只改一边。
5. 再扩展餐次、食谱、购物清单或食物拍照；这些是执行便利层，不应先于目标校准闭环。

### P4：更广动作覆盖与真人升级通道

1. 按“动作 × 机位 × 错误类型”扩展经过标注与真机验收的 cue，不用通用 LLM 视觉替代运动模型。
2. 对持续疼痛、异常恢复、复杂病史、饮食风险或长期停滞，提供真人教练/注册营养师/医疗专业人员升级，而不是继续自动调参。
3. iOS 后续复用 Plan/Agent/Policy 合同，但相机和 HealthKit 适配独立实现；Android 先把合同和审计模型稳定下来。

## 健康、安全与证据边界

- 成人一般活动基线可参考政府指南：每周至少 150 分钟中等强度有氧，并至少 2 天肌力训练；初学者应从少量开始逐步增加。[美国 Physical Activity Guidelines](https://odphp.health.gov/our-work/nutrition-physical-activity/physical-activity-guidelines/current-guidelines/top-10-things-know)
- 训练处方应遵循可配置、渐进和个体反应，而不是追求每天加量。2026 ACSM 已发布新的健康成人抗阻训练 Position Stand；产品规则应版本化并由领域人员审阅。[ACSM 官方说明](https://acsm.org/resistance-training-guidelines-update-2026/)、[Position Stand 原文](https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823/)
- 减重目标不应默认追求越快越好。CDC 提醒渐进、稳定的每周约 1–2 磅更易维持；具体个体还需结合体重、病史和专业判断。[CDC](https://www.cdc.gov/healthy-weight-growth/losing-weight/index.html)
- Google Health Coach 自身也明确标注：它提供一般健康信息，不用于诊断、治疗或预防疾病，AI 可能出错，改变健康计划前应咨询专业人员。[Google 官方帮助](https://support.google.com/googlehealth/answer/16961408?hl=en)
- 对未成年人、孕产期、进食障碍风险、糖尿病用药、心血管/肾脏/代谢疾病、近期手术或伤病康复，应进入单独资格与专业审核流程；通用消费级 Agent 不自动生成限制性饮食或高强度计划。
- 用户报告疼痛比相机“动作看起来正确”优先级更高。出现急性症状时，系统应停止而不是用姿态分数鼓励完成。
- 每条建议都要标注它来自：客观记录、设备估计、相机模型、用户主观反馈、规则推导或 LLM 解释。不同来源不能合成一个无来源的“AI 分数”。
- 模型和规则更新要保留版本；计划变更应支持回滚，并监控不同体型、性别、肤色、服装、机位、设备上的失败率。

## 建议的产品北极星与验收指标

不要用聊天次数或 AI 文案满意度作为核心指标。首个闭环应关注：

- **计划落实率**：按计划完成、经批准调整后完成、无故跳过分别统计。
- **有效调整率**：Agent 提案被接受且后续完成；接受后又撤销/再次修改要单列。
- **处方稳定性**：同一输入不应产生大幅来回摆动；记录不足时应 hold。
- **动作反馈准确性**：按动作/机位/cue 的 precision、触发延迟、用户纠错率，而非总体“AI 准确率”。
- **训练进展**：估计强度/负荷趋势、目标 rep/RIR 完成、周量与恢复是否可持续。
- **营养趋势**：记录完整性、目标范围依从、体重趋势是否落在用户批准的速度，而非单日体重。
- **安全指标**：疼痛/异常触发后的停止率、越过下限的提案数应为 0、用户撤销健康权限后的残留读取应为 0。
- **可审计性**：100% 已提交计划变更可回答“改了什么、为什么、用了什么数据、谁批准、如何撤销”。

## 最终建议

产品定位可明确为：**一个能看见训练、管理计划、协调饮食和日程，并在用户授权范围内真正修改后续安排的 Android 健身 Agent。**

第一版的差异化不是动作数量超过 Keep，也不是聊天更像真人，而是把现有实时运动分析与可执行的结构化计划首次连起来：

`观察本组 → 收集主观反馈 → 生成有证据的变更 diff → 用户批准 → 写入下一次训练 → 周检再校准`。

这条链一旦可靠，再扩展饮食、恢复、日历和更多动作；反之，如果计划对象、权限和审计没有先建好，新增“Agent”最后只会成为一层会给建议但不能负责执行的聊天外壳。
