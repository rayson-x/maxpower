# 用户档案字段盘点与缺口

> 日期：2026-08-13
> 状态：current-state audit + target field catalog proposal
> 范围：首次建档、对话自动填表、Planner 输入和客户端档案展示

## 1. 领域边界

产品里常说的“用户档案”应称为 **User dossier（用户档案视图）**。它不是一个可以无限加字段的单一 Aggregate，而是以下权威数据的组合投影：

| 所有者 | 保存什么 | 不保存什么 |
| --- | --- | --- |
| User Profile | 相对稳定的个人事实、训练背景、环境、偏好和长期限制 | 目标、当天状态、完成记录、计划 |
| Goal Contract | 想达到什么、何时达到、保护什么、愿意付出什么 | 用户身体事实和训练历史 |
| Coaching Mandate | Agent可以代办什么、哪些操作必须确认、限制和锁定 | 用户偏好和计划内容 |
| Permission Set | 相机、健康数据、通知、远程语言模型、同步和媒体权限 | 健康结论和产品偏好 |
| Safety Constraint | 当前自动化必须遵守的停止、暂停和专业限制 | 诊断和病史推断 |
| Timeline | 体重、围度、体脂、训练组、饮食、睡眠和恢复等带时间的事实 | 长期目标和计划 |
| Nutrition Strategy | 当前能量、宏量、日类型和复核窗口 | 用户事实本身 |
| Working Memory | 尚未能映射为正式字段的非权威线索 | 未确认事实和自动规划依据 |

因此，对话中发现“有价值的信息”时不能一律写进 Profile：

```text
稳定事实或明确偏好 → User Profile draft
目标、期限和取舍 → Goal Contract draft
Agent权限选择 → Coaching Mandate draft
安全限制 → Safety draft
发生过或测量到的事情 → Timeline Record draft
暂时无法结构化的线索 → Working Memory（非权威）
```

## 2. 当前客户端实际可以填写

以下字段来自当前 `ProductShell` 建档页面，不等于底层模型的全部能力。

### 2.1 首屏必经选项

| 页面字段 | 当前写入 | 备注 |
| --- | --- | --- |
| 训练起点 | `profile.trainingExperience` | 刚开始 / 规律训练 / 进阶训练 |
| 主目标 | `goal.primaryGoal` | 增肌 / 力量 / 减脂保肌；没有自由目标原文 |
| 每周训练次数 | `profile.schedule.weeklyFrequency` | 当前只给 2–5 次快捷选项 |
| 单次训练时长 | `profile.schedule.sessionDurationMinutes` | 当前只给 30/45/60/75 分钟 |
| 主要场景 | `profile.locations[0]` | 只有家里或健身房；器械由页面固定猜成徒手/全健身房 |
| Agent协作模式 | `mandate.mode` 和整组默认 scopes | manual / collaborative / managed |

### 2.2 可选基础信息

| 页面字段 | 当前写入 | 备注 |
| --- | --- | --- |
| 年龄 | `profile.demographics.ageYears` | 没有生日、出生年份或采集日期，年龄会随时间失效 |
| 性别 | `profile.demographics.sex` | 可未知或不填写 |
| 身高 | `profile.demographics.height` | cm |
| 当前体重 | `profile.demographics.currentWeight` | 同时又可作为 Timeline 身体测量，存在双重所有权问题 |
| 已知维持热量 | Nutrition Strategy 的起始输入 | 不进入 Onboarding draft/Profile；来源和测量窗口未保存 |
| 更具体阶段意图 | `goal.goalType` | 增肌 / 减脂 / 增力 / 维持 / 重返训练 |
| 饮食条件自由文本 | `profile.nutritionPreferences[]` | 一个字符串，没有结构化为外食频率、烹饪条件等 |

### 2.3 可选专业信息

