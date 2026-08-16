---
title: 本地健身知识库覆盖度审查
date: 2026-08-13
status: completed
scope: local-workspace
---

# 本地健身知识库覆盖度审查

## 结论先行

本地资料已经形成一个**面向“力量训练视觉动作教练”**的、结构化且有相当深度的知识库；它不是面向所有运动、所有人群的通用健身百科。

其覆盖链条可以概括为：

```text
手机视频/姿态点 → 机位与轨迹质量 → 动作身份与次数分段
→ 预计肌群与保守动作建议 → 训练编程/恢复约束/营养策略
```

链条的前半段（计算机视觉、单目机位、轨迹、次数、证据边界）最深；后半段（力量训练计划、营养、恢复）已有可用的规则与安全边界，但广度仍明显小于前半段。最重要的能力边界是：目录中有动作，不等于已经能识别它、评价其技术质量，或从视频推断真实肌肉激活和伤病风险。

**覆盖总评：**

| 维度 | 结论 | 依据 |
|---|---|---|
| 领域广度 | 中等偏广；覆盖力量训练动作、基础有氧/活动度、训练计划、恢复、营养和视觉动作分析 | `wiki/index.md` 的知识地图；`maxpower/docs/wiki/` 的五份领域文档 |
| 核心深度 | 高，但高度集中于视觉动作教练链路 | `wiki/` 的标签分布中 `pose-estimation`、`camera-view`、`rep-counting`、`trajectory` 均显著领先 |
| 可执行结构化程度 | 高 | `maxpower/src/knowledge/packs/core-fitness-knowledge.v1.json` 包含目录、刺激契约、规则包、安全词表和训练策略 |
| 视觉动作质量的已验证覆盖 | 低 | 参考轨迹只覆盖高位下拉；已批准真值为 0 组，见 `wiki/capability-baseline.md` |
| 特殊人群、医疗与专项运动覆盖 | 低/明确排除 | 营养、恢复与训练文档均把诊断、康复、疾病和特殊生理时期置于安全边界外 |

因此，当前最准确的产品定位是：**面向健康成人、以休闲力量训练为主的动作识别与保守训练辅助知识底座**。不应将它描述为临床康复、特殊人群训练处方、全运动项目教练或基于视频的肌电/伤病风险评估系统。

## 审查范围与方法

### 纳入内容

本审查读取了工作区内可访问的、明显属于健身知识资产的文本和结构化内容：

- 工作区知识导航与汇总层：`wiki/`（含 `knowledge/`、`concepts/`、`entities/`、`sources/`）。
- MaxPower 的规范领域文档：`maxpower/docs/wiki/`。
- MaxPower 的可执行知识包：`maxpower/src/knowledge/packs/core-fitness-knowledge.v1.json`。
- 相关的研究与可行性材料：`maxpower/docs/research/`、`strength-cut-coach/docs/research/`、`form-coach-torso-feasibility/docs/research/`，以及由 `wiki/sources/` 索引的来源记录。

未把依赖目录、构建产物、重复打包目录、普通应用代码和运行报告作为“知识库规模”计入；它们可验证实现状态，但会显著夸大知识内容。由于工作区同时保留历史项目文档，规模统计将“导航层”和“原始研究层”分开，避免重复计算同一结论。

### 判定口径

1. **存在**：有本地文档或结构化条目可直接定位。
2. **可用于产品规则**：文档将证据事实、产品规则、未知和安全边界分开，或已进入版本化 JSON 知识包。
3. **已验证能力**：除有知识外，还需要同一动作身份、机位和数据条件下的验证；目录、模拟先验和研究摘要本身不算验证。
4. **领域空白**：在规范知识页明确列为 `Unknown`/范围外，或整个索引没有相应专题与可执行资产。

这是一份本地内容审查，而不是对外部文献重新鉴定；所有事实均回链到下文的本地文件路径。

## 内容规模与层次

### 1. 工作区知识导航层

`wiki/index.md` 的自动索引记录 **91 页**。按栏目：7 个入口页、14 篇学科知识与算法页、6 篇概念页、3 篇实体页、1 篇开放问题、60 篇来源页。全库约 **15,557 行**；来源页多数是轻量溯源卡，而非完整正文。

