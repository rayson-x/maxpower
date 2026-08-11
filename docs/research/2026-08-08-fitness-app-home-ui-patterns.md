# 健身 App 首页与 Agent 协作 UI 模式调研

日期：2026-08-08  
范围：Keep 9.x、Google Health / Google Health Coach、WHOOP、Fitbod、Freeletics、RP Hypertrophy、训记，以及 ChatGPT、Claude、Gemini 等通用 Agent 产品。  
方法：只使用官方帮助中心、官方产品博客、公司披露、官方应用商店页面和官方演示视频。应用商店宣传截图可能晚于或早于当前客户端版本；凡不能确认当前真实 UI 的地方均标为 `unknown`。

## 结论先行

MaxPower 不应该复制某一个产品的首页，而应组合三种已经被一手资料验证的模式：

1. **Freeletics / Fitbod 的“今日处方优先”**：用户打开 App 就能看到下一次或当天训练，开始训练是最高权重动作。
2. **Google Health / WHOOP 的“卡片化状态解释”**：首页承载恢复、睡眠、进展和 Coach 消息，但这些卡片服务于今天的决策，不能压过训练主卡。
3. **通用 Agent 的“统一 composer + 上下文执行卡”**：输入框是跨能力的自然语言入口；能力选择收进底部 sheet 或快捷 chips；计划修改、工具执行和结果不能只留在气泡里，而要显示为可审计卡片。

推荐首页不是“卡片信息流 + 一个聊天 Tab”，而是：

> **有固定秩序的多卡片 Today 页面 + 页面内常驻 Coach composer；点击输入框进入带当前页面上下文的全屏聊天。**

普通用户无需先理解训练术语或审查每一次小调整。用户先选择托管/协同/手动权限模式；低风险且已授权的变化可自动写入并提供 `查看变更 / 撤销`，越权或中高风险变化才显示计划预览并要求确认。

## 一手证据矩阵