| 页面字段 | 当前写入 | 备注 |
| --- | --- | --- |
| 深蹲重量 | `professional.strengthBaseline.squat` → Profile | 没有次数、RIR和动作变式，不能判断真实水平 |
| 卧推重量 | `professional.strengthBaseline.benchPress` → Profile | 同上 |
| 硬拉重量 | `professional.strengthBaseline.deadlift` → Profile | 同上 |
| 腰围 | Professional body observation → Timeline | 可以保存，但没有同步到 Profile 的 currentCircumferences 投影 |
| 颈围 | Professional body observation → Timeline | 同上 |
| 当前体脂率 | Professional body observation → Timeline | 体脂方法只是自由文本 condition，没有进入 Goal target.currentBodyFat |
| 体脂数据来源 | body observation condition | 没有受控测量方法和不确定区间 |
| 平台持续周数 | `profile.historyModifiers.plateau.durationWeeks` | 不要求可比测量窗口 |
| 往期策略 | `historyModifiers.priorStrategies` | 自由文本拆分 |
| 最近执行情况 | `historyModifiers.plateau.executionAdherence` | 只在“平台资料”里出现，语义耦合错误 |
| 最近恢复变化 | `historyModifiers.plateau.recoveryChange` | 同上，不是恢复事实本身 |

### 2.4 安全确认

客户端当前只让用户确认：

- 已成年；
- 当前没有需要立即停止运动的症状或专业人员限制。

但提交时把“专业限制、近期手术/急性受伤、孕产特殊情况、低能量或饮食失调风险、stop signals”全部写成 `false/[]`。这不是有效筛查：用户勾选一句总确认，不足以证明每一项都是明确否认。

## 3. Onboarding Draft 模型支持、客户端却没有入口

### 3.1 User Profile draft

- `returningStatus`：新手、回归、持续训练；客户端固定写 `new`。
- 多地点训练环境：home / gym / hotel / outdoor / other。
- 每个地点的空间、噪声和具体器械。
- `bodyDirection`：增重、减脂、维持、只看表现；客户端由主目标自动推导。
- 动作限制：不能做、不喜欢、暂时不可用、政策性不推荐。
- 多条营养偏好。
- 专业人员给出的训练、营养、动作和日程限制。

### 3.2 Goal draft

- conditioning / health 次要目标；
- 自定义成功指标；
- 开始和结束日期；
- 可接受代价和不可接受代价；
- 测量策略和维持底线；
- 目标体重、目标体脂、力量目标和目标围度。

### 3.3 Coaching Mandate draft

- 各能力单独选择 manual / confirm / managed_small_step；
- 最大加重百分比、最大周组数变化；
- 动作、训练日、重量、组数、周结构、专业限制等锁定；
- 授权有效期。

客户端目前用一个模式替用户批量生成全部 scopes 和固定 limits，用户不能逐项表达。

### 3.4 Permission draft

- camera；
- health；
- notifications；
- remote LLM；
- cloud sync；
- media upload。

客户端建档时不询问，默认 remote LLM 和 cloud sync 为 granted，其余 not configured。

### 3.5 Safety draft

- 专业人员限制；
- 近期手术或急性受伤；
- 孕期或产后特殊考虑；
- 饮食失调或低能量风险自报；
- 胸痛、眩晕/晕厥、异常呼吸困难、新发显著疼痛、心悸、异常疲劳；
- 带有效期和机器可执行边界的专业限制。

### 3.6 Professional draft

- 近期分化；
- 按肌群统计的周训练量；
- 带动作变式、日期、重量、次数和RIR的历史组；
- 多次体重、体脂和围度记录及测量条件；
- 能量摄入观察及 exact/estimate/import 来源；
- 公式、输入、范围和用户覆盖值分离的体脂估计；
- 重大减重、维持和反弹/饥饿经历；
- 睡眠、疲劳、酸痛和主观恢复观察；
- 用户自定义动作。

## 4. 正式领域模型支持，Onboarding Draft 仍然填不了

这是当前最大缺口：Planner 已经读取这些字段，但首次建档无法收集或完成时不会映射。

### 4.1 Profile 缺失入口

| 正式字段 | 规划用途 | 当前问题 |
| --- | --- | --- |
| `dailyActivityLevel` | TDEE、NEAT和每日能量预算 | 草稿无字段；居家办公等关键信息无法结构化 |
| `metabolicExerciseSafety` | 空腹有氧、HIIT和低血糖安全门控 | 草稿无字段 |
| `demographics.currentCircumferences` | 体脂估计和视觉目标 | Professional可写Timeline，但不形成Profile当前投影 |
| `exercisePreferences` | 长期动作偏好 | 草稿只有 constraints，无明确喜欢/优先动作入口 |
| `primaryDataSources` | 体重、睡眠等多来源冲突选择 | 草稿无字段 |
| `trainingHistorySummary` | 当前分化和周量 | Professional有字段，但客户端不填 |
| `strengthBaseline.*Reps` | 冷启动负荷与水平判断 | 正式模型有，草稿和客户端都没有 |
| `historyModifiers.recentPhase` | 刚增肌/减脂/维持后的起步策略 | 草稿无字段 |

