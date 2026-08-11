# AI 教练能力评审：领域知识补充与 Agent Harness 优化方案

> 版本：v0.1 · 日期：2026-08-10 · 状态：proposal
> 依据：两轮代码盘点（知识运行时面 + harness 机制）、deep-research 教练知识体系调研（`docs/research/2026-08-09-fitness-coach-knowledge-domains.md`）、workspace wiki 四份领域知识页、Codex 交叉验证
> 适用范围：自适应 Coach MVP（`.scratch/adaptive-fitness-coach-mvp/`）及后续迭代

## 0. 总判断

现有架构方向正确：**LLM 是语言层，确定性引擎是决策大脑**，授权/审计/幂等/撤销/冲突处理这一圈"安全外壳"已达生产级。但当前产品形态是"带对话界面的计划引擎"，距离"教练"还差两类能力：

- **领域知识**：六大教练知识域中，评估筛查与行为改变两个域整体缺席；已有知识域存在"引擎数值与文献断开""LLM 无知识检索通道"两个结构性断点。
- **Harness**：生命周期收尾（孤儿 run）、上下文工程（无 token 预算）、主动行为通道（无 proactive）三处结构性缺口，另有若干工程收尾项。

本文给出逐项缺口、证据位置、补充方案与优先级。所有方案遵守既有不变量：LLM 不产生事实、确定性规则才可执行、安全边界不可被覆盖（`CONTEXT.md`、`docs/adr/0001`）。

---

## Part A · 领域知识补充

### A1. 六大知识域覆盖对照

| 知识域 | 运行时现状 | 评级 |
|---|---|---|
| ① 运动科学基础 | 33 动作族目录、肌群关联（含免责声明）、刺激契约、替代权重（`src/knowledge/installedPack.ts:86-360`） | ✅ |
| ② 训练编程 | 3 目标规则包全接线：RIR 校准 4–5、双进阶、周量 ±1 组、deload 触发（`src/training-rules/trainingRulePacks.ts`） | ✅ |
| ③ 营养策略 | 蛋白区间、脂肪下限、Mifflin-St Jeor、±200 kcal 调整、安全拒绝清单（`src/nutrition/NutritionStrategyEngine.ts:23-33,584-593`） | ✅ |
| ④ 恢复信号 | 多信号决策树、HRV 分设备基线、主观优先（`src/recovery/RecoveryRulePack.ts:100-191`） | ✅ |
| ⑤ 评估与筛查 | 仅自填禁忌清单 → stop_and_seek（`src/onboarding/model.ts:90-98`） | ❌ |
| ⑥ 行为改变/软技能 | 代码中不存在（仅 `training_motivation_decline` 信号枚举） | ❌ |

### A2. 缺口与补充方案

#### A2.1 行为改变对话准则（缺口 ⑥）— P1

**问题**：TTM 阶段模型、动机访谈（MI）四过程、习惯养成回路在代码库中完全不存在。这不是功能缺失，是教练的核心手艺缺失——直接决定 onboarding 与 coach drawer 的对话质量。

**方案**：
1. 新增领域知识页（workspace wiki `knowledge/behavior-change-coaching.md`），入库 TTM 五阶段、MI 四过程（engaging→focusing→evoking→planning）、ask-offer-ask、重要性尺子、习惯回路（cue-routine-reward）。来源已抓取待验证清单见 `docs/research/2026-08-09-fitness-coach-knowledge-domains.md` 第 ⑤ 节，入库前先完成 13 条待验证断言的核验。
2. 在 coach system prompt 增加"对话行为准则"层（`src/coach/adapters/provider.ts:873` 是唯一注入点）：按用户所处改变阶段选择互动方式；evoke 而非 prescribe；不评判。
3. onboarding 增加可选的改变阶段评估（3–5 个固定措辞问题），结果作为 working memory（non-authoritative，永不提升为事实），供对话策略使用。

**验收**： ScriptedLLMProvider 场景测试覆盖"前意向阶段用户收到 evoking 式回应而非直接下指令式回应"；准则文本版本化并随 contextManifest 钉在 run 上。

#### A2.2 结构化筛查与基线评估（缺口 ⑤）— P1/P2

**问题**：当前安全筛查是自由文本式自填清单，不是 PAR-Q 式结构化问卷；无体能基线电池、无动作筛查。

