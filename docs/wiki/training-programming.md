# 训练编程长期知识库：增肌、增力与减脂保肌

> 文档版本：`training-programming/0.1.0`
> 证据检索截止：2026-08-08
> 适用产品：MaxPower 的确定性 Planner、规则包、Agent 解释层与 Proposal 审计
> 适用范围：无急性疾病、无需要临床康复处方的成年人；不是医疗建议、伤病康复方案或竞技备赛方案。

## 1. 本文如何使用证据

本文把三类内容严格分开：

- **证据事实**：正式立场文件、系统综述/Meta 分析或原始研究能够直接支持的结论。
- **产品规则建议**：为使 MaxPower 可预测、可测试且保守而制定的实现默认值。它可以受证据约束，但不能表述成被研究验证的唯一最优方案。
- **未知**：没有足够研究支持，或现有证据不能推出个体阈值、精确公式或因果结论。

证据标签：

| 标签 | 含义 |
|---|---|
| `A` | 正式组织立场文件或大型 umbrella review |
| `B` | 系统综述、Meta 分析或网络 Meta 分析 |
| `C` | 单项原始研究、验证研究或正式专家共识 |
| `D` | MaxPower 产品默认值；不是生理事实 |
| `U` | 未知或证据不足，不得由 Agent 自行补齐 |

所有规则输出都必须保存 `ruleId`、`ruleVersion`、`evidenceRefs`、适用人群、输入缺失项和 reason codes。规则更新只影响未来 Proposal；既往训练计划与训练结果保留当时的规则包版本。

## 2. 一页结论