### 4.2 Goal Contract 缺失入口或完成映射

| 正式字段 | 规划用途 | 当前问题 |
| --- | --- | --- |
| `targetMode` | 大体重减脂、保肌减脂、力量优先减脂 | 草稿无字段 |
| `executionTier` | 保期限、平衡、保可持续性 | 草稿无字段 |
| `guardrails` | 最低恢复、关键训练完成保护 | 草稿无字段 |
| `measurementPlan` | 规定体重、腰围、关键力量的可比观测 | 草稿无字段 |
| `slowdownConsent` | 是否允许延后期限或降低负担 | 应在计划调整时收集，不应建档默认 |
| `plannedRecoveryEveryWeeks` | 用户明确选择的恢复窗口 | 草稿无字段；不能自动强制周期化 |
| `missedSessionPolicy` | 漏训轮转顺延或跳过 | 草稿无字段 |
| `dietStrategyId/Locked` | 饮食策略选择与锁定 | 建档另建Nutrition Strategy，但Goal没有选择记录 |
| `emphasisMuscles` | 塑形目标肌群 | 草稿无字段 |
| `deemphasisMuscles` | 用户明确希望减弱的部位 | 草稿无字段 |
| `dailyStepTarget` | 减脂NEAT计划 | 草稿无字段 |
| `recentPhase` | 目标侧近期阶段 | 与Profile同概念重复，需要确定唯一所有者 |
| `targetWeeks/pace` | 目标速度和执行严格度 | 草稿只有horizon，客户端固定84天 |
| `aerobicPreference` | 有氧角色、时机和强度偏好 | 草稿无字段 |
| `commitmentPreferences` | 训练、饮食、恢复分别愿意做到什么程度 | 草稿无字段 |
| `targets.currentBodyFat` | 体脂目标时间线起点 | 用户体脂只写Timeline，没有映射到目标合同 |
| `targetShoulderWaistRatio/targetWaist/targetShoulder` | 宽肩窄腰等视觉目标 | 草稿只能写通用circumferences，缺视觉语义 |

## 5. 领域模型仍缺少的字段

### P0：建档和首次计划会直接受影响

1. **目标原话及来源引用**
   当前只有枚举和结构化目标，无法保留“想把体脂降到12%，目前16%”的完整意图，也无法证明12和16来自哪条用户消息。应增加 `goalIntentNarrative` 或 Capture ref，而不是只存摘要。

2. **年龄的时间语义**
   只保存 `ageYears` 会过期。应选择：可选完整生日、出生年份及精度，或 `ageYears + observedAt`。根据年龄推算的出生年份只能是候选范围，不是事实。

3. **训练年限与连续性**
   beginner/intermediate/advanced 太粗。Agent可从自然对话捕获 `trainingYearsRange`、最近连续训练月数和近期停训时长，并在它们会改变计划时追问具体事实；等级不应作为用户必填项。

4. **可执行日程**
   每周次数和单次时长不足以排计划。需要可训练星期/日期、常用时段、日期弹性、工作/出差等稳定限制。临时变化仍进Timeline。

5. **目标定义的自由语义**
   当前没有明确的 physique / recomposition 目标类型。“宽肩窄腰”“腹肌清晰”“同时降低腰围并维持力量”只能塞进肌群或字符串，缺少可验证的多目标表达。

6. **力量基线的可比上下文**
   重量必须与 exact exercise variant、次数、RIR/RPE、日期、是否比赛标准或训练动作绑定。只填“卧推80kg”没有规划意义。

7. **饮食执行环境**
   `nutritionPreferences: string[]` 不足以支持规划。需要结构化记录常见外食/自己做饭、记录意愿、预算/时间、饮食限制、当前执行稳定性。具体吃了什么仍进Timeline。

8. **当前恢复基线而非一次状态**
   首次计划至少需要近期睡眠常态、疲劳、酸痛/疼痛和压力对训练的影响；这些应生成带时间窗的Timeline baselines，不应成为永恒Profile字段。