**方案**：
1. **结构化健康筛查（P1）**：将 onboarding safety section 升级为 PAR-Q+/ACSM 筛查算法逻辑——三变量（当前活动水平、已知疾病/症状、期望强度）→ 低/中/高风险 → 是否需医学许可。纯确定性决策树，接入现有 `OnboardingService.buildSafetyConstraint`（`src/onboarding/OnboardingService.ts:565-591`）。证据锚点：recovery 知识页已含 Riebe 2015 症状清单（PMID 26473759）。
2. **体能基线电池（P2）**：professional 档增加自报之外的基线选项（俯卧撑/平板/计时走跑），结果入 Timeline 作为保守校准的补充证据。
3. **动作筛查（P2，差异化机会）**：FMS 式观察协议（7 测试、4 级评分，已验证的官方一手文献）与 canonical packet 架构天然兼容。前置条件：对应动作的识别 profile 达到 validated，且输出只能是描述性证据（"过顶深蹲时膝内扣投影超出参考走廊"），绝不输出"FMS 分数"或伤病预测——与 `claimable-outputs` 纪律一致。

**验收**：筛查结果决定 safety constraint 的测试用例；任何筛查输出不含诊断性措辞。

#### A2.3 知识检索工具（结构性断点）— P1

**问题**：LLM 的 13 个工具全是状态查询/提案（`src/coach/toolRegistry.ts:46-112`）。用户问"这个动作练哪里/为什么这样安排"时，agent 只能依赖模型先验，而非查询自己审核过的知识库。

**方案**：新增只读工具（`accessClass:"read"`、`offlineAvailable:true`）：
- `knowledge.lookup_exercise`——按动作族/变式查目录条目（肌群关联、器械、计划模式、免责声明全文）。
- `knowledge.explain_rule`——按 ruleId 返回规则的当前版本、数值、证据锚点与"不能推出什么"。

**边界**：工具只返回知识包内已审核内容；查不到时返回 `unknown`，禁止 LLM 用模型知识补答（system prompt 已有同类禁令，扩展到知识域）。

**验收**：eval 用例——动作相关问题必须调用工具且回答与目录一致；查不到时必须明示不知道。

#### A2.4 证据引用回填（结构性断点）— P2

**问题**：知识治理骨架完整（版本钉、哈希签名），但证据库内容稀薄（`src/knowledge/planningEvidence.ts` 仅 1 条 citation）；NutritionStrategyEngine / RecoveryRulePack 的数值全部标"产品默认值"，无 evidenceRefs 挂到文献。

**方案**：把 wiki 三张知识页（training-programming / nutrition-strategy / recovery-health-signals）中已验证的文献（ACSM 2026、ISSN 2017、Morton 2018、Saw 2016、Riebe 2015 等，PMID 已核对）回填为各规则包的 `evidenceRefs`。规则数值保持产品规则语义（D 级），但审计链可达文献。

**验收**：每个对外可见的规则数值至少一条 evidenceRef 或显式 `product_rule_no_external_claim` 标记；Action Log 的 evidenceRefs 字段贯穿到卡片 UI。

#### A2.5 特殊人群边界决策 — P2（产品决策，非纯工程）

**问题**：老年/孕期/慢病当前全部走"拒绝自动化 + 转介"。教练知识边界（NSCA 2019 老年人立场声明等）提示健康老年人群可在证据支持下覆盖。

**方案**：先作显式产品决策记录（ADR）：v1 维持拒绝边界，或在安全筛查分流后开放"健康老年人保守包"。若开放，NSCA 2019 需换一手来源（Fragala et al., J Strength Cond Res 2019）入库后再实现。

---

## Part B · Agent Harness 优化

### B1. 生命周期收尾 — P0

| 缺口 | 证据 | 方案 |
|---|---|---|
| streaming 崩溃产生孤儿 run，永远卡住 | `agentRuntime.ts:207`（continueRun 只认 resuming）；`ledger.ts:577-597` 无清扫 | 启动期清扫：ledger 加载时把非终态 run 终态化为 `terminated`（terminalCode `process_lost`），UI 显示"上次对话已中断"；不尝试恢复部分流 |
| pending action / token / memory expiresAt 全部惰性过期 | `hitl.ts:239-261`、`actions.ts:503`、`memory.ts:129-270` | 在现有 catchUp 周期（`LocalRecipeCatchUpCycle`）加统一清扫器：过期 pending → expired、过期 token 销毁、到期 memory 走 forget 流程；全部落 action log |

**验收**：崩溃注入测试（streaming 中途杀进程 → 重启后 run 为终态且会话可用）；清扫器幂等测试。

### B2. 上下文工程 — P0/P1

| 缺口 | 证据 | 方案 |
|---|---|---|
| 对话历史全量注入，无窗口无预算 | `adapters/provider.ts:268-279` | P0：滑动窗口（最近 N 条原文）+ 更早消息按 run 摘要（复用 timeline 的 `fact_ref_hierarchical` 压缩模式）；P1：token 估算与预算（按 provider 上下文上限留安全余量），预算分配顺序：系统准则 > 安全约束 > 当前计划 > 近期时间线 > 记忆 > 对话历史 |
| 全量 JSON 快照写盘 | `SQLiteCoachLedger.ts:234-240` | P2：增量表 + 快照检查点（先观测体积增长再决定） |

