# 跨平台自适应健身 Coach 深挖：从输入到真实计划写回

日期：2026-08-08

产品范围：Google Health Coach、Fitbod、Freeletics、RP Hypertrophy、WHOOP Coach。

平台范围：普通移动客户端（iOS / Android）；不以 Android 为唯一交付前提。

证据口径：只采用产品官方帮助中心、官方产品页和官方博客。产品方公开说明可以证明功能被文档化，但不等同于独立效果验证，也不能证明未公开的算法、代码架构或准确率。

## 结论先行

1. **Google Health Coach 是这组产品里唯一有充分官方证据证明“自然语言 → 修改结构化周计划/单次训练 → 持久化到 Fitness 页”的产品。** 用户既可以通过 Coach 请求调整，也能手工修改动作、组、次数、重量与时长；后续计划、今日训练和执行记录处于同一 App 内。这是真正的计划 Agent，而不只是聊天建议。[Google Health Coach 官方帮助](https://support.google.com/googlehealth/answer/16961408?hl=en)
2. **Fitbod、Freeletics、RP Hypertrophy 都会真正改变后续处方，主要靠有界规则和结构化反馈。** Fitbod 更像“下一次力量训练生成器”，Freeletics 更像“训练 Journey + 当天重生成”，RP 更像“增肌周期内重量/次数/组数调节器”。Freeletics 另有可对话的 Coach+，但官方没有证明对话层能调用 Journey 的写入能力；“能聊天”和“能改计划”仍是两个系统边界。
3. **WHOOP Coach 是高质量的“解释与目标层”，不是已证明的训练计划执行层。** 它可以主动推送 Daily Outlook、动态更新 Strain/Sleep/Recovery 目标、解释训练、记住生活背景，还能通过 AI 增删 Journal behavior；但官方同时明确建议配合专业训练计划使用，未证明它会把建议写成一套未来的动作、组、次数和负荷计划。[WHOOP Coach 官方帮助](https://support.whoop.com/s/article/How-to-Use-the-AI-Powered-WHOOP-Coach)
4. **“iOS 和 Android 都有 App”不等于“完全一致”，更不能证明“由同一套代码编译”。** 官方资料只能验证用户可见功能。Google 与 WHOOP 没有披露客户端代码架构；Fitbod 已有明确的平台功能差异；RP Hypertrophy 当前更不是标准的 iOS/Android 双原生形态——美国 iOS 有 App Store 版本，其余用户主要使用浏览器 Web App/PWA。
5. 对本项目最有价值的组合不是复制某一个产品，而是：**Google 的对话写回与计划页 + Fitbod 的历史/RiR/恢复输入 + Freeletics 的临时约束重生成 + RP 的增肌训练量规则 + WHOOP 的全天主动消息和上下文记忆。**

## 证据强度标记

本文对每个判断使用三种口径：

- **官方明确**：帮助中心或产品文档直接描述了输入、行为或结果。
- **合理推断**：可由多个官方行为拼出，但产品没有公开完整数据流或算法细节。
- **未披露/未证明**：未找到官方证据；不能据此断言产品绝对没有，只能说明不能用于产品对标承诺。

## 总览：输入如何变成后续结果

| 产品 | 输入 | 中间状态 / 已公开规则 | 输出 | 用户确认或覆盖 | 持久影响 |
| --- | --- | --- | --- | --- | --- |
| **Google Health Coach** | 目标、障碍、日程变化、设备、训练史、睡眠/HR/体重等健康数据、第三方数据、手工记录、对话/上传内容 | Gemini + Google Health 中的指标、目标、历史、计划与会话记忆；具体处方公式未披露 | 周目标、推荐 workouts、动作/组/次/重量/时长、营养与恢复建议、全天消息 | 可对话请求变更；Fitness 页 `Make changes`；单次 workout 页 `Adjust`；也能逐项手改 | **是**：计划和 workout 真正变更并持续显示；可 leave plan / regenerate plan |
| **Fitbod** | 目标、经验、器械、split、时长、历史 sets/reps/load、RiR、手工增减重量/次数、肌肉恢复、休训、部分外部活动 | 肌肉恢复 0–100%、Estimated Strength/1RM、mStrength 的强度与容量变化；持续高 RiR 可提高重量或次数 | 下一次动作、组、次数、重量、肌群选择；当天按时长/器械重生成 | 用户可手改动作/顺序/组次重量、RiR、恢复百分比；Swap/Session Mods | **是**：日志、RiR 与手工表现会影响未来建议；My Plan 设置影响以后训练 |
| **Freeletics** | onboarding 的目标/训练日/器械/跑步偏好；每次 session 的表现/反馈；每组重量反馈；当天时间、器械、空间、噪声、肌肉酸痛、难度；Coach+ 对话及匿名化年龄/性别/体重/训练目标 | Journey、运动员档案、历史表现；Coach+ 是独立的 OpenAI 驱动回答层；具体模型未披露；超过一月休训时提供较轻恢复选项 | 后续 session；当天更短/无器械/安静/替代/更易或更难 session；重量训练下一组可降重；Coach+ 给训练/营养/健康回答 | 用户提交反馈或主动点 `Adapt session` → `Create new session`；可手改建议重量；Coach+ 可聊天但未证明能提交 Journey mutation | **是（规则层）**：每次训练后更新后续 session；当天生成新的持久 session。**未证明（对话层）**：Coach+ 回答会写回 Training Journey |
| **RP Hypertrophy** | 每次训练的 pump、soreness、workload perception；实际 reps/load；目标 RIR；周期长度和肌群优先级 | 重量通常每周小百分比递增；器械档位过大时改为每组加 1 rep；三类反馈决定未来 sets；周期末固定 deload | 后续重量、次数、组数、训练量；最后一周降低量/强度并可能移除小肌群 | 用户可手动改重量、加/删 sets、改周期长度 | **是**：每个未来 session 都受历史反馈影响；deload 随周期长度移动 |
| **WHOOP Coach** | 连续 HR/HRV/RHR、睡眠/睡债、Recovery、Strain、Stress、Journal、活动、GPS/天气、对话目标与 My Memory | Recovery、Optimal Strain、Sleep Need、Journal behavior correlation、My Memory；生成式解释层使用这些状态 | Daily Outlook、Strain/Sleep/Recovery target、训练时间/强度/水分/恢复建议、Activity Insights、Day in Review | 用户可聊天、分享主观感受、commit activity、编辑 Memory；Journal 需持续手工 Yes/No | **有限**：targets 动态更新，commit activity 显示在 Overview，Memory/Journal 可写；**未证明会修改结构化训练计划** |

## 1. Google Health Coach：目前最完整的计划执行 Agent

### 用户实际怎么用

官方文档给出的完整体验路径是：

1. 在 Google Health App 中启用 Coach，完成一段关于目标、挑战、障碍和偏好的 onboarding 对话。
2. Coach 生成个性化计划。用户到 `Fitness` 页看到本周 weekly targets 与一组 recommended workouts。
3. 用户可从 `Ask Coach` 或 `Fitness → Make changes` 用自然语言改整个计划，例如旅行、本周日程变化、跑步机被占用、想让训练更长/更轻松。
4. 用户也可进入某个 workout，点 `Adjust`，或直接手动修改 reps、sets、weights、duration，添加、排序或删除动作。
5. 执行 workout 时，App 显示 warm-up、core、upper body、cool-down 等结构化 segment，用户逐项勾选并记录 reps/weights。
6. 完成后可以把活动历史中的实际记录链接到计划 workout；Coach 随后给表现分析，并在晚间总结其对计划进度的影响。

这条路径的关键不是 Coach 能说出“建议跑步”，而是请求会落到可见、可编辑、可执行的计划对象。官方还给出“Replace today’s upper-body workout with a 4-mile run”、旅行期间调整计划、让某次训练更长或更容易等例子。[开始使用 Google Health Coach](https://support.google.com/googlehealth/answer/16961408?hl=en)

### 它读什么数据

**官方明确**，Coach 可使用：

- 活动与运动：步数、距离、消耗、weekly cardio load、心率、运动历史详情；
- 睡眠：时长、时刻表、睡眠阶段；
- 身体与健康指标：体重、体脂、HRV、呼吸率、皮肤温度、SpO₂、周期相关信息；
- 账户/profile：姓名、年龄、身高、体重、性别；
- 手工输入、目标、聊天和语音、上传的训练计划/菜单/记录/照片/文件；
- Fitbit/Pixel Watch 与连接的第三方 App 数据；
- 授权后的位置与天气，用于环境相关建议。

启用 Coach 后，它可访问账户关联的健康与活动数据；某些医疗记录或特定传感器数据仍需单独同意。Coach 会自动保存用户在对话中分享的信息，用于后续个性化；用户可以删除会话、关闭通知、撤销位置和其他数据访问。[数据与个性化说明](https://support.google.com/googlehealth/answer/17055092?hl=en-GB)

### 训练、营养、恢复与主动消息的真实边界

| 领域 | 官方明确能力 | 边界 |
| --- | --- | --- |
| 训练计划 | 创建周计划、weekly targets、推荐 workouts；对话或手工改计划/单次 workout；记录和链接实际完成 | 未公开 progression、训练量和安全规则；“由 Gemini 建计划”不等于处方算法已被公开验证 |
| 单次训练 | 生成结构化 workout；可立即 play/save；改动作、组、次、重量、时长 | 没有手机相机实时姿态纠错证据 |
| 营养 | 文本/照片/文件记录食物；个性化 calorie/macro targets；可讨论 meal plan | 公开文档没有证明像 MacroFactor 那样按体重趋势自动执行周度热量校准；新版帮助还说明 recipes 已移除 |
| 恢复 | 用睡眠、readiness、HR/HRV 等生成早间状态和建议 | 一般 wellness，不是医疗建议；疼痛时官方要求不要依赖 Coach 判断动作安全 |
| 主动触达 | 早晨睡眠/readiness、训练后分析、晚间日结与计划进度 | 可关闭 push；触发策略、频率上限和准确率未披露 |

### 写回与确认机制

- **对话写回**：用户提出修改，结果进入 Fitness 页的 plan/workout。
- **显式 UI 写回**：`Make changes`、`Adjust` 和手工动作编辑。
- **持久化结果**：计划会保留在 Fitness 页；若丢失可在设置中 `Regenerate weekly plan`，最多等待约 10 分钟；用户可在 plan details 底部 `Leave plan`。
- **未披露**：每种自然语言改动是否总有 diff 预览、是否有自动 commit/二次确认、版本历史和一键 rollback。不能把“能调整”扩张成“已经具备企业级审计与撤销”。

### iOS / Android、设备、订阅与地区

- Google Health App 支持 **Android 11+** 与 **iOS 16.4+**。[安装要求](https://support.google.com/product-documentation/answer/14226283?hl=en)
- Android 通过 Health Connect，iOS 通过 Apple Health 接第三方数据；官方列举 Apple Watch、Garmin、Samsung、WHOOP、Oura、Strava、MyFitnessPal 等来源，但第三方不一定分享所有指标，且 Google 明确说部分指标仍只使用第一方数据。[第三方连接](https://support.google.com/googlehealth/answer/14236613?hl=en)
- 当前官方帮助要求：18 岁以上、至少配对一个 Fitbit 或 Pixel Watch、Google Health Premium、位于 eligible country。Google Health Premium 也可包含在 Google AI Pro / Ultra 中，但仍要求 Fitbit/Pixel Watch。[Premium 与国家列表](https://support.google.com/googlehealth/answer/14237941?hl=en)
- 当前列出的 37 个国家/地区包括美国、英国、加拿大、澳大利亚、新西兰、新加坡、印度、日本、韩国、台湾，以及多国欧洲和拉美/东南亚市场；**不包括中国大陆**。
- 2026-04 的 Public Preview 博客曾写 iOS/Android 的 free 与 Premium 用户逐步获得预览；2026-08 当前帮助则把计划调整和 Premium coaching 明确标为 Premium，并要求设备。应以当前帮助的运行条件为准，历史博客只能解释产品演进，不能证明免费层今天仍有完整计划能力。[Public Preview 历史公告](https://blog.google/products-and-platforms/devices/fitbit/fitbit-personal-health-coach-expansion/)
- **最重要的设备边界**：Coach workouts 只在手机 Google Health App 中；目前不会同步到或显示在手表/追踪器上。即使 Pixel Watch/Fitbit 是资格门槛，它也不是计划执行屏。[官方说明](https://support.google.com/googlehealth/answer/14236613?hl=en)
- 官方未披露 iOS/Android 是否同一跨平台代码库；只能说核心 Coach 体验在两端都有，健康数据适配层不同。

### 对本项目最值得复制的部分

不是聊天界面本身，而是四个产品合同：`plan` 是可持久化对象；自然语言只能调用受限 plan mutation；用户有结构化手工编辑通道；实际活动可以关联到 planned workout。还应补上 Google 官方未证明的 diff、审批、审计和 rollback。

## 2. Fitbod：从训练史、RiR 和恢复生成下一次处方

### 用户实际怎么用

1. `My Plan` 保存长期目标、经验/难度、器械、training split、exercise variability、warm-up/cool-down 等设置。
2. `Workout` 页生成当天 session。用户可以点 `Swap` 换 split、肌群、saved workout 或从零创建；也能在 `Training Session Mods` 把时长改为 15–90 分钟，或切换今日器械。
3. 训练中用户按实际 sets/reps/load 记录；每个力量动作全部 sets 完成后填一次 RiR，superset/circuit 则在整组结束后提示。
4. 训练后，历史表现、RiR、恢复估计与用户手工改动进入后续推荐。

这不是自然语言 Coach，也不是严格的“先展示完整周日历再执行”。公开资料更支持把它理解为：持久化 My Plan 约束下，持续生成/调整下一次 workout。

### 输入 → 规则 → 输出

**官方明确输入**包括目标、训练经验、可用器械、split、时长、偏好、历史重量/次数/组数、RiR、用户跳过/替换/删除/添加的动作、肌肉恢复，以及 Apple Health/Health Connect 导入的部分活动。[Fitbod 如何创建训练](https://help.fitbod.me/hc/en-us/articles/360004429814-How-Fitbod-Creates-Your-Workout)

**官方明确规则/状态**包括：

- 每个肌群维护 0–100% recovery；训练历史、强度和外部活动会改变恢复估计，较新鲜肌群会被优先；
- Estimated Strength / theoretical 1RM 和周期性的 Max Effort Day 用于更新能力估计；
- mStrength 会让不同 workout 在高次数低重量与低次数高重量之间变化；
- 持续报告高 RiR，系统可能提高未来重量或次数；完成困难或用户主动降重会影响后续建议；
- 较长休训会降低建议负荷；新用户没有历史时，使用总体训练数据估计保守起点。

**输出**是下一 workout 的动作、肌群、sets、reps、load 与强度/容量变化。具体数学公式、最大单次增幅、反馈权重和最低数据量未公开。

### 用户反馈成本与写回边界

- RiR 不是每组必填，而是一个动作做完后按最高努力 set 或最后一组给出；用户也可以事后编辑。
- 用户可直接改 sets/reps/load、增删/替换/排序动作；这些实际日志和调整会用于未来推荐。
- 当天时长变化会自动缩放动作数量；换器械会重生成今日训练；My Plan 变化影响未来 workouts。[Customizing Today's Workout](https://help.fitbod.me/hc/en-us/articles/38318585683991-Customizing-Today-s-Workout)
- **算法限制被官方明确公开**：superset/circuit 的 RiR 被当成“该动作在新鲜状态下完成”，不会回溯扣除前置动作造成的疲劳；算法更看重近期最强表现。[RiR 说明](https://help.fitbod.me/hc/en-us/articles/360033133174-Reps-in-Reserve-RiR-Formerly-Exertion-Rating-RPE)
- 自定义动作能影响用户手工分配的肌肉恢复，但不会进入 Fitbod 的未来动作推荐；这是“可记录”与“可驱动 Agent”不同的典型边界。[动作定制帮助](https://help.fitbod.me/hc/en-us/sections/31812780318743-Exercise-Workout-Customization)

### iOS / Android 差异

- 核心 Fitbod 订阅可在 iOS、Android 和网页购买，官方称购买渠道不改变订阅访问能力。[订阅渠道](https://help.fitbod.me/hc/en-us/articles/360009643814-What-s-the-difference-between-subscribing-through-the-app-vs-the-Fitbod-website)
- 但功能并非完全相同：**On-Demand Workouts 仅 iOS；从照片/截图 Import Workout 仅 Android**。
- iOS 使用 Apple Health，Android 使用 Health Connect。只有兼容的导入活动才会影响恢复/后续推荐；例如 Apple Health 官方列表外的运动不会影响下一次 workout，需要用户手工调整 recovery。[Fitbod Integrations](https://help.fitbod.me/hc/en-us/sections/35305345636375-Integrations)
- Apple Watch 有 RiR 提示；官方资料不能证明 Wear OS 达到同样反馈体验。
- 官方没有披露 iOS/Android 是否由同一套代码编译。产品功能差异本身已经说明不能把“双端可用”写成“双端完全一致”。

### 能力边界

Fitbod 能真实修改未来推荐，属于处方闭环；但没有自然语言日程 Agent、完整营养方案、相机动作反馈或公开的疼痛/医学决策能力。它最适合被借鉴为 training engine，而不是 Agent UI。

## 3. Freeletics：Journey 自适应与当天约束重生成

### 用户实际怎么用

1. onboarding 选择目标、Training Journey、训练日、器械和跑步偏好；Coach 在 `Coach` tab 安排当前 session。
2. 用户完成训练并给表现/技术反馈，Coach 在生成下一 session 前读取它。
3. 日程临时变化时，用户在当前 Coach session 底部点 `Adapt session`，选择时间少、无器械、无空间、不能跑、需要安静、换一套、排除最多两个身体区域、或变更难度，再点 `Create new session`。
4. weights session 中，每一组后的休息期可以反馈；若无法完成次数，可让下一组降重。用户也可在 warm-up 前直接手改建议重量。

除此之外，Freeletics 还有一个独立的自然语言界面 **Coach+**：早期官方产品介绍给出的路径是 `Coach tab → Coach+ icon → tap to chat`，可回答运动技术、表现提升、训练调整、营养、伤病和一般 wellness 问题，也可定制语气与获得激励/提醒。该介绍当时把它标为逐步开放、English-only pilot；当前隐私政策已经给出正在使用 Coach+ 时的数据处理规则，但没有公布当前完整地区、订阅档位或用户覆盖率。[Coach+ 官方介绍](https://www.freeletics.com/en/blog/posts/freeletics-coach-plus/)

### 输入与真实调整

- **长期输入**：目标、训练 modality、训练日、器械、跑步偏好、athlete profile、历史 performance 和每次 workout feedback。
- **即时输入**：最大可用时间、器械/空间/噪声、跑步可行性、肌肉 soreness、期望难度。
- **输出**：下一 session 的强度、动作和工作量；当天可重生成更短、无器械、不同焦点或不同难度的 session。
- **组内写回**：未完成 reps 可以降低下一 set 的 weight；通过反馈不能在当次训练中加重，只能手工编辑。[Freeletics Weights Journeys](https://help.freeletics.com/hc/en-us/articles/360001995859-Freeletics-Weights-Journeys)
- **后续写回**：官方明确说 Coach 会在每次 session 后根据 performance/feedback 调整 plan，并在生成下一 session 前应用这些反馈。[开始使用 Freeletics](https://help.freeletics.com/hc/en-us/articles/115004675229-Get-started-with-Freeletics-Training)
- 超过一个月未训练，系统会提供以更容易 session 继续或按原 session 继续的选择；不是静默大幅降级。[休训后的调整](https://help.freeletics.com/hc/en-us/articles/360011919479-Can-I-reset-my-Training-Coach)

### Coach+：对话层的输入、隐私与权限边界

Freeletics 当前隐私政策明确：

- Coach+ 使用 OpenAI Ireland Ltd. 提供的第三方 LLM 技术，由 Freeletics 实现；Freeletics 称训练 Coach+ 时只使用聚合或去标识化 fitness 数据和自有数据。
- 用户问题会发送到 OpenAI 接口；回答会参考当前对话、Freeletics 科学知识，以及匿名化的 **年龄、性别、体重、训练目标**。
- Freeletics 称其与 LLM 合作方约定对查询和 Freeletics metrics 执行 zero-retention / zero-training；但同时说明 **Freeletics 自己会保留对话历史用于评估和改进 Coach+**，而聊天历史不会保存在用户可见的 conversation thread。两句话针对不同数据持有者，不能简化成“聊天完全不留存”。
- 首次使用前要同意处理和传输问题/回答；若用户在对话中主动分享健康数据，也是在同意相应处理。用户可在 App profile 的 `Privacy` 中撤回同意并删除 Coach+ 数据。[Freeletics 隐私政策](https://www.freeletics.com/en/pages/Privacy/)

**权限边界：**官方证明 Coach+ 会结合对话上下文和少量匿名化 profile metrics 生成回答，但没有证明它能调用 `Adapt session`、改变动作/组次/重量、移动 Journey session 或写入下一 Coach week。因此本报告把它判为独立的 L1/L2 对话/建议层；真正的 L3 计划写回仍来自传统 Training Coach 的结构化 feedback、Adapt session 和 workout 编辑。用户在 Coach+ 里问“我今天只有 20 分钟”是否会直接产生新 session，现有官方证据不足。

### 反馈成本、确认与限制

- 当天重生成是**反应式**且需要用户明确选择条件、点击创建；并非 Agent 自动读取日历后悄悄改动。
- weights 每组都可给反馈，手工负担高于 Fitbod 的动作结束 RiR；post-session 反馈还会继续影响未来。
- Bodyweight Adapt 的选项最多；weights/running/hybrid 选项更少，Hardcore Journey 还有额外限制。[Bodyweight Adapt](https://help.freeletics.com/hc/en-us/articles/360003933780-Adapt-your-Bodyweight-training-session)
- 传统 **Training Coach** 的官方帮助仍把它描述为数字计划算法，不是可以对话的真人；**Coach+ 则是另行提供的聊天层**。两者并存并不构成矛盾。用户可以向 Coach+ 提问，但官方没有证明能像 Google Health Coach 一样用自由语言把“周五训练移到周日”直接写回 Journey。[传统 Training Coach 说明](https://help.freeletics.com/hc/en-us/articles/360004957019-Can-I-talk-to-the-Coach)、[Coach+](https://www.freeletics.com/en/blog/posts/freeletics-coach-plus/)
- “排除身体部位”不应被用于疑似拉伤、关节痛或伤病，官方建议必要时看医生；不能把它包装为伤病康复 Agent。

### iOS / Android 与数据边界

- Training Coach 是订阅功能，iOS/Android App Store 都可购买；免费层只提供部分 workouts/exercises/runs。[订阅](https://help.freeletics.com/hc/en-us/articles/360020109819-Purchase-a-Coach-subscription)、[免费与 Coach](https://help.freeletics.com/hc/en-us/articles/360004928220-Is-the-app-free)
- iOS 通过 Apple Health，Android 通过 Health Connect；第三方活动可以导入并集中显示。[第三方运动同步](https://help.freeletics.com/hc/en-us/articles/15550274001554-Sync-workout-data-from-other-apps)
- **未证明**：导入第三方活动会改变 Coach 的下一次处方。官方只说“see them all in one place”，不能把显示同步扩张成算法输入。
- 没有找到核心 Training Coach 或 Coach+ 在 iOS/Android 上不同的官方说明，但这只能支持“核心 App 路径面向移动端”，不能证明 Coach+ 对所有地区/档位开放，也不能证明同一代码库、像素级一致或功能百分百相同。

## 4. RP Hypertrophy：把主观肌肉反馈写进未来训练量

### 用户实际怎么用

用户先建立一个 hypertrophy mesocycle，选择训练天数、周期长度、肌群优先级、动作、初始重量和目标 RIR。每次训练按照处方完成 reps/load，并对 pump、soreness、workload perception 给反馈；系统持续更新未来重量、次数和 sets。用户始终可以改重量、加/删 sets 或改变周期长度。

RP 的“AI”更准确地说是专家系统。它没有聊天、没有全天主动消息，也没有穿戴设备恢复分数；优势是公开了比其他产品更具体的增肌调节规则。

### 已公开的具体规则

**重量与次数：**

- 每周倾向把重量提高几个百分点；
- 若器械下一档过大，例如哑铃 10 lb 到 15 lb 超过所需增幅，则改为每个 set 增加 1 rep；
- 用户偏离目标 RIR 时，系统会调整后续 load 和 rep range；目标 RIR 是每组还剩多少次力竭余量，而不是固定每组必须做相同 reps。

**sets / volume：**

- pump 不明显 + 几乎不酸 + workload 很容易 → 通常增加 sets；
- pump 很好 + soreness 恰好在下次训练前恢复 + workload 接近能力边缘 → 通常保持；
- pump 极强 + 下次训练前仍未恢复 + workload 难以承受 → 降低未来 volume。

官方明确说这些计算持续进行，“每个未来 session”都会受到过去反馈影响。[重量、次数和组数规则](https://help.rpstrength.com/hc/en-us/articles/32600173777815-How-does-the-app-determine-when-to-add-weight-reps-and-sets)

**deload：**

- mesocycle 最后一周自动是 deload；周期从 5 周改成 6 周时，deload 随之移动；
- deload 会降低 volume、intensity，目标 RIR 也更保守，并可能自动移除 traps/forearms 等小肌群；
- 用户可以加一周延后，但官方提示通常不建议无限延长积累期。[自动 deload](https://help.rpstrength.com/hc/en-us/articles/33510413024279-Does-the-app-automatically-place-deloads)、[deload 细节](https://help.rpstrength.com/hc/en-us/articles/31639551676439-Why-did-my-training-get-so-much-easier-deload)

### 反馈、覆盖与边界

- 反馈频率是每次 workout；具体 UI 量表、权重和异常值处理未公开。
- 处方会自动写入未来 session，不要求用户逐次批准每个小增量；但用户可以手工更改 weight、sets。[用户覆盖](https://help.rpstrength.com/hc/en-us/articles/32434237175447-Shouldn-t-I-be-doing-more-sets-or-weight)
- 目标是 hypertrophy；力量增长是次要结果。不能把它当成通用跑步、减脂、恢复或饮食 Agent。[适用人群](https://help.rpstrength.com/hc/en-us/articles/33510008280087-Who-is-the-RP-Hypertrophy-App-for)
- 未找到官方证据证明它读取 wearable recovery、日历、睡眠、心率、相机姿态或营养数据。主观反馈非常有价值，但也依赖用户理解 pump/soreness/RIR 并持续如实填写。

### iOS / Android 的关键事实

- 2025-12-20 起，美国 iOS 用户可以从 App Store 下载 RP Hypertrophy 1.0.0。[官方更新](https://help.rpstrength.com/hc/en-us/articles/34725726510999-RP-Hypertrophy-App-What-s-new)
- 官方当前说明：其他用户主要打开 Web App，并在 Safari/Chrome 里 `Add to Home Screen`；任何能运行浏览器的设备都可用。[下载与登录](https://help.rpstrength.com/hc/en-us/articles/33257801884311-How-do-I-sign-in-and-download-the-app)
- 因此不能称其为“iOS 与 Android 同一套代码编译出的双原生项目”。更准确的判断是：**美国 iOS 商店 App + 广泛可用的 Web App/PWA**；Android 原生/Play Store Hypertrophy App 在本次官方资料中没有得到证明。

## 5. WHOOP Coach：恢复解释与全天主动指导，不是计划编辑器

### 用户实际怎么用

WHOOP 把 Coach 嵌在整个 App，而不只放一个聊天页：

- 早晨打开 App 看 **Daily Outlook**：推荐的 strain、活动、训练窗口、天气条件与能量预测；用户可 commit 一个 activity，使其出现在 Overview，并在完成时获得 Kudos。
- 训练完成并处理后，在 **Activity Details → Coach icon** 看 Activity Insights，解释 Strain、心率区间、stress 与生理模式，并可追问或补充“训练感觉如何”和目标。
- 晚间看到 **Day in Review**：当天总结、行为提示与推荐 bedtime range。
- Overview 的 Coach text box 支持自由提问，例如“今天应该练多重”；回答会基于 Recovery 和训练史给 Strain Target。
- Profile 中的 **My Memory** 可查看、添加、编辑、删除或彻底关闭 Goals、Identity、Lifestyle、Preferences、Events、Health History、Mood 等长期上下文。

这套体验同时包含主动和反应式两类触发，但绝大多数输出是 target、insight、nudge 和解释。

### 输入 → 中间状态 → 输出

| 输入 | 中间状态 / 规则 | 输出 |
| --- | --- | --- |
| HRV、RHR、呼吸率、睡眠时长/质量、皮温、SpO₂、周期阶段等 | Recovery 1–100%，红 1–33、黄 34–66、绿 67–100；具体权重只部分公开 | readiness/恢复解释、当天强度建议 |
| 今日已积累 Strain、Recovery、Sleep、周期阶段 | Optimal Strain / Strain Target，全天动态更新 | 今天应达到的目标 exertion，而不是具体杠铃动作处方 |
| Sleep Need、sleep debt、近期作息 | Sleep target、推荐 bedtime range、Sleep Planner | 睡眠时间建议；用户可设置基于目标的 haptic alarm |
| 活动的 Strain、HR zones、stress、physiological pattern | Activity Insights 生成式解释 | 训练后分析和下次改善建议 |
| Journal 的饮酒、补剂、晚餐、冥想等行为 | 至少 90 天内 5 次 Yes + 5 次 No 才能解锁某行为 Recovery Impact；建议持续约 30 天看长期趋势；每日刷新 | 行为与 Recovery 的相关影响，不证明因果 |
| Stress Monitor、Journal、旅行、伤病、目标、偏好、天气 | Daily Outlook + My Memory + 对话上下文 | 训练时间、水分、恢复、活动类型/强度建议和主动提示 |

Recovery、Sleep、Strain 的基础指标来自 WHOOP 穿戴设备；Stress Monitor 仅 Peak/Life 层可用。Journal 相关分析使用 machine learning 与生物指标做模式识别，但官方也明确：高度重叠的行为无法区分是哪一个产生影响。[Recovery Impacts](https://support.whoop.com/s/article/Recovery-Insights)、[WHOOP Journal](https://support.whoop.com/s/article/WHOOP-Journal-Overview?language=en_US)

### 真正能写回什么，不能写回什么

**官方明确可以持久化：**

- Dynamic Strain/Sleep/Recovery targets 会随最新数据更新；
- 用户 commit 的 activity 会显示在 Overview；
- My Memory 的上下文可保存、编辑、删除或关闭；
- 用户可以让 WHOOP AI 增加/移除 Journal behavior，Journal 日志持续保存并用于行为关联；
- 用户设定的 Sleep Planner / haptic alarm 是实际设备设置。

**官方没有证明：**

- 根据 Recovery 自动改写一个有动作、sets、reps、load 的周训练计划；
- 将“今天降低强度”自动提交到 Strength Trainer 或外部日历；
- 自动移动明天/后天的 session，或做周期 progression/deload；
- 生成式建议具有医疗诊断能力。

官方甚至明确回答 WHOOP **不能替代 personal coach**，应将 insights 与专业训练计划配合使用。其“upload a Strength Trainer workout with WHOOP Coach”仍标为 **will soon be able to**，不能计入当前能力。[WHOOP Coach](https://support.whoop.com/s/article/How-to-Use-the-AI-Powered-WHOOP-Coach)

### 反馈成本、数据充分性与营销边界

- 传感器数据主要被动采集，日常负担低；但 Journal 需要持续 Yes/No 记录，至少 5 Yes + 5 No/90 天才产生某行为 impact，且共线行为会阻止归因。
- 主观训练感受和生活事件可通过聊天/My Memory 提供，但没有公开的结构化 RIR/pump/soreness → sets/load 规则。
- Daily Outlook、天气提醒、Day in Review 是主动消息；Activity Insights 和 Coach 对话是反应式。
- WHOOP 的 “real-time coaching” 主要指数据/目标和在当下给建议，不应被解读成实时视觉动作纠正或自动改计划。
- Journal 的 behavior impact 是相关模式，不应宣传成“某个习惯导致 Recovery 上升 X%”。

### iOS / Android、设备和订阅

- WHOOP App 支持 iOS 与 Android；当前帮助要求 iOS 16 以上才能运行，建议 iOS 17+；WHOOP 5.0 推荐 Android 11+，并要求 Google Play Store 支持。[移动端要求](https://support.whoop.com/s/article/WHOOP-App-Minimum-Software-Requirements?language=en_US)
- AI-powered personalized coaching 在 WHOOP One、Peak、Life 三档都有；One 包含基础 Sleep/Strain/Recovery、AI Coach、Journal/Behavior Impact、Strength Trainer；Stress Monitor 和 Health Monitor 只在 Peak/Life；Life 再加医疗监管能力。[会员功能](https://support.whoop.com/s/article/Membership-Pricing)
- 必须有 WHOOP 设备和有效会员，硬件/订阅而非手机本身是数据充分性的主要门槛。部分医疗功能按地区受限；AI Coach 的官方页面没有给出独立国家白名单。
- 官方没有记录 iOS/Android 的 Coach 功能差异，也没有披露是否同一代码库；只能判断核心 AI Coach 体验面向双端。

## 横向比较：用户感受到的“教练”与 App 实际权限

| 产品 | 用户主观感受 | App 实际最强权限 | 不应误解为 |
| --- | --- | --- | --- |
| Google Health Coach | “我能跟教练聊，教练真的改了这周” | 创建/编辑 plan、targets、workouts；手工和对话双通道 | 医疗/伤病判断；手表端计划；公开透明的训练科学引擎 |
| Fitbod | “它知道我上次练得怎么样，下一次会变” | 生成未来动作/组次/负荷，读取 RiR/恢复/历史 | 日历 Agent、饮食 Coach、实时姿态纠错 |
| Freeletics | “今天条件变了，我能马上换一套；Coach+ 还能回答问题” | 结构化 Training Coach 重生成 session/调整 Journey；Coach+ 生成对话建议 | Coach+ 对话可自动写回 Journey；自动读取日历并静默改动；第三方运动必然影响算法 |
| RP Hypertrophy | “每次 pump/酸痛/吃力都会改后续训练量” | 周期内持续调整 weight/reps/sets 和 deload | 通用健身 Agent、传感器恢复系统、双端原生 App |
| WHOOP Coach | “它理解我的身体状态并主动提醒” | 动态 targets、解释、Memory/Journal、commit activity、提醒 | 已经改写结构化训练计划；动作/组/重量 progression 引擎 |

## 对普通 iOS / Android 客户端的产品建议

### 1. 把能力拆成三个可独立验收的闭环

| 闭环 | 输入 | 输出对象 | 参考产品 |
| --- | --- | --- | --- |
| 计划闭环 | 目标、日程、器械、经验、训练史 | `PlanVersion`、`PlannedSession`、`ExercisePrescription` | Google、Freeletics |
| 训练表现闭环 | 完成组次重量、RIR、动作质量、pump/soreness/workload、恢复 | 下一组或未来 session 的 load/reps/sets/volume | Fitbod、RP |
| 全天教练闭环 | 睡眠/HRV/HR、天气、日程、行为、主动消息偏好 | morning outlook、post-workout analysis、evening review、变更提案 | WHOOP、Google |

LLM 负责理解“这周出差，只有两次 30 分钟”，但真正的动作替换、周量、progression、deload 和营养下限应由可测试规则引擎产生。LLM 不应直接覆盖整张计划表。

### 2. 明确“建议”与“已改计划”

每条 Agent 输出必须属于一种状态：

- `INSIGHT`：只解释，不改变任何计划；
- `RECOMMENDATION`：给建议，但需要用户自己处理；
- `MUTATION_PROPOSAL`：展示 before/after diff、原因、数据新鲜度和风险；
- `COMMITTED_CHANGE`：已写入新 PlanVersion，带 mutation ID、撤销入口；
- `HELD`：数据不足、存在疼痛/医学风险或权限不足，暂不调整。

WHOOP 最大的边界问题正是用户可能把 insight 当作 plan change；Google 最大的待补能力是官方未证明完整 diff/rollback。本项目应把这两点同时解决。

### 3. 用户反馈应该分层，不能每次都填长问卷

- 每组自动记录：reps、load、动作质量/置信度；只在异常或关键 progression 时追问。
- 每个动作结束：一次 RiR，沿用 Fitbod 的低负担模式。
- 每个目标肌群/session 结束：pump、soreness 预期、workload，沿用 RP 的训练量变量，但只问当日相关肌群。
- 第二天/下次同肌群训练前：soreness 是否按时消退，比训练后立刻问“未来会不会酸”更可靠。
- 临时变化：快捷选项优先——只有 20 分钟、没器械、出差、睡眠差、某部位不适；必要时再进入对话。
- 用户若长期不反馈，系统应降低自适应幅度并明确提示数据不足，而不是假装精确。

### 4. 跨平台不要求同一 UI 实现，但要求同一领域行为

建议把双端一致性定义为可测试合同，而不是“同一套代码”：

- 同一 `PlanVersion`、exercise ID、mutation policy、progression rule 和 audit event；
- 相同输入产生相同候选处方与安全校验结果；
- Android Health Connect、iOS HealthKit 只做平台 adapter；来源、权限、缺失和时区语义统一；
- 相机、通知、后台任务、穿戴设备 UI 可以平台化实现，但不能改变计划事实；
- 每项功能维护 parity matrix：核心能力、平台专属能力、降级路径和未支持项。

Fitbod 已证明即使核心订阅相同，双端仍会有 On-Demand/Import Workout 等差异；RP 则证明“可在手机使用”甚至不代表有双原生 App。对本项目，真正要验收的是领域结果一致，而不是从仓库目录结构推断用户体验一致。

## 建议的 MVP / 后续顺序

1. **MVP-1：Google 式计划对象与有界写回。** 建立周计划、今日 session、手工编辑、Agent mutation proposal、确认、commit、撤销；双端共享领域模型。
2. **MVP-2：Fitbod/RP 式训练自适应。** 先只支持已验证动作，输入实际 sets/reps/load、RiR、动作质量、soreness；输出下一 session 小幅 progression/hold/regression。
3. **MVP-3：Freeletics 式日程突发调整。** 时间/器械/场地/旅行/恢复变化可生成 session diff；允许用户预授权同肌群同难度替换和一周内顺延。
4. **MVP-4：WHOOP 式全天教练。** morning、post-workout、evening 三个确定触点；消息只引用可解释数据，且明确它是 insight 还是 mutation proposal。
5. **营养协同后续接入同一 PlanVersion。** 训练日/休息日热量与碳水分配必须是结构化目标；不得仅生成一段“低碳/碳循环建议”。其自适应规则仍应参考 MacroFactor/Carbon/RP Diet，而不是从本报告五个训练产品里强行推导。

## 官方来源索引

### Google

- [Get started with the Google Health Coach](https://support.google.com/googlehealth/answer/16961408?hl=en)
- [Ask your Google Health Coach](https://support.google.com/googlehealth/answer/17053789?hl=en)
- [Manage Coach data & personalization](https://support.google.com/googlehealth/answer/17055092?hl=en-GB)
- [Connect third-party devices and apps](https://support.google.com/googlehealth/answer/14236613?hl=en)
- [Google Health app setup requirements](https://support.google.com/product-documentation/answer/14226283?hl=en)
- [Google Health Premium availability and requirements](https://support.google.com/googlehealth/answer/14237941?hl=en)
- [Historical Public Preview expansion](https://blog.google/products-and-platforms/devices/fitbit/fitbit-personal-health-coach-expansion/)

### Fitbod

- [How Fitbod Creates Your Workout](https://help.fitbod.me/hc/en-us/articles/360004429814-How-Fitbod-Creates-Your-Workout)
- [Reps in Reserve](https://help.fitbod.me/hc/en-us/articles/360033133174-Reps-in-Reserve-RiR-Formerly-Exertion-Rating-RPE)
- [Customizing Today's Workout](https://help.fitbod.me/hc/en-us/articles/38318585683991-Customizing-Today-s-Workout)
- [Muscle Recovery](https://help.fitbod.me/hc/en-us/articles/360006269014-Muscle-Recovery)
- [Integrations](https://help.fitbod.me/hc/en-us/sections/35305345636375-Integrations)

### Freeletics

- [Get started with Freeletics Training](https://help.freeletics.com/hc/en-us/articles/115004675229-Get-started-with-Freeletics-Training)
- [Choose a Training Journey](https://help.freeletics.com/hc/en-us/articles/360001805519-Choose-your-Freeletics-Training-Journey)
- [Adapt Bodyweight session](https://help.freeletics.com/hc/en-us/articles/360003933780-Adapt-your-Bodyweight-training-session)
- [Freeletics Weights Journeys](https://help.freeletics.com/hc/en-us/articles/360001995859-Freeletics-Weights-Journeys)
- [Can I talk to the Coach?](https://help.freeletics.com/hc/en-us/articles/360004957019-Can-I-talk-to-the-Coach)
- [Coach+ product introduction](https://www.freeletics.com/en/blog/posts/freeletics-coach-plus/)
- [Freeletics privacy policy — Coach+](https://www.freeletics.com/en/pages/Privacy/)
- [Sync third-party workouts](https://help.freeletics.com/hc/en-us/articles/15550274001554-Sync-workout-data-from-other-apps)

### RP Hypertrophy

- [Weight, reps and sets adjustment](https://help.rpstrength.com/hc/en-us/articles/32600173777815-How-does-the-app-determine-when-to-add-weight-reps-and-sets)
- [RIR definition](https://help.rpstrength.com/hc/en-us/articles/31147466880791-What-does-RIR-mean)
- [User override](https://help.rpstrength.com/hc/en-us/articles/32434237175447-Shouldn-t-I-be-doing-more-sets-or-weight)
- [Automatic deload](https://help.rpstrength.com/hc/en-us/articles/33510413024279-Does-the-app-automatically-place-deloads)
- [Download and platform access](https://help.rpstrength.com/hc/en-us/articles/33257801884311-How-do-I-sign-in-and-download-the-app)

### WHOOP

- [How to Use the AI-Powered WHOOP Coach](https://support.whoop.com/s/article/How-to-Use-the-AI-Powered-WHOOP-Coach)
- [Recovery Impacts](https://support.whoop.com/s/article/Recovery-Insights)
- [WHOOP Journal Overview](https://support.whoop.com/s/article/WHOOP-Journal-Overview?language=en_US)
- [WHOOP Strain](https://support.whoop.com/s/article/WHOOP-Strain?language=en_US)
- [Strain Target](https://support.whoop.com/s/article/Strain-Coach)
- [My Memory](https://www.whoop.com/us/en/thelocker/my-memory-whoop/)
- [Membership Pricing and features](https://support.whoop.com/s/article/Membership-Pricing)
- [Mobile app requirements](https://support.whoop.com/s/article/WHOOP-App-Minimum-Software-Requirements?language=en_US)
