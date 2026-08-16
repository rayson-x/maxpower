# 健身、健康与健体数字教练的规划模式调研

调研日期：2026-08-14  
问题：其他数字教练如何把长期目标与期限，转成阶段路线、近期周历、训练与恢复、饮食、每日反馈和动态调整；LLM、规则与算法分别能决定什么？  
范围：主体优先选择明确提供 AI Coach、AI 计划生成或自适应规划的健身健康产品；以官方产品帮助/算法说明、官方产品文档、监管披露、开源仓库源码与文档、原始论文为证据。未采用测评、媒体报道、论坛评价或厂商比较页。纯记录器只保留为透明规则对照，不作为产品方向主体。

## 证据口径

- **可验证机制**：一手资料明确说明了输入、计划表示、更新时点、用户操作或算法边界；开源项目还可由源码/仓库文档交叉检查。
- **官方描述，机制未公开**：厂商说“AI”“个性化”“防止过度训练”等，但未公开决策规则、模型验证或效果试验。报告只记录它的产品承诺，不把它当作已验证能力。
- **未知**：公开资料没有说明。未知不按最有利方式推断。

这一区分很重要：几乎所有商业产品都公开“采集什么、何时更新、用户能改什么”，但很少公开完整排序权重、冲突规则、计划稳定性目标或个体结果的因果证据。

## 结论先行

1. **最成熟的层级不是“训练 / 饮食 / 恢复三个平级 tab”，而是“目标与期限 → 阶段 → 本周 → 今天”。** Garmin Run Coach 最清楚：目标赛事进入日历后，形成 base、build、peak、taper、race 阶段；用户再从训练日历查看一周建议，并在当天收到随表现与恢复变化的训练。RP 以 mesocycle 和末周 deload 表达中期阶段；Freeletics 用有固定 session 数或周数的 Training Journey 包住近期训练。
2. **训练与恢复在决策上不可分。** Garmin 把训练日、休息日、训练负荷和恢复共同用于每日计划；Fitbod 先计算肌群恢复再选下一课；RP 用酸痛、泵感和 workload feedback 调整后续组数。即使界面有独立恢复详情，恢复也应作为同一日历上的约束、状态和安排，而不是一份与训练并列且互不影响的计划。
3. **近期计划需要两种适应回路。** 一种是每课/每日的小调整：时间变少、缺器械、疲劳、漏训、额外活动后，替换当天内容或调整后续几天。另一种是每周/阶段检查：根据体重趋势、摄入完整性、表现与恢复改变下周预算或阶段。把所有变化都做成“整份计划重写”会导致计划抖动，也无法解释改变半径。
4. **饮食最好与目标周期协调，但不应假装由单日 readiness 自动决定。** MacroFactor 的能量与宏量目标来自目标速率、摄入、体重趋势和能量消耗估计，并在每周 check-in 中提出修改、允许拒绝；RP Diet Coach 把目标体重、期限、训练/活动日程转成按日和按餐宏量目标。公开资料没有支持“睡差一晚就由 LLM 大改热量”的做法。
5. **高质量产品把“建议”与“应用修改”分开。** MacroFactor 允许拒绝 check-in 调整；WHOOP Weekly Plan 让用户先 review/adjust 再 Start Plan，且可随时编辑、暂停或结束；Oura/WHOOP 的 memory 可查看和删除。MaxPower 应把重大计划版本、目标变化、饮食预算变化交给用户确认，并根据 Coaching mandate 只自动执行授权半径内的小调整。
6. **LLM 适合解释与会话，不应拥有生理事实或计划合法性的最终裁决权。** WHOOP 和 Oura 都把传感/评分算法与 LLM 对话组合起来；WHOOP 还允许切换为不使用个人数据的教育模式，Oura 明确提示 LLM 可能出错。Garmin、Fitbod、MacroFactor、RP 的核心自适应机制都可由指标、规则或专有算法完成，不依赖聊天模型。
7. **真正可借鉴的共同结构是“计划骨架稳定、滚动窗口可变、变化有原因与确认”。** 长期阶段不要每天重排；近 7 天可滚动；今天可在安全边界内快速适配；任何改变都应保留原计划、事实依据、修改范围和用户决定。
8. **AI-first 产品里，Google/Fitbit 已公开了最接近 MaxPower 的“会话建档 → 周计划 → 手动/会话调整 → 每日消息 → 营养记录”产品闭环。** 但它仍停留在 Public Preview/快速迭代期，官方已经退役过旧的 scheduled weekly plans；这说明应借鉴层级与交互，不应绑定它的具体页面或把预览能力当作稳定标准。

## 系统总览