9. **用户自选训练等级代替了教练评估**
   当前客户端让用户直接选 beginner / intermediate / advanced，Planner又直接用该枚举决定分化、动作复杂度和训练量。这会把最重要的教练判断交给用户，也会让“会说术语”“练过几年”和“当前能够稳定执行”被错误合并。

## 5.1 训练水平和状态应该怎样评估

用户不需要回答“你是什么水平”。Agent应从对话和已有事实形成临时判断，并只在缺少会改变计划的证据时追问具体事实。

### 三类数据必须分开

| 类型 | 例子 | 所有者 |
| --- | --- | --- |
| Training background | 训练两年、最近四分化、卧推80×5 RIR1、停训三个月 | User Profile + Timeline facts |
| Coaching level assessment | 需要冷启动校准、已有稳定动作经验、能否承受较高自主训练复杂度 | 版本化assessment artifact |
| Readiness state | 昨晚睡差、腿部酸痛、最近表现下降、这周只能练三天 | Timeline + Recovery/Risk assessment |

### Level不是一个维度

建议至少分别判断：

- 训练编排理解：是否理解组次、RIR、分化和进阶；
- 动作熟悉度：按exact exercise variant分别评估；
- 当前表现证据：可比重量、次数、RIR和近期趋势；
- 训练连续性：近期是否稳定训练，而不是累计年限；
- 自我调节能力：能否根据疲劳、疼痛和日程调整；
- 执行稳定性：计划完成、饮食和记录的真实连续性；
- 当前Readiness：恢复、酸痛、时间和安全状态。

### 对话中的正确行为

```text
用户自然表达
→ 捕获明确事实
→ 基于证据形成 provisional assessment
→ 证据足够：不再问“你的训练水平”
→ 只有某个缺口会改变首计划：问一个具体高信息问题
→ 首两次训练继续校准
→ 新证据更新assessment，不改写历史事实
```

例如用户说“最近一直四分化，深蹲100×3、卧推80×5、硬拉110×4”，Agent已经可以判断他不是需要从全身两分化教学起步的普通新手，不应再要求选择“初级/中级”。但这段话仍不能证明动作质量、RIR、训练连续性和今天的恢复状态；只有这些会改变当前安排时才继续询问或在训练中观察。

术语熟练度只能作为弱证据。用户可能复制网络表达；反过来，一个训练成熟的人也可能不使用RIR等术语。因此每项assessment必须保留支持证据、反例、未知项、评估时间和复核条件。

### P1：提高视觉目标和长期调整能力

- 视觉目标的目标部位、维持部位和不希望增长部位；
- 标准照片的拍摄协议和照片引用，而不是照片结论；
- 腰、颈、胸、肩、髋、大腿、上臂等测量方法和条件；
- 当前有氧基础：方式、时长、频率、耐受和可用设备；
- 日均步数或活动区间及来源；
- 训练动作喜欢、讨厌、不可做、替代偏好和原因；
- 计划复杂度偏好：详细计划或最简执行版；
- 计划复核节奏和通知偏好。

### P2：不应混入教练档案的账号设置

- Agent名字和表现风格；
- 昵称、头像；
- 邮箱、电话、地址；
- UI语言、主题和营销通知。

这些属于账号或产品设置，不应影响Planner事实，也不应发送给领域知识检索。

## 6. 建议的目标字段目录

字段目录应是固定、版本化的，Agent只负责根据目标选择和组合。

### 6.1 用户唯一必填的Baseline intake

| 主题 | 字段 |
| --- | --- |
| 基础 | 年龄；身高；当前体重 |
| 目标 | 用户自己的自由语言目标 |

只有这四项是建档交互中要求用户主动提供的固定信息。目标原话中的结构化内容由Agent同时提取，例如“想把体脂降到12%，目前16%”会生成目标体脂12%和当前体脂16%的草稿候选，并保留原消息引用。

其余字段不是通用必填项，来源只有四种：

1. 用户自然对话已经明确提到，Agent自动填入草稿；
2. Agent根据目标判断某项会改变下一步，通过对话或动态小表单获取；
3. 后续训练、Timeline或健康数据逐步观察；
4. 没有必要时永久保持未知。

FieldCatalog应为每个字段声明 `requiredFor`，例如 `initial_training_plan`、`energy_target`、`fasted_cardio` 或 `workout_execution`。这是一项动作的证据门槛，不是把字段升级为建档必填。