该层的作用不是单独保存全部原始知识，而是把不同项目的研究结果连接到共同的术语、证据等级和能力边界。`wiki/WIKI.md`、`wiki/concepts/evidence-tiers.md` 与 `wiki/index.md` 共同定义了这一治理方式。

标签计数进一步显示重心：

| 标签 | 页面数 |
|---|---:|
| `pose-estimation` | 64 |
| `camera-view` | 56 |
| `rep-counting` | 54 |
| `trajectory` | 50 |
| `dataset` | 42 |
| `muscle` | 32 |
| `exercise-catalog` | 32 |
| `training-programming` | 9 |
| `recovery` | 4 |
| `nutrition` | 3 |

来源：对 `wiki/**/*.md` front matter 的 `tags` 做去重页计数；索引内容可见 `wiki/index.md`。

### 2. 规范领域知识与可执行包

`maxpower/docs/wiki/` 有五份规范文档、合计约 **13,546 行**（中文内容以行数而非空格分词衡量更可靠）：

| 文档 | 主要领域 | 行数 |
|---|---|---:|
| `exercise-and-stimulus-knowledge.md` | 动作身份、器械、刺激契约、替代、可声称边界 | 5,652 |
| `nutrition-strategy.md` | 能量、宏量营养、依从性、营养安全边界 | 3,915 |
| `training-programming.md` | 增肌/增力/减脂保肌、RIR/RPE、进阶、减载 | 1,932 |
| `recovery-and-health-signals.md` | 睡眠、HRV、RHR、疲劳、疼痛、恢复约束 | 1,221 |
| `program-strategy-set.md` | 分化、课表架构、进阶与长期阶段 | 826 |

与叙述文档配套的 `core-fitness-knowledge.v1.json`（语义版本 `1.0.0`，审阅日期 2026-08-08）含：

- **33** 个动作概念；
- **379** 个精确动作变体；
- **33** 个 `StimulusContract`（训练刺激契约）；
- **5** 个目标导向的替代动作排序配置；
- **5** 个版本化可执行规则包（兼容性、目录约束、增肌、增力、减脂保肌）；
- **31** 个领域锚点与 **16** 条禁止声称；
- 训练策略材料中的 **44** 条引文、**263** 条 passages 和 **263** 条 keypoints。

来源：`maxpower/src/knowledge/packs/core-fitness-knowledge.v1.json` 的 `manifest`、`exerciseCatalog`、`executableRulePacks`、`safetyLexicon` 与 `programStrategies`。

### 3. 原始研究层

原始研究材料与技术可行性记录并不少：

| 位置 | Markdown 文件数 | 作用 |
|---|---:|---|
| `wiki/sources/` | 60 | 统一索引的来源/溯源卡 |
| `maxpower/docs/research/` | 58 | 新版产品与领域研究 |
| `strength-cut-coach/docs/research/` | 17 | 早期视觉动作教练研究 |
| `form-coach-torso-feasibility/docs/research/` | 2 | 躯干可行性研究 |

它们为规范层提供来路，但其中也包含历史结论和实验性材料。采用时应以规范页、已审阅知识包和相同身份的数据验证为优先，而不是把所有研究笔记等同于可上线规则。

## 主题覆盖地图

### A. 视觉动作理解与动作质量边界 — 深度覆盖

| 子领域 | 覆盖状态 | 本地证据 |
|---|---|---|
| 姿态估计、2D→伪 3D、单目限制 | 深 | `wiki/knowledge/2d-to-3d-lifting.md`、`wiki/knowledge/camera-geometry.md`、`wiki/concepts/monocular-pseudo-3d.md` |
| 机位、坐标系、可观测性 | 深 | `wiki/concepts/camera-view-strategy.md`、`wiki/knowledge/camera-geometry.md` |
| 骨架连续性、主体选择、轨迹修复 | 深 | `wiki/concepts/pose-pipeline-order.md`、`wiki/algorithms-registry.md`、`wiki/sources/fc-dominant-subject-pose-tracking.md` |
| 次数分段与计数 | 深 | `wiki/knowledge/rep-segmentation.md`、`wiki/capability-baseline.md` |
| 轨迹参考、对齐与质量输出 | 中等，但验证窄 | `wiki/concepts/trajectory-reference.md`、`wiki/capability-baseline.md` |
| 动作质量、躯干代偿、可声称输出 | 中等且保守 | `wiki/knowledge/neutral-spine-compensation.md`、`wiki/knowledge/claimable-outputs.md`、`wiki/concepts/evidence-tiers.md` |

