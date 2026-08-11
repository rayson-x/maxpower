# 竞品能力对标：动作监控、自适应计划、营养账本、恢复管理（2026-08-11）

## 结论先行

四条能力上，市面的真实天花板差异极大：

- **营养账本是唯一已经被做透的一条。** MacroFactor 有公开、可核实的自适应算法文档：按周复核、用「摄入 + 趋势体重变化」反推能量消耗、有明确的最低记录门槛和平滑逻辑，且调整需要用户在 check-in 中确认。MaxPower 在这条上**不构成差异化，是入场券**。
- **AI 动作监控普遍是「受限场景 + 强营销声称」。** 能查到的官方口径都把可用范围限定在特定课程类型或特定动作集合，而营销页给出的是「100% 准确」这类无法核实的绝对表述。这条上真实天花板远低于宣传。
- **自适应训练计划普遍只用训练历史，不用主观恢复输入。** 恢复度基本是从「上次练了什么、隔了多久」推算出来的衰减曲线，而不是来自睡眠、酸痛、疲劳的真实反馈。
- **恢复管理被穿戴设备占据，但它与训练计划是断开的。** Whoop 这类设备把恢复算得很细，却不直接产出「今天这次训练怎么改」的处方。

对 MaxPower 而言，**差异化不在任何单项能力上，而在四项之间的连接**：把恢复输入真正接进当日训练调整、把训练日类型接进当日营养预算、把动作观察接进下一组处方。这三条连接在本次调研中没有找到任何一家公开做到。

> 边界：本篇的证据强度参差不齐，且我未能取得其中两家的官方支持文档（见下方「证据强度」列）。**营销页的功能表述一律记为「厂商声称」，不作为该能力存在的证据。** 定价与功能会变，本篇所有结论的查证日期均为 2026-08-11。

## 与前作的关系

本篇不重复以下前作已确立的内容，只补「四项能力各自的真实天花板」这一层：

- [`2026-08-05-simple-follow-along-training-apps.md`](2026-08-05-simple-follow-along-training-apps.md)、[`2026-08-08-fitness-app-home-ui-patterns.md`](2026-08-08-fitness-app-home-ui-patterns.md)：跟练类产品形态与首页信息架构。
- [`2026-08-08-fitness-coach-user-reviews-and-effectiveness.md`](2026-08-08-fitness-coach-user-reviews-and-effectiveness.md)：用户侧评价与有效性。
- [`2026-08-09-fitnesscat-goodgym-motion-tracker-pose-recognition.md`](2026-08-09-fitnesscat-goodgym-motion-tracker-pose-recognition.md)：国内两款动作识别产品的具体实现观察。

## 证据强度分级

本篇对每条证据标注来源类型，读者据此判断可信度：

| 级别 | 含义 |
| --- | --- |
| **A｜官方文档** | 直接抓取到的官方帮助中心 / 开发者文档原文 |
| **B｜官方域内容** | 厂商自有域名，但属于博客 / 内容营销栏目 |
| **C｜厂商声称** | 营销页或产品页表述，无独立技术文档佐证 |
| **D｜未能核实** | 目标页面返回 404 / 403，或本轮未查证 |

## 一手证据

### 1. 营养账本：MacroFactor 是唯一有完整公开算法说明的

