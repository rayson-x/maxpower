# 增肌周期规则与 Agent Harness 深模块设计

日期：2026-08-08  
范围：RP Hypertrophy 公开能力；MaxPower 的确定性增肌规则、tool-first interface、离线优先与可选云同步设计  
方法：优先使用 RP Strength 官方帮助中心；产品未公开的公式不从营销描述反推。本文是研究与设计，不代表已经实现。

## 结论先行

RP Hypertrophy 最值得借鉴的不是“AI 文案”，而是一个持续反馈的专家规则闭环：计划给出目标 RIR、重量、次数和组数；用户记录实际表现与肌群级泵感、酸痛、工作量感受；系统据此调整所有后续训练，并在周期末安排减量周。RP 官方只公开了方向性行为，没有公开精确公式、阈值、信号权重、冲突处理或产品效果验证。因此 MaxPower 应构建自己的、版本化且可测试的规则包，不应宣称复刻 RP 算法。

推荐将这套能力做成一个深模块 `HypertrophyHarness`。外部只有两个入口：

```ts
interface HypertrophyHarness {
  read(query: CoachQuery): Promise<CoachView>;
  act(command: CoachCommand): Promise<CoachOutcome>;
}
```

`read` 返回带来源、缺失项和版本的事实投影；`act` 接受封闭的 tagged union，负责记录反馈、生成调整、执行授权决策和撤销。LLM 可以调用这两个 tool，但永远不能提交任意 plan patch。规则计算、权限判断、PlanRevision、幂等、审计、离线事务和同步冲突都隐藏在模块实现中。

本地 SQLite 事件账本是每台设备可独立工作的完整事实源；云端是可选的同步、备份与跨设备协作 adapter，不是运行 Coach 的前提。关闭网络、未登录或云服务故障时，规则引擎、训练记录、计划调整和撤销都必须继续工作。

## 一、RP Hypertrophy 公开能力与证据边界

### 1.1 已由官方资料明确的行为

