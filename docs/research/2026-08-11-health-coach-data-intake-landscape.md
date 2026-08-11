# 健康／健身 Coach 的日常事件记录：证据、Schema 与确认策略（2026-08-11）

## 结论

这不是入组问卷问题。健康／健身 Coach 的主循环应是：**一天中发生一件事 → 用最合适的方式留下可核验事实 → 只让该事实改变下一步 → 必要时确认**。不要先收集完整健康档案，再试图从中猜测今天发生了什么。

本轮最有用的第一方证据支持三件事：

1. **训练日志应统一力量与有氧，但实际字段不同。** 力量的事实是动作、每组次数／负重及完成状态；有氧的事实是活动类型、起止时间、时长、距离和（可选）强度。MacroFactor、WHOOP、Google Health 都公开支持训练中记录组次／重量或活动实际值。[MacroFactor Workout logging](https://help.macrofactorapp.com/en/articles/310-how-to-log-a-workout) [WHOOP Strength/Strain](https://support.whoop.com/s/article/WHOOP-Strain?language=en_US) [Google Health custom workouts](https://support.google.com/googlehealth/answer/15402636?hl=en)
2. **自然语言、照片和语音只能产生候选／估算，不应静默写成营养事实。** MacroFactor 的语音／文本和照片识别都先生成可编辑条目，用户再执行 `Log Foods`；Cronometer 的食物搜索先进入份量和完整营养档案选择。这是 MaxPower 应继承的「草稿 → 明示确认」模式。[MacroFactor Describe](https://help.macrofactorapp.com/en/articles/216-log-foods-with-ai-describe) [MacroFactor Photo AI](https://help.macrofactorapp.com/en/articles/258-ai-food-logging) [Cronometer 食物搜索与份量](https://support.cronometer.com/hc/en-us/articles/360018955211-Mobile-Add-a-Food)
3. **恢复数据应优先被动导入，但缺失时必须有手工回退；提问应出现在会改变行动的时刻。** Google Health 可经 Health Connect／Apple Health 显示获授权的睡眠、训练和身体测量；WHOOP 则在当天记录行为、用恢复／已累积负荷更新当天目标。没有导入时，Coach 只在晨间、下一次训练前或用户报告异常时问一个短问题，而非发放每日问卷。[Google Health connections](https://support.google.com/googlehealth/answer/14236613?hl=en-GB) [WHOOP Journal](https://support.whoop.com/s/article/WHOOP-Journal-Overview?language=en_US) [WHOOP Strain Target](https://support.whoop.com/s/article/Strain-Coach)

## 一手来源表

| 产品／平台 | 第一方资料 | 本报告采用的直接证据 |
| --- | --- | --- |
| **MacroFactor** | [训练记录](https://help.macrofactorapp.com/en/articles/310-how-to-log-a-workout)、[自定义动作](https://help.macrofactorapp.com/en/articles/376-what-if-the-app-doesn-t-have-an-exercise-i-m-looking-for)、[文本／语音食物](https://help.macrofactorapp.com/en/articles/216-log-foods-with-ai-describe)、[食物照片](https://help.macrofactorapp.com/en/articles/258-ai-food-logging) | 每组实际重量／次数、训练时长；未收录动作可定义为次数、单侧重量、时长或距离；文本／语音／照片先产出可编辑食物条目。|
| **Google Health／Fitbit** | [自定义训练](https://support.google.com/googlehealth/answer/15402636?hl=en)、[手工活动／体重](https://support.google.com/googlehealth/answer/14236402?co=GENIE.Platform%3DAndroid&hl=en-GB)、[营养／对话记录](https://support.google.com/googlehealth/answer/14237210?hl=en) | 运动搜索、每个动作的组次／重量、跑步距离／配速；完成后 RPE；活动可编辑类型、起止时间、距离、热量；对话、文本和照片可记录健康／食物事实。|
| **Health Connect** | [数据类型](https://developer.android.com/health-and-fitness/health-connect/data-types)、[数据格式与 metadata](https://developer.android.com/health-and-fitness/health-connect/data-format)、[用户权限说明](https://support.google.com/android/answer/12201227?hl=en-en) | 睡眠、活动、身体测量、营养、生命体征等逐类授权；每条数据含来源应用、设备、记录方式和时间等 provenance。它是数据层，不是 Coach。|
| **WHOOP** | [Coach／Daily Outlook／Strength 上传](https://support.whoop.com/s/article/How-to-Use-the-AI-Powered-WHOOP-Coach)、[Journal](https://support.whoop.com/s/article/WHOOP-Journal-Overview?language=en_US)、[Strain](https://support.whoop.com/s/article/WHOOP-Strain?language=en_US) | 行为可当天即时记录；训练后／训练中可补动作、组次、次数、重量；文本或训练照片可由 Coach 提取后编辑；当天目标考虑 recovery 和已累积 strain。|
| **Oura** | [Meals](https://support.ouraring.com/hc/en-us/articles/40264659421843-Meals)、[Tags](https://support.ouraring.com/hc/en-us/articles/360038676993-Using-Tags)、[Apple Health integration](https://support.ouraring.com/hc/en-us/articles/360025438734-Apple-Health-Integration) | 餐食可拍照、上传或文本，用户可改名称／时间；Tag 可带时间、备注和自定义行为；在授权下可导入睡眠、活动、心率、身体数据。|
| **Cronometer** | [食物搜索／条码／份量](https://support.cronometer.com/hc/en-us/articles/360018955211-Mobile-Add-a-Food)、[手工运动](https://support.cronometer.com/hc/en-us/articles/360020448572-Mobile-Add-Exercise)、[备注和照片](https://support.cronometer.com/hc/en-us/articles/360018304351-Add-a-Note) | 食物数据库检索、条码和份量；手工运动包含类型、时长、强度；文本备注可带照片和时间戳。它证明记录层，不证明自动训练处方。|

## 1. 统一 Exercise Journal：一个事件，两套实际字段

### 交互要求

入口始终是「记录训练」；先选 **力量 / 有氧 / 灵活性或其他**，再进入可浏览的 movement list。列表至少提供：

- **力量筛选**：身体部位（胸、背、肩、臂、臀、腿、核心等）、器械／无器械、动作模式；
- **有氧筛选**：跑、走、骑行、划船、游泳、球类、徒步及其他；
- 搜索、最近使用、收藏和「自定义动作／活动」。Google Health 已公开支持按名称搜索并加入动作；MacroFactor 已公开支持动作库缺项时创建自定义动作。[Google Health custom workouts](https://support.google.com/googlehealth/answer/15402636?hl=en) [MacroFactor custom exercise](https://help.macrofactorapp.com/en/articles/376-what-if-the-app-doesn-t-have-an-exercise-i-m-looking-for)

目前查到的第一方资料可证实「搜索动作」「动作—肌群映射」「自定义动作」，但**没有一份资料明确证明在记录页使用身体部位筛选器**；因此身体部位／有氧筛选是 MaxPower 应实现的导航设计，不应伪称为某竞品已验证的 UI。MacroFactor 的 body map 证明了动作与肌群关系可被透明展示。[MacroFactor Levels](https://help.macrofactorapp.com/en/articles/342-understanding-levels)

### 推荐事件 Schema

```text
exercise_session
  id, started_at, ended_at, timezone
  kind: strength | cardio | mobility | other
  capture_mode: live_manual | post_manual | imported
  source: user_confirmed | HealthKit | HealthConnect | device_app
  status: draft | confirmed | imported
  entries[]

strength entry
  movement_id, display_name, primary_body_parts[], equipment
  sets[]: { set_kind, reps_actual, load_actual, load_unit, completed }
  rpe_session?             # 用户愿意时的主观用力

cardio entry
  activity_type
  started_at, ended_at, duration_actual
  distance_actual?, distance_unit?
  effort: rpe? | heart_rate_summary? | none
  route_ref?               # 仅在用户授权的导入来源存在时
```

**只记实际，不把处方写成完成。** `reps_actual`、`load_actual`、`duration_actual` 与计划中的目标字段分开；一组未完成应被保存为事实，而非自动改成计划值。MacroFactor 的训练流程要求用户在每组完成后输入实际重量和次数；WHOOP 说明连接已选动作、组次与重量可提高肌肉负荷估计；Google Health 在训练结束后收集 RPE 以供后续建议使用。[MacroFactor](https://help.macrofactorapp.com/en/articles/310-how-to-log-a-workout) [WHOOP](https://support.whoop.com/s/article/WHOOP-Strain?language=en_US) [Google Health](https://support.google.com/googlehealth/answer/15402636?hl=en)

**有氧不应伪装成力量组。** Google Health 的手工活动可修改类型、起止时间、距离和热量；其训练构建器也支持时间、距离、配速和心率目标。MaxPower 对未戴设备的跑／走／骑行，最低只需活动类型和时长；距离、配速、心率、路线均为可选事实。[Google Health 手工活动](https://support.google.com/googlehealth/answer/14236402?co=GENIE.Platform%3DAndroid&hl=en-GB) [Google Health 训练构建](https://support.google.com/googlehealth/answer/15402636?hl=en)

### 什么立即改变下一步

| 新事实 | 当天／下一次可改变的行动 | 不可做的推断 |
| --- | --- | --- |
| 一组实际次数／重量明显低于计划，或 session RPE 很高 | 下一组减量、延长休息、换低负荷版本，理由显示为「依据刚记录的实际完成／RPE」 | 不得把它诊断为疲劳、受伤或体能下降。|
| 训练已完成 | 结束同肌群的当天加练；更新已完成量 | 不得假定动作质量、疼痛或恢复良好。|
| 有氧的实际时长／距离／RPE | 更新当天累计活动与补水／恢复提示；影响下一次同类训练的保守进阶 | 不得在无心率／路线时杜撰配速或热量。|
| 用户报告疼痛、头晕、受伤或临时限制 | 当前动作停止自动加量，给替代／休息选项，并使约束带到其明确的有效期 | 不作诊断、治疗或医疗放行。|

## 2. Food Journal：数据库事实与 AI 估算必须分层

### 首选交互

1. **数据库选食物**：搜索、最近、收藏或条码；选中具体食物条目后填写份量和单位，再显示该条目的营养快照。Cronometer 的官方流程正是名称／条码搜索 → 食物条目 → 份量、日记分组和完整营养档案。[Cronometer Add Food](https://support.cronometer.com/hc/en-us/articles/360018955211-Mobile-Add-a-Food)
2. **快速输入**：用户说／写「午饭一碗牛肉面」或拍餐盘；Agent 抽取候选食物与份量，再让用户一键选择、修改或拒绝。MacroFactor 的 Describe 支持文本及键盘麦克风语音；Photo AI 将照片转成**可编辑**食物条目，并要求用户再执行 `Log Foods`。[MacroFactor Describe](https://help.macrofactorapp.com/en/articles/216-log-foods-with-ai-describe) [MacroFactor Photo AI](https://help.macrofactorapp.com/en/articles/258-ai-food-logging)
3. **显式热量**：用户可直接说「这餐按 800 kcal 记」，但它必须是 `manual_calories`，而不是被伪装成数据库宏量明细。若用户没有同时确认蛋白／脂肪／碳水，系统只记录总热量及其来源，不凭空补全宏量。

Oura 同样表明照片／文本餐食的正确定位：它允许用户改餐食名称和时间，输出的是蛋白、纤维、加工度、糖、脂肪、碳水的低／中／高估计和 Advisor 建议，而非可静默入账的精确热量。[Oura Meals](https://support.ouraring.com/hc/en-us/articles/40264659421843-Meals)

### 推荐事件 Schema

```text
food_event
  occurred_at, meal_slot?, source, status: draft | confirmed
  items[]
    food_ref?              # 数据库条目 ID；无则为空
    label                   # 用户原文或可见名称
    portion_value?, portion_unit?
    nutrients_snapshot?     # 只在明确数据库条目／标签解析后写入
    manual_calories?        # { kcal, entered_by: user }
    evidence: database | barcode | label | user_text | voice | photo
    estimate_confidence?    # 仅 evidence 为文本／语音／照片时
  original_input_ref?       # 原文本／图片引用，按同意与保留策略保存
```

**状态机是安全阀。** `user_text`／`voice`／`photo` 只能创建 `draft`：展示「识别到的食物、份量估计、估计依据」，让用户选择数据库候选、改份量、只记热量或取消。只有用户点击确认后，`nutrients_snapshot` 才进入当天累计。`database`／`barcode` 也应显示来源、份量和可编辑营养值；Cronometer 指出制造商条码食品的营养字段可能较少，不能把「条码」等同于完整资料。[Cronometer 食物数据质量](https://support.cronometer.com/hc/en-us/articles/360018955211-Mobile-Add-a-Food)

### 什么改变下一步

- 已确认的食物／份量改变当天已摄入与剩余目标；**草稿和低置信度估计不改变**正式营养账本。
- 只确认热量时，只改变能量总额；界面明确标注「未记录宏量」，不假装达到蛋白目标。
- 当天的建议可以是「补录份量」「下一餐优先某营养素」；长期能量／宏量调整要另设数据充分度 gate。MacroFactor 明确将持续饮食和体重记录用于其后续能量估计，资料不足时应暂停更新，而非假精确地调目标。[MacroFactor Expenditure](https://help.macrofactorapp.com/en/articles/20-expenditure) [MacroFactor 饮食记录频率](https://help.macrofactorapp.com/en/articles/110-how-frequently-do-i-need-to-log-my-nutrition-for-the-expenditure-algorithm-and-weekly-coaching-updates)

## 3. Recovery、身体测量与临时约束：被动优先，手工永远可用

### Sleep／recovery Schema

```text
sleep_event
  source: imported | manual
  authorization_scope?      # 仅 imported
  start_at?, end_at?, duration?
  stages?, resting_hr?, hrv?, score?  # 来源有才存，绝不补造
  perceived_recovery?: 1..5 | unknown
  fatigue?: 1..5 | unknown
  soreness_body_parts?: []

body_measurement
  type: weight | body_fat | waist | other
  value, unit, occurred_at, source

temporary_constraint
  kind: pain | injury | illness | travel | schedule_change | other
  free_text?, affected_body_parts?, severity?: user_selected
  starts_at, expires_at?, source: user_confirmed
```

**被动导入。** 在用户逐项授权时，Google Health 可通过 Health Connect／Apple Health 接收睡眠时长、阶段和日程、训练、体重／身体测量，以及受设备支持限制的 HRV、RHR、SpO₂、呼吸率、温度等。[Google Health 连接字段](https://support.google.com/googlehealth/answer/14236613?hl=en-GB) Health Connect 的记录也携带数据来源应用、设备和主动／被动／手工记录方式，必须原样保留。[Health Connect metadata](https://developer.android.com/health-and-fitness/health-connect/data-format)

**手工回退。** 没有授权、没有穿戴设备或导入迟到时，Coach 只提供昨晚睡眠时长（可选）和「今天恢复怎样？」1–5 的简短输入；再按需要开放疲劳、酸痛部位和临时限制。Google Health 已支持手工记录体重；WHOOP 的 Journal 证明行为和生活事件可在当天发生时记录，且 Coach 会结合 Journal 输入和生理数据调整建议。[Google Health 手工体重](https://support.google.com/googlehealth/answer/14236402?co=GENIE.Platform%3DAndroid&hl=en-GB) [WHOOP Journal](https://support.whoop.com/s/article/WHOOP-Journal-Overview?language=en_US) [WHOOP Coach](https://support.whoop.com/s/article/How-to-Use-the-AI-Powered-WHOOP-Coach)

### 只在有用时提问

| 触发时刻 | Coach 最多问什么 | 回答后改变什么 |
| --- | --- | --- |
| 早晨且没有授权睡眠数据 | 「昨晚睡了多久？今天恢复 1–5？」 | 仅影响当天强度上／下调和是否建议恢复日。|
| 打开即将开始的训练、且上次高 RPE／未完成 | 「身体有不适或要避开的部位吗？」 | 添加短期约束、替换动作；不回答则保持保守计划。|
| 用户刚说「出差／忙／脚不舒服」 | 从文本提取时间、约束与受影响部位，显示小卡片确认 | 调整今天时段、训练时长或动作；不自动改变长期目标。|
| 训练结束 | 单个 RPE 与「有无异常」 | 影响下一次进阶；异常优先于分数，停止自动加量。|
| 记录一餐后 | 仅在份量／候选食物不确定时追问 | 把草稿转成确认账本；不以追问凑问卷。|

WHOOP 的 Daily Outlook／Strain Target 是「新恢复状态 + 今天已累积负荷 → 当天活动建议」的可核验例子；Oura Tags 表明行为可以保留时间、备注和自定义标签，但不会直接改变日分数。MaxPower 应采用前者的**触发式建议**，保留后者的**上下文记录但不越级推断**。[WHOOP Daily Outlook](https://support.whoop.com/s/article/How-to-Use-the-AI-Powered-WHOOP-Coach) [WHOOP Strain Target](https://support.whoop.com/s/article/Strain-Coach) [Oura Tags](https://support.ouraring.com/hc/en-us/articles/360038676993-Using-Tags)

### 日历／生活事件

本轮第一方资料支持把旅行、压力、育儿等写为当天行为或 Coach context，不支持默认读取操作系统日历来决定训练。[WHOOP Coach context](https://support.whoop.com/s/article/How-to-Use-the-AI-Powered-WHOOP-Coach) 因此 MaxPower 应让用户通过一句话或一次性日历选择建立 `temporary_constraint`／`availability_override`，只保存时间窗和用户确认的可用性；默认不保存日历标题、参会人或地点。

## 4. 证据、provenance 与 Agent 确认政策

### 来源权威顺序

| 类别 | 例子 | 可直接写入？ | 可如何影响 Coach |
| --- | --- | --- | --- |
| **U1：用户已确认的实际事实** | 完成的组次／负重、选定食物与份量、手工睡眠、RPE、疼痛／限制 | 是 | 最高优先级；直接改变下一步，但保留编辑和撤销。|
| **D1：获授权的原始导入观测** | 设备写入的睡眠、活动、体重、HR 汇总 | 是，带 `source_app/device/recording_method` | 用于建议，不覆盖 U1 的更正。|
| **D2：第三方派生值** | readiness、恢复分数、估计消耗 | 是，标为派生与来源 | 只触发降载／追问，不作为医疗事实或自动加量许可。|
| **A0：Agent 解析／照片／语音估计** | 从「一碗牛肉面」、餐盘图、训练照片提取的候选 | **否，只能 draft** | 展示候选与置信度，等待确认；不可静默累计营养或施加约束。|

当同一类型来自多个应用时，不能相加或静默覆盖。Health Connect 明确维护来源、设备和记录方式，并允许用户处理数据源优先级；MacroFactor 也说明手工记录或更高优先级记录会阻止同步覆盖。[Health Connect metadata](https://developer.android.com/health-and-fitness/health-connect/data-format) [Health Connect priority](https://support.google.com/android/answer/12990553?hl=en-en) [MacroFactor sync priority](https://help.macrofactorapp.com/en/articles/355-force-data-syncing)

### Progressive extraction + confirmation

1. **先保留原始表达，后抽取小事实。** 用户说「今天深蹲 60 公斤做了三组，右膝不舒服」，Agent 先保存原文，生成动作／重量／组数／右膝限制四个候选，而不是假设每组次数或疼痛诊断。
2. **只确认高影响或不确定字段。** 弹出「深蹲 60 kg × 3 组？」「右膝今天避免深屈膝？」两个可编辑 chip；用户可确认、改正或只保存备注。已确认训练事实可入账，限制才进入 `temporary_constraint`。
3. **照片与语音同样走草稿。** 餐盘照片先给食物和份量估计；训练照片先给动作／组次候选。WHOOP 的 Strength 上传也是「文本或照片 → 分析 → 编辑细节 → 再开始／关联训练」的模式。[WHOOP Coach](https://support.whoop.com/s/article/How-to-Use-the-AI-Powered-WHOOP-Coach)
4. **让确认成为自然结束动作，不成为表单。** 用户完成一组就点勾；拍完餐就点「加入」；说出不适就点「今天生效」。不相关字段延后到下一次确实会影响建议的时刻再问。

## MaxPower 的最小日内循环

```text
记录训练 / 记录一餐 / 同步睡眠 / 报告临时变化
        ↓
结构化事实或 Agent 草稿（保留来源、时间与置信度）
        ↓
高影响草稿一键确认；低影响上下文仅作为备注
        ↓
显示“因何改变”：下一组、下一餐提示、今天降载／改期
        ↓
完成后只收一个能改变下次的信号（RPE 或异常）
```

实施上，先交付统一 Exercise Journal、食物「数据库＋份量」确认流、睡眠导入与手工恢复回退。所有自然语言／照片／语音都采用 A0 草稿；所有设备数据保留 D1 provenance；所有 Coach 推断都说明依据并可撤销。这样能获得日常即时性，而不会退化成问卷式 UX，也不会把估算、可穿戴分数或 Agent 猜测包装成事实。