| 系统 | 时间层级与计划表示 | 训练和恢复 | 饮食关联 | 重规划与确认 | 决策边界 |
|---|---|---|---|---|---|
| Google/Fitbit Personal Health Coach（Gemini） | 目标/建档会话 → personalized weekly targets + workouts → Today 消息/单课 | 睡眠、活动、健康数据进入同一 coach；周计划可按旅行、器械、难度等调整 | 2026 增加 calorie、meal、water 与个性化 macro ranges | 用户可用 Ask Coach 或 Adjust 改整周/目标/单课，也可手改 sets/reps/weights；能离开计划 | Gemini 会话 + Fitbit/Health 数据与工具；官方明确 AI 会出错且不提供医疗判断 |
| Keep AI Coach Kaka | 长期运动/健康数据与评估 → 个性计划 → 训练中语音 → 训练后分析；监管披露称可动态改 schedule | 公司披露规划、执行、评估多 Agent，并覆盖训练、睡眠和饮食 | 有 diet log/recommendation 描述；公开计划联动细节不足 | 宣称长期记忆与持续优化；缺少可验证的用户确认、版本 diff 和触发规则 | 公司披露 MAS + Kinetic.ai；能力边界、算法与结果验证大多未公开 |
| GRAVL（原 Gains AI） | onboarding/目标/经验/器械/日程 → Fitness Plan/整周 → session/set/rep/load | Recovery Split 按肌群恢复和目标选择下一课肌群；恢复百分比的生理效度未公开 | Gravl Macros 用照片估算热量和宏量；未证明参与训练计划裁决 | 每次训练后重算后续重量；可选 Recovery/Preset/Custom split、换动作、换场地 | 官方同时称 AI platform 与 scientific algorithm；可验证的是结构化生成和重算，不是 LLM 自由规划 |
| Garmin Run Coach | 赛事/日期 → base/build/peak/taper/race → 周日历 → 当日 workout | 同一训练计划内安排训练与休息；恢复、睡眠、负荷影响当日建议 | 不是主计划组成 | 漏训、额外活动、健康/恢复变化触发日级适应；一周可预览 | 指标与专有算法生成；未公开 LLM 参与 |
| RP Hypertrophy | 目标肌群优先级 → 4–8 周常见 mesocycle → 周次 → session/exercise/set | 末周固定 deload；酸痛、泵感、workload 反馈进入后续容量 | RP Diet 为独立产品，目标可协调但公开资料未显示统一规划器 | 每课反馈连续影响未来 session；用户可手工增删组 | 规则/专有算法；完整公式未公开 |
| Freeletics | 目标 → Training Journey（周或 session 数）→ 训练周 → 完整 session | 每课含 warm-up/cooldown；部分 Journey 有减量期；没有可验证的统一恢复日历模型 | Nutrition Coach 独立，公开资料不足以证明联合裁决 | 课后表现/反馈、一个月以上中断、当天限制可改下一课；用户点 Create new session | 专有 Coach；“AI”细节未公开 |
| Fitbod | 目标/经验/训练 split → 下一课 → exercise/set/rep/load | 肌群恢复百分比直接影响动作选择，但主要是“下一课生成器”而非清晰阶段路线 | 只见活动/卡路里上下文；不是联合饮食周期 | 每次记录、换动作、RiR/Max Effort、目标或器械变化后更新 | Exercise Selector + Capability Recommender；权重与验证未公开 |
| MacroFactor | 体重目标与目标速率 → 周营养计划 → 每日宏量目标 → 食物日志 | 不生成训练恢复日历；运动习惯影响蛋白等设置 | 核心能力；周目标与每日分配同屏关联 | 每周 check-in 提议热量/宏量调整，可拒绝；数据不足时 expenditure “holding” | 后看、确定性算法 + coaching modules；不是 LLM 自由裁决 |
| WHOOP Weekly Plan + Coach | 目标/30 日基线 → Monday–Sunday 周目标 → Daily Outlook/活动洞察/晚间回顾 | 睡眠、Recovery、Strain、行为目标置于同一周计划；日内目标联动 | 水分、蛋白、酒精等多为行为目标，不是完整饮食处方 | 周五进度、周一 recap；可编辑/暂停；Daily Outlook 随当日数据更新 | 生物指标算法提供状态/目标；LLM 负责自然语言和上下文解释 |
| Oura Advisor | 长期趋势/目标 → 会话中创建计划 → 自定义 check-in | Sleep、Activity、Readiness、Resilience 统一解释，但公开计划结构较弱 | 可讨论，未见可验证的宏量/餐食规划器 | 用户设 check-in 频率；memory 可审阅/删除；具体自动重规划规则未知 | health-sensing algorithms + LLM；官方明确 LLM 会出错且非医疗设备 |
| HeartSteps / JITAI | distal goal → proximal outcome → decision points → intervention option | readiness/receptivity 是是否干预的门，不是独立 tab | 原版 HeartSteps 不做饮食规划；JITAI 框架可迁移 | 每个 decision point 用最新 tailoring variables 决定“建议/不建议”；研究用微随机试验优化 | 预定义规则或学习策略；LLM 不是必要组件 |
| wger / Liftosaur（开源对照） | routine/program → day/exercise/set；显式 progression/deload rule | 以计划规则和训练日志为主，恢复模型弱 | wger 有营养与体重记录，但不是联合自适应 planner | 由用户定义 progression 规则；计划逻辑可审计 | 透明规则/脚本；价值在表示与可复现，不在“智能教练”证据 |

## 1. Google/Fitbit Personal Health Coach：当前最完整的 AI-first 周计划闭环

### 可验证机制