| 能力 | 官方公开行为 | 可安全借鉴的产品语义 |
|---|---|---|
| 训练目标 | 产品主要目标是增肌；力量提升只是次要结果 | 将 `hypertrophy` 设为独立策略，不把它泛化成力量、减脂或康复规则。[RP：适用人群](https://help.rpstrength.com/hc/en-us/articles/33510008280087-Who-is-the-RP-Hypertrophy-App-for) |
| RIR | RIR 是停止一组时估计还能完成的次数；同一 RIR 下，后续组会因疲劳而出现次数下降 | 保存每组实际 RIR，不要求同一动作每组次数相同；RIR 是主观证据，不是传感器事实。[RP：RIR 定义](https://help.rpstrength.com/hc/en-us/articles/31147466880791-What-does-RIR-mean) |
| 重量与次数进阶 | 重量通常每周增加几个百分点；如果下一器材档位跳幅过大，例如 10 lb 到 15 lb 哑铃，则改为每组增加一次 | 先做设备离散档位检查；不能安全微增时用次数进阶，而不是硬跳重量。[RP：重量、次数和组数](https://help.rpstrength.com/hc/en-us/articles/32600173777815-How-does-the-app-determine-when-to-add-weight-reps-and-sets) |
| 未命中目标 RIR | 官方称系统会调整后续 load 和 rep range | 记录偏差并重算后续处方；不要惩罚性追加强度。[RP：未命中目标 RIR](https://help.rpstrength.com/hc/en-us/articles/32435225484183-What-if-I-miss-my-target-RIR-in-week-1) |
| 组数进阶 | 系统使用泵感、酸痛和对训练量的主观感受调整未来组数；低泵感、几乎不酸且感觉轻松时通常加组；泵感好、按时恢复且接近上限时通常保持；泵感极高、未按时恢复且工作量难以承受时通常减组 | 把三个信号建模为肌群 × 暴露的结构化反馈，输出 `increase / hold / reduce`，并暴露 reason codes。[RP：重量、次数和组数](https://help.rpstrength.com/hc/en-us/articles/32600173777815-How-does-the-app-determine-when-to-add-weight-reps-and-sets) |
| 持续适配 | 官方称每个未来 session 都受到过去反馈影响；用户可以手动增加或删除组数 | 后续处方引用证据窗口与规则版本，同时保留锁定、覆盖和撤销。[RP：重量、次数和组数](https://help.rpstrength.com/hc/en-us/articles/32600173777815-How-does-the-app-determine-when-to-add-weight-reps-and-sets) |
| 时间约束 | 每个肌群训练后询问训练量承受度；用户若表示已达到包括时间在内的上限，系统不会继续加组 | `workload` 不能只解释为生理疲劳，必须能表示时间预算。[RP：训练过长](https://help.rpstrength.com/hc/en-us/articles/32600133107863-Why-is-the-app-giving-me-so-many-sets-Long-Workouts) |
| 肌群优先级 | `Emphasize` 在恢复良好时从 MEV 向 MRV 增量；`Grow` 只在需要时增量并更接近 MEV；`Maintain` 保持 MV | 优先级影响增量倾向和容量预算，不应简单修改所有动作的权重。[RP：肌群优先级](https://help.rpstrength.com/hc/en-us/articles/34825395726743-Muscle-Emphasis-Breakdown) |
| 周期长度 | 官方一般建议总周期 4–8 周；入门者可更长，中级者约 4–8 周积累，高级者约 3–6 周积累，并强调日程约束 | 周期长度必须是可编辑的策略输入；不能由 Agent 无视旅行和日程自动决定。[RP：周期长度](https://help.rpstrength.com/hc/en-us/articles/30976017295383-How-many-weeks-should-my-mesocycle-be) |
| 自动减量 | 周期最后一周自动成为 deload；修改周期长度时 deload 随之移动 | deload 是 `Mesocycle` 的结构状态，不是临时聊天建议。[RP：自动安排 deload](https://help.rpstrength.com/hc/en-us/articles/33510413024279-Does-the-app-automatically-place-deloads) |
| 减量行为 | 官方描述 deload 同时降低训练量和强度，目标 RIR 更保守；小肌群如斜方肌、前臂可能被移除；用户可延长积累期，但官方不建议多数人无限超过六周积累 | deload 生成独立 PlanRevision；具体减幅属于 MaxPower 自有规则配置，不能从公开页面猜测。[RP：deload 细节](https://help.rpstrength.com/hc/en-us/articles/31639551676439-Why-did-my-training-get-so-much-easier-deload) |
| 表现下降 | 出现 underperformance 标记时，官方建议接受更轻的训练以恢复，但允许用户忽略 | 连续表现下降进入恢复降级，不因单次异常自动重写整个周期。[RP：underperformance](https://help.rpstrength.com/hc/en-us/articles/32435171890967-If-I-get-a-flag-for-underperformance-what-do-I-do) |
| 用户控制 | 用户始终可以手动改重量、加减组数 | “托管模式”也必须有锁定字段、通知和撤销，不能把自主权等同于每次审批。[RP：手工覆盖](https://help.rpstrength.com/hc/en-us/articles/32434237175447-Shouldn-t-I-be-doing-more-sets-or-weight) |
| 器材筛选 | 官方称可依据用户可用器材筛选动作 | 器材库存和可用档位应进入动作与负荷约束。[RP：家庭健身房](https://help.rpstrength.com/hc/en-us/articles/31122691829143-Can-I-use-the-app-with-a-home-gym) |
| 负重语义 | 杠铃记录总重量，哑铃记录单只重量；自重、额外负重和助力器械的语义不同 | `Load` 必须带计量方式，不能只存一个裸数字。[RP：load 输入规则](https://help.rpstrength.com/hc/en-us/articles/30801977895063-What-to-put-in-the-load-box) |

### 1.2 不能从公开资料验证的部分

以下内容在查阅到的 RP 官方资料中没有可复现说明，必须标记为未知：

- 每周“几个百分点”的确切数值、不同动作/器材是否使用不同百分比。
- pump、soreness、workload 的完整量表、数值权重、决策表和冲突优先级。
- 一次加减多少组、肌群周量上下限如何个体化、何时从加组转为提前 deload。
- underperformance 的检测窗口、阈值、异常值处理和回归方式。
- 目标 RIR 在积累周期内的完整 progression 曲线；官方只明确提到最后一个 hard week 可达到 0 RIR，deload 会变容易。
- 训练历史在多长窗口内衰减，手工修改如何影响后续学习。
- 算法是否以及如何读取睡眠、HRV、日历、骨架、营养或医疗信息。
- 对该产品规则本身的独立效果试验、算法校准结果、受伤率或相对真人教练的效果。

因此，MaxPower 可以说“采用基于 RIR、训练表现和恢复反馈的确定性增肌规则”，不应说“复刻 RP 算法”或“经 RP 证明有效”。

## 二、MaxPower 自有确定性规则包

本节是建议设计，不是对 RP 内部算法的推断。

### 2.1 输入事实

```ts
type HypertrophyEvidence = {
  athleteId: string;
  planRevisionId: string;
  sessionPrescriptionId: string;
  occurredAt: string;
  exerciseContextId: string; // 动作 × 变式 × 器材 × 机位
  muscleExposure: Array<{ muscleId: string; contribution: "primary" | "secondary" }>;
  completedSets: Array<{
    setId: string;
    prescribed: { load: Load; repRange: Range; targetRir: Range };
    actual: { load?: Load; reps?: number; rir?: number; status: SetStatus };
    pain?: PainSignal;
    canonicalRepRefs?: string[];
  }>;
  muscleFeedback?: Array<{
    muscleId: string;
    pump: "none" | "low" | "target" | "excessive";
    sorenessRecovery: "none" | "early" | "on_time" | "late" | "not_recovered";
    workload: "easy" | "sustainable" | "limit" | "too_much";
  }>;
  constraints?: { availableMinutes?: number; equipmentSnapshotId?: string };
  provenance: EvidenceProvenance;
};
```

`Load` 至少包含 `value`、`unit`、`measurement`（barbell total、single dumbbell、machine stack、added bodyweight、assistance）、器材 ID 和最小增量。缺失的 RIR、重量或反馈必须保持 unknown，不能由 LLM 补齐。

Canonical packet 是动作 rep 边界与轨迹证据的唯一事实源。只有 `Confirmed rep` 可进入正式训练量；`Needs-review rep` 在批准前排除；Tier 2 simulated session 不能产生次数或动作质量结论。骨架可以支持完成次数、节奏和同上下文投影趋势，不能推断实际负重、肌肉激活、疼痛或真实三维关节状态。

### 2.2 分开处理负荷/次数与训练量

不要把所有反馈压成一个“恢复分”。建议规则实现内部保留两个独立状态机：

#### A. `PerformanceProgression`

1. `INSUFFICIENT_EVIDENCE`：负重、reps、RIR 或动作身份缺失；保持原处方并请求最少必要输入。
2. `ON_TARGET`：实际表现落在 rep 与 RIR 容差内；按当前 mesocycle 的微进阶策略生成下一处方。
3. `TOO_EASY`：RIR 持续高于目标且完成全部计划；若下一器材增量在授权上限内则加一个设备档位，否则每组增加一次。
4. `TOO_HARD`：RIR 低于目标、未完成处方或出现明显 set-to-set 崩落；保持或降低一个档位/收窄次数目标。
5. `UNDERPERFORMANCE`：至少两个可比 session 的表现下降，且不能由器材/动作变化解释；进入恢复降级候选。
6. `PAIN_HOLD`：任何疼痛或红旗信号覆盖进阶；停止自动增量，按权限请求替换、降级或专业评估。

单次主观 RIR 偏差只影响下一次局部处方；只有重复证据才允许更改周期级策略。任何增量都受 `CoachingMandate.maxLoadIncreasePercent`、器材最小档位和用户锁定字段约束。

#### B. `VolumeProgression`

按肌群而不是按动作计算，并保留三个原始维度：

| Pump | Soreness recovery | Workload | 建议动作 |
|---|---|---|---|
| low/none | none/early | easy | 若优先级允许且证据完整，下一次该肌群增加 1 个有效组 |
| target | on_time | sustainable/limit | 保持 |
| excessive | late/not_recovered | limit/too_much | 减少 1 个有效组或提前恢复降级 |
| 任意冲突组合 | 任意冲突组合 | 任意冲突组合 | 默认保持；连续两次同方向后再调整 |
| 任意 | 任意 | 时间上限 | 禁止加组；优先替换低 SFR 动作或重排 |
| 任意 | 任意 | 任意，同时有 pain | `PAIN_HOLD`，不自动增加训练量 |

上表是 MaxPower 的保守起点，不是 RP 的公开决策表。它应放入签名、版本化的 `HypertrophyRulePack`，每次最多改变一个肌群的一个有效组；周训练量变化另受 mandate 百分比上限约束。`Emphasize / Grow / Maintain` 只修改允许的进阶速率与容量预算：Maintain 不自动增量，Grow 有充分证据才增量，Emphasize 在恢复良好时优先分配有限的全身恢复预算。

### 2.3 Mesocycle 状态机

```text
PLANNED
  -> ACCUMULATION
       -> ACCUMULATION_NEXT_WEEK
       -> EARLY_DELOAD_PROPOSED
       -> PAUSED
  -> DELOAD
  -> COMPLETED
```

- 创建周期时固定 `accumulationWeeks`、deload 位置、RIR progression、肌群优先级和 rule-pack digest。
- 默认 deload 是结构化最后一周；改变周期长度必须新建 PlanRevision，不能原地改历史。
- `EARLY_DELOAD_PROPOSED` 只在重复 underperformance、多个肌群未按时恢复或用户明确请求时产生；单次睡眠差只调整当天训练。
- deload 的负荷、组数、RIR 和动作删减由 MaxPower 自有 rule pack 明确给出，并携带 reason codes；不能把 RP 未公开的比例写成“行业事实”。
- 完成或中止周期后生成不可变总结，供下一周期初始化，但不得重算旧计划。

## 三、Agent Harness：两个入口的深模块

### 3.1 外部 seam

```ts
interface HypertrophyHarness {
  read(query: CoachQuery, context: ToolContext): Promise<CoachView>;
  act(command: CoachCommand, context: ToolContext): Promise<CoachOutcome>;
}
```

调用者只需知道：

- `read` 无副作用，支持 as-of revision，并始终返回 missingness、provenance 和 schema/rule versions。
- `act` 原子执行一个命令，必须带 `idempotencyKey`；任何改计划操作都检查 `expectedPlanRevisionId`。
- `act` 不是任意 patch 入口。Agent 只能请求一个领域意图，具体 diff 由规则实现生成。
- 成功提交只会创建新的不可变 `PlanRevision`；rollback 是补偿性新 revision，不删除历史。
- 所有结果本地可得；云断线不能改变相同输入下的规则输出。

### 3.2 Tool schema

Agent 可见的 tool 直接映射到接口，不把内部 repository、同步协议或规则函数暴露出去。

#### `fitness.read`

```json
{
  "name": "fitness.read",
  "description": "读取可审计的训练事实和计划投影；不会修改任何数据。",
  "inputSchema": {
    "type": "object",
    "required": ["view"],
    "properties": {
      "view": {
        "enum": [
          "today",
          "active_mesocycle",
          "exercise_history",
          "muscle_recovery_evidence",
          "plan_revision",
          "pending_changes",
          "capabilities"
        ]
      },
      "subjectId": { "type": "string" },
      "asOfRevisionId": { "type": "string" },
      "window": { "type": "string", "enum": ["last_session", "7d", "28d", "mesocycle"] }
    },
    "additionalProperties": false
  }
}
```

核心输出：

```ts
type CoachView = {
  data: unknown;
  asOfPlanRevisionId: string;
  evidenceRefs: EvidenceRef[];
  missing: MissingField[];
  capabilityGrants: CapabilityGrant[];
  versions: { schema: string; compiler: string; rulePack: string; catalog: string };
};
```

#### `fitness.act`

```json
{
  "name": "fitness.act",
  "description": "记录证据或请求、执行、拒绝、撤销一个受规则与权限控制的训练计划动作。",
  "inputSchema": {
    "oneOf": [
      {
        "type": "object",
        "required": ["kind", "idempotencyKey", "sessionId", "feedback"],
        "properties": {
          "kind": { "const": "record_feedback" },
          "idempotencyKey": { "type": "string" },
          "sessionId": { "type": "string" },
          "feedback": {
            "type": "object",
            "properties": {
              "setRir": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": ["setId", "rir"],
                  "properties": {
                    "setId": { "type": "string" },
                    "rir": { "type": "number", "minimum": 0, "maximum": 10 }
                  },
                  "additionalProperties": false
                }
              },
              "muscles": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": ["muscleId", "pump", "sorenessRecovery", "workload"],
                  "properties": {
                    "muscleId": { "type": "string" },
                    "pump": { "enum": ["none", "low", "target", "excessive"] },
                    "sorenessRecovery": { "enum": ["none", "early", "on_time", "late", "not_recovered"] },
                    "workload": { "enum": ["easy", "sustainable", "limit", "too_much"] }
                  },
                  "additionalProperties": false
                }
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": ["kind", "idempotencyKey", "expectedPlanRevisionId", "scope"],
        "properties": {
          "kind": { "const": "adapt_plan" },
          "idempotencyKey": { "type": "string" },
          "expectedPlanRevisionId": { "type": "string" },
          "scope": { "enum": ["next_set", "next_session", "week", "mesocycle"] },
          "reason": { "enum": ["session_completed", "missed_rir", "underperformance", "recovery", "schedule", "user_request"] }
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": ["kind", "idempotencyKey", "proposalId", "decision"],
        "properties": {
          "kind": { "const": "decide_change" },
          "idempotencyKey": { "type": "string" },
          "proposalId": { "type": "string" },
          "decision": { "enum": ["approve", "reject", "undo"] }
        },
        "additionalProperties": false
      }
    ]
  }
}
```

`record_feedback` 只接受枚举与有界数值，不接受一段自然语言直接成为事实。自然语言先由 LLM 转成候选结构，再由 UI 请用户纠正歧义；原文可作为 provenance 附件，但规则只读取结构化字段。

`adapt_plan` 不允许 Agent 传 `sets: 8` 或 `load: 120kg` 这类最终处方。规则实现读取 evidence、mandate、locks、equipment、history 和 rule pack 后生成：

```ts
type CoachProposal = {
  proposalId: string;
  basePlanRevisionId: string;
  patch: TypedPlanDiff;
  evidenceRefs: EvidenceRef[];
  reasonCodes: ReasonCode[];
  assumptions: string[];
  missing: MissingField[];
  risk: "low" | "moderate" | "high" | "safety_hold";
  executionPolicy: "auto_commit_notify" | "auto_commit_undo" | "confirm" | "hold";
  versions: VersionPins;
  expiresAt: string;
};
```

### 3.3 权限模式

`CoachingMandate` 是版本化事实：

- `managed`：低风险且未超限的负荷、次数、单组训练量或当天重排可自动提交，之后通知并可撤销。
- `collaborative`：低风险可自动；周量、周期、deload、跨日程修改需确认。
- `manual`：只生成 proposal，不自动提交。

权限按领域拆分：`loadProgression`、`volumeProgression`、`exerciseSubstitution`、`schedule`、`deload`、`nutrition`。限制至少包括最大单次负荷增幅、最大周量变化、锁定动作/训练日/肌群、疼痛时的允许动作，以及 mandate 过期时间。

普通用户不需要审查每个专业数字；他授权目标、边界和自动化程度。规则在边界内自动写 PlanRevision，越界才确认。任何安全 hold、目标变更、用户锁定字段、激进周量变化或伤病相关决定都不能因为 `managed` 而静默执行。

### 3.4 隐藏在实现中的复杂度

`HypertrophyHarness` 内部包含但不外露：

- Evidence normalizer 与 eligibility gate。
- Exercise identity、负重计量和器材档位解析。
- Performance 与 Volume 两个状态机。
- Mesocycle compiler 与 deload planner。
- Capability Registry：区分正式次数、建议性次数、轨迹描述和进阶资格。
- Permission evaluator 与 risk classifier。
- Proposal builder、PlanRevision committer 和 rollback builder。
- 本地事件账本、投影、outbox、同步合并和冲突处理。
- LLM intent adapter 与 explanation renderer；两者都没有 plan write port。

删除这个模块会让同一套规则、权限、审计、幂等和同步复杂度散落到 Android、iOS、云端、聊天和训练页面，因此它通过 deletion test；两入口为多种调用者提供高 leverage，并把规则变更集中在一个 seam。

## 四、完全离线与可选云同步

### 4.1 本地版本必须拥有的完整数据

本地账户无需登录，至少保存：

- `AthleteProfile`、`GoalContract`、`CoachingMandate` 及其版本。
- 动作目录、精确 exercise context、器材库存与负重档位。
- `PlanRevision`、`SessionPrescription`、计划锁和 proposal。
- 实际 set、重量、reps、RIR、肌群反馈、疼痛/异常信号。
- canonical packet refs、Confirmed/Needs-review/Rejected 状态和 observation findings。
- `HypertrophyRulePack`、schema、compiler、catalog、识别 profile 的版本与摘要。
- append-only audit events、idempotency records、outbox 和本地投影。

建议以 SQLite 事务保存结构化事实和 revisions；视频、canonical packet 大对象及导出文件保留在本地 blob store，通过 content hash 引用。敏感数据库密钥由 iOS Keychain/Android Keystore 保护。默认不上传视频；canonical packet、健康数据和主观反馈分别授权同步。

离线应用内嵌最后一个已验证且签名的 rule pack。规则升级只影响新 proposal；历史 PlanRevision 继续引用旧 digest，保证重放得到相同解释。

### 4.2 云端是 adapter，不是事实裁判

在同步 seam 定义自有远程 port，并至少提供两个 adapter：本地 in-memory/SQLite 测试 adapter 与生产 encrypted-sync adapter。云端提供备份、跨设备、较重计算和可选云 LLM；本地规则引擎始终可提交本地 revision。

建议事件包含：

```ts
type LedgerEvent = {
  eventId: string;          // UUIDv7
  deviceId: string;
  athleteId: string;
  aggregateId: string;
  parentRevisionIds: string[];
  lamport: number;
  occurredAt: string;
  schemaVersion: string;
  payloadHash: string;
  payload: unknown;
};
```

合并策略按事实类型区分：

- 完成训练、set、反馈属于追加事件，可去重后合并。
- 同一 proposal 的重复调用依靠 `idempotencyKey` 合并。
- PlanRevision 使用 optimistic concurrency；相同 base 上的并发修改形成分支。
- 不重叠的 typed diff 可由确定性 rebase 生成新 proposal；涉及同一训练日、动作、组数、权限或目标的冲突必须让本地规则重新计算或用户选择，禁止字段级 LWW。
- `CoachingMandate`、GoalContract、安全状态和用户锁不能自动 last-write-wins。
- 云端生成的 proposal 回到本地后，仍要由本地兼容 rule pack 和 mandate 验证；云端不能绕过本地权限直接覆盖计划。

多端“最终一致”不等于所有中间计划瞬时相同。训练开始时冻结 `SessionPrescription`；同步到来的新计划不得改变正在执行的 session，只对下一安全切点生效。

## 五、状态与审计

### 5.1 Proposal / PlanRevision

```text
DRAFT
  -> POLICY_EVALUATED
       -> AUTO_COMMITTED
       -> AWAITING_CONFIRMATION -> COMMITTED | REJECTED | EXPIRED
       -> SAFETY_HOLD
COMMITTED -> SUPERSEDED
COMMITTED -> ROLLBACK_REQUESTED -> COMPENSATING_REVISION
```

每个 commit 保存：base revision、typed diff、before/after、evidence refs、missingness、reason codes、用户/Agent/规则来源、mandate revision、rule-pack digest、compiler version、设备与时间、风险与执行策略。历史不可修改或删除；“撤销”是把选定字段恢复为此前值的新 revision。

### 5.2 防止规则和 Agent 漂移

- LLM 没有任意 patch 或数据库写端口，只能调用封闭 tool schema。
- `additionalProperties: false`、枚举 ID、单位校验、动作身份校验和输出大小限制。
- 目标、权限、规则、目录、识别配置全部版本化；active mesocycle 默认 pin rule pack。
- 修改预算、hysteresis、cooldown：单次异常不改周量，连续证据才跨 session 调整。
- 每个 proposal 引用原始 evidence，不把 Agent 总结当证据。
- unknown 保持 unknown；数据不足优先 hold，不用语言模型猜测。
- 定期让用户确认目标与硬约束，但不把短期疲劳写成永久偏好。

## 六、关键失败模式

| 失败模式 | 默认处理 |
|---|---|
| RIR、负重或反馈缺失 | 保持处方或仅做不依赖缺失字段的低风险调整；返回 missing fields |
| 泵感低但酸痛未恢复 | 信号冲突，保持或降级；不因低泵感加组 |
| 单次表现下降 | 标记异常，不改变周期；检查睡眠、日程、器材、动作是否可比 |
| 连续表现下降 | 生成恢复降级或 early-deload proposal，不自动诊断原因 |
| 用户选择了错误动作/器材/单位 | 拒绝进阶计算，要求修正 identity/measurement |
| Agent 幻觉 exercise ID、proposal ID | schema/catalog 校验失败，返回可恢复错误，不做模糊匹配提交 |
| 重复 tool call 或移动端重试 | 同一 idempotency key 返回原结果 |
| stale base revision | 返回 `REVISION_CONFLICT` 和最新 revision，不自动覆盖 |
| 两设备离线修改同一训练 | 保存分支；不重叠 diff 可重算，重叠字段需选择 |
| 同步中断 | 本地事务已提交则继续工作，outbox 稍后重试；不回滚用户训练记录 |
| 云端 rule pack 与本地不兼容 | 隔离 proposal，要求升级或本地重算 |
| Tier 2/needs-review 被当正式次数 | capability gate 拒绝进入 formal volume |
| 疼痛或医疗语言 | `SAFETY_HOLD`；不提供诊断和康复处方 |
| 用户长期给出极端反馈 | 显示反馈校准提示，以趋势和上限限制响应，不静默放大训练量 |
| 正在训练时计划同步变化 | 当前 SessionPrescription 冻结，新 revision 下一安全切点生效 |

## 七、测试策略：通过模块 interface 验证

### 7.1 规则 golden tests

用专家审核的表格生成固定案例：

- 达到目标 RIR 且器材有安全小档位 → 增加一个档位。
- 器材跳幅超过 mandate → 保持重量并每组加一次。
- RIR 过低或未完成 reps → 不增重。
- low pump + early recovery + easy workload，连续两次 → 肌群加一组。
- excessive pump + not recovered + too much → 减一组/恢复降级。
- 冲突反馈 → 保持。
- 最后一周 → deload revision；改变周期长度 → deload 随新结构移动。
- Maintain 肌群永不由恢复良好自动加组。

测试断言外部 `CoachOutcome`、PlanRevision diff、reason codes 和 audit，不断言内部函数。

### 7.2 Property-based invariants

- 任何输入都不能越过 mandate 的负荷/周量上限。
- 没有 eligible evidence 时不能自动 progression。
- `Confirmed rep` 之外的计数永不进入 formal volume。
- commit 永不修改已有 PlanRevision。
- rollback 总是新 revision，且可追溯到目标 commit。
- 相同 base、rule pack、evidence 和 command 必须生成相同 proposal digest。
- 同一 idempotency key 多次调用至多产生一次事件。
- 未授权 nutrition、医疗或目标变化永远不能由增肌规则包产生。

### 7.3 状态机与故障注入

- 对 proposal 和 mesocycle 做 model-based state-machine tests。
- 在 SQLite commit、outbox enqueue、上传、下载、rebase 每个阶段注入崩溃；重启后不得重复 commit 或丢失已记录 set。
- 模拟数周无网、两设备并发、时钟漂移、旧 schema、损坏 event、rule pack 升级和权限撤销。
- Android、iOS、桌面/云端对同一 golden ledger 做确定性重放，比较 proposal digest 与 revision hash。

### 7.4 Agent adversarial tests

- Agent 直接要求“把卧推加到 200kg”、伪造 proposal、跳过确认、修改锁定字段、把 missing RIR 写成 0。
- prompt injection 藏在训练备注、动作名或云端同步数据中。
- 自然语言存在多种单位、单只/双只哑铃、助力器械正负方向歧义。

预期结果必须是 schema rejection、clarification、permission denial 或 safety hold，而不是尽力执行。

### 7.5 产品效果验证与规则正确性分离

软件正确性测试只能证明规则按规格运行，不能证明它促进增肌。发布后应另外建立 4/8/12 周效果与安全评估：计划完成率、反馈完整率、动作与负荷进展、周量回退频率、用户手工纠正率、疼痛/不适报告、deload 接受率和留存。任何“有效”宣传都应以 MaxPower 自有数据或独立研究为依据，不能由 RP 的产品描述代替。

## 八、建议实施顺序

1. 先建立 `Load`、CompletedSet、MuscleFeedback、CoachingMandate、PlanRevision 和审计事件；不先做 LLM。
2. 实现本地 SQLite 账本与 `read/act` 两入口，在飞行模式跑完创建周期、记录、适配、deload、撤销。
3. 上线保守 rule pack v1：RIR/器材档位的负荷与次数进阶、肌群反馈的 ±1 set、固定末周 deload。
4. 把 canonical packet 的 eligible evidence 接入，但不让姿态单独触发增重。
5. 接入 Agent tool schema，只允许意图解析和解释；做 adversarial contract tests。
6. 最后增加可选 encrypted-sync adapter、跨端 replay tests 和云端增强能力。

首版不要实现：从 2D 骨架自动判断 RIR、按单次睡眠分数大幅减量、自动伤病康复、不可解释的“恢复百分比”、从 RP 页面猜测未公开阈值，或让云端 LLM直接写本地计划。

## 官方来源索引

- [RP Hypertrophy App 帮助中心](https://help.rpstrength.com/hc/en-us/categories/30801297737495-RP-Hypertrophy-App)
- [如何确定增加重量、次数和组数](https://help.rpstrength.com/hc/en-us/articles/32600173777815-How-does-the-app-determine-when-to-add-weight-reps-and-sets)
- [RIR 定义](https://help.rpstrength.com/hc/en-us/articles/31147466880791-What-does-RIR-mean)
- [未命中目标 RIR](https://help.rpstrength.com/hc/en-us/articles/32435225484183-What-if-I-miss-my-target-RIR-in-week-1)
- [Underperformance](https://help.rpstrength.com/hc/en-us/articles/32435171890967-If-I-get-a-flag-for-underperformance-what-do-I-do)
- [训练过长与组数](https://help.rpstrength.com/hc/en-us/articles/32600133107863-Why-is-the-app-giving-me-so-many-sets-Long-Workouts)
- [肌群优先级](https://help.rpstrength.com/hc/en-us/articles/34825395726743-Muscle-Emphasis-Breakdown)
- [周期长度](https://help.rpstrength.com/hc/en-us/articles/30976017295383-How-many-weeks-should-my-mesocycle-be)
- [自动安排 deload](https://help.rpstrength.com/hc/en-us/articles/33510413024279-Does-the-app-automatically-place-deloads)
- [Deload 行为](https://help.rpstrength.com/hc/en-us/articles/31639551676439-Why-did-my-training-get-so-much-easier-deload)
- [家庭器材筛选](https://help.rpstrength.com/hc/en-us/articles/31122691829143-Can-I-use-the-app-with-a-home-gym)
- [负重输入语义](https://help.rpstrength.com/hc/en-us/articles/30801977895063-What-to-put-in-the-load-box)