| 产品 | 默认首页 / 第一主卡 | 今日训练与自由记录 | 恢复 / 进展 | Agent / Chat | 导航与点击层级 | 可信边界 |
|---|---|---|---|---|---|---|
| **Google Health** | `Today` 顶部是可定制 Focus metrics，其后是 fitness、sleep、wellness insights 和 Coach messages。官方公开截图显示 Today 指标行后接主动洞察卡。 | 个性化周计划位于 `Fitness`；用户可直接跟 Coach 生成/修改计划，也可手动编辑。Today 的 Focus metrics 下有 `Log`，Fitness 有 `Log activity`。 | Fitness 展示周计划进度、weekly cardio 和 steps；独立 Sleep、Health 页面承载睡眠与 vitals。 | `Ask Coach` 可随时进入；当前官方应用商店截图将其表现为右下浮动入口，点入 full-page chat，页面有欢迎语、建议问题、`+ Log` 和底部文本框。Coach 可记录数据、创建训练、修改目标/组次/次数/时长。 | 官方功能图确认 `Today / Fitness / Sleep / Health` 四个信息域；Coach 是跨信息域入口，不是第五个数据页面。日志结果可点入 detail。 | 当前一手资料最完整，适合作为“卡片首页 + 独立上下文聊天”的主要参照。[新 Google Health](https://support.google.com/googlehealth/answer/17068213?hl=en)、[功能图](https://support.google.com/product-documentation/answer/17081467?hl=en)、[Coach 使用说明](https://support.google.com/googlehealth/answer/16961408?hl=en)、[官方截图演示](https://blog.google/products-and-platforms/devices/fitbit/personal-health-coach-public-preview/)、[App Store](https://apps.apple.com/us/app/google-health-fitbit/id462638897) |
| **WHOOP** | App Store 当前宣传图显示 Home 顶部并列 Sleep、Recovery、Strain 三环，下面是解释卡、Health/Stress 小卡及 `My Day`。 | Home 的 `+` action 可启动活动/WHOOP Live；2025 年导航更新后 Weekly Plans 放在 Home 的 `My Plans`。它不是重量训练处方首页。 | 恢复、睡眠和 strain 是第一层；长期趋势在 Dashboard，计划目标回到 Home/Health。 | WHOOP Coach 在底部导航可直接访问，其他页面也可保留角落入口；官方截图是 full-page chat，底部单一输入框。 | 官方帮助确认 Home、Health、Coach、Community、More 等主要入口，但不同会员与更新阶段会改变具体排列；旧 `Plan` tab 已废弃。 | 适合借鉴“少量核心状态 + 人话解释”，不适合照搬为训练执行首页。[当前导航](https://support.whoop.com/s/article/Navigating-the-WHOOP-Mobile-App?language=en_US)、[导航更新](https://support.whoop.com/s/article/WHOOP-Basics)、[WHOOP Coach](https://support.whoop.com/s/article/How-to-Use-the-AI-Powered-WHOOP-Coach)、[App Store](https://apps.apple.com/us/app/whoop/id933944389) |
| **Fitbod** | 产品重心是 `Workout` tab：当前地点、时长、肌群选择/恢复、器材及完整动作清单直接组成下一次训练。 | 顶部 `Swap` 集中处理肌群、动作、器材和从零创建；训练中可改 reps/weight/set。自由训练通过 Create from Scratch、On Demand、Saved Workout 或 `+ Add Exercise` 进入。 | `Log` 顶部展示周目标/streak；动作历史、Strength Score、周训练报告在日志和详情中。 | 没有经官方资料确认的对话式 Coach 入口。 | 官方帮助至少确认 `Workout` 与右下 `Log`；Club 只在部分地点条件出现。动作编辑通常进入 full page/detail，快速变更集中到 Swap menu。 | 最适合借鉴“今日训练即首页”和专业记录密度；不适合借鉴 Agent UI。[编辑训练](https://help.fitbod.me/hc/en-us/articles/360006335593-Editing-Workouts-in-Fitbod)、[工作原理](https://help.fitbod.me/hc/en-us/sections/360001078993-Understanding-Fitbod-How-It-Works)、[App Store](https://apps.apple.com/us/app/fitbod-gym-fitness-planner/id1041517543) |
| **Freeletics** | App Store 当前宣传截图和官方帮助均指向 `Coach` 当前日：顶部一周日期、今日 Coach session、动作段落与主训练动作。 | `Adapt session` 位于 session 详情底部；可按时间、器材、空间、噪音、跑步、身体区域和难度重新生成。`Explore all` 是计划外训练/手工记录入口。 | 计划进度在 Coach Journey 内；当前宣传图另展示 Daily Athlete Score 和 Community，但不是首页主任务。 | 没有经官方资料确认的开放聊天输入框；“AI Coach”主要表现为结构化适配。 | 官方当前资料展示 `Community / Coach / Profile` 三项底栏，Coach 居中主位；当前日点入 session full page，Adapt session 再进入结构化选择和重新生成。 | 是“执行优先 + 结构化快速调整”最直接参照。[Coach 当前日](https://help.freeletics.com/hc/en-us/articles/360004928220-Is-the-app-free)、[调整今日训练](https://help.freeletics.com/hc/en-us/articles/360003933780-Adapt-your-Bodyweight-training-session)、[计划外记录](https://help.freeletics.com/hc/en-us/articles/4403073844626-Log-an-exercise-workout-or-run-outside-of-your-Training-Journey)、[App Store](https://apps.apple.com/us/app/freeletics-workouts-fitness/id654810212) |
| **RP Hypertrophy** | 当前 App Store 宣传图展示 `Workout` 当前周/日，肌群分组和处方动作直接成为工作界面。 | Workout 内逐动作输入重量、次数和完成状态；Meso 与 Templates 用于周期规划。自由计划主要由模板、Meso builder 和 workout 编辑承担。 | 进展不是首页摘要卡，而是嵌在 mesocycle、动作历史和训练反馈中；训练后/肌群反馈用结构化表单。 | 没有经官方资料确认的聊天式 Coach。 | 宣传截图可确认底部 `Workout / Meso / Templates / Exercises / More`，具体动作详情是 full page；反馈是 sheet/modal。 | 适合专业模式的数据和反馈交互，不适合普通用户首屏。[App Store](https://apps.apple.com/us/app/rp-hypertrophy/id1555614554)、[官方帮助中心](https://help.rpstrength.com/hc/en-us/categories/30801297737495-RP-Hypertrophy-App) |
| **Keep 9.x** | 官方 9.0 文案确认“精简繁杂布局、核心功能触手可及、迅速进入训练”，但当前 App Store 宣传图片仍明显展示较旧的 Keep 8.0 视觉，**无法据此确认 9.x 默认首页和第一张卡**。 | 官方确认一键开启跑步/健身/骑行、课程库和 AI 日程计划。自由记录入口和 Today 卡的当前具体位置 `unknown`。 | 官方确认 AI 数据解读、运动档案、身体/心率/HRV 等健康数据，但当前首屏排序 `unknown`。 | 卡卡支持计划、数据记录和解释；官方披露其多 Agent、意图识别、persona 和 memory，但 9.x 聊天入口形态 `unknown`。 | 当前底部导航、卡片点击进入 chat/sheet/full page 均不能从有效一手截图可靠确认。 | 只能借鉴“内容执行 + 吃练睡 + 主动 Agent 编排”的产品能力，不能把过期截图当 9.x UI。[Keep App Store](https://apps.apple.com/cn/app/keep-ai-%E8%BF%90%E5%8A%A8%E6%95%99%E7%BB%83/id952694580)、[Keep 2025 中期报告](https://www1.hkexnews.hk/listedco/listconews/sehk/2025/0825/2025082500859_c.pdf) |
| **训记** | 当前 App Store 宣传图以官方计划/个人模板列表为训练入口；另一份官方功能演示视频顶部先出现饮食记录、下接今日安排。但视频没有版本日期，不能证明是 7.0.366 当前默认首页。 | 中央 `训练/饮食` 是强入口；动作库、历史和计划内每组记录可直接操作。官方计划、个人模板、自定义动作均有入口。 | `历史` 有月历/年报和容量数据；训练详情有动作历史/图表/置顶备注。 | 最新官方版本说明确认 AI 可读取官方训练计划、复制训练/饮食 Skills，并提到喵喵教练；当前聊天输入框和首屏入口 `unknown`。 | App Store 媒体可见 `训练 / 动作 / 训练·饮食 / 历史 / 我的`；但截图内容日期为 2023，需视为官方媒体而非当前 UI 证明。训练记录是 full page，动作设置/更多使用菜单。 | 最适合借鉴“自由记录永远可达”和专业训练数据，不应借其信息密度作为小白默认首页。[App Store](https://apps.apple.com/cn/app/%E8%AE%AD%E8%AE%B0-%E8%AE%AD%E7%BB%83%E8%AE%A1%E5%88%92%E4%B8%93%E5%AE%B6/id1464915553)、[官方全功能演示](https://trains.xunjiapp.cn/) |

## 经过验证的首页模式

### 1. 处方首页：打开就能开始

Fitbod、Freeletics 和 RP 都把当天/下一次训练放在最高层，而不是先展示趋势图或要求用户聊天。这说明计划主导产品的首屏必须能在不输入任何文字的情况下完成核心任务。

适用于 MaxPower：

- 第一张卡只表达一个任务：`今天练什么`。
- 主 CTA 只保留 `开始训练`。
- 卡内呈现时长、地点/器材、目标肌群、动作数和为什么有这次调整。
- `调整今天` 与 `记录计划外训练` 是次级入口，不能与主 CTA 等宽同权。

### 2. 状态首页：数据必须落到一个行动判断

WHOOP 通过 Sleep / Recovery / Strain 三个核心状态和解释卡减少数字阅读成本；Google Health 把可定制指标、主动消息和各领域洞察汇总在 Today。两者共同点是：首屏不是完整仪表盘，而是“今天最需要知道什么”。

适用于 MaxPower：

- 恢复卡只先显示 `照常 / 稍微收一点 / 恢复优先 / 暂停并处理`。
- 点入后才显示睡眠、HRV、主观疲劳、疼痛、训练负荷等证据。
- 不显示看似精确但不可操作的总分；不允许单一 wearable 分数直接改重量。

### 3. 自由记录是逃生口，不是首页第二主线

Fitbod 用 Create from Scratch / Add Exercise，Freeletics 用 Explore all，训记用中央训练入口和动作库。成熟产品都允许偏离推荐计划，但通常把它放在主处方旁边或下一层，而不是另做一个同权首页。

适用于 MaxPower：

- Today 的 `···` 或 `更多` 中始终提供 `记录计划外训练`。
- 用户开始自由训练后，Agent 询问是否把它计入本周期，不能默认污染计划完成率。
- 专业模式可把自由记录提升为首页快捷项；托管模式保持次级。

## 通用 Agent App 的入口与协作决策模式

### ChatGPT：一个 composer，能力收进 sheet

OpenAI 2025 移动 UI 把散落的工具图标收进统一 Skills/Tools 底部 sheet，composer 保留添加、工具、麦克风和语音入口，目的是降低输入区拥挤。历史 ChatGPT agent 模式从工具菜单或 `/agent` 进入，执行期间允许用户中断，并在高影响步骤暂停确认；截至本报告日期该旧 agent 模式已被 ChatGPT Work 等新表面替代，因此这里只引用其已经公开的交互原则，不把旧页面当当前 UI。[移动 composer 更新](https://help.openai.com/gu-in/articles/6825453-chatgpt-release-notes)、[Agent 帮助](https://help.openai.com/en/articles/11752874-chatgpt-agent)、[高影响确认](https://openai.com/index/prompt-injections/)

可借鉴：

- composer 视觉上保持一个输入面，不常驻一整排工具。
- 相机、动作分析、恢复、计划调整等进入能力 sheet；最常用的 2–3 项可作为 composer 上方 chips。
- 工具执行必须有独立状态卡，允许暂停/取消；不能只显示“正在思考”。

### Claude：对话产生独立结果对象

Claude Mobile 在输入框提供 dictation 和 voice；Android widget 将新聊天、相机、语音做成三个直接入口。Claude 的 Artifacts 和文件生成把可继续使用、下载或编辑的结果与普通聊天文本区分开。[Android widget](https://support.claude.com/en/articles/10534883-using-the-claude-widget-on-android)、[语音模式](https://support.claude.com/en/articles/11101966-use-voice-mode)、[文件结果](https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude)、[Artifacts](https://support.anthropic.com/en/articles/9547008-publishing-remixing-and-sharing-artifacts)

可借鉴：

- 训练计划、计划变更和周复盘应是独立可打开的 artifact/card，不是长对话中的 Markdown。
- 从首页卡进入聊天时，把当前计划、恢复约束或动作作为显式 context card 固定在 composer 上方。

### Gemini：多模态入口和可复用能力快捷方式

Gemini Mobile 明确支持键盘、语音、图片和相机；Gems 把稳定目标/偏好封装成可复用的专家快捷方式。Google Labs 的 workflow Gem 会先显示工作流 steps 和 preview，用户点击 `Start app` 后执行，是公开资料里最明确的“计划预览后运行”模式之一；但该 workflow 功能当前仅 Web/实验性，不应误写为移动端既有模式。[Gemini Mobile](https://support.google.com/gemini/answer/14579631?hl=en-GP&p=answers&rd=1)、[Gem 快捷方式](https://support.google.com/gemini/answer/15236405?hl=en-GB)、[工作流 preview](https://support.google.com/gemini/answer/16802014?hl=en-GB)

可借鉴：

- 相机不是独立“AI 页面”，而是 composer 的上下文采集方式。
- 用户 Recipe（如“酒店 30 分钟训练”“卧推日复盘”）可表现为 capability chips，而不是另做复杂自动化编辑器。
- 中高风险或大范围变化先展示步骤/差异，再执行。

## 推荐的 MaxPower 首屏

### 信息层级

首屏只允许一个 Hero，其他卡按稳定槽位排列；内容可变化，但卡片职责不能随机漂移。

1. **阻断层（条件显示）**：疼痛、安全、传感器不可用、计划冲突。没有阻断时不占位。
2. **今日训练 Hero**：训练名、目标、时长、器材、预计强度、开始按钮。
3. **Coach 变更摘要**：只在今天计划被调整时出现；显示“一句话原因 + 查看差异 + 撤销”。
4. **恢复卡**：四级人话状态 + 一个行动后果，例如“减少 1 组，不降低主动作重量”。
5. **本周进展卡**：完成 `2/4`、目标肌群覆盖和下一重要里程碑。
6. **次级卡**：营养、睡眠、最近 PR、日程冲突中最多展示两个；其余进入查看全部。
7. **常驻 Coach composer**：在底部导航上方，但不能遮住 Hero CTA。

建议草图：

```text
早上好，今天上肢增肌                         [头像]

┌ 今日训练 ─────────────────────────┐
│ 上肢 A · 胸背重点                  │
│ 52 分钟 · 健身房 · 5 个动作        │
│ 睡眠偏少，辅助动作减少 1 组         │
│ [开始训练]                         │
│ 调整今天                  查看详情  │
└───────────────────────────────────┘

┌ 恢复：稍微收一点 ┐  ┌ 本周 2 / 4 ┐
│ 强度照常，少一组  │  │ 连续第 3 周 │
└─────────────────┘  └─────────────┘

┌ 最近调整 ─────────────────────────┐
│ 卧推 50 → 52.5 kg · 因连续达成 RIR │
│ 查看依据                         撤销│
└───────────────────────────────────┘

[ 调整今天 ] [ 记录计划外训练 ] [ 看进展 ]
┌ +  问 Coach 或告诉我今天的变化   🎙 ┐
└───────────────────────────────────┘

 今天        计划        进展        我的
```

### composer 与 chat 的转场

- 首页 composer 默认显示 `问 Coach 或告诉我今天的变化`。
- 点击输入框进入 full-page chat，而不是小浮层；键盘、长回答、计划预览和相机证据需要完整空间。
- 转场时附带一个可见 context card：`今日上肢 A`。用户可以移除或切换为 `本周计划 / 最近一次卧推 / 恢复状态`。
- composer 上方只显示 3 个动态 chips：例如 `调整今天`、`记录训练`、`解释恢复`。更多能力进入 `+` sheet。
- 点击首页具体卡再进入聊天时，自动带上该卡上下文，例如从恢复卡进入就是 `解释今天为什么减一组`，不是空白聊天。

### 卡片点击语义

| UI 元素 | 默认点击结果 |
|---|---|
| 今日训练 Hero / 查看详情 | Full page session prescription |
| 开始训练 | 直接进入 execution，不经过聊天 |
| 调整今天 | 先开结构化 bottom sheet；选择“其他”或点输入框进入带计划上下文的 chat |
| 恢复 / 进展卡 | Full page evidence/detail；页内可继续 Ask Coach |
| 最近调整 | Plan change artifact；显示 before/after、证据、规则版本、权限来源和 undo |
| composer | Full-page contextual chat |
| capability chip | 简单记录走 sheet；需要推理或多轮沟通走 chat |
| 相机 / 附件 | composer 的 context acquisition sheet，不另建 Agent tab |

## 协作决策与执行 UI

### 计划变化不要只有聊天气泡

每次计划变化都应生成 `PlanChangeCard`：

```text
调整卧推进阶
50 kg × 8–10  →  52.5 kg × 6–8

依据：连续 2 次达到目标 RIR；无疼痛；器材支持 2.5 kg 档位
权限：托管模式 · 自动渐进 ≤ 5%

[查看完整依据]                         [撤销]
```

### 三种决策路径

1. **自动执行 + 通知 + Undo**：用户已授权，且变化在重量、组数、日程等变更预算内。
2. **Preview + Confirm**：修改周期目标、训练频率、大幅周容量、饮食策略或锁定字段。
3. **Safety hold**：疼痛、疑似伤病、冲突数据或权限不足；Agent 只能解释与建议下一安全动作。

这比“每次都问你是否同意”更适合小白，同时保留了专业用户需要的可见性和控制权。

### 执行中状态

不要使用无限旋转的“AI 正在思考”。建议把 tool call 映射为用户能理解的阶段：

```text
正在调整今天的训练
✓ 读取本周计划
✓ 检查器材和剩余时间
● 计算动作替代与训练量
○ 写入计划

[取消]
```

低于约 1 秒的本地确定性调用不展示过程；多步或云端调用才显示过程卡。任何计划写入都要在最后生成结果卡，并支持 Undo 或明确说明为什么不能撤销。

## 反模式

- **首页变成聊天空白页**：小白不知道该问什么，训练主任务被隐藏。
- **每张卡都可以随 Agent 心情重排**：用户无法形成肌肉记忆；只允许槽位内内容动态变化。
- **多个同权主 CTA**：开始训练、自由记录、问 Coach、看计划不能四个大按钮并列。
- **卡片堆成指标仪表盘**：HRV、睡眠、strain、酸痛如果没有对应行动，不能占首页第一屏。
- **计划变化只存在于气泡**：用户离开聊天后无法确认当前真实计划，也无法审计或撤销。
- **所有 tool 都暴露成 chip**：工具数量增长会复刻旧 ChatGPT composer 拥挤问题；常用 3 个，其余放 sheet。
- **自由输入直接修改数据库**：聊天先变成 typed intent，规则/权限层生成 plan change，再写入版本化计划。
- **强制逐次确认**：普通用户并无能力判断每次重量或组数调整；确认应发生在权限、越权和高风险变化层。
- **相机独立成为首页主产品**：骨架识别是训练执行证据，不应再次把产品退化为拍摄工具。

## 建议的底部导航

推荐：`今天 / 计划 / 进展 / 我的`，Agent 不占单独 Tab。

- `今天`：执行、状态、即时调整与 composer。
- `计划`：周历、周期、目标、日程和锁定项。
- `进展`：动作表现、训练量、身体指标与目标预测。
- `我的`：器材、地点、健康数据、权限模式、本地/云端、账户。
- `自由记录` 通过 Today 次级入口、系统快捷方式和训练 Hero 的更多菜单访问；专业模式可固定为快捷 chip。

理由：Google Health 和 WHOOP 证明 Coach 可以作为跨页面能力存在；Fitbod、Freeletics、RP 则证明训练用户首先需要的是可执行处方。独立 Agent Tab 会把上下文从当前任务剥离，增加“先打开聊天，再解释我在哪”的成本。

## 需要原型验证的未知项

官方资料不能代替本产品可用性测试。进入视觉设计前建议用可点击原型验证：

1. 常驻 composer 是否使用户误以为必须聊天才能开始训练。
2. `调整今天` 先出结构化 sheet 还是直接 chat，哪种完成更快。
3. 计划变更自动执行后的 `Undo` 可发现性。
4. 恢复卡与本周进度卡谁更应该占第一屏。
5. 自由记录放在 Hero 更多菜单、chip 还是显式文本入口，对专业用户的影响。
6. 训练中是否保留 composer，还是改为“换动作 / 记录不适 / 问 Coach”三个上下文按钮。

建议至少覆盖三类任务：首次小白开始训练、普通用户因时间/器材变化调整今天、高阶用户查看并覆盖 Agent 的负荷调整。

## 来源说明

- 应用商店页面和 Apple Search API 的版本/媒体于 2026-08-08 检索。应用版本可以是当前的，但开发者提供的宣传截图本身可能陈旧；报告已逐项注明。
- Keep 9.x 和训记当前真实首屏缺少足够的一手、带版本 UI 证据，未用第三方评测图补齐。
- 本报告讨论交互事实与模式，不把 App Store 评分、市场规模或公司自报使用量当作 UI 有效性证据。