Google 在 2025 年 10 月开始 Fitbit personal health coach Public Preview，并明确它由 Gemini 构建。官方研究入口称系统以安全性、帮助性、准确性、相关性和个性化为评价维度，累计使用超过 100,000 小时的人类评估，评估者含 fitness、family medicine、sleep 和 behavioral science 专家；同时公布了 personal health agent、LLM health/wellness 评价、weekly cardio load 和 proactive conversational coaching 等研究方向。[Google：Personal Health Coach 的研究基础](https://blog.google/products-and-platforms/devices/fitbit/research-behind-personal-health-coach-preview/)

2026 年 4 月，官方产品更新把计划明确为 **personalized weekly fitness plans**：按目标生成 weekly targets 和 tailored workouts，支持 step-by-step workout guidance，并在 Today 里给 morning、post-workout、end-of-day/end-of-week 消息；用户可通过 Ask Coach 自然语言 check-in。[Fitbit Personal Health Coach 更新](https://blog.google/products-and-platforms/devices/fitbit/personal-health-coach-updates/)

Google Health 帮助中心进一步给出可操作边界：完成 coach 建档后，Fitness tab 显示当周 targets 和推荐 workouts；用户可通过会话或 Adjust 改整份计划、targets 或单课，也可手工改 movement details（reps、sets、weights、duration）和 exercise list。官方列出的会话适配包括旅行、跑步机被占、延长/缩短和降低难度；若疼痛，帮助页明确要求不要依赖 coach 判断动作是否安全。用户可随时 Leave plan。[Google Health Coach 帮助](https://support.google.com/googlehealth/answer/16961408?hl=en)

营养在 2026 年 3 月加入 calorie target、meal/water logging 和 personalized macronutrient ranges；它证明 AI Coach 的信息架构正在从训练扩到同一健康上下文，但官方没有公开宏量目标如何与具体训练日联合优化。[Fitbit 营养与健康更新](https://blog.google/products-and-platforms/devices/fitbit/fitbit-personal-health-coach-new-features/)

### 机制与营销边界

可验证的是 weekly target/workout 对象、会话和手动调整入口、结构化日志、Daily/weekly messages、退出计划及安全提示。完整生成算法、恢复如何改变力量训练组数、冲突优先级、计划版本审计和健康结果没有公开。它还在 Public Preview 中快速变化：官方帮助说明旧的 scheduled weekly plans 已退役，可导出/删除已完成计划。这是“计划对象必须可迁移、可版本化”的反例提醒，不是可直接照抄的稳定产品规范。

### 对 MaxPower 的启示

- AI 对话不应是计划唯一载体；同一计划需要 Fitness/Calendar 的结构化可见面。
- 自然语言改计划与按钮 Adjust 应写入同一个 draft/diff，不能走两套事实通道。
- 用户手改 sets/reps/weight 是显式覆盖；后续 Agent 只能在保留覆盖来源和授权的前提下学习偏好。
- 疼痛与安全不可由“更懂用户的 Gemini/LLM”越权裁决。

## 2. Keep AI Coach Kaka：多 Agent 闭环有价值，但公开可验证粒度不足

### 官方可验证描述

Keep 2025 年 ESG 报告和交易所披露称，AI Coach Kaka 于 2025 年 3 月推出，围绕用户生命周期形成训练前规划、训练中实时指导、训练后分析；技术上采用围绕 planning、execution、evaluation 的 Multi-Agent 协作架构、工具调用与编排、以及基于长期运动健康数据的 memory/insights。报告称 Kaka 可动态生成和调整训练计划，并连接身体评估、个性化计划、语音训练、饮食与睡眠记录/分析。[Keep 2025 ESG 报告（港交所）](https://www1.hkexnews.hk/listedco/listconews/sehk/2026/0423/2026042300954.pdf)

Keep 2025 年中期披露进一步称 MAS 有意图识别、persona modelling 和 memory 三个支柱；Kaka 覆盖个性 workout planning、voice-guided training、diet logs/recommendations、exercise tracking/analysis、姿态与动作评估。披露还称截至 2025 年 6 月，70% 的用户生成请求交付了融合多维参数的个性 workout regimen。[Keep 2025 中期报告（港交所）](https://www1.hkexnews.hk/listedco/listconews/sehk/2025/0923/2025092300334.pdf)

投资者关系页面也声称 AI-assisted personalized curriculums 会根据运动水平、目标、日常训练模式和饮食动态调整课程内容与强度。[Keep Investor Relations 公司介绍](https://ir.keep.com/en/about_profile.php)

### Gap：不能从披露推断的机制

这些是公司监管披露和官方产品描述，可证明 Kaka、MAS、计划生成/调整等能力方向确实存在；但公开材料没有提供用户可见的长期目标期限对象、阶段路线、周日历 schema、训练与恢复同历、重规划触发器、计划 diff/确认流程、Agent 冲突规则或独立结果验证。“70% 请求交付计划”衡量覆盖率，不衡量计划质量、执行率或健康效果。因此 Keep 适合作为“AI Coach 由多个有边界角色协作”的架构先例，不适合作为具体规划语义的唯一标杆。

## 3. GRAVL（原 Gains AI）：计划先行、训练后重算的 AI 健身产品

用户确认此前提到的 G 开头产品为 **GRAVL**。它原名 Gains AI，当前以 AI Personal Trainer 和个性化力量训练计划为核心。

### 可验证的计划闭环

GRAVL 官网把产品流程明确为 `Train → Log → Progress`：先根据目标、器械与日程生成整周训练和每组重量/次数；用户完成并记录后，系统分析训练并重算后续安排。官网明确声称 automatic progressive overload 会在每次训练后调整下一周重量，整周计划也会在训练记录后重新计算；换健身房或旅行时，计划会根据可用器械重建。[GRAVL 官网](https://www.gravl.ai/)

官方帮助中心把 Fitness Plan 的训练结构分为三类：**Recovery Split** 根据当前肌群恢复状态和目标决定每次训练的目标肌群；**Preset Splits** 提供按目标、经验和频率组织的固定分化；用户也可选择自定义设置。这个结构比“AI 自动生成”营销词更可核查，因为它暴露了计划稳定性和恢复参与方式。[GRAVL Fitness Plan 设置](https://help.gravl.ai/en/articles/10185534-gravl-essentials-set-up-your-fitness-plan)

动作层支持器械占用时一键替换同肌群动作，并重新计算 sets、reps 和 weights；官网还提供从 TikTok、Instagram、图片、PDF 导入训练，再转成结构化可执行 workout 的能力。营养侧的 Gravl Macros 用照片估算 calories、protein、carbs 和 fats，但公开资料没有证明宏量结果会参与训练或恢复计划裁决。[GRAVL 官网](https://www.gravl.ai/)

### AI 与算法边界

GRAVL 同时使用 “AI-powered training platform” 和 “scientific algorithm” 描述自己。公开资料可确认结构化计划生成、训练日志、逐动作 progression、Recovery Split、器械过滤和训练后重算；不能确认核心规划是否由 LLM 完成，也没有公开长期目标日期、mesocycle、恢复百分比的生理验证、营养联动、计划版本 diff 或用户确认协议。因此它更像 **算法驱动的自适应训练系统 + AI 输入/内容能力**，而不是以自由对话作为唯一规划器。

### 对 MaxPower 的启示

- 借鉴 `生成整周 → 执行记录 → 局部重算`，不必每次反馈都重写目标和阶段。
- Recovery Split 证明训练与恢复可在同一个选课/周历模型中表达，但 MaxPower 不应把一个恢复百分比冒充真实组织恢复。
- 导入外部计划的价值在“解析成结构化对象后再验证”，不能把 TikTok/PDF 内容直接视为合格计划。
- GRAVL 的交互是 plan-first。MaxPower 若要 AI-first，应在它的结构化执行闭环上增加对话入口、事实回执、计划 diff、解释和确认，而不是退回聊天生成 Markdown。

## 4. Garmin Run Coach：目前最完整的“期限 → 阶段 → 周历 → 当日适应”参照

### 可验证机制

Garmin 官方科学说明明确：有目标赛事时，计划采用 **base、build、peak、taper、race** 阶段；base/build 各约 3–9 周，peak 约 3–6 周，taper 为 10 天。赛事可提前一年设置，阶段化训练在赛前六个月进入；期限不足六个月时阶段会压缩。没有赛事时，计划以提高体能为目标，较难与较易训练周交替。[Garmin Run Coach 科学说明](https://www.garmin.com/en-GB/garmin-technology/garmin-coach/garmin-run-coach/)

计划输入包括目标/日期、可训练日和长课日、当前 VO2 max 与乳酸阈、心率和配速、近一周 acute load、近四周 chronic load，以及睡眠、恢复和压力等健康指标。用户可在 Garmin Connect 的训练日历查看未来一周，同时看到计划概览和进度。[Garmin Run Coach 官方支持](https://support.garmin.com/en-SG/?faq=xmMRe8rjaZ3CNaINXf8dLA)

漏训不要求用户把旧课机械搬到另一天：适应型 Run/Cycling/Triathlon/Fitness Coach 会自动调整后续；官方支持页明确说这些计划不允许手工 reschedule，理由正是漏训后由计划优化调整。[Using Garmin Coach Training Plans](https://support.garmin.com/en-CA/?faq=o21H5a4cSU52FwFAy0R6Z5)

### 边界

可验证的是层级、输入、预览窗口和更新行为；“确保不超过身体能承受”“降低伤病风险”等是官方表述，公开页面没有给出个体安全效果验证或完整算法。它也主要面向耐力/综合体能，不能直接把跑步的 EPOC 负荷和阶段长度照搬到健体训练。

### 对 MaxPower 的启示

- 目标日期必须在计划顶层出现，并驱动阶段长度，而不是只藏在聊天文字里。
- 周历是当前阶段的滚动投影；恢复日与训练日共同占据日历，不分成两个 plan tab。
- 漏训应重算剩余窗口，并保留原定 session 的“未执行”事实；不能把历史改写成“从未计划”。

## 5. RP Hypertrophy / Diet Coach：mesocycle、deload 和感知反馈的强结构

### 可验证机制

RP Hypertrophy 让用户选择 mesocycle 长度。官方帮助中心称多数人总周期约 4–8 周，初学者可更长，中高级更短；最后一周由系统自动设为 deload，若改变总周数，deload 随之移动。[mesocycle 长度](https://help.rpstrength.com/hc/en-us/articles/30976017295383-How-many-weeks-should-my-mesocycle-be)；[自动 deload](https://help.rpstrength.com/hc/en-us/articles/33510413024279-Does-the-app-automatically-place-deloads)

训练容量不是只看完成/未完成。官方说明系统根据泵感、酸痛、主观 workload 调整未来 sets；重量通常按小百分比增加，若器械档位太大则改为加 reps。反馈“恢复充足且刺激不足”通常加组，“刚好恢复且接近上限”维持，“未恢复且负荷过高”减少。用户仍可手工增删组。[进阶规则说明](https://help.rpstrength.com/hc/en-us/articles/32600173777815-How-does-the-app-determine-when-to-add-weight-reps-and-sets)

RP Diet Coach 则先让用户选择目标体重与期限/速率。官方称 fat loss 常见 6–12 周，并限制最大周减重速率为体重的 1%；其计划会结合睡眠日程、训练日程、日常活动与目标生成按日、按餐宏量目标，再以每周体重进度建议营养调整。[fat-loss 阶段](https://help.rpstrength.com/hc/en-us/articles/34705936087191-How-to-choose-an-effective-fat-loss-phase)；[安全边界和周调整](https://help.rpstrength.com/hc/en-us/articles/33327568055447-How-does-the-app-keep-me-safe-while-dieting)

### 边界

RP 公开了可预测的输入与方向，却未公开完整系数、冲突规则和长期效果验证。Hypertrophy 与 Diet Coach 是两套产品；公开资料支持“饮食参考训练日程”，不支持它们共享一个统一训练恢复规划器。泵感/酸痛也只是自报代理变量，不能当成已测得的肌肉生长或组织恢复。

### 对 MaxPower 的启示

- `GoalCycle → Mesocycle → WeekPlan → Session` 是用户可理解、也和现有 MaxPower 领域词汇一致的层级。
- 主观反馈是正式 Record：来源、时间、适用肌群和有效期都要保留；不能被模型改写为生理事实。
- deload 应在阶段路线和周历上可见，不能藏在“恢复 tab”。

## 6. Freeletics：固定 Journey 骨架 + 当天适配

### 可验证机制

Freeletics 在 onboarding 收集目标、训练模态、训练日、设备和跑步偏好，先选择一个 Training Journey；Journey 常以 18、24、35、42 或 48 个 sessions 表示，部分同时标明 6 或 12 周，并可能包含 periodization 或最终 deload。[开始使用](https://help.freeletics.com/hc/en-us/articles/115004675229-Get-started-with-Freeletics-Training)；[Bodyweight Training Journeys](https://help.freeletics.com/hc/en-us/articles/360008600540-Bodyweight-Training-Journeys)

每次 session 是 warm-up 到 cooldown 的完整单元。课后表现和反馈影响后续；当天可通过 Adapt Session 告知时间不足、无器械、无空间、不能跑、需要安静、排除最多两个身体区域、改变难度或要求另一课，再由用户点“Create new session”。中断超过一个月时，Coach 会让用户选择以更容易的 session 继续或按原计划继续。[Adapt Session](https://help.freeletics.com/hc/en-us/articles/360003933780-Adapt-your-Bodyweight-training-session)；[中断后的调整](https://help.freeletics.com/hc/en-us/articles/360011919479-Can-I-reset-my-Training-Coach)

### 边界与启示

公开资料证明了 Journey 骨架与当天替换，但没有证明训练、恢复和 Nutrition Coach 由一个统一模型联合优化，也没有公开“AI”如何裁决。值得借鉴的是：当天限制不是重做 onboarding，而是对既有 session 的有边界修改；替换前展示用户输入，替换后保留 Journey 意图。

## 7. Fitbod：恢复约束进入下一课生成，但长期路线表达偏弱

### 可验证机制

Fitbod 官方将生成分为 Exercise Selector 与 Capability Recommender：前者根据目标、经验、器械、split、历史偏好和肌群 recovery 为动作排序；后者基于动态估算 1RM、目标和历史表现决定 sets、reps、weight。肌群恢复显示为 0–100%，可由用户手调；记录训练会更新恢复，导入的 cardio/活动也可影响它。[Fitbod 算法说明](https://fitbod.me/blog/fitbod-algorithm/)；[Muscle Recovery 帮助](https://help.fitbod.me/hc/en-us/articles/360006269014-Muscle-Recovery)

完成训练、修改重量/次数、换动作、RiR/Max Effort、改变目标或器械后，后续建议更新。官方同时提醒恢复百分比只是多个输入之一，不应把某个数字当成绝对可训练阈值。[Fitbod Algorithm Q&A](https://help.fitbod.me/hc/en-us/articles/16254175592215-Fitbod-s-Algorithm-Q-A)

### 边界与启示

“数亿训练使机器学习更准”是厂商描述；公开资料没有模型评估、权重和因果验证。Fitbod 强项是下一课，不是清晰可核验的目标期限与阶段路线。MaxPower 可借鉴“恢复作为动作候选的约束与排序输入”，不可照搬“一个恢复百分比代表组织已经恢复”的表达。

## 8. MacroFactor：最清楚的营养反馈闭环与用户确认

### 可验证机制

MacroFactor 的 coached/collaborative program 以体重目标和目标变化速率为上游，以每日能量和宏量目标为计划。其 expenditure 由摄入和趋势体重持续后看估计；至少每 7 天记录 4 天饮食、每周至少 1 次体重，估计才能继续更新，否则状态变为 “holding”，避免基于不足数据调整。[营养记录要求](https://help.macrofactorapp.com/en/articles/110-how-frequently-do-i-need-to-log-my-nutrition-for-the-expenditure-algorithm-and-weekly-coaching-updates)

每周 check-in 根据 expenditure、趋势体重与目标速率提出热量/宏量修改。用户可拒绝，拒绝后不会应用新目标。Coaching Modules 先解释为什么出现，必要时询问和纠正 partial logging、fasting、weigh-in 或 logging break，再在用户批准下修改数据或 program。[Check-ins 与 Coaching Modules](https://help.macrofactorapp.com/en/articles/247-introduction-to-check-ins-and-coaching-modules)；[增/减重调整](https://help.macrofactorapp.com/en/articles/222-how-does-macrofactor-make-adjustments-for-a-weight-gain-or-weight-loss-goal)

其算法声明为 back-looking、deterministic；补记最近历史会实时重算 expenditure，并反映在下一次 check-in。计划调整还使用 smoothing，避免目标随短期 expenditure 变化过快。[补记历史的影响](https://help.macrofactorapp.com/en/articles/207-will-logging-food-to-a-previous-day-affect-my-expenditure-and-coaching-recommendations)；[目标调整的平滑](https://help.macrofactorapp.com/en/articles/23-how-do-i-adjust-my-macro-targets)

### 边界与启示

MacroFactor 不生成训练/恢复计划；它证明的是“营养策略必须有独立、数据充分性敏感的周反馈回路”。MaxPower 应借鉴 `updating / holding / insufficient evidence`、先解释再确认、允许拒绝、平滑改变，不要把短期体重波动交给 LLM 自由解释并立刻砍热量。

## 9. WHOOP Weekly Plan + Coach：周目标、日内反馈与 LLM 解释层

### 可验证机制

WHOOP Weekly Plan 是 Monday–Sunday 的周计划，至少 7 次 sleep 后解锁。用户可从 preset 或 custom plan 开始，review/adjust 后才 Start Plan。目标同时覆盖 Sleep Performance、Strain、HR zones、活动频次和 Journal behaviors；推荐参考 30 日平均、恢复趋势和 Healthspan 指标。周五给进度，周一 recap，用户可编辑、暂停或结束。[WHOOP Weekly Plan](https://support.whoop.com/s/article/Weekly-Plan?language=en_US)

WHOOP Coach 的 Daily Outlook 在早晨提供基于 Recovery、Strain、环境与历史的活动/目标建议；Activity Insights 在训练后解释心率区间、strain 和模式；Day in Review 在晚间给睡眠与就寝建议。官方帮助页还明确 My Memory 可增删目标、习惯、当前状态和偏好；Coaching Mode 可在“使用个人数据定制”和“仅教育支持”间切换。[AI-powered WHOOP Coach](https://support.whoop.com/s/article/How-to-Use-the-AI-Powered-WHOOP-Coach)

WHOOP 官方说明 Coach 由 LLM 与会员生物历史组合；但 Strain Target 等目标有独立的结构化来源，例如 Recovery、当天已累计 Strain 和周期阶段。[会员功能说明](https://support.whoop.com/s/article/Membership-Features-Benefits?language=en_US)；[WHOOP Strain](https://support.whoop.com/s/article/WHOOP-Strain?language=en_US)

### 边界与启示

“防止 burnout/overtraining”是官方产品措辞，公开帮助页没有证明因果效果。WHOOP 的成熟点在分工：指标算法提供状态和目标，LLM 解释并接收上下文；周计划由用户启动和可编辑。蛋白、水分等只是行为目标，不等于能量/宏量营养计划。

## 10. Oura Advisor：传感算法 + LLM + 可管理记忆，但计划对象较弱

Oura 官方帮助页明确 Advisor 结合 health-sensing algorithms 与 LLM，使用 scores/contributors、activities/tags、profile 和历史互动，支持可配置对话风格、check-in 通知和 memories；用户可继续历史 thread、删除 thread、审阅或删除 memory。[Oura Advisor 帮助](https://support.ouraring.com/hc/en-us/articles/39512345699219-Oura-Advisor)

官方发布称 Advisor 可分析短期与长期 Sleep、Activity、Readiness、Resilience 趋势，展示图表，并在会话中创建健康目标计划；同时明确当前 LLM 可能出错，Oura Ring/Advisor 不是医疗设备。[Oura Advisor 发布说明](https://ouraring.com/blog/oura-advisor/)

可验证的是数据范围、会话入口、记忆控制和产品宣称的 plan 能力；公开资料没有给出 plan schema、阶段结构、自动调整规则或确认协议。因此它更适合作为“解释与反思层”参照，不适合成为 MaxPower 计划执行语义的参照。

## 11. JITAI / HeartSteps：把“什么时候改、什么时候不打扰”写进模型

JITAI 原始框架把系统定义为：在时变状态下，于正确时点提供正确类型/剂量的支持。其显式组件包括 distal outcome、proximal outcome、decision points、tailoring variables、intervention options 与 decision rules；“provide nothing” 是正式选项，避免用户不可接收时仍强行干预。[Nahum-Shani et al., JITAI 设计原则](https://pmc.ncbi.nlm.nih.gov/articles/PMC5364076/)

HeartSteps 的 6 周微随机试验每天最多在 5 个用户选择时点决定是否发 walking/anti-sedentary 建议，并在晚间提示为次日活动做 implementation intention；其直接结果是建议后 30 分钟的步数，而不是把单次反馈直接等同于长期健康结果。[HeartSteps 原始试验](https://pmc.ncbi.nlm.nih.gov/articles/PMC6401341/)

对 MaxPower 最重要的不是复制随机化，而是明确：

- 长期目标是 distal outcome；本周训练完成率、主动作表现、腰围/体重趋势等是不同时间尺度的 proximal signals。
- readiness、可用时间、场地与用户是否愿意被打扰是 tailoring variables。
- decision point 必须预定义：课前、课后、每天早晨、周检、阶段末；不必等用户发起聊天。
- “保持原计划”“仅提醒”“降低剂量”“换课”“完全休息”“请求更多信息”都应是合法 option。

JITAI 论文并未给所有健康领域一个通用阈值；变量有效期、缺失处理和安全规则仍需 MaxPower 自己验证。

## 12. 透明规则对照（非主体）：wger 与 Liftosaur 的价值是可审计表示

[wger](https://github.com/wger-project/wger) 把 workout routine、automatic progression rules、workout log、体重、营养计划和营养日志做成可自托管数据对象；[Liftosaur](https://github.com/astashov/liftosaur) 用 Liftoscript 显式写 progression 与 deload，例如完成目标 reps 后加重、连续失败后减载。二者都允许用户检查和修改规则。

它们没有公开证据支持“统一训练恢复营养 Agent”，也没有可验证的个体生理恢复模型。值得借鉴的是：

- progression 规则应是版本化、可测试、可回放的结构化逻辑，而不是埋在 prompt。
- planned、performed、logged 需要分开；修改规则不改写历史。
- 开源可审计不等于科学有效，计划规则仍需证据与产品验证。

## 跨系统的共同模式与共同缺口

### 可以较有把握采用的模式

1. **稳定上层，滚动下层**：目标合同和阶段骨架低频修改；本周滚动；今天按状态适配。
2. **恢复是约束也是安排**：既影响动作、容量和强度，也在日历上表现为休息、主动恢复、睡眠/行为目标。
3. **事实与反馈分层**：传感指标、完成记录、自报疲劳/酸痛、体重与摄入完整性保留不同来源和可信度。
4. **缺数据时暂停或请求，不凭空补齐**：MacroFactor 的 holding、JITAI 的 provide nothing、Oura/WHOOP 的非医疗/LLM限制都指向同一原则。
5. **用户确认与可撤回**：重大目标、期限、热量、阶段和周结构变化应先展示 diff；memory 和偏好可查看、删除。
6. **解释紧邻决策**：不是一段拟人化长回复，而是“为什么这周这样排”“今天为何有变化”“使用了哪些记录”的短说明。

### 仍然未知，不能从竞品资料推断

- 商业系统的完整优化目标、权重、冲突处理、计划稳定性成本和安全失败语义。
- “训练与恢复同一周历”是否比独立详情页显著提高理解、执行率和信任；Garmin/WHOOP 提供强先例，但不是 MaxPower 用户证据。
- 单日 readiness 到底应允许修改多少力量/健体训练内容；可穿戴分数与局部肌群恢复并非同一个概念。
- 训练日/休息日营养差异是否提高依从性，还是增加认知负担；竞品实现不构成因果证据。
- LLM 解释是否帮助用户理解，或只增加权威感与顺从；Oura 的自报可靠性数据是厂商测试描述，不等于独立验证。
- 多目标（减脂同时保力量/围度、赛事同时健体）发生冲突时，用户偏好如何排序，以及多大变化半径可被自动接受。

## MaxPower 推荐的信息架构

### 产品定位：初始化由 Agent 引导，进入产品后 App-first、Agent-assisted

产品生命周期需要明确分成两个阶段：

1. **首次初始化**：登录后若没有完整档案和第一版计划，进入专用的全屏 Agent 对话。对话是这个阶段的流程入口，Agent 通过自然语言和动态表单卡完成建档、目标确认、计划生成与首次确认。完成前不进入普通主页，也不再提供另一套固定问卷。
2. **正常使用**：档案和第一版计划确认后进入完整 App。此后用户可以直接使用 Today、Calendar、Add、Plan、Profile，也可以打开唯一的 Coach 对话让 Agent 代为操作。常规功能不能要求用户先聊天。

因此，“AI-first”不应被实现为整个产品 chat-only。MaxPower 首先必须是一个无需日常 Agent 也完整、简洁、可操作的健身 App；初始化完成后，Agent 是建立在正常产品能力之上的第二操作入口和协调层。

```text
初始化：专用 Agent 对话 → 档案草稿 → 第一版计划 → 用户确认 → 进入 App

正常使用：
手动 UI（页面 / 表单 / 抽屉） ─┐
                              ├─ 同一 Draft / Command / Validation ─ Plan、Timeline、Record
Coach 对话（自然语言 / 工具卡）─┘
```

- 高频、明确、单步骤操作优先保留直接 UI：记录组次、体重、饮食、移动训练日、查看计划。
- 模糊、跨领域或需要解释的任务适合 Agent：聚餐后如何处理、睡眠差是否换课、目标日期变化如何影响训练与饮食。
- 主动风险判断可以先显示通知/变更卡；用户既可直接确认或拒绝，也可选择进入唯一的 Coach 对话继续讨论。
- Agent 发出的表单、记录草稿和计划差异必须复用手动流程的业务组件与写入命令，不能维护“聊天专用真相”。
- 手动修改后 Agent 必须读取到同一结果；Agent 确认写入后，正常的 Today、Calendar 和 Plan 页面必须立即反映。

因此更准确的产品描述是：**Agent 增强的健身 App**。Agent 减少操作成本、连接跨域事实并提供解释，但不取代清晰的信息架构和手动可操作性。

### 1. 页面顺序：从长期到今天，而不是按专业域分 tab

**A. 目标总览卡（首屏）**

- 目标：用户原话 + 结构化主目标/次目标。
- 期限：目标日期或时间范围；若不可可靠预测，显示区间和置信度，不承诺单点日期。
- 成功指标：体重、腰围、围度、主动作表现、训练完成率等，注明哪些已确认、哪些待建立基线。
- 当前判断：`可行 / 需调整 / 证据不足`，以及最关键的 1–3 个约束。
- 操作：`调整目标`、`确认路线`。

**B. 阶段路线卡**

以横向 timeline 展示 `GoalCycle → Mesocycle`，每阶段显示起止时间、阶段意图、训练刺激重点、营养策略方向、deload/maintenance window 和转段条件。不要铺开每天动作；点击阶段再展开。

**C. 本周日历卡（训练 + 恢复唯一主视图）**

按 7 天显示：

- 训练日：session 目的、主要动作模式/肌群、预计时长、强度/容量摘要。
- 恢复日：完全休息、主动恢复、睡眠窗口或 mobility；这些是日历事件，不是另一个 tab。
- 每天共同显示 readiness/constraint 状态、是否有计划变化、饮食类型（训练日/恢复日或统一目标）。
- 点击某天只局部展开当天详情；不整页刷新、不改变滚动位置。

**D. 饮食策略卡**

位置在周历之后，而非和训练并列竞争主导航。先显示目标周期内的能量/宏量策略与调整节奏，再显示本周按日目标。日历上只放轻量标签，细节在本卡；这样既关联训练日，又避免一张日历塞入每餐。

**E. 今日执行与反馈卡**

当天只问会改变决定的最少信息：时间/器械变化、疼痛或异常、安全问题、主观 readiness；训练后记录完成、实际 sets/reps/load/RIR、关键酸痛/疲劳、替换与原因。饮食使用摄入完整性和体重趋势，不把未完整记录当成低依从事实。

**F. 变化与依据卡**

仅在发生变化时出现：`改了什么 / 为什么 / 影响哪几天或哪个阶段 / 哪些保持不变 / 需要确认吗 / 撤回`。说明应引用 Record 与规则，不输出角色扮演式长段落。

### 2. 会话模式

首次生成不应只回复“先跑一周再看”。推荐顺序是：

1. 一句话复述目标与期限，并标注假设。
2. 展示 `目标总览 + 阶段路线`，请用户确认长期方向。
3. 展示当前阶段的 `训练+恢复周历`。
4. 展示与该阶段协调的饮食策略。
5. 说明本周将采集哪些最小反馈、何时会复盘、什么情况会提前调整。

日常会话从今天切入，但始终能回到上层：`今天怎么练` → 今日卡；`为什么这样排` → 展示本周约束和阶段意图；`目标改到 12 周` → 先修订 Goal contract，再重算阶段与周历，而不是只改聊天文案。

### 3. 卡片交互与确认半径

| 改变 | 默认行为 | 原因 |
|---|---|---|
| 同一 session 内等价动作替换、休息时长小调 | 可在已授权 Coaching mandate 下自动，显示撤回 | 影响半径小，用户当下需要快速执行 |
| 当天降容量、移动一课、增加恢复日 | 先展示当天/本周 diff；协作模式一键确认 | 会影响周刺激与恢复 |
| 修改周分化、周容量预算、营养日目标 | 必须确认 | 跨多日且可能影响目标速率 |
| 修改目标、期限、mesocycle 或能量策略 | 必须显式确认并生成新 Plan revision | 这是 Goal contract / GoalCycle 级变化 |
| 安全 gate、证据不足、冲突无解 | 不自动放宽；请求信息或给保守方案 | LLM 无权越过硬边界 |

### 4. 决策职责

- **LLM**：解析目标和限制、提出待确认候选事实、解释结构化计划/变化、询问最少必要信息。不能生成未观测恢复事实，不能把自报酸痛升级成医学判断，不能直接写入 Timeline。
- **确定性规则/策略**：适用性、安全 gate、缺失数据、最大变化半径、营养最低边界、权限与确认要求。
- **计划器/约束求解**：从 GoalCycle/Mesocycle 预算生成 WeekPlan，联合排训练、休息、时间窗、器械与偏好；重规划时固定已完成部分，并惩罚无必要变化。
- **训练/营养算法**：从已确认 Record 更新强度、容量、估计能力、体重趋势和能量策略；输出结构化 proposal 与证据状态。
- **用户**：确认 Goal contract、重大 Plan revision、推断值和不确定记录；可覆盖并记录原因。

### 5. 与现有 MaxPower 领域模型的对应

推荐直接使用现有 canonical terms，而不是再造 UI 专用真相：

```text
Goal contract
  └─ Goal cycle
      ├─ Mesocycle[]
      │   └─ Week plan[]
      │       ├─ Training session plan[]
      │       └─ Recovery event / Recovery constraint projection
      └─ Nutrition strategy

Timeline Records + current Readiness state
  └─ Plan revision proposal
      ├─ evidence
      ├─ changed scope
      ├─ preserved scope
      ├─ reason codes
      └─ confirmation / Coaching mandate decision
```

其中恢复不是另一份 plan：`RecoveryConstraint` 是时效约束，休息/主动恢复是 WeekPlan 的日历投影；实际睡眠、酸痛、疲劳和完成情况属于 Record/Readiness。NutritionStrategy 与 GoalCycle 协调，但有自己的周检查与数据充分性状态。

## 必须先做的最小实验

1. **信息层级理解实验**：同一计划做 A/B。A 为训练/饮食/恢复 tab；B 为目标总览→阶段路线→训练+恢复周历→饮食。5–8 名目标用户完成“目标何时达成、为何周三休息、漏训后哪天变化、今天吃多少”任务；记录首次答对率、点击数和主观确定性。若 B 不能提高理解，就不要仅凭竞品先例全面重构。
2. **周历密度原型**：比较“日格只显示摘要，点开详情”和“日格直接展示动作+恢复+营养”。观察 320–430 px 手机宽度下能否 10 秒内找到今天、下一训练日和本周 deload；优先验证，不先实现完整数据流。
3. **变化确认半径实验**：用三个情景测试用户期望：当天等价换动作、移动训练日、修改周热量。让用户选择自动/一键确认/必须解释后确认，形成 Coaching mandate 默认值，而不是由团队猜。
4. **计划稳定性回放**：用匿名/合成两周记录回放漏训、睡眠差、额外有氧、器械不可用。衡量每次重规划改动天数、保留 session 比例、目标预算偏差与安全冲突；先确定 change-cost 阈值，再接 LLM。
5. **数据不足语义实验**：制造体重少记、饮食不完整、readiness 过期、酸痛不明确等情况，验证界面能否让用户分清 `保持原计划 / 保守调整 / 等待更多数据`，且不会把 unknown 显示成“状态正常”。
6. **解释剂量实验**：对同一变更比较一句理由、三点证据、长教练段落。指标是正确复述原因、信任校准和确认耗时；目标不是让文案更像真人，而是让用户知道变化依据和边界。
7. **训练日营养联动实验**：只先比较“统一日目标”与“训练/恢复两类日目标”，追踪一周完成率、误读和调整负担。没有足够数据前，不引入每天随 readiness 波动的热量计划。

## 建议的第一版产品判定

可以直接进入原型的决策：

- 取消“训练”和“恢复”两个平级 plan tab，改为一个 7 日历主视图；恢复详情作为日格展开与周说明。
- 在周历上方增加目标期限和阶段路线；没有可靠期限时显示范围与假设。
- 饮食保留独立详情卡，但与 GoalCycle 和日历的训练/恢复日类型关联。
- 所有卡片内部切换局部更新，不重绘会话根节点。
- 首周不是孤立试用：明确它属于哪个阶段、这周验证什么、何时复盘、哪些指标会触发小调或阶段重算。

暂不应宣称或实现为事实的内容：

- 一个“恢复百分比”能准确代表局部肌肉或损伤风险。
- LLM 能仅凭对话安全地联合优化训练、恢复和饮食。
- 单晚 wearable readiness 足以决定大幅改课或改热量。
- 竞品使用了“AI”就证明长期目标达成率更高。

最小可行方案应是：**结构化 Goal contract 与 GoalCycle 定方向，规则和计划器生成阶段与周历，训练/营养算法在各自证据边界内提出调整，LLM 只做自然语言入口和可追溯解释，用户按授权半径确认计划修订。**