这部分的主要优势不是“打一个标准度总分”，而是明确区分可观察轨迹、可比较轨迹、未知和不可声称的结论。

### B. 动作、肌群、器材与刺激 — 宽覆盖，验证分层

旧工作区动作目录含 **65 个动作身份**：61 个五分化力量动作（胸 9、背 13、腿 16、肩 13、手臂 10）加 4 个居家移动动作。新版可执行包则采用更细的 **33 个动作概念 / 379 个精确变体** 模型；两者口径不同，不能直接相加。

结构化变体覆盖了水平推/拉、垂直推/拉、深蹲、髋铰链、弓步、膝屈伸、提踵、核心屈曲/抗伸展/抗旋、肩部各主要方向、手臂孤立动作、步行/骑行/椭圆机/爬楼、活动度和恢复活动。器械包括自重、杠铃、哑铃、壶铃、拉力器、固定器械、弹力带和有氧器械。

来源：`wiki/entities/exercise-catalog.md`；`maxpower/src/knowledge/packs/core-fitness-knowledge.v1.json` 的 `exerciseCatalog.concepts` 与 `exerciseCatalog.variants`。

不过，动作目录是**训练和记录的语义覆盖**，不是视觉识别覆盖。`maxpower/docs/wiki/exercise-and-stimulus-knowledge.md` 明确记录：65 个旧目录动作中 13 个处于 experimental profile 层，其余 52 个为 `catalog_only`；而 `wiki/entities/exercise-catalog.md` 也禁止把近邻动作、机位或器械的资料直接转移给未知身份。

### C. 力量训练编程与长期适应 — 中高覆盖

规范页已经覆盖健康成人力量训练的主要产品决策：

- 目标：增肌、增力、减脂保肌；
- 剂量与强度：周直接组、RIR/RPE、动作优先级、负荷与次数双进阶；
- 组织：分化、课内结构、轮转、减载、徒手难度图；
- 约束：没有同动作历史时不虚构起始公斤，缺 RIR 时不自动加重；
- 与恢复、营养和用户记录的接口。

来源：`maxpower/docs/wiki/training-programming.md`、`maxpower/docs/wiki/program-strategy-set.md`、`maxpower/src/knowledge/packs/core-fitness-knowledge.v1.json` 的训练规则包。

这对“健康成人的休闲阻力训练”已足够成为可解释的保守规则底座；但它不覆盖比赛峰值、完整耐力专项周期、临床康复或特定疾病训练处方。`program-strategy-set.md` 也明确把峰值/竞赛计划排除在默认收录范围外。

### D. 恢复与健康信号 — 中等覆盖，安全边界清晰

恢复知识把主观状态、睡眠、HRV、静息心率、局部酸痛、既往训练负荷与日程转化为四级 `RecoveryConstraint`，并明确不把设备 readiness 当诊断或自动取消训练的依据。它还区分 HealthKit 的 SDNN 与 Health Connect 的 RMSSD，避免把异口径 HRV 拼作同一基线。

来源：`maxpower/docs/wiki/recovery-and-health-signals.md`；对应安全词表位于 `core-fitness-knowledge.v1.json`。

该领域的局限同样明确：适用于本产品力量训练者的窗口、最小有意义变化和不同生活情境的阈值尚未验证；系统不做疾病、伤病或风险预测。

### E. 营养 — 中等覆盖，限于健康成人策略

营养知识包括能量平衡、增肌/维持/减脂保肌的起始策略、蛋白质、脂肪下限、碳水按训练需求分配、饮食休息/碳循环的证据边界、趋势与依从性门控，以及 REDs 等安全拒答边界。

来源：`maxpower/docs/wiki/nutrition-strategy.md`。

范围明确限于健康成人休闲力量训练者。该文档直接排除诊断、治疗、康复营养、孕产营养、进食障碍治疗、疾病特异饮食、完整食物数据库、补剂和比赛减重。因此，现有营养覆盖应理解为“安全的宏观策略和调整纪律”，而不是个人临床营养服务。

## 已验证能力与目录覆盖必须分开看

这是本知识库最需要避免误读的地方：