**证据级别 A** —— 以下内容取自直接抓取的官方帮助文档 [How Does MacroFactor Make Adjustments For a Weight Gain or Weight Loss Goal](https://help.macrofactorapp.com/en/articles/222-how-does-macrofactor-make-adjustments-for-a-weight-gain-or-weight-loss-goal)。

- **调整频率**：按周。系统「invites you to complete a weekly check-in」，用户可以「dismiss a check-in, and check in at a later date」—— 即调整需经用户确认，不是静默改写。
- **能量消耗来源**：「MacroFactor continuously estimates your average daily energy expenditure based on your energy intake and trended rate of weight change」。这是从摄入与趋势体重反推，而非依赖公式或穿戴设备读数。
- **最低记录门槛**：营养「at least four days in each seven-day period (though seven days is ideal)」；体重「at least once per seven-day period (though at least three days is ideal)」。
- **平滑**：「additional smoothing logic helps ensure continuity of your program, and helps the coaching program avoid over-corrections」。
- **宏量分配**：先调能量，再调宏量；「protein recommendations scale with lean mass」，碳水与脂肪按所选方案（High-Carb / Balanced / Low-Carb / Keto）按比例调整。

> 值得注意的口径冲突：搜索摘要给出的门槛是「6 out of 7 days」，而官方文档原文是「at least four days in each seven-day period」。以官方文档为准。这正是不能用二手摘要替代一手抓取的具体例证。

这套设计与 MaxPower PRD 里 NutritionDayLedger + 复核 gate 的思路高度重合。**结论：这条是入场券，不是差异化点。** 真正的差距在于 MacroFactor 只做营养，不知道你今天练了什么。

### 2. AI 动作监控：官方口径受限，营销口径绝对化

**Peloton Guide**（证据级别 B / D）

官方支持页 [Peloton Guide Movement Tracker](https://support.onepeloton.com/s/article/9306851307412-Peloton-Guide-Movement-Tracker) 本轮返回 **404**，未能取得官方原文。以下来自 Peloton 自有域的博客与支持索引页（级别 B）：

- 能力被明确限定：「Only strength classes have rep or motion tracking」。
- rep tracker 与 motion tracker 是两件事：前者计次，后者仅感知「是否在动」，屏幕上以一个水滴形图标填充表示。
- 有 rep target（如 15/15）与 time target（如 30 秒）两种目标形态，课后可看每个动作的次数、重量与总量。

**证据级别 C（厂商声称，且本篇明确不采信为事实）**：Peloton 博客称「Through the camera, Guide counts reps, and it's 100 percent accurate」。

> 这句「100 percent accurate」是典型的不可核实绝对表述。它没有说明在什么动作集合、什么机位、什么遮挡条件下测得，也没有对应的技术文档。本仓库 [`unified-recognition-corpus-gate-2026-08-09.md`](../reports/unified-recognition-corpus-gate-2026-08-09.md) 已确立按「动作 × 变式 × 器械 × 机位」逐组验证的口径 —— 按该口径，这类无条件的准确率声称不构成任何证据。**MaxPower 不应对标这句话，也不应模仿这种表述方式。**

**Sency**（证据级别 C）

其营销页称使用边缘计算，「data is never sent to the cloud」，SDK 可在数分钟内集成，支持「dozens of exercises」，提供计次、动作分析、活动识别与姿势纠正。本轮未取得其技术文档以核实端侧推理的具体形态、动作清单或精度口径。

> 未查证的线索：本轮调研中出现过 VAY 采用云端架构、以及 KinesteX 与 PoseTracker 两家未列入初始名单的厂商。**这三条我没有亲自核实，此处仅作为后续待查线索记录，不作任何结论。**

### 3. 自适应训练计划：恢复度来自训练历史，不来自身体反馈

**Fitbod**（证据级别 B / D）

官方帮助中心文章 [Muscle Recovery](https://help.fitbod.me/hc/en-us/articles/360006269014-Muscle-Recovery) 与 [How Fitbod Creates Your Workout](https://help.fitbod.me/hc/en-us/articles/360004429814-How-Fitbod-Creates-Your-Workout) 本轮均返回 **403**，未能取得官方原文。以下来自 Fitbod 自有域博客（级别 B）：

- 每个肌群被赋予 0–100% 的恢复百分比，依据是近期训练历史。
- 优先选择「最近 48–72 小时未被重练」的肌群；完全恢复（回到 100%）的判定是休息 7 天。
- 若某肌群仍疲劳但必须练，会给较低强度或替代动作。
- 表现指标走平或下降时会提示需要恢复或调整编排（量、强度、变式）以避免平台。

**关键观察**：以上全部输入都是**训练历史的函数**。本轮没有找到任何官方说明表明 Fitbod 把睡眠、酸痛、主观疲劳作为恢复度的输入。也就是说，「恢复」在这类产品里是从「你练了什么、隔了多久」算出来的衰减曲线，而不是身体的真实反馈。

> 这与 MaxPower PRD 第 79–82 条（手工记录睡眠、疲劳、酸痛、主观恢复，并据此产生 RecoveryConstraint）是结构性差异，不是参数差异。

### 4. 恢复管理：穿戴设备算得细，但不产出训练处方

**Whoop**（证据级别 B）

来自 Whoop 自有域内容栏目（[How Does WHOOP Recovery Work](https://www.whoop.com/us/en/thelocker/how-does-whoop-recovery-work-101/)、[Recovery score 101](https://www.whoop.com/us/en/thelocker/recovery-hrv-training-capacity/)）：

- Recovery 分数的输入包括静息心率、HRV、呼吸频率、睡眠时长与质量、皮肤温度、血氧。
- HRV 权重最高，理由是它反映自主神经系统平衡。
- HRV 与静息心率在睡眠期间采集，因为此时运动与日间噪声较低。
- 呼吸频率通常夜间稳定，显著变化可能提示疾病。

Whoop 还提供开发者 API（[WHOOP for Developers](https://developer.whoop.com/docs/developing/user-data/recovery/)），可读取 recovery 数据。

**关键观察**：Whoop 输出的是一个身体状态分数，**不产出「今天这次训练的哪一组该怎么改」**。恢复数据与训练处方之间的那一段连接是空的。

> 与 MaxPower 的关系：PRD 明确把 Health Connect / HealthKit 排除在 MVP 之外，首版用手工事实。本条证据说明这个取舍在能力上是可接受的 —— 穿戴设备的优势在测量精度，而 MaxPower 要争的是测量之后的那一步。

## 能力矩阵

| 产品 | AI 动作监控 | 自适应训练计划 | 营养账本 | 恢复管理 |
| --- | --- | --- | --- | --- |
| Peloton Guide | 仅力量课程，计次与「是否在动」分离（B）；「100% 准确」为营销声称（C） | 未查证（D） | 未查证（D） | 未查证（D） |
| Fitbod | 无 | 肌群 0–100% 恢复度，输入仅训练历史（B） | 无 | 仅训练历史推算，无主观输入（B） |
| MacroFactor | 无 | 无 | **周度自适应，算法公开可核实（A）** | 无 |
| Whoop | 无 | 无 | 无 | **多信号 Recovery 分数 + 开发者 API（B）**，但不产出训练处方 |
| Sency（SDK） | 声称端侧、数十个动作（C），无技术文档佐证 | 不适用 | 不适用 | 不适用 |

> 矩阵中的「未查证（D）」是诚实的空白，不是「该产品没有此能力」。Peloton 一行的三个 D 是本轮时间与抓取失败所致，不应读作否定判断。

## 对 MaxPower 的定位判断

1. **营养账本是入场券，不要当卖点。** MacroFactor 已经把「自适应能量目标 + 用户确认 + 最低记录门槛 + 防过度修正」做到有公开文档的程度。MaxPower 的 NutritionDayLedger 必须做到这个水平才算合格，但做到了也不构成差异化。
2. **不要在动作监控的「准确率」上跟人比声称。** 市面最响的说法是无条件的「100% 准确」。本仓库既有的逐组验证口径（动作 × 变式 × 器械 × 机位）在诚实性上是优势，但它注定跑不出更漂亮的营销数字。差异化应落在「观察之后做了什么」，而不是「观察得多准」。
3. **真正的空白是三条连接，这是 MaxPower 唯一的结构性机会：**
   - 恢复输入 → 当日训练调整（Fitbod 的恢复度不含身体反馈；Whoop 的身体反馈不产出处方）
   - 训练日类型 → 当日营养预算（MacroFactor 不知道你今天练了什么）
   - 动作观察 → 下一组处方（Peloton 计次但不改处方）
   
   这三条连接恰好就是 PRD 里 04、03、02 三张票的核心，本轮调研中没有找到任何一家公开做到。
4. **恢复能力上不要追穿戴设备的测量精度。** 手工事实 + 明确的 unknown 语义，加上「能真正改变今天训练内容」的输出，比多接一个 HRV 数据源更有价值。PRD 把 Health 平台排除出 MVP 的取舍，本轮证据支持它。

## 未取得官方数据的条目

- Peloton Guide 官方支持页（404），未能核实动作支持范围、机位要求、器械要求与不支持场景。
- Fitbod 官方帮助中心两篇（403），恢复度算法的官方原文未取得，现有描述均来自其自有域博客。
- Sency 的技术文档、支持动作清单、端侧推理的具体形态与精度口径。
- VAY 的架构（云端 / 端侧）、KinesteX、PoseTracker 三条线索完全未核实。
- Peloton、Fitbod、MacroFactor、Whoop 的定价。
- 国内产品（Keep、FITURE、咕咚等）本轮完全未覆盖。