1. 对健康成人，持续进行渐进式阻力训练本身比复杂方案更重要。2026 ACSM 立场文件认为，力量通常受较重负荷（约 `>=80% 1RM`）、每动作 2–3 组、每周至少两次暴露和动作顺序影响；增肌更受较高周量（约 `>=10 组/肌群/周`）影响。这个“10 组”是群体层面的增强信号，不是每个人的最低有效量、自动起始量或安全上限。[ACSM 2026](https://pubmed.ncbi.nlm.nih.gov/41843416/)
2. 多种负荷都可以带来增肌；较重负荷更有利于最大力量。动作必须与目标有足够特异性，不能把低负荷高次数自动称为“更适合减脂”。[Currier et al., 2023](https://pubmed.ncbi.nlm.nih.gov/37414459/) [Lopez et al., 2021](https://pubmed.ncbi.nlm.nih.gov/33433148/)
3. 训练到瞬时力竭不是增肌或增力的必要条件。RIR/RPE 可用于调节努力程度，但它是主观估计，准确性受负荷、次数、熟悉度和动作影响；产品不能把 `2 RIR` 当作传感器测得的精确事实。[Grgic et al., 2022](https://pubmed.ncbi.nlm.nih.gov/33497853/) [Refalo et al., 2023](https://pubmed.ncbi.nlm.nih.gov/36334240/)
4. 周期化在等训练量条件下可能小幅改善 1RM，尤其是已有训练经验者；对增肌并未显示稳定优势。Mesocycle 是组织目标、疲劳和日程的产品结构，不是必须每 4–8 周重置的生理定律。[Moesgaard et al., 2022](https://pubmed.ncbi.nlm.nih.gov/35044672/) [ACSM 2026](https://pubmed.ncbi.nlm.nih.gov/41843416/)
5. 减量周实践广泛，但精确时机与减幅缺少高质量验证。固定完全停训一周没有显示额外增肌收益，并可能不利于短期力量；因此应优先按重复的表现/疲劳证据触发，并通过减少组数、远离力竭等方式降低训练压力，而不是默认完全停训。[Bell et al., 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/) [Coleman et al., 2024](https://pubmed.ncbi.nlm.nih.gov/38274324/)
6. 减脂保肌的训练核心仍是阻力训练。能量缺口会削弱瘦体重增长；在减重期加入阻力训练有助于保留去脂体重。没有充分证据支持减脂期必须大幅降低或提高阻力训练周量，故默认先保留可恢复的强度暴露和既有训练结构，再按表现与恢复下调。[Murphy & Koehler, 2022](https://pubmed.ncbi.nlm.nih.gov/34623696/) [Lopez et al., 2022](https://pubmed.ncbi.nlm.nih.gov/35191588/)
7. 当没有可靠的历史重量时，MaxPower 不生成一个伪精确公斤数。第一场在正常训练内用保守 RIR 引导和逐级试重，由用户确认实际使用重量；骨架或视频不能验证真实负重。

## 3. 核心概念与计量

### 3.1 必须分开的三种状态

```text
Prescription: 计划 60 kg × 8–10 × 3 @ 2–3 RIR
Performance:  用户确认实际 60 kg × 10/9/8，最后组约 1 RIR
Observation:  canonical packet 确认/待复核的动作次数与可见轨迹
```

- `Prescription` 是预测目标，不能写成用户已经举起的重量。
- `Performance` 是用户记录或确认的实际动作、重量、次数和主观 RIR。
- `Observation` 可支持次数、节奏和同上下文运动表现；不能推出实际公斤数、真实肌肉激活、疼痛或关节受力。
- 计划重量与实际重量必须使用不同字段和 provenance。任何重量进阶依据只能引用用户填写/确认的表现事实。

### 3.2 可比训练上下文

`ComparableExerciseContext` 至少包含：

```text
exercise × variation × equipment × setup/ROM × load measurement
```

杠铃总重、单只哑铃重量、器械配重片、自重附加重量和助力重量不可混为一条历史。动作、器材、明显 ROM 或助力方式改变后，旧数据只能作为参考，不能直接触发自动加重。

### 3.3 工作组与周量

- **工作组**：完成的、属于计划刺激的阻力训练组；热身、技术试做和未开始的计划组不计入。
- **直接组**：目标肌群是该动作的主要训练对象。产品 v0.1 只用直接组做自动周量进阶。
- **间接暴露**：多关节动作对次要肌群的贡献单独记录，但 v0.1 不用固定 `0.5 组` 等未经验证的系数折算。
- 计划周量、实际完成周量、摄像头确认次数必须分别保存；缺失实际数据时不得把计划组当作已完成组。

## 4. 证据事实

### 4.1 增肌

| 证据事实 | 标签 | 适用范围 | 不能推出什么 |
|---|---:|---|---|
| 较高周量与更大肌肥大总体相关；ACSM 2026 将约 `>=10 组/肌群/周` 识别为可增强增肌的计划特征。 | `A/B` | 健康成年人，研究多为数周至数月 | 不能推出每个人必须从 10 组起步、10 组是 MEV、或存在统一 MRV。[ACSM 2026](https://pubmed.ncbi.nlm.nih.gov/41843416/) [Schoenfeld et al., 2017](https://pubmed.ncbi.nlm.nih.gov/27433992/) |
| 多组方案通常比单组更适合作为增肌重点；在等训练量下，split 与 full-body 对增肌/力量没有稳定差异。 | `B` | 健康成年人 | 不能仅凭训练拆分名称判断优劣；应按可执行性分配周量。[Currier et al., 2023](https://pubmed.ncbi.nlm.nih.gov/37414459/) [Ramos-Campo et al., 2024](https://pubmed.ncbi.nlm.nih.gov/38595233/) |
| 从低到高的多种负荷均可增肌；当研究要求低负荷练到很高努力程度时，组间增肌差异通常不稳定。 | `A/B` | 以健康、年轻或中年成人为主 | 不能推出所有负荷、所有动作都同样舒适、安全或省时；也不能要求每组力竭。[ACSM 2026](https://pubmed.ncbi.nlm.nih.gov/41843416/) [Lopez et al., 2021](https://pubmed.ncbi.nlm.nih.gov/33433148/) |
| 瞬时力竭不是肌肥大的必要条件；更接近力竭未呈现简单线性“越近越好”。 | `B` | 证据主要来自年轻健康成人 | 不能推出远离力竭到任意程度仍等效；精确最佳 RIR 未知。[Refalo et al., 2023](https://pubmed.ncbi.nlm.nih.gov/36334240/) [Grgic et al., 2022](https://pubmed.ncbi.nlm.nih.gov/33497853/) |
| 固定复杂周期化对等训练量条件下的增肌没有显示稳定优势。 | `A/B` | 健康成年人 | 不代表计划结构、动作轮换或疲劳管理没有产品价值。[ACSM 2026](https://pubmed.ncbi.nlm.nih.gov/41843416/) [Moesgaard et al., 2022](https://pubmed.ncbi.nlm.nih.gov/35044672/) |

### 4.2 增力

| 证据事实 | 标签 | 适用范围 | 不能推出什么 |
|---|---:|---|---|
| 最大力量提升受较高负荷与测试动作特异性影响；ACSM 2026 指出 `>=80% 1RM`、每动作 2–3 组、目标动作靠前和每周至少两次暴露是有利特征。 | `A/B` | 健康成年人；不是竞技举重个体方案 | 不能据此给无历史用户直接计算公斤数。[ACSM 2026](https://pubmed.ncbi.nlm.nih.gov/41843416/) [Currier et al., 2023](https://pubmed.ncbi.nlm.nih.gov/37414459/) |
| 等周量条件下，周期化训练对 1RM 有小幅总体优势；波动周期化的优势主要出现在已有训练经验者。 | `B` | 健康成人，研究异质性较高 | 不能推出某种周周期永远最优，也不能要求新手复杂波动。[Moesgaard et al., 2022](https://pubmed.ncbi.nlm.nih.gov/35044672/) |
| 训练到力竭不是力量提升的必要条件；非力竭训练在部分比较中相当或更好。 | `B` | 以年轻成人为主 | 不能推出所有高强度组都应保留相同 RIR。[Vieira et al., 2021](https://pubmed.ncbi.nlm.nih.gov/33555822/) [Grgic et al., 2022](https://pubmed.ncbi.nlm.nih.gov/33497853/) |

### 4.3 RIR / RPE

RIR 表示一组结束时主观估计还能完成的合格重复数。RIR 型 RPE 的常用映射源于阻力训练专项量表：`RPE 10 = 0 RIR`、`RPE 9 = 1 RIR`，依此类推。[Zourdos et al., 2016](https://pubmed.ncbi.nlm.nih.gov/26049792/)

| 证据事实 | 标签 | 产品含义 |
|---|---:|---|
| RIR 可以用于调节负荷；一项年轻新手男性研究在熟悉后显示 3、5、8 次方案的 `1 RIR` 负荷具有较高重测信度。 | `C` | 可作为保守试重工具，但不能跨人群宣称同等准确。[Lovegrove et al., 2022](https://pubmed.ncbi.nlm.nih.gov/36135029/) |
| 人们对距离力竭的预测并不完美，较少经验者总体更容易误差；轻负荷、高次数时误差可能变大。 | `C` | 记录区间和置信度，不把单次 RIR 当精确标签。[Steele et al., 2017](https://pubmed.ncbi.nlm.nih.gov/29204323/) [Hughes et al., 2020](https://pubmed.ncbi.nlm.nih.gov/33337690/) |
| 已训练人群对 1–3 RIR 的估计在部分动作/负荷研究中较准确，但误差仍依动作和条件变化。 | `C` | 必须保留 exact exercise context；不能用一个动作的校准推断全动作。[Refalo et al., 2024](https://pubmed.ncbi.nlm.nih.gov/37967832/) |

### 4.4 减脂保肌

| 证据事实 | 标签 | 适用范围 | 产品边界 |
|---|---:|---|---|
| 持续能量缺口会削弱阻力训练带来的瘦体重增长；Meta 回归中约 `500 kcal/day` 缺口与无法增加瘦体重相关。 | `B` | 纳入至少 3 周的干预；群体关联 | 该数字不是所有人的医疗阈值，也不是 App 可据此诊断低能量可用性。[Murphy & Koehler, 2022](https://pubmed.ncbi.nlm.nih.gov/34623696/) |
| 对超重/肥胖人群，减重饮食中加入阻力训练总体有助于保留瘦体重。 | `B` | 超重/肥胖成人，不能直接外推至所有精瘦运动员 | 体重不降不等于干预无效；训练引擎不应只优化秤重。[Lopez et al., 2022](https://pubmed.ncbi.nlm.nih.gov/35191588/) |
| 对能量限制中的已训练运动员，较高训练量是否更保肌证据不足；研究报告不完整，仅有方向性信号。 | `B/U` | 已训练、较瘦运动员 | 不应在减脂开始时自动加量，也不应无证据大幅砍量。[Roth et al., 2022](https://pubmed.ncbi.nlm.nih.gov/35146569/) |

因此，减脂保肌的 Planner 规则应把“维持可恢复的力量/肌肉刺激”设为训练目标，把饮食、体重趋势和恢复作为约束；不得创建所谓专属“燃脂次数区间”。营养目标另由营养知识库和用户授权管理。

### 4.5 徒手与外部负重

- ACSM 2026 认为弹力带、徒手和家庭训练均可改善力量、肌肥大和身体功能；器械类型并非健康成人获得结果的必要条件。[ACSM 官方摘要](https://acsm.org/resistance-training-guidelines-update-2026/)
- 在特定上肢推训练研究中，匹配难度的俯卧撑与卧推可取得相近力量进步；渐进式俯卧撑也能提升俯卧撑和卧推表现。但样本小、周期短，不能建立一张通用的“某变式 = 某公斤”换算表。[Calatayud et al., 2015](https://pubmed.ncbi.nlm.nih.gov/24983847/) [Kotarsky et al., 2018](https://pubmed.ncbi.nlm.nih.gov/29466268/)
- 没有足够高质量证据为所有徒手动作排序一个跨个体通用难度，也没有证据验证固定的杠杆、ROM、节奏或微负重等价公式，故这些属于动作库的版本化产品知识而非生理事实。

### 4.6 Deload

- 专家共识把 deload 定义为降低训练压力、促进恢复并为后续训练做准备的时期；可通过减少组数、次数、频率、接近力竭程度或调整动作实现。共识同时明确：这一领域研究不足，没有标准化最佳方案，固定预排 deload 未必必要。[Bell et al., 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/)
- 在已有训练经验者的 9 周研究中，中途完全停训一周并未改善增肌、局部耐力或爆发力，并出现较差的下肢力量提升。[Coleman et al., 2024](https://pubmed.ncbi.nlm.nih.gov/38274324/)
- 2026 年一项 19 名未训练年轻男性的肢体内对照研究发现，在第 4、8 周减少组数和频率的 deload 与连续训练在肌厚和 10RM 上相近；样本、动作和周期有限，不能据此认定固定 deload 最优。[Pancar et al., 2026](https://pubmed.ncbi.nlm.nih.gov/41730991/)

## 5. MaxPower 规则包建议

以下均是 `D` 级产品规则。默认目标是保守、可解释和可撤销，而不是声称最优。

### 5.1 Goal Contract 与 Mesocycle

| Rule ID / 版本 | 默认规则 | 适用 | 禁用或缺失条件 | 证据锚点 |
|---|---|---|---|---|
| `TP-GOAL-001@1` | 一个 Mesocycle 只设一个主目标：`hypertrophy`、`strength` 或 `fat_loss_preserve_lean_mass`。副目标只能使用剩余训练预算并维持最低暴露；改变主目标创建新 Goal Contract revision。 | 一般成人 | 目标冲突、期限或每周可训练次数未知时只生成 Proposal，不提交周期 | ACSM 2026 的目标特异性；严格主次为产品规则 |
| `TP-MESO-001@1` | Mesocycle 保存完整路径、周目标、刺激槽与可能的恢复窗口；只详细物化当前周和下一周，更远周保持意图状态。周期长度按日程、经验与反馈配置，不固定 4–8 周。 | 所有目标 | 比赛峰值、临床康复、特殊职业体测转交专业规则包 | 周期化对力量可能有小幅价值，对增肌优势不稳定 |
| `TP-MESO-002@1` | 新手/回归者优先稳定动作与简单进阶；已有可靠训练历史且主目标为力量时，才允许在相近周量下安排轻/中/重暴露变化。 | 健康成人 | 无可比动作历史或技术尚不稳定时禁用复杂波动 | [Moesgaard et al., 2022](https://pubmed.ncbi.nlm.nih.gov/35044672/) |

### 5.2 初始负荷未知：保守校准

`TP-LOAD-CAL-001@1`：没有同一 `ComparableExerciseContext` 的可靠实际负荷时，计划中公斤字段必须为 `unknown`，不得根据性别、年龄、体重或人群力量标准自动生成起始公斤数。

第一场使用正常训练内校准：

1. 选择容易停止、器材档位明确且用户可执行的动作；先完成无负重/很轻负重的熟悉组。
2. 显示次数范围与保守目标 `4–5 RIR`，不显示伪精确公斤建议。`4–5 RIR` 是 MaxPower 的首课保守默认值，不是被证据证明的最佳区间。
3. 用户选择并确认一个明显保守的重量，完成短试做组；系统询问 RIR、是否完成目标次数与是否有疼痛/眩晕等停止信号。
4. 若用户报告仍有 `>=6 RIR`、动作上下文一致且无停止信号，可在充分休息后上调一个可用器材档位；若 `4–5 RIR`，接受为首个工作负荷；若 `<=3 RIR`、未达次数下限或出现异常，降低一个档位或停止该动作。
5. 首次校准默认不追求 0–2 RIR、不做 1RM 测试、不连续追重到力竭。最多三次上调试做；仍不能定位时保存 `unknown` 并由用户/教练后续确认。
6. 只有用户确认的实际公斤数进入 Performance Timeline。首场结果是低置信基线；至少两个可比 session 后才允许自动负荷进阶。

禁用条件：孕期特殊情况、近期手术、急性伤病、医生限制、用户报告胸痛/眩晕/明显疼痛等停止信号，或动作无法安全独立停止。此时 Planner 不继续校准并提示寻求合格专业人员。App 不做诊断。

证据依据：RIR 在熟悉后的年轻新手样本中可作为负荷调节工具，但个体预测并非完美，轻负荷/高次数误差更大。[Lovegrove et al., 2022](https://pubmed.ncbi.nlm.nih.gov/36135029/) [Steele et al., 2017](https://pubmed.ncbi.nlm.nih.gov/29204323/)

### 5.3 PerformanceProgression

状态机：

| 状态 | 判定输入 | 下一步默认 |
|---|---|---|
| `INSUFFICIENT_EVIDENCE` | 实际重量、次数、RIR、动作上下文或用户确认缺失 | 保持或回到校准；不加重 |
| `ON_TARGET` | 工作组达到次数范围，RIR 未低于目标下界，无停止信号 | 保持；累计可比证据 |
| `TOO_EASY` | 全部工作组达到次数上界，且 RIR 不低于目标下界 | 一次证据只加次数/保持；连续两次才加负荷 |
| `TOO_HARD` | 任一工作组低于次数下界，或 RIR 比目标更接近力竭至少约 2 次，或组间表现明显崩落 | 后续安全边界减一个档位/减少次数；下一次保持或回退 |
| `UNDERPERFORMANCE` | 至少两个可比 session 的同方向下降，且不能由器材、动作、ROM 或漏记解释 | 进入恢复/计划复核 Proposal，不惩罚性加量 |
| `STOP_SIGNAL` | 用户明确疼痛、胸痛、眩晕、呼吸异常等，或本地安全规则命中 | 停止自动进阶；按安全规则暂停并确认 |

`TP-PERF-001@1`（双进阶）：

- 先在目标范围内增加可控的重复次数，再增加外部负荷。
- 只有连续两个可比 session 中，所有工作组均达到次数上界、实际 RIR 不低于计划下界且无停止信号，才建议增加一个**最小可用器材档位**。
- 单次负荷跳幅默认不得超过当前负荷的 10%；超过时继续次数进阶、使用用户已配置的微负重或提议相邻难度变式。`10%` 是采用 ACSM 2009 `2–10%` 旧进阶建议上界的保守产品限制，不代表最优跳幅。[ACSM 2009](https://www.acsm.org/wp-content/uploads/2025/01/Progression-Models-in-Resistance-Training-for-Healthy-Adults-Simplified.pdf)
- 负荷增加后回到次数范围下部，但不得同时自动增加重量、组数和难度变式。
- 预测负荷标记为 `predicted_target`；用户完成后才产生 `performed_load`。

`TP-PERF-002@1`（局部优先）：

- 一次偏差只允许改变下一组或下一次同动作的安排；改变周结构需要重复证据。
- 正在执行的 set 冻结；只在 set 之间的安全边界调整后续 set。
- 任何自动调整受 Coaching Mandate、器材最小增量、用户锁定和动作可用性约束。

### 5.4 RIR 目标区间

`TP-RIR-001@1`：

- 首课或未知负荷：`4–5 RIR`。
- 一般增肌工作组：默认 `2–4 RIR`；力量主项默认 `2–4 RIR`。这些是保守产品区间，不是证据证明的唯一最佳值。
- 默认不安排 `0 RIR`；只有已有稳定历史、用户明确偏好、动作可安全停止且规则包允许时，才能将个别低风险组提议到 `0–1 RIR`。
- UI 同时显示口语解释，例如“结束时大约还能完成 2–4 次合格重复”；不得只显示 RPE 数字。
- 保存用户原始回答和映射版本；`RPE 8 -> 约 2 RIR` 是量表语义，不是传感器事实。
- RIR 缺失时不得由速度、表情、心率或骨架自动补齐。个体化速度—RIR 模型若未来启用，必须有同动作、同设备的校准与独立能力等级。

### 5.5 VolumeProgression 与周量

`TP-VOL-BASE-001@1`（无可靠历史时的保守起点）：

- 一般健康/新手/回归者：每动作 1–2 个工作组、每个主要肌群每周至少两个可执行暴露；实际周量由动作分配产生。
- 增肌为主且无历史：产品默认从每目标肌群约 `4–8 个直接工作组/周` 内选择，默认点为 6；先满足依从性与恢复，再接近或超过约 10 组的群体增强区间。
- 已训练但历史缺失：询问最近四周的实际周量。仍未知时不得假设其“高级”容量，使用与新/回归者相同的保守起点并允许用户修改。
- `>=10 组/周` 只作为增肌优化参考，不作为自动最低量；v0.1 在超过 `12 个直接组/肌群/周` 前要求至少四周完整记录或用户明确批准。`12` 是产品审慎门槛，不是生理上限。

`TP-VOL-PROG-001@1`（加减量）：

- 自动加量的必要条件：同一肌群至少两个可比较暴露完成；计划工作组完成；表现未下降；用户没有未恢复/时间上限/停止信号；周量数据完整。
- 每次最多为一个肌群增加 1 个直接工作组/周；同一周不同时自动加重量与组数。超过 mandate 周量增幅上限时只生成 Proposal。
- 单次“泵感低”“不酸”或“感觉轻松”不能独立触发加组。泵感、DOMS 和主观工作量仅是带 provenance 的支持性反馈；目前没有验证它们组成确定性加组公式的高质量证据。
- 重复两次未恢复、表现下降、时间预算命中或用户认为负担过高时，优先减少 1 个直接组或保持周量并调整动作/日程；不要因单次睡眠差重写整个周期。
- 信号冲突或缺失时默认 `hold`，同时向用户请求最少必要信息。

`TP-VOL-ATTR-001@1`：v0.1 不把多关节动作给次要肌群自动折算成固定比例。保存 `directSets`、`secondaryExposures` 和原始动作明细；未来只有在验证规则后才能引入肌群/动作特异折算。

### 5.6 三类目标的编排默认

| 主目标 | 训练意图 | 默认编排 | 何时降级/禁用 |
|---|---|---|---|
| 增肌 | 累积足够、可恢复的直接工作组；广泛负荷均可使用 | 当前/下周详细计划；动作相对稳定；以次数→最小负重→必要时组数的顺序进阶 | 周量/表现缺失时不加量；重复未恢复或停止信号时降级 |
| 增力 | 提高目标动作或动作模式的最大力量 | 主动作靠前；保留较重但非默认力竭的暴露；已有训练者可使用简单波动；辅助量服务于主项 | 无安全技术基础、无实际负荷历史时不直接安排高百分比；未知 1RM 不伪造百分比 |
| 减脂保肌 | 在能量约束下尽量保留力量和肌肉刺激 | 尽量保留原有可恢复的动作、相对强度与直接组；先按表现删减非关键辅助组，不把训练改成纯高次数循环 | 连续表现/恢复下降、体重变化过快或疑似低能量可用性时只提示复核并建议专业支持，不诊断 |

### 5.7 徒手难度与微负重

`TP-BW-001@1`：每个徒手动作使用动作库维护的有向难度图，而不是一条全局“初级→高级”直线。

节点必须是精确变式，并保存：接触点、身体角度、支撑高度、ROM、单双侧、助力/弹力带、附加重量和可安全停止方式。边只表示“动作库认为通常更难/更易”的产品关系；不能表示固定公斤等价。

进阶顺序：

1. 在相同节点内完成次数/RIR 双进阶；
2. 若可用，加入最小附加负重或减少最小助力；
3. 若无法微调，再 Proposal 到一个相邻难度节点；
4. 新节点建立新基线，旧节点表现不得直接触发连续升级。

相邻节点首场把目标 RIR 调回 `4–5`，减少工作组或次数，用户确认可控后再恢复常规安排。动作库没有已审核相邻节点、用户器材不可用、动作存在停止风险或当前上下文无法比较时，禁用自动难度进阶。

`TP-MICROLOAD-001@1`：外部负重动作优先使用用户器材表中的最小实际档位。没有微负重片或器械档位跳幅超过当前重量 10% 时，不建议虚构中间重量；继续次数进阶、改变允许的器材配置，或等待用户配置新器材。

### 5.8 Deload 触发与内容

`TP-DELOAD-001@1`：默认不因“到了第 N 周”强制 deload。允许两种来源：

- `planned_recovery_window`：用户日程、比赛或已知高压力窗口；
- `adaptive_deload_proposal`：至少两个可比较 session 的表现下降，加上一个独立支持信号（多个肌群未恢复、主观疲劳/训练意愿显著恶化、用户明确请求或时间约束）。

单次穿戴设备低分、单次睡眠差、单次 RIR 偏差或单次酸痛不能独立触发整周 deload。

`TP-DELOAD-CONTENT-001@1`：

- 优先减少工作组和辅助动作，并把组终止点移得更远离力竭；保留熟悉的主动作技术暴露。
- 不默认完全停训；只有用户明确需要、停止信号或专业人员要求时才提出完全休息。
- 初始实现不写死“减 50%”等精确比例。Planner 生成逐项 diff，目标是比前一周清楚地降低训练压力，并在下一周重建，而不是证明某一减幅最优。
- deload 后是否恢复、保持或重建训练量取决于实际表现，不自动补做被删掉的训练量。

禁用/转交：比赛 taper、伤病康复、医疗限制和疑似过度训练综合征不由本规则包处理。

### 5.9 缺失、冲突与用户覆盖

`TP-MISSING-001@1`：

- 缺少实际重量：不能加重或计算强度百分比。
- 缺少 RIR：可以记录完成次数，但不得把该组归类为 `TOO_EASY` 并自动加重。
- 缺少实际组/次数：不能做 VolumeProgression。
- 动作/器材/ROM 改变：建立新上下文基线。
- 用户报告与 canonical packet 不一致：两者分别保存 provenance；用户可确认/更正，系统不得静默覆盖。
- 同步冲突：冻结自动提交，只生成待确认 Proposal。
- 用户可在任何时候锁定动作、重量、组数或周结构；托管模式也必须通知、可撤销并保留审计历史。

## 6. Planner 输出的最低解释要求

每次改变负荷、次数、组数、动作难度或 deload，解释至少包含：

```json
{
  "decision": "increase_load | add_rep | hold | reduce_load | add_set | remove_set | deload_proposal",
  "scope": "next_set | next_session | week | mesocycle",
  "reasonCodes": ["TWO_COMPARABLE_SESSIONS_AT_TOP_RANGE"],
  "evidenceRefs": ["performed-set:...", "user-rir:..."],
  "missing": [],
  "before": {},
  "after": {},
  "rule": { "id": "TP-PERF-001", "version": 1 },
  "confidence": "low | moderate | high",
  "requiresConfirmation": true
}
```

不得使用以下措辞：

- “摄像头确认你举了 60 kg”；
- “没有酸痛说明必须加组”；
- “第六周身体必须 deload”；
- “10 组是你的最低有效量”；
- “2 RIR 是客观测得”；
- “高次数更燃脂，所以减脂期应全部改高次数”。

## 7. 明确未知与研究队列

以下问题应保留为 `U`，不能由 LLM 通过常识补齐：

1. 不同肌群、动作、性别、年龄和训练年限的个体最低有效量与最大可恢复量精确值。
2. 每次加/减 1 组是否优于其他增量，以及泵感、酸痛、工作量、RIR 与表现的最佳信号权重和冲突优先级。
3. 对所有人都适用的最佳 RIR；不同负荷、动作和长组中 RIR 的个体误差模型。
4. 固定 4–8 周 Mesocycle、固定末周 deload 或某一 deload 百分比是否改善长期结果。
5. 徒手变式之间的通用公斤等价值，以及杠杆、ROM、节奏和微负重的统一难度公式。
6. 能量限制中应维持、增加还是减少多少周量才能最佳保留肌肉；现有已训练运动员数据不足。
7. 如何把多关节动作对次要肌群的贡献折算成统一“有效组”。
8. 消费级视频、速度或穿戴设备能否跨动作可靠估算 RIR、实际负重或肌肉疲劳。当前答案是否定或未验证，除非未来有同上下文校准与验证。

建议后续验证顺序：

1. 用回放测试验证 `PerformanceProgression` 在器材离散档位、漏记和动作替换下不会误加重。
2. 用影子模式运行 `VolumeProgression`，先观察 Proposal，不自动提交；比较用户接受率、撤销率、计划完成率和重复表现下降。
3. 对首课 `4–5 RIR` 校准做可用性研究，记录试重次数、用户理解、首个工作组偏差和停止率，不把“未受伤”作为唯一成功指标。
4. Deload 仅在足够事件积累后研究触发规则；比较自适应与固定日历策略，预注册主要结局。

## 8. 来源索引

以下只列本文实际依赖的一手组织文件、正式论文和系统综述；未使用博客或竞品营销资料。

1. Currier BS, et al. **American College of Sports Medicine Position Stand. Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults: An Overview of Reviews.** *Med Sci Sports Exerc.* 2026. DOI: 10.1249/MSS.0000000000003897. [PubMed](https://pubmed.ncbi.nlm.nih.gov/41843416/)；[ACSM 官方发布](https://acsm.org/resistance-training-guidelines-update-2026/)
2. Ratamess NA, et al. **Progression Models in Resistance Training for Healthy Adults.** *Med Sci Sports Exerc.* 2009. DOI: 10.1249/MSS.0b013e3181915670. [ACSM 官方译本](https://www.acsm.org/wp-content/uploads/2025/01/Progression-Models-in-Resistance-Training-for-Healthy-Adults-Simplified.pdf)
3. Currier BS, et al. **Resistance training prescription for muscle strength and hypertrophy in healthy adults: a systematic review and Bayesian network meta-analysis.** *Br J Sports Med.* 2023. [PubMed](https://pubmed.ncbi.nlm.nih.gov/37414459/)
4. Schoenfeld BJ, Ogborn D, Krieger JW. **Dose-response relationship between weekly resistance training volume and increases in muscle mass.** *J Sports Sci.* 2017. [PubMed](https://pubmed.ncbi.nlm.nih.gov/27433992/)
5. Moesgaard L, et al. **Effects of Periodization on Strength and Muscle Hypertrophy in Volume-Equated Resistance Training Programs.** *Sports Med.* 2022. [PubMed](https://pubmed.ncbi.nlm.nih.gov/35044672/)
6. Lopez P, et al. **Resistance Training Load Effects on Muscle Hypertrophy and Strength Gain.** *Med Sci Sports Exerc.* 2021. [PubMed](https://pubmed.ncbi.nlm.nih.gov/33433148/)
7. Refalo MC, et al. **Influence of Resistance Training Proximity-to-Failure on Skeletal Muscle Hypertrophy.** *Sports Med.* 2023. [PubMed](https://pubmed.ncbi.nlm.nih.gov/36334240/)
8. Grgic J, et al. **Effects of resistance training performed to repetition failure or non-failure on muscular strength and hypertrophy.** *J Sport Health Sci.* 2022. [PubMed](https://pubmed.ncbi.nlm.nih.gov/33497853/)
9. Vieira AF, et al. **Effects of Resistance Training Performed to Failure or Not to Failure on Muscle Strength, Hypertrophy, and Power Output.** *J Strength Cond Res.* 2021. [PubMed](https://pubmed.ncbi.nlm.nih.gov/33555822/)
10. Zourdos MC, et al. **Novel Resistance Training-Specific Rating of Perceived Exertion Scale Measuring Repetitions in Reserve.** *J Strength Cond Res.* 2016. [PubMed](https://pubmed.ncbi.nlm.nih.gov/26049792/)
11. Lovegrove S, et al. **Repetitions in Reserve Is a Reliable Tool for Prescribing Resistance Training Load.** *J Strength Cond Res.* 2022. [PubMed](https://pubmed.ncbi.nlm.nih.gov/36135029/)
12. Steele J, et al. **Ability to predict repetitions to momentary failure is not perfectly accurate, though improves with resistance training experience.** *PeerJ.* 2017. [PubMed](https://pubmed.ncbi.nlm.nih.gov/29204323/)
13. Hughes LJ, et al. **Estimating Repetitions in Reserve in Four Commonly Used Resistance Exercises.** *J Strength Cond Res.* 2020. [PubMed](https://pubmed.ncbi.nlm.nih.gov/33337690/)
14. Refalo MC, et al. **Accuracy of Intraset Repetitions-in-Reserve Predictions During the Bench Press Exercise.** *J Strength Cond Res.* 2024. [PubMed](https://pubmed.ncbi.nlm.nih.gov/37967832/)
15. Ramos-Campo DJ, et al. **Efficacy of Split Versus Full-Body Resistance Training on Strength and Muscle Growth.** *J Strength Cond Res.* 2024. [PubMed](https://pubmed.ncbi.nlm.nih.gov/38595233/)
16. Murphy C, Koehler K. **Energy deficiency impairs resistance training gains in lean mass but not strength.** *Scand J Med Sci Sports.* 2022. [PubMed](https://pubmed.ncbi.nlm.nih.gov/34623696/)
17. Lopez P, et al. **Resistance training effectiveness on body composition and body weight outcomes in individuals with overweight and obesity across the lifespan.** *Obes Rev.* 2022. [PubMed](https://pubmed.ncbi.nlm.nih.gov/35191588/)
18. Roth C, Schoenfeld BJ, Behringer M. **Lean mass sparing in resistance-trained athletes during caloric restriction: the role of resistance training volume.** *Eur J Appl Physiol.* 2022. [PubMed](https://pubmed.ncbi.nlm.nih.gov/35146569/)
19. Calatayud J, et al. **Bench press and push-up at comparable levels of muscle activity results in similar strength gains.** *J Strength Cond Res.* 2015. [PubMed](https://pubmed.ncbi.nlm.nih.gov/24983847/)
20. Kotarsky CJ, et al. **Effect of Progressive Calisthenic Push-up Training on Muscle Strength and Thickness.** *J Strength Cond Res.* 2018. [PubMed](https://pubmed.ncbi.nlm.nih.gov/29466268/)
21. Bell L, et al. **Integrating Deloading into Strength and Physique Sports Training Programmes: An International Delphi Consensus Approach.** *Sports Med Open.* 2023. [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/)
22. Coleman M, et al. **Gaining more from doing less? The effects of a one-week deload period during supervised resistance training on muscular adaptations.** *PeerJ.* 2024. [PubMed](https://pubmed.ncbi.nlm.nih.gov/38274324/)
23. Pancar Z, et al. **Effects of deload periods in resistance training on muscle hypertrophy and strength endurance in untrained young men.** *Sci Rep.* 2026. [PubMed](https://pubmed.ncbi.nlm.nih.gov/41730991/)

## 9. 更新策略

- 建议复审周期：每 12 个月；ACSM、NSCA 或 ISSN 发布新立场文件时立即复审。
- `0.1.x` 只允许修正引用和表述；任何阈值、触发条件或自动权限变化至少升级 minor 版本。
- 新研究不得静默覆盖旧规则：先新增 evidence entry，记录适用人群与局限，再通过规则包评审决定是否更新默认值。
- 如果证据冲突，默认保持更保守规则、降低自动权限并生成用户可理解的 Proposal。