| 层次 | 当前范围 | 结论 |
|---|---|---|
| 动作目录 | 65 个旧目录动作；33 个概念、379 个新版变体 | 可以命名、记录、建模刺激和寻找平替 |
| 识别/计数 profile | 内置 Rust profile 8 个，均为 provisional | 只在精确动作身份和机位匹配时可用 |
| 参考轨迹 | 高位下拉 | 输出“可比较/未知/带外”的描述性证据，而不是技术评分 |
| 人工数据 | 39 组草稿、375 个草稿 rep 边界；已批准真值 0 组 | 尚无可推广的地面真值验证基础 |
| 肌群结论 | 预计肌群与刺激意图 | 不是由视频观测得到的真实激活或肌电 |

来源：`wiki/capability-baseline.md` 第 39–46、94–98 行；`wiki/roadmap-priority.md`；`wiki/open-questions.md`；`maxpower/docs/wiki/exercise-and-stimulus-knowledge.md` 的“Separation of Layers”。

## 明显空白与优先级

### P0：阻止视觉动作质量能力扩展的空白

1. **批准真值和独立专家审核缺失。** 现有 39 组草稿和 375 个 rep 边界尚未形成一组已批准真值；项目也尚未确定能审核动作质量规则的独立教练或生物力学专家。这使新的质量规则和参考走廊无法从“目录/模拟先验”升级为“已验证能力”。
2. **动作×机位的参考轨迹过窄。** 实际参考走廊只覆盖高位下拉，其他动作不能继承该轨迹或阈值。
3. **单目观测边界。** 缺多视角、深度、IMU、sEMG 与实验室动捕的同身份验证，因此不能声称真实肌肉激活、精确三维关节动力学或伤病风险。

证据：`wiki/capability-baseline.md`、`wiki/roadmap-priority.md`、`wiki/open-questions.md`。

### P1：使训练教练从“力量训练”扩展到更完整健身服务的空白

1. **有氧/体能处方。** 目录有基础有氧和 `conditioning` 相关动作，但训练编排仍以阻力训练为中心，缺 FITT-VP 式的有氧剂量、进阶、强度区间与专项耐力周期化知识。
2. **专项运动。** 力量举、举重、CrossFit、跑步、骑行及球类专项的技术、负荷管理和竞赛周期未形成专题知识。
3. **特殊人群。** 青少年、老年虚弱人群、孕产期、慢病患者、术后/疼痛/康复人群均不在当前可自动化范围；即使零散提及，也不能视为覆盖。
4. **营养细分。** 缺照片/文字膳食估算精度的正式证据与校准规则、消费级体脂/BIA 精度专题、完整食物/补剂数据库和疾病营养路径。
5. **现实器材细节。** 可执行包已经有器材类型，但实物库存、离散重量档位和部分微负重可用性仍存在 `Unknown`，不能假设所有训练场景等价。

证据：`wiki/adaptive-coach-mvp-knowledge-gap-2026-08-08.md` 的 K20.1、K8.2 和有氧处方缺口；`maxpower/docs/wiki/nutrition-strategy.md` 的范围外清单；`maxpower/docs/wiki/exercise-and-stimulus-knowledge.md` 的未知项；`maxpower/docs/wiki/program-strategy-set.md` 的范围外清单。

### P2：知识库治理空白

规范领域知识主要位于 `maxpower/docs/wiki/`，而工作区级 `wiki/` 的来源索引以视觉与姿态研究为中心。结果是：只阅读 `wiki/index.md` 的人可以看到训练、营养、恢复主题名称，却不一定能顺着工作区溯源卡直接找到所有最新规范文档。应明确两者的权威分工，或为这五份规范文档补充工作区级来源登记；这属于可发现性问题，不是内容不存在。

证据：`wiki/index.md` 的知识地图和来源页列表；`wiki/adaptive-coach-mvp-knowledge-gap-2026-08-08.md` 第 4.5 节。

## 建议的对外表述

可以说：

> 我们的本地知识库覆盖健康成人的休闲力量训练动作、训练刺激、基础编程、恢复和营养策略，并对单目视频的动作识别、次数分段、机位与轨迹可观测性做了深入建模。所有建议都有证据等级、未知项和安全边界。

不应说：

> 系统已能评估所有动作是否标准、从视频准确判断肌肉激活或伤病风险，或向所有人群提供完整训练与营养处方。