**验收**：构造 500 条消息的会话，上下文大小有界且 manifest 记录压缩方式；预算超限前有确定性降级（先砍对话历史，不砍安全约束）。

### B3. Agent 主动行为通道 — P1（"教练感"的关键）

**问题**：proactive 只到确定性模板通知；agent 不能主动发起 Run 或消息。

**方案**：在 recipe 引擎旁加 **proactive coach 通道**：
1. 事件源（连续表现下降、计划完成率异常、mesocycle 到期、恢复持续恶化——均已有确定性判定）触发"开场白提案"。
2. 开场白经 PolicyGate + mandate 门控（manual 模式只出通知卡片；collaborative/managed 可发起对话）；频率上限与免打扰窗口为产品规则。
3. 用户点击进入正常 CoachRun（复用 `ensureWorkoutCoachSession` 模式），事件上下文钉入 run 的 factFrontier。

**边界**：主动内容只能是"基于已确认事实的提问/提醒"，永远不能是未请求的计划变更；全部落 action log。

**验收**：mandate 三模式下的主动行为差异测试；频率上限测试；无事件时零打扰测试。

### B4. Agent 行为 eval 套件 — P1（放开新工具的前置）

**问题**：现有 ~4000 行场景测试覆盖 runtime 语义（重启续跑、stale、token），但无"LLM 是否选对工具/是否幻觉"的回归套件。

**方案**：
1. 用现有 `ScriptedLLMProvider` 建 eval 集：工具选择正确性（问动作→必须调 knowledge.lookup_exercise）、幻觉防线（问未知动作→必须答不知道）、边界措辞（不输出医疗/诊断/燃脂区间等禁止声称——清单已在 wiki 三张知识页）。
2. 接入 CI；新工具上线必须先有对应 eval 用例。

**验收**：eval 集 ≥30 用例，覆盖每个工具的选/不选两类场景；禁止声称清单逐条有用例。

### B5. 工具执行韧性 — P2

| 缺口 | 证据 | 方案 |
|---|---|---|
| 工具无独立超时/取消 | `toolRegistry.ts:179` 裸同步调用 | 工具包装超时（默认 5s，可声明覆盖），超时落 typed error 不卡 run |
| provider 流无全量 replay | 仅 receipt 级回放 | 暂不补；先把 ToolAudit 的 provider_request/response 对导出为可回放脚本（低成本达到调试目的） |

### B6. 刻意不做的（记录决策，避免反复讨论）

- **记忆提升为事实**：全库无 promote 路径是刻意的——working memory 永远 non-authoritative，事实只能经用户确认的 typed action 产生。保持。
- **远程失败自动降级本地 LLM**：显式不降级是设计决策（测试 `coachSessionRuntime.test.ts:224`）。保持。
- **冲突自动合并**：同步冲突由用户新 revision 解决，不自动 merge。保持。

---

## 路线图汇总

| 优先级 | 项目 | 类型 |
|---|---|---|
| P0 | B1 孤儿 run 清扫 + 过期清扫器 | harness 收尾 |
| P0 | B2 对话窗口与 token 预算 | harness 收尾 |
| P1 | A2.3 知识检索工具 + B4 eval 套件（绑定交付） | 知识 + harness |
| P1 | A2.1 行为改变对话准则 | 知识 |
| P1 | A2.2.1 结构化健康筛查 | 知识 |
| P1 | B3 proactive coach 通道 | harness |
| P2 | A2.2.2/3 基线电池与动作筛查 | 知识 |
| P2 | A2.4 证据引用回填 | 知识治理 |
| P2 | A2.5 特殊人群边界 ADR | 产品决策 |
| P2 | B5 工具超时、ledger 增量存储 | harness 收尾 |

**两个绑定关系**：A2.3（知识工具）必须先有 B4（eval）覆盖才上线；A2.2.3（动作筛查）受识别 profile validated 数量门控，与 `.scratch` 识别路线对齐。

## 参考

- 教练知识体系调研：`docs/research/2026-08-09-fitness-coach-knowledge-domains.md`
- MVP 知识缺口分析：workspace `wiki/adaptive-coach-mvp-knowledge-gap-2026-08-08.md`
- 领域知识页：workspace `wiki/knowledge/{training-programming,nutrition-strategy,recovery-health-signals}.md`
- 架构决策：`docs/adr/0001-local-coach-owns-decisions-and-facts.md`、`0002-cloud-owns-confirmed-product-resources.md`
- 术语与不变量：`CONTEXT.md`
