---
title: 恢复约束与健康信号
slug: recovery-and-health-signals
type: knowledge
project: maxpower
date: 2026-08-08
status: active
confidence: provisional
tags: [recovery, sleep, hrv, resting-heart-rate, fatigue, soreness, training-load, healthkit, health-connect]
---

# 恢复约束与健康信号

> 本页定义训练产品如何把睡眠、HRV、静息心率（RHR）、主观疲劳、局部酸痛、日程和历史训练负荷转成 `RecoveryConstraint`。它是训练编排规则，不是医疗诊断、疾病预测或伤病风险评分。

## 结论先行

1. `RecoveryConstraint` 应是**可解释的分级约束**，不是把所有信号压成一个看似精确的 0–100 分。
2. 用户明确报告的当日状态和训练中表现最接近当前决策；睡眠与历史负荷提供上下文；HRV、RHR 和厂商 readiness 分数只做同人、同来源、同测量口径下的佐证。
3. **任何单一穿戴设备信号都不得硬取消训练。**设备信号缺失、过期、换设备、算法变化或相互冲突时，应降低置信度，而不是把“不确定”解释成“恢复差”。
4. 只有用户明确报告停止信号、既有医疗限制命中，或训练中出现本地安全规则事件时，才进入 `暂停并确认`。算法不得根据 HRV、RHR、睡眠分或厂商 readiness 分数推断疾病。
5. Apple HealthKit 的 HRV 是 **SDNN**；Android Health Connect 的 HRV 记录是 **RMSSD**。两者不是可直接拼接的同一指标，必须分别建基线。[Apple HealthKit HRV](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilitysdnn) · [Health Connect HRV](https://developer.android.com/reference/androidx/health/connect/client/records/HeartRateVariabilityRmssdRecord)

## 证据标签

本文每项规则使用以下标签，避免把研究事实和产品选择混在一起：

- **事实**：由官方数据规范、原始验证研究、训练试验、系统综述或专业共识直接支持。
- **产品规则**：在现有证据和已确认产品边界上做出的保守实现选择；阈值本身不声称具有临床意义。
- **未知**：现有证据不足，必须通过本产品数据和预注册评估验证。

## 一、`RecoveryConstraint` 分级

`RecoveryConstraint` 只约束**尚未执行**的训练。已完成记录不可重写；正在执行的 set 保持冻结；调整在下一个安全边界形成 Proposal。

| 等级 | 含义 | 典型触发 | 默认动作 | 用户控制 |
|---|---|---|---|---|
| `NORMAL` / 照常 | 没有可信的恢复担忧，或数据不足以作负面判断 | 主观状态正常；设备信号在个人基线内；数据缺失但无用户不适 | 按计划执行，仅展示解释 | 可主动降级 |
| `SLIGHT_REDUCTION` / 稍微收一点 | 存在一个可信的软信号，或多个弱信号同向 | 当日疲劳偏高；目标肌群明显酸痛；一晚睡眠明显低于个人常态；日程压缩 | Proposal 优先增加目标 RIR、删去可选/低优先级组、缩短训练；不自动取消主训练 | 可接受、修改或覆盖；覆盖需记录理由但不惩罚用户 |
| `RECOVERY_FIRST` / 恢复优先 | 多域信号同向、持续恶化，或主观状态强烈提示不适合原计划 | 高疲劳 + 目标肌群重度酸痛；连续睡眠不足 + 近期负荷明显高于个人常态；热身表现显著低于同动作常态并伴高 RPE/RIR 偏差 | Proposal 改为低疲劳技术/轻量训练、其他肌群或恢复日；避免力竭和高技术风险动作；显著减少尚未执行的 hard sets | 协作模式必须确认；托管模式也不得越过安全上限 |
| `PAUSE_AND_CONFIRM` / 暂停并确认 | 用户明确报告停止信号，或本地安全规则命中 | 胸部不适、眩晕/晕厥、异常呼吸困难等系统性症状；训练中突发锐痛；已知医疗限制命中；用户明确要求停止 | 暂停相关动作或整场训练，给出非诊断性的求助/就医提示，不生成“绕过症状继续练”的方案 | 必须由用户明确处理；设备分数不能触发此级 |

**事实。** ACSM 的运动前筛查共识把症状、已知疾病、当前活动水平和拟进行强度作为核心，并建议活跃人群若出现相关症状应停止训练、寻求医疗许可；列举的信号包括胸/颈/颌/臂不适、静息或轻微活动时呼吸困难、眩晕或晕厥、心悸和异常疲劳等。[Riebe et al., 2015](https://journals.lww.com/acsm-msse/fulltext/2015/11000/updating_acsm_s_recommendations_for_exercise.28.aspx)

**产品规则。** 普通局部 DOMS、单晚低睡眠分、单次 HRV/RHR 异常或厂商红色 readiness 都是软信号，不能进入 `PAUSE_AND_CONFIRM`。突发锐痛与普通酸痛必须让用户分别选择，系统不得自行诊断。

**未知。** `SLIGHT_REDUCTION` 和 `RECOVERY_FIRST` 中究竟减少多少训练量、增加多少 RIR，尚无可跨人群、跨训练目标直接套用的统一阈值。初始规则必须版本化，并通过完成率、训练表现、用户覆盖率和次日状态验证，不能用“受伤率下降”作为未经验证的宣传结论。

## 二、决策原则：优先级、佐证与否决

### 2.1 输入优先级

从高到低：

1. **显式安全事实**：用户报告的系统性症状、锐痛、既有医疗限制、训练中的停止事件。它们可以触发硬暂停。
2. **当日主观与动作局部信号**：总体疲劳/恢复感、目标肌群酸痛、主观睡眠质量，以及热身或正式组中实际记录的 RPE/RIR、次数完成情况。
3. **已完成训练历史**：近期 hard sets、组次/次数/用户填写重量、session RPE、失败组和计划偏差；这些描述施加了什么负荷，但不等于身体已经恢复或未恢复。
4. **睡眠时长与规律**：提供恢复上下文；优先总睡眠时长、睡眠窗口与用户主观睡眠质量，睡眠分期只作解释。
5. **HRV、RHR 与厂商 readiness**：只作趋势佐证，不能单独触发硬动作。
6. **日程**：表示训练是否可行、可用多长时间；它不是生理恢复信号。

**事实。** 一项纳入 56 个原始研究的系统综述发现，主观 wellbeing 对急性和慢性训练负荷的变化总体比常见客观指标更敏感且更一致，且主观与客观指标往往并不相关；作者建议把主观指标单独使用或纳入混合监测。[Saw et al., 2016](https://pubmed.ncbi.nlm.nih.gov/26423706/)

**事实。** 在高训练量力量/HIIT overload 研究中，静息 HR/HRV 与表现/恢复指标之间并非稳定一一对应，这支持把自主神经信号视为补充而非力量训练 readiness 的单点真值。[Schneider et al., 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6538885/)

**产品规则。** 当主观状态与设备相反时，不做平均：用户感觉差、设备正常时，以主观状态提出软降级；用户感觉好、设备异常时，展示异常并通过热身检查，而不是直接削减或取消训练。

### 2.2 不做不透明总分

首版使用“规则命中 + 证据包”而非加权总分。每次决策至少保存：

```text
constraint_level
triggering_facts[]
corroborating_facts[]
contradicting_facts[]
missing_or_stale_facts[]
proposed_changes[]
rule_pack_version
evaluated_at
```

**产品规则。** `triggering_facts` 必须足以解释等级；`corroborating_facts` 只能增强置信度，不能偷偷变成硬否决；`contradicting_facts` 必须保留并向用户可见。

## 三、各信号能做什么、不能做什么

### 3.1 睡眠

**事实。** 成人规律地每晚睡眠至少 7 小时是 AASM/SRS 的健康共识建议，但个体睡眠需要存在差异，这不是某一训练日的取消阈值。[Watson et al., 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC4442216/)

**事实。** 急性睡眠丢失对体能表现的影响受任务类型、丢失发生时段和清醒时长影响；汇总研究支持总体负面影响，但不足以给每个力量训练者定义统一的“睡 X 小时必须休息”规则。[Craven et al., 2022](https://pubmed.ncbi.nlm.nih.gov/35708888/) 力量训练专门综述也指出研究结果和情境存在差异。[Knowles et al., 2018](https://pubmed.ncbi.nlm.nih.gov/29422383/)

**事实。** 消费级设备对睡/醒判别通常优于精细睡眠分期；一项同时验证六种设备的 PSG 对照研究中，睡/醒一致率约 86%–89%，但 Cohen's κ 仅 0.30–0.51，说明简单准确率不能等同于可靠睡眠结构判断。[Miller et al., 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9412437/)

**产品规则。** 使用顺序为：完整睡眠窗口与总时长 → 相对个人基线的偏离 → 用户主观睡眠质量 → 分期作为说明。不得因“深睡/REM 少”单独降级训练；不得把消费设备睡眠阶段当作临床 PSG。

**产品规则。** 一晚明显低于个人常态只能支持 `SLIGHT_REDUCTION`；连续多晚低于常态且与高疲劳、酸痛或高历史负荷同向，才支持 `RECOVERY_FIRST`。具体“连续”和“明显”由版本化规则定义。

### 3.2 HRV

**事实。** HRV 指标依赖定义与采样方式。HealthKit 提供 SDNN；Health Connect 提供 RMSSD。二者即便都以毫秒表示，也不能按数值直接合并。[Apple HealthKit HRV](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilitysdnn) · [Health Connect HRV](https://developer.android.com/reference/androidx/health/connect/client/records/HeartRateVariabilityRmssdRecord)

**事实。** Apple Watch 在静息、受控条件下的 HRV 与参考测量可有较好一致性，但验证研究同时强调腕部 PPG/RR 数据、活动伪影、样本与测量条件的局限；这不等于任意时间点的消费级 HRV 都能判断训练 readiness。[Hernando et al., 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC6111985/) · [Bonneval et al., 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12031371/)

**事实。** HRV 引导训练的随机试验主要集中于耐力训练。例如 Vesterinen 等用个人化 HRV 范围决定高/中强度或低强度训练，在 40 名休闲跑者中减少了高/中强度次数，并显示潜在跑步表现收益；证据不能直接外推为力量训练自动减组算法。[Vesterinen et al., 2016](https://pubmed.ncbi.nlm.nih.gov/26909534/) 汇总研究发现 HRV 引导训练对耐力表现和 VO₂peak 的优势小且未稳定达到统计显著。[Javaloyes et al., 2021](https://pubmed.ncbi.nlm.nih.gov/34639599/)

**事实。** 训练监测研究显示单日 HRV 波动大；在训练有素的铁三运动员中，每周至少 3 个有效 LnRMSSD 观测才较接近整周平均的判断。[Plews et al., 2014](https://pubmed.ncbi.nlm.nih.gov/24334285/)

**产品规则。** HRV 只在同一用户、同一指标（SDNN 或 RMSSD）、同一主来源、相近测量窗口和体位/睡眠阶段口径下与个人基线比较。换设备、换指标或算法版本变化时重新建基线。

**产品规则。** 单次低 HRV 只能解释或触发热身检查；至少需要趋势持续或与主观疲劳、睡眠、RHR、负荷中另一个独立域同向，才可支持软降级。HRV 永远不能单独触发硬暂停。

**未知。** 对以增肌/力量为主的人群，何种 HRV 趋势能预测当日可训练量、目标 RIR 或表现，缺乏足够直接证据；需要按训练目标分别验证。

### 3.3 静息心率（RHR）

**事实。** HealthKit 的 RHR 是系统基于全天 sedentary HR 估计的最低静息心率；Apple 明确说明当天估计会随数据增加而改善，并可能删除、替换当前或前一天的早期样本。因此早晨第一次同步值不一定是最终值。[Apple HealthKit RHR](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/restingheartrate)

**事实。** Health Connect 的 `RestingHeartRateRecord` 是带时间戳的单次记录，并不保证各写入应用使用相同算法。[Health Connect RHR](https://developer.android.com/reference/androidx/health/connect/client/records/RestingHeartRateRecord)

**产品规则。** RHR 只与同来源个人基线比较；同日 Apple 值在最终同步前标为 provisional。单次升高或降低有多种可能原因，只能作为佐证，不输出疾病原因，不单独降级训练。

### 3.4 主观疲劳与总体恢复感

**事实。** 训练监测研究最常用的单项 wellbeing 维度包括疲劳、肌肉酸痛、睡眠质量、压力和情绪；问卷措辞和量表实现并不统一。[Duignan et al., 2020](https://pubmed.ncbi.nlm.nih.gov/32991706/)

**事实。** Perceived Recovery Status（PRS）量表的开发研究发现主观恢复状态与重复冲刺表现变化存在中等关联，但它不是跨运动项目的医学量表。[Laurent et al., 2011](https://pubmed.ncbi.nlm.nih.gov/20581704/)

**产品规则。** 每次训练前用少量、固定措辞的单项问题收集：总体疲劳、恢复感、主观睡眠质量、压力/日程负担。保持原始答案，不把用户回答“校正”为设备结论。

**产品规则。** 当日高疲劳可独立触发 `SLIGHT_REDUCTION`；只有极高、持续或与其他域同向时才支持 `RECOVERY_FIRST`。用户报告“异常疲劳伴系统性症状”进入安全确认，而不是由 Agent 推断病因。

### 3.5 局部酸痛、疼痛和动作限制

**事实。** 主观酸痛是常见运动员 wellbeing 监测维度，但酸痛、力量恢复和生理标志物并不完全同步，因此酸痛分数不是组织损伤程度或受伤概率。[Saw et al., 2016](https://pubmed.ncbi.nlm.nih.gov/26423706/) 高容量阻力训练后，PRS 与酸痛会随恢复时间变化，但研究不支持一个适用于所有动作/训练者的固定取消阈值。[Sikorski et al., 2013](https://pubmed.ncbi.nlm.nih.gov/23287827/)

**产品规则。** 分开采集：

- 普通肌肉酸痛：0–4 级，并选择身体部位；
- 动作受限：是否影响日常活动、关节活动范围或热身动作；
- 疼痛：钝痛/锐痛、肌肉/关节、静息/动作中、新发/既有。

**产品规则。** 轻度、局部、预期内酸痛只影响同肌群的可选训练量；不相关肌群可照常。重度酸痛并伴动作受限或热身表现下降支持 `RECOVERY_FIRST`。新发锐痛、关节痛或用户要求停止，暂停相关动作并确认；系统不把它命名为具体伤病，也不提供康复方案。

### 3.6 日程与生活约束

**事实。** 日程没有直接测量生理恢复，厂商产品通常把生活压力与生理/睡眠/负荷一起用于 readiness 解释，但这些是产品语义而非临床结局证据。Garmin Training Readiness 综合睡眠、恢复时间、HRV 状态、急性负荷、睡眠史和压力史；WHOOP Recovery 综合 HRV、RHR、睡眠和呼吸率；Oura 使用个人平均与睡眠/活动平衡等 contributor。[Garmin Training Readiness](https://www.garmin.com/en-MY/garmin-technology/running-science-entry-level/after-running/training-readiness/) · [WHOOP Recovery](https://www.whoop.com/us/en/thelocker/how-does-whoop-recovery-work-101/) · [Oura Readiness Contributors](https://support.ouraring.com/hc/en-us/articles/360057791533-Readiness-Contributors)

**产品规则。** 日程只改变训练的时间、地点、器械可用性和可完成范围：时间不足时缩短或改期，不把“只有 30 分钟”显示成“恢复差”。用户主动报告的生活压力可作为主观疲劳域输入，但日历事件标题不得被模型擅自解释为压力或健康事实。

### 3.7 历史训练负荷

**事实。** 训练负荷监测共识建议同时考虑外部负荷、内部反应和个体情境，且没有一种指标能覆盖所有运动和目标。[Bourdon et al., 2017](https://pubmed.ncbi.nlm.nih.gov/28463642/)

**事实。** session-RPE 是将训练持续时间与整场主观强度结合的实用内部负荷方法，但在不同训练形态和个体中仍有可靠性限制。[Foster et al., 2001](https://pubmed.ncbi.nlm.nih.gov/11708692/) · [Crawford et al., 2018](https://pubmed.ncbi.nlm.nih.gov/30134535/)

**事实。** 不应把 acute:chronic workload ratio（ACWR）阈值当作伤病预测或硬训练限制；方法学评估指出其因果关系未建立、比值会产生统计伪影，不能据此声称降低受伤率。[Impellizzeri et al., 2020](https://pubmed.ncbi.nlm.nih.gov/32502973/) · [Wang et al., 2021](https://pubmed.ncbi.nlm.nih.gov/33332011/)

**产品规则。** 对力量训练，历史负荷优先使用产品自己的已完成事实：按动作/动作模式/目标肌群记录 hard sets、次数、用户填写重量、RIR/RPE、失败组、持续时间与计划偏差。计划中的训练不是负荷；未记录完成的组不能推定完成；骨架或视频不能验证真实公斤数。

**产品规则。** 展示近期与个人常态的差异可帮助解释，但不输出“受伤风险 X%”。负荷异常只有与恢复/表现信号同向时才支持软降级。

## 四、数据新鲜度与完整性

以下时间窗是**首版产品规则**，不是医疗阈值。所有原始时间戳、时区、来源和 `lastModifiedTime` 必须保留。

| 信号 | 可用于当日决策的默认新鲜度 | 过期/缺失处理 |
|---|---|---|
| 主观疲劳、恢复感、酸痛/疼痛 | 训练前 12 小时内；训练开始前再次确认停止信号 | 超时则询问，不沿用昨日负面标签 |
| 主观睡眠质量 | 最近主睡眠醒来后、当日训练前 | 缺失不扣分 |
| 睡眠 | 最近一个已结束的主睡眠，结束时间距评估不超过 24 小时；小睡单独标注 | 会话未结束、阶段覆盖不全或重叠时降置信；允许用户修正 |
| HRV / RHR | 与最近主睡眠或当日标准化晨测对应，距评估不超过 24 小时 | 过期只展示；不触发降级 |
| 厂商 readiness/recovery | 最近睡眠后生成且更新时间明确，不超过 24 小时 | 只展示；无法确定算法/更新时间则不入规则 |
| 日程 | 每次生成/修改 Proposal 时读取未来 24–48 小时 | 连接失效时按“未知”，不按“有空” |
| 已完成训练负荷 | 本地 Timeline 已同步至评估时刻 | 同步落后或跨设备冲突时降低置信，不补造训练 |

**事实。** Health Connect 记录包含数据来源、设备、最后修改时间、记录方法和时区；时区缺失在部分旧 Android 场景可能发生，应用必须处理。[Health Connect data format](https://developer.android.com/health-and-fitness/health-connect/data-format)

**事实。** Health Connect 默认只能读取首次授权前 30 天的数据，读取更早历史需要额外历史权限；changes token 长期不用会在 30 天过期。因此“没有旧数据”可能是权限或同步状态，不等于用户没有训练/睡眠历史。[Read Health Connect data](https://developer.android.com/health-and-fitness/health-connect/read-data) · [Synchronize Health Connect data](https://developer.android.com/health-and-fitness/health-connect/sync-data)

**产品规则。** `missing`、`permission_denied`、`not_supported`、`stale`、`partial` 和 `conflict` 必须是不同状态。任何一种都不能被编码成数值 0 或“恢复差”。

## 五、个人基线与趋势

### 5.1 基线成熟度

下面是保守的首版产品门槛：

| 状态 | 规则 | 可参与决策程度 |
|---|---|---|
| `NO_BASELINE` | 少于 14 个同来源、同口径有效观测 | 只展示原值，不根据 HRV/RHR/睡眠设备趋势降级 |
| `PROVISIONAL` | 至少 14 个有效观测，但少于 42 天历史或覆盖不足 | 仅作佐证，不能成为主要触发 |
| `ESTABLISHED` | 最近约 60 天内至少 42 天有效、各周有足够覆盖，来源/算法稳定 | 可作为软触发之一，仍不能单独硬暂停 |
| `INVALIDATED` | 换设备、SDNN↔RMSSD、主要算法版本变化、长期中断或时区/测量条件不可比 | 冻结旧基线，重新建立；旧数据仅供历史展示 |

**产品规则依据。** Oura 官方产品语义称建立 contributor 平均值最多需约两周，“长期”约为两个月，HRV balance 比较近 14 天和约 3 个月个人平均；这些窗口可作为保守 UX 参考，不是临床阈值。[Oura Readiness Contributors](https://support.ouraring.com/hc/en-us/articles/360057791533-Readiness-Contributors) Plews 等的研究则支持 HRV 趋势至少需要每周多个有效点，而非依赖单日值。[Plews et al., 2014](https://pubmed.ncbi.nlm.nih.gov/24334285/)

### 5.2 比较方式

**产品规则。** 每个 `(signal_type, metric_definition, source, device, algorithm_version, measurement_window)` 建独立序列。使用个人稳健中心和波动范围（如 median/MAD 或经验证的自然对数尺度）判断是否偏离常态，同时展示连续性；不拿人群平均给个人贴“好/坏”标签。

**产品规则。** 趋势规则至少区分：

- 单点异常；
- 多日同向；
- 近期均值偏离长期基线；
- 波动性变大但中心未变；
- 算法/设备切换造成的阶跃。

**未知。** 适合本产品力量训练者的窗口长度、MAD 倍数、最小有意义变化和月经周期/旅行/轮班的分层方式尚未验证。上线前不得把研究样本中的阈值直接写成全局常量。

## 六、来源冲突与去重

### 6.1 平台事实

**事实。** HealthKit 对象提供 `sourceRevision`、`device`、`UUID` 和 metadata，可识别写入来源与版本。[HealthKit sourceRevision](https://developer.apple.com/documentation/healthkit/hkobject/sourcerevision) · [HealthKit metadata](https://developer.apple.com/documentation/healthkit/hkobject/metadata)

**事实。** Health Connect metadata 包含 data origin、device、recording method、ID、last modified time 和 client version。其 Aggregate API 仅对 Activity 和 Sleep 按用户设置的来源优先级去重；其他数据类型会组合多个写入源，应用若直接聚合可能把不同来源混在一起。[Health Connect aggregation](https://developer.android.com/health-and-fitness/health-connect/aggregate-data) · [Health Connect data format](https://developer.android.com/health-and-fitness/health-connect/data-format)

**事实。** Health Connect 睡眠 session 与阶段是区间数据，阶段可缺失，且同一时段可能存在多个应用写入的 session；Apple HealthKit 也允许 `inBed`、awake、core、deep、REM 和 unspecified 等不同粒度的样本。[Health Connect sleep sessions](https://developer.android.com/health-and-fitness/health-connect/features/sleep-sessions) · [HealthKit sleep analysis](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis)

### 6.2 产品冲突规则

1. 用户可为睡眠、HRV 和 RHR 分别固定一个“主要来源”；不得假设同一设备对所有信号都优先。
2. 相同时间窗的多个 HRV/RHR 来源**不取平均**。决策只用主要来源，其他来源保留为矛盾证据。
3. Health Connect 的睡眠总时长优先使用平台按用户优先级去重后的 aggregate；仍保存原始 session 供追溯。Apple 侧用 source/device 和重叠区间生成 canonical sleep，不重复计时。
4. 用户手工更正睡眠或训练完成事实时，保留原始设备记录与更正记录，canonical view 标明选择依据；不能静默覆盖。
5. 同一来源记录后续修改或删除时，重新计算受影响基线和 Proposal，但不改写过去已经执行的训练决定；过去决定保留当时证据快照。
6. 若主观和设备冲突，优先用户当日陈述，同时把设备差异展示为“数据不一致”，不指责用户也不推断设备故障。

## 七、厂商指标可借鉴的产品语义

这些资料只说明厂商如何定义产品，不是独立结局证据，也不能证明其分数可减少伤病或改善力量训练：

- **WHOOP**：Recovery 使用 HRV、RHR、睡眠表现和呼吸率，并强调个人趋势；可借鉴“多信号 + 个人基线”，不可复制其颜色阈值作为本产品硬规则。[WHOOP Recovery](https://www.whoop.com/us/en/thelocker/how-does-whoop-recovery-work-101/)
- **Oura**：Readiness contributor 使用个人平均；HRV balance 比较近 14 天和更长期均值，activity balance 也比较近期与长期活动。可借鉴“基线成熟期”和“短/长期分离”，不可把分数当诊断。[Oura Readiness Contributors](https://support.ouraring.com/hc/en-us/articles/360057791533-Readiness-Contributors)
- **Garmin**：Training Readiness 综合当晚睡眠、恢复时间、HRV 状态、急性负荷、睡眠史和压力史；acute load 的影响随时间衰减。可借鉴“同一解释中展示不同时间尺度”，不可直接导入其 proprietary score。[Garmin Training Readiness](https://www.garmin.com/pt-BR/garmin-technology/running-science/physiological-measurements/training-readiness/) · [Garmin Training Status](https://www.garmin.com/en-GB/garmin-technology/running-science/physiological-measurements/training-status/)

## 八、建议的规则求值流程

```text
1. 读取用户明确停止信号与既有限制
   -> 命中：PAUSE_AND_CONFIRM；结束自动求值

2. 检查每个输入的 freshness / permission / completeness / provenance
   -> 无效输入进入 missing_or_stale_facts，不做负分

3. 计算当日主观与局部动作域
   -> 高疲劳、重度目标肌群酸痛、动作受限可成为主要软触发

4. 计算睡眠与历史负荷上下文
   -> 只比较个人常态；分期不单独触发

5. 读取 HRV/RHR/厂商分数
   -> 只在基线成熟且口径一致时作为佐证

6. 处理矛盾
   -> 用户状态优先；矛盾降低自动执行权限，转 Proposal 或热身检查

7. 输出 NORMAL / SLIGHT_REDUCTION / RECOVERY_FIRST
   -> 附可解释证据、变更范围、置信度、规则版本

8. 到下一个安全边界应用
   -> 不重写已完成事实，不修改正在执行的 set
```

### 首版保守触发表（产品规则）

| 条件 | 最高自动等级 |
|---|---|
| 仅一个新鲜的 HRV、RHR、睡眠分或厂商 readiness 异常 | `NORMAL` + 解释/热身检查 |
| 单晚睡眠低于常态，或当日中度疲劳，或目标肌群中度酸痛 | `SLIGHT_REDUCTION` Proposal |
| 两个独立域同向，其中至少一个为主观/表现域 | `RECOVERY_FIRST` Proposal |
| 连续趋势异常但用户感觉良好、热身正常 | 至多 `SLIGHT_REDUCTION`，允许覆盖 |
| 用户明确报告系统性停止信号、新发锐痛或既有限制命中 | `PAUSE_AND_CONFIRM` |
| 数据缺失、权限撤销、同步失败、来源冲突 | 不升级；降低置信度并询问 |

## 九、非医疗措辞边界

### 可以说

- “你今天报告的疲劳较高，而且目标肌群仍明显酸痛；建议把尚未执行的可选组删掉，并保留 3 RIR。”
- “昨晚 HRV 低于你在同一设备上的近期范围，但你感觉良好；先用热身表现确认，不据此取消训练。”
- “两个设备给出了不同的睡眠时长。当前按你指定的主要来源计算，置信度较低。”
- “这不是诊断。如果胸部不适、眩晕或异常呼吸困难仍存在，请停止训练并寻求专业医疗帮助。”

### 不可以说

- “你的 HRV 表明你生病/过度训练了。”
- “你昨晚深睡不足，所以今天训练会受伤。”
- “ACWR 超过 1.5，受伤风险是 X%，禁止训练。”
- “设备恢复分是红色，因此系统已取消训练。”
- “你的酸痛说明肌肉尚未修复/发生了某种损伤。”

## 十、验证计划与未决问题

以下项目仍是**未知**，需要在本产品中验证：

1. 不同目标（增肌、力量、减脂保肌、体能）是否需要不同的恢复触发和降级动作。
2. `SLIGHT_REDUCTION` 应优先调 RIR、组数、动作稳定性还是训练频率；其对完成率与长期进步的影响。
3. 用户主观疲劳/酸痛量表的最佳措辞、锚点、最小可用问题数，以及长期填写疲劳。
4. 对力量训练用户，HRV/RHR 趋势是否在加入主观状态和热身表现后仍提供增量信息。
5. 同一用户换设备/算法后需要多少重叠天数才能桥接；在未验证前默认不桥接。
6. 小睡、轮班、跨时区、月经周期、饮酒、急性疾病等情境如何影响基线；这些因素只能由用户主动提供，不能从日历标题或设备变化推断。
7. 何种数据质量和覆盖度足以允许托管模式自动执行 `SLIGHT_REDUCTION`；`RECOVERY_FIRST` 首版宜保留确认。

### 最小评估指标

- 建议接受率、修改率、覆盖率与撤销率；
- 计划完成率、尚未执行 hard sets 的变化、目标 RIR 偏差；
- 热身与正式组的次数/用户填写重量/RPE 或 RIR 相对个人常态；
- 次日主观恢复与酸痛变化；
- 错误硬暂停为零，单一设备导致取消为零；
- 不同设备、性别、年龄、训练经验与目标的校准差异；
- 规则包版本升级前后的离线 replay，确保历史决策可复现。

## 来源范围说明

本页使用 Apple 与 Android 官方 API 文档解释可获得的数据及其语义；WHOOP、Oura、Garmin 官方资料仅描述产品语义；训练和测量结论优先引用原始验证研究、随机试验、系统综述与专业共识。厂商材料不作为健康结局、伤病预防或训练效果的证据。