## 主要本地证据索引

- `wiki/index.md` — 全库索引、知识地图、页面计数和标签。
- `wiki/entities/exercise-catalog.md` — 65 个旧目录动作、身份边界与目录不等于识别能力。
- `wiki/capability-baseline.md` — 已运行能力、8 个 provisional profile、唯一参考走廊和批准真值缺口。
- `wiki/roadmap-priority.md`、`wiki/open-questions.md` — 真值、专家审核和参考轨迹扩展的阻塞。
- `wiki/knowledge/*.md`、`wiki/concepts/*.md` — 视觉动作链、肌群边界、可声称输出及证据纪律。
- `maxpower/docs/wiki/exercise-and-stimulus-knowledge.md` — 目录、刺激、识别/参考轨迹/肌群层分离。
- `maxpower/docs/wiki/training-programming.md`、`program-strategy-set.md` — 力量训练编排与明确未知。
- `maxpower/docs/wiki/recovery-and-health-signals.md`、`nutrition-strategy.md` — 恢复、营养与安全边界。
- `maxpower/src/knowledge/packs/core-fitness-knowledge.v1.json` — 版本化结构化内容及数量。
- `wiki/adaptive-coach-mvp-knowledge-gap-2026-08-08.md` — 域知识缺口、领域文档与工作区 wiki 的分工现状。

---

# 教练知识库建设蓝图

## 使用前提：已知、假设与共同未知

### 已知（本地证据）

- 现有资产面向 `healthy_adults`、`beginner_to_advanced_resistance_training`，并把 `exercise_catalog`、`stimulus_metadata` 和治理列为知识包范围：`maxpower/src/knowledge/packs/core-fitness-knowledge.v1.json` 的 `manifest`。
- 训练、营养和恢复规范页已经把“证据事实 / 产品规则 / Unknown / 安全边界”分开；它们不授权诊断、治疗或临床康复。
- 视觉动作技术的验证数据和专家审核仍是最大短板，见本报告“已验证能力与目录覆盖必须分开看”。

### 建设假设（需要业务确认，不当作事实）

1. 首发服务对象仍是能自行决定开始一般锻炼的健康成年人，而非医疗转诊患者。
2. 教练服务的近期目标是“提高安全、理解、完成率与训练记录质量”，而不是宣称治疗疼痛、预防伤病或改善某项疾病指标。
3. 每一条新自动规则都可以保留版本、输入、结果、用户覆盖和转介记录，并接受人工复核。

### 共同未知（必须在立项前补齐）

- 用户所在司法辖区、实际执业者资质及法律允许的服务边界；下述资料主要来自国际/美国组织，不能替代本地法律意见。
- 目标用户的年龄、训练史、基础疾病、可用器材、语言文化、营养限制以及是否有可用的专业转介网络。
- 什么程度的误报、漏报、自动调整和解释成本对用户可接受；这些是产品效用问题，不能从教材中直接推导。
- 当前视频数据是否足以代表真实用户（动作、器材、机位、体型、服装、光照和训练环境）。

## 服务边界与转介规则

### 教练可以做的事（绿色）

- 向已筛为适合一般锻炼的成年人解释动作选项、训练日志、一般性计划结构、RIR/RPE、自我报告恢复和基本营养教育。
- 在可观测性满足时，提供带置信度和“不确定”提示的动作次数、相位或轨迹描述；可建议减重、暂停某动作或改为用户已知的低风险替代，但不可把它命名为治疗。
- 记录并提示用户与其医生、注册营养师、物理治疗师或其他合格人员沟通。

### 只能在确认/转介后协作（黄色）

- 已知慢病、正在用可能影响运动反应的药物、持续疼痛、近期手术/急性伤病、孕产期、未成年人、高龄/虚弱、进食障碍史或高度限制饮食。
- 系统只能收集事实、展示保守限制、请求专业指示或确认；不得由模型自行解释病因、处方治疗剂量或宣称医疗获益。
- 对于由临床人员明确给出活动限制或计划的人，系统只能把该限制作为优先级最高的外部指令保存和执行。

### 立即停止并建议紧急/医疗评估（红色）