“训练等级”不列为用户必填字段。建档可以收集训练经历和近期表现，系统生成 provisional Coaching level assessment；证据不足时用保守起点并在真实训练中校准。

### 6.2 减脂或体型目标的条件字段

- 当前体脂值、方法、日期和可信范围；
- 目标体脂/腰围/体重及截止日期；
- 当前腰围，必要时颈围和其他视觉围度；
- 关键力量或保肌表现底线；
- 日常活动、步数和居家/站立/体力劳动情况；
- 饮食环境、执行档位和历史执行稳定性；
- 有氧角色与偏好；
- 低血糖/代谢运动安全；
- 视觉强调肌群和不可接受代价。

### 6.3 增肌目标的条件字段

- 目标肌群、维持肌群和明确减弱肌群；
- 当前体重趋势和愿意接受的增重速度；
- 当前分化、按肌群周量和最近可比动作表现；
- 可恢复训练天数、睡眠常态和近期阶段；
- 饮食执行能力与盈余接受度。

### 6.4 力量目标的条件字段

- 目标 exact lift、目标重量和截止日期；
- 当前 exact variant 的重量、次数、RIR/RPE、日期和测试条件；
- 当前训练频率、分化、失败点和动作限制；
- 体重级别或体重变化是否允许；
- 优先级：绝对力量、相对力量或同时减脂保护力量。

### 6.5 重返训练的条件字段

- 停训时长和停训前稳定训练量；
- 当前可用时间、器械和恢复常态；
- 用户明确的专业限制或需要许可的边界；
- 首阶段更看重动作重建、习惯恢复还是表现恢复。

## 7. 字段基础设施缺口

0. 当前实现不符合Baseline intake决定：客户端首屏还要求训练等级、主目标枚举、频率、时长、场地和协作模式；Onboarding完成校验还要求trainingExperience、schedule、locations、bodyDirection、primaryGoal、horizon、successMetrics和mandate scopes。迁移时必须区分“用户四项必填”“Agent可推导候选”和“具体动作的requiredFor”，不能用默认值假装用户回答过。
1. 当前 provenance 只到 Profile 顶层字段，不能证明嵌套字段来自哪条消息。
2. `mergePatch` 对嵌套对象是浅合并；分轮填写 demographics、targets 或 professional 子对象时可能覆盖兄弟字段。
3. Draft只有 section-level confirmed，没有 field-level `captured / normalized / estimated / confirmed / conflicted`。
4. 没有统一 FieldCatalog，客户端表单、Agent tool schema、Onboarding model 和完成映射会继续漂移。
5. 没有 `requiredFor` 和目标依赖条件，Agent无法可靠判断“现在必须问什么”。
6. 当前客户端把多项未知安全事实直接写成 false，违反“缺失不等于否定”。
7. 当前体重和围度同时出现在Profile与Timeline语义中；应由Timeline拥有测量事实，User dossier投影“最新值”。
8. 当前体脂既可作为Timeline测量，又在Goal targets中保存 currentBodyFat；应明确后者只是钉住的目标起点引用或快照，不是第二个可编辑真值。
9. `profile.trainingExperience` 目前既是用户自报字段又直接控制Planner的重要分支；它应被Training background和版本化Coaching level assessment取代，或至少不再单独决定分化与训练复杂度。

## 8. 建议优先级

### P0

1. 建立统一、版本化 FieldCatalog，覆盖Profile、Goal、Mandate、Safety和Timeline baseline。
2. 修复安全未知值被写成false。
3. 增加field-level provenance、状态和深层patch语义。
4. 补齐目标原话、期限、当前/目标体脂、daily activity、训练年限、可训练日、器械和力量次数/RIR。
5. 将当前体重、围度和体脂的权威所有者统一到Timeline，User dossier展示最新投影。
6. 建立多维Coaching level assessment和Readiness state，移除让用户自选等级后直接驱动Planner的路径。

### P1

1. 补齐commitment、aerobic、emphasis/deemphasis、missed-session和measurement-plan字段。
2. 建立按目标返回材料性字段的Knowledge Intake Requirement，不让LLM凭模型先验决定问卷。
3. 客户端和Agent都从同一个FieldCatalog渲染/提交，移除手写字段漂移。

### P2

- 账号资料、Agent人格和外观设置独立于教练User dossier。