- 用户报告胸部不适、晕厥/濒晕厥、异常呼吸困难、突发严重或尖锐疼痛、神经系统异常，或已有医疗限制命中。
- 输出应为非诊断性：“停止当前训练，按症状紧急程度寻求医疗帮助/联系医疗专业人员。”不得生成绕过症状继续练的替代方案。

当前恢复页已有类似规则（`maxpower/docs/wiki/recovery-and-health-signals.md`）。作为外部的职业边界参照，ACSM 的专业资源把运动前筛查和健康适宜性纳入专业能力；APTA 明确物理治疗的诊断、评估与治疗计划由相应受训/受监管专业人员完成，且各司法辖区范围不同。[ACSM GETP 12](https://acsm.org/education-resources/books/guidelines-exercise-testing-prescription/) · [ACSM 运动生理专业能力交叉表](https://chapters.acsm.org/docs/default-source/certification-documents/acsm-ep-crosswalk.pdf) · [APTA 执业范围说明](https://www.apta.org/your-practice/scope-of-practice)

## 优先建设顺序

| 优先级 | 缺口 | 为什么现在做 | 交付物应是什么，而不是什么 |
|---|---|---|---|
| P0 | 筛查、停止与转介工作流 | 是扩大人群和增加自动化前的安全闸门；现有恢复页已有基础，但尚不是全服务入口合同 | 版本化事实问卷、红黄绿路由、解释与审计日志；**不是诊断或医疗清除** |
| P0 | 动作×机位真值和独立专家审核 | 当前所有视频技术扩展都受 0 组批准真值阻塞 | 精确身份的标注协议、双人审核、一致性和独立留出集；**不是“全动作标准评分”** |
| P1 | 基础有氧/体能（FITT-VP）知识包 | 目录已有有氧动作，但缺剂量、进阶和与力量训练的整合 | 面向已筛健康成人的一般活动模板和用户选择；**不是心肺康复或专项耐力训练处方** |
| P1 | 营养观察与不确定性校准 | 当前宏观营养策略可用，但照片/文字记录的误差模型是实质缺口 | 范围、置信度、确认和偏差警示；**不是精确热量测量或临床营养治疗** |
| P1 | 行为改变、依从性与教练沟通 | 再好的计划若无法执行，就没有可持续价值；当前只覆盖部分依从性门控 | 目标协商、计划障碍、每周复盘和可解释提示；**不是心理治疗或心理诊断** |
| P2 | 特殊人群与康复协作接口 | 市场价值高，但误用风险和证据要求更高 | 外部专业计划/限制的导入、转介与共同管理记录；**不是自主康复方案** |
| P2 | 专项运动与竞赛周期 | 在健康休闲力量训练稳定后再做，避免将一般规则伪装成专项教练 | 逐项目、逐级别、逐赛季的独立知识包；**不是通用迁移** |

## 学科框架与推荐教材

以下是“建设资料架”，不是让系统把教材文字复制为规则。每份来源先应转写为带适用人群、证据级别、版本、反例和转介条件的原子知识条目；临床章节只能用于识别边界与转介语言，不能直接变成教练自动处方。

| 学科模块 | 建库目的 | 优先权威资料（组织/出版社直链） | 教练可用边界 |
|---|---|---|---|
| 职业范围、筛查与一般运动处方 | 建立进入条件、FITT-VP、记录、停止和转介协议 | [ACSM’s Guidelines for Exercise Testing and Prescription, 12th ed.](https://acsm.org/education-resources/books/guidelines-exercise-testing-prescription/)；[ACSM’s Resources for the Personal Trainer, 7th ed.（出版社页）](https://shop.lww.com/ACSM-s-Resources-for-the-Personal-Trainer/p/9781975219314) | 用于一般运动适宜性、筛查和保守计划。健康/疾病诊断、医疗清除与治疗决策仍须相应执照专业人员。 |
| 力量与体能训练学 | 扩充力量、速度、功率、测试、恢复、年龄/性别差异和计划设计 | [NSCA *Essentials of Strength Training and Conditioning*, 5th ed.](https://www.nsca.com/certification/cscs/essentials-of-strength-training-and-conditioning-5th-edition/) | 可形成健康人与运动表现人群的训练原则与教练流程；竞赛峰值、伤后回归和高风险专项要另建证据包及人工审核。 |
| 运动生理与基础有氧体能 | 补足有氧剂量、能量系统、并发训练和运动测试的概念 | [ACSM GETP 12](https://acsm.org/education-resources/books/guidelines-exercise-testing-prescription/)；[NSCA *Essentials*, 5th ed.](https://www.nsca.com/certification/cscs/essentials-of-strength-training-and-conditioning-5th-edition/) | 对已筛健康成人给一般活动/体能建议；不解释心肺症状，不制定心脏、肺部或代谢疾病运动治疗方案。 |
| 功能解剖、运动学与生物力学 | 把“动作名称/预计肌群”提升为关节动作、外力、可观察变量和不可观察变量 | [Neumann’s *Kinesiology of the Musculoskeletal System*, 4th ed.](https://www.us.elsevierhealth.com/neumanns-kinesiology-of-the-musculoskeletal-system-9780323718592.html)；[McGinnis, *Biomechanics of Sport and Exercise*, 4th ed.](https://www.human-kinetics.co.uk/9781492571407/biomechanics-of-sport-and-exercise/) | 可构建术语、教练提示与视频可观测性说明；不能从单目视频推断关节内部载荷、组织损伤或真实肌电。 |
| 动作学习与反馈 | 建立教学提示、注意焦点、阶段性学习和反馈频率的规则 | [Shumway-Cook & Woollacott, *Motor Control*, 6th ed.](https://www.lww.co.uk/9781975209575/motor-control/) | 用于一般动作教学设计。该书有临床应用背景；神经系统/功能障碍的评估与治疗应转介临床人员。 |
| 运动营养与饮食行为 | 扩充能量、宏量营养、训练日供能、补水、体重变化和记录不确定性 | [Jeukendrup & Gleeson, *Sport Nutrition*, 4th ed.](https://www.human-kinetics.co.uk/9781718221703/sport-nutrition/) | 用于健康成人的一般教育与策略。疾病营养、进食障碍、孕产、药物互动、补剂治疗和比赛减重均不自动化；需要注册营养师/医生路径。 |
| 恢复、疼痛和康复协作 | 扩展停止规则、疼痛语言、功能限制记录和外部计划接口 | [ACSM’s Resources for the Personal Trainer](https://acsm.org/education-resources/books/resources-personal-trainer/)；[APTA Guide / 执业范围](https://www.apta.org/your-practice/scope-of-practice) | 教练只做筛查、记录、停止、通用低风险活动和转介；物理治疗中的检查、诊断、预后和治疗计划不属于本系统。 |
| 运动与健康心理、行为改变 | 建立自主性、目标协商、习惯、压力与依从性沟通，不把“没完成”误判为生理问题 | [Gill, Williams & Reifsteck, *Psychological Dynamics of Sport and Exercise*, 4th ed.](https://www.human-kinetics.co.uk/9781492586241/psychological-dynamics-of-sport-and-exercise/) | 可用于动机、目标、社会支持和沟通设计；心理疾病筛查、诊断、危机干预和治疗需转介持证心理健康专业人员。 |
| 证据治理与产品验证 | 把教材和研究转为可审计规则，防止陈旧、越界和误用 | 本地的 `wiki/concepts/evidence-tiers.md`、`wiki/knowledge/claimable-outputs.md`、`maxpower/docs/wiki/*.md` | 所有外部知识必须经版本、适用范围、冲突、未知项和实验验证后才可进入默认规则。 |

上述版本和链接于 2026-08-13 核验。ACSM 已说明其认证考试自 2025-07-10 起对齐 GETP 第 12 版；NSCA 将 *Essentials* 第五版描述为其力量与体能训练的核心资源；两本 Human Kinetics 资料分别以生物力学/功能解剖和运动营养为主。[ACSM 更新说明](https://acsm.org/certification-exam-2025-getp12/) · [NSCA 第五版说明](https://www.nsca.com/certification/cscs/essentials-of-strength-training-and-conditioning-5th-edition/) · [Human Kinetics 运动营养资料](https://www.human-kinetics.co.uk/9781718221703/sport-nutrition/)

## 高优先级缺口的最小建设实验

下面的阈值是**待预注册的产品成功标准**，不是现有事实或临床标准。每个实验只改变一个主要变量，冻结其余版本；结果必须能否定假设，不能只收集“看起来不错”的演示案例。

| 缺口 / 单一变量 | 最小实验与对照 | 成功/失败信号（预注册产品标准） | 必须采集的数据 | 服务边界 |
|---|---|---|---|---|
| P0 筛查与转介：**结构化路由规则** vs 现有自由文本入口 | 使用去标识化、人工构造或经伦理审批的情景集；由独立合格临床顾问仅对“应继续/应转介/应紧急停止”标签进行裁决。两组只改变入口规则。 | 成功：所有预标红旗均被停止/转介，且系统从不输出“医疗清除/诊断”；失败：任一红旗被允许继续，或路由无法解释/审计。 | 每题原始回答、规则版本、命中理由、路由结果、人工金标准、覆盖/更正。 | 这是路由准确性测试，不对真实用户作疾病判定；真实红旗一律停止并转介。 |
| P0 视频技术：**一个精确动作×机位的参考走廊版本** vs 固定基线 | 只选择一个动作、一个器械配置、一个机位；锁定采集协议，在独立留出视频上比较旧/新走廊。双人标注、盲法裁决，且训练/验证/测试分离。 | 成功：预注册的次数 F1、可用覆盖率和审核一致性同时达标，且不出现跨身份迁移；失败：任一指标未达标、审核一致性低或因机位/器械漂移失效。 | 原视频许可、精确身份、机位、设备、帧级/rep 级标签、标注者、一致性、模型/走廊 hash、拒答/失败原因。 | 只可输出观察到的计数/轨迹状态；在专家审核前不得升级为技术合格评分。 |
| P1 基础有氧：**FITT-VP 默认模板** vs 仅让用户自行安排 | 招募已通过一般运动筛查的健康成人；保持总提示频率和界面不变，只改变是否提供低/中强度的保守模板。 | 成功：完成率、RPE 记录率和用户理解度改善，且没有因系统建议造成的红旗事件；失败：不良症状、过度训练反馈增加或用户无法按计划理解/执行。 | 筛查版本、已选目标、时长/频率、主观 RPE、完成/放弃原因、症状/转介、用户覆盖。 | 不测试疾病疗效或 VO₂max 医疗推断；出现症状立即停止/转介。 |
| P1 营养观察：**照片/文字估算方式** vs 已称重的食物真值 | 在标准化餐食（含混合菜、隐藏油脂和不同份量）中，仅改变估算输入方式；真值由称重配方或可靠标签给出。 | 成功：预注册比例的真值落入系统给出的能量/宏量范围，且偏差随份量、混合菜和油脂被正确标低置信；失败：系统持续给出窄而错误的范围或出现未提示的系统性偏差。 | 食物组成/重量真值、照片条件、估算范围、置信度、用户确认、误差方向/大小、失败类型。 | 结果仅为可确认草稿；不做精确摄入、疾病饮食或减重处方。 |
| P1 行为改变：**每周障碍—计划提示** vs 普通周报 | 随机 A/B：其余训练和营养建议固定，只加入一次以用户选择障碍为起点的计划提示。 | 成功：计划完成率或持续记录率提高，同时用户感到自主而非被惩罚；失败：退出、压力/内疚反馈增加，或效果仅来自更高提醒量。 | 目标、用户选择的障碍、提示曝光、训练/记录完成、主动覆盖、简短自主性感受量表、退出原因。 | 不把情绪/依从性解释为心理诊断；心理危机或进食障碍线索进入转介流程。 |

## 建库工作流（每个模块通用）

1. **定义主张。** 写清目标用户、情境、可操作输入、允许的输出和禁止输出。
2. **建立证据卡。** 每张卡包含出处、版本、适用人群、研究/组织类型、限制、证据与产品规则的区别、复审日期。
3. **先定义拒答与转介。** 在写默认规则前，明确哪些输入必须停止、确认、人工审核或外部专业指令。
4. **只做一个最小规则。** 不同时改变算法、数据、界面和教练话术；为每个规则赋版本/hash。
5. **预注册验证与反证条件。** 包含留出集、人工裁决、失败标签、用户覆盖和不良事件/转介日志。
6. **通过后才扩大范围。** 扩展动作、人群、器械或疾病相关场景时，视为新身份/新规则包，不能“因相似”自动继承。

这个流程与本地已有的 `evidence-tiers`、`claimable-outputs`、`canonical-packet` 和 `unknown_preservation` 设计保持一致，重点是让知识增长不会超过验证和服务边界。
