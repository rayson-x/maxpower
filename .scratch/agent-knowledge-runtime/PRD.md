Status: ready-for-agent

# Agent 知识运行时改造：知识包数据化、知识检索、对话准则与 Harness 收尾

> 来源：`docs/design/agent-harness-and-domain-knowledge-gaps-v0.1.md`、`docs/design/domain-knowledge-upgrade-simulation-v0.1.md`，以及 2026-08-10 设计拷问（grilling）的 11 项已确认决策。
> 遵循：ADR 0001（本地 Coach 拥有决策与事实）、ADR 0002（云端拥有已确认产品资源）、`CONTEXT.md` 全部不变量。

## Problem Statement

用户与客户端 agent 对话时，agent 对领域问题的回答不挂在产品审核过的知识上：动作库、规则解释、证据引用只接线给确定性引擎，LLM 只能靠模型先验即兴回答——不可审计、可能与规则包数值矛盾、每次说法不一致，还可能越过安全边界（输出禁止声称、回答领域外问题）。同时 agent 没有统一的对话行为准则，面对动摇、焦虑、长期不练的用户时回应质量全凭模型运气。

Harness 层面，三个已实现机制的收尾缺口开始影响可靠性：streaming 中途崩溃产生永远卡住的孤儿 run；pending action / token / working memory 全部惰性过期、无清扫器；对话历史无窗口无 token 预算，长会话无界增长。

知识运营层面，领域知识包以 TS 代码内嵌编译进二进制，无法作为数据资产更新，更谈不上未来的云端分发；也没有沉淀"这个用户身上校准出的知识"的位置。

## Solution

把领域知识从代码内嵌改造为**版本化数据资产**：内置包兜底 + 签名数据包覆盖，agent 通过两个新的只读知识工具按需查询当前版本，查询结果带证据引用；知识库没有的内容按领域分级处理——运动/健康/饮食领域内允许模型先验回答并固定标注，领域外拒答并转介。

把行为改变科学（TTM 阶段模型、动机访谈）写成版本化的对话准则注入 system prompt，并用确定性输出过滤器拦截禁止声称清单——agent 的回答从"不可审计的即兴"变成"可对账、可复现、可追责"。

Harness 收尾：启动时把崩溃遗留的非终态 run 终态化；在既有 catchUp 周期加统一过期清扫器；ContextAssembler 增加对话窗口与 token 预算，超预算时按确定性顺序降级（先砍对话历史，不砍安全约束）。

立起个人知识层骨架：四类条目（观测校准值/用户偏好/系统推断/未知）+ provenance + 读写接口，本轮不接任何引擎消费者。

全程以 eval 套件为上线门：禁止声称与领域拒答 100% 通过、工具选择零失误，知识工具才允许启用。

## User Stories

### 知识检索与回答

1. As a 训练用户, I want 问"俯卧撑练哪里"时得到动作库审核过的答案（含肌群角色与免责声明）, so that 我得到的不是模型随口编的常识
2. As a 训练用户, I want 问"为什么这么安排"时听到规则包的同一条数值链与依据, so that 计划解释与我实际被安排的逻辑一致
3. As a 用户, I want 答案末尾能点看证据来源（文献/规则版本）, so that 我可以判断该不该信
4. As a 用户, I want 知识库里没有的运动/健康/饮食问题得到标注"未经验证的一般知识"的回答, so that 我既得到帮助又知道边界
5. As a 用户, I want 知识库没有的数值类问题（重量、RIR、热量目标）被明确拒答, so that 我不会把编造数字当作产品建议
6. As a 用户, I want 编程、法律、纯情绪倾诉等领域外问题被礼貌拒答并给出固定转介话术, so that 我清楚这个产品是什么、不是什么
7. As a 用户, I want "训练后总是很焦虑"这类以健康为锚点的交叉话题得到领域内回应（如提示可能与恢复相关）, so that 对话不会在最需要教练感的时候被生硬切断
8. As a 用户, I want 交叉话题的回应不做心理疏导或医疗诊断, so that 我不会把健身 app 当成心理咨询

### 对话行为准则

9. As a 动摇期用户, I want 说"上周一次没练是不是废了"时被引导说出自己的原因并获得选择权, so that 我更可能继续练下去而不是被说教劝退
10. As a 新用户, I want 教练按我所处的改变阶段调整说话方式（前意向期不直接开处方）, so that 我不会在还没准备好时被计划吓退
11. As a 用户, I want agent 永远不输出禁止声称（"燃脂次数区间""HRV 表明你生病了""深睡不足会受伤"等）, so that 我不会被伪科学误导
12. As a 用户, I want 即使模型违规生成了禁止声称，展示前也会被拦截改写, so that 安全边界不依赖模型自觉
13. As a 产品方, I want 对话准则文本版本化并钉入每个 run 的 context manifest, so that 任何一次对话都能追溯当时生效的准则版本

### 知识包数据化

14. As a 产品方, I want 知识包是版本化 JSON 数据资源而非编译期代码, so that 知识更新不需要发版
15. As a 用户, I want 无数据包或数据包损坏时自动回退内置包, so that 知识能力永远可用（离线优先）
16. As a 产品方, I want 数据包必须带签名（reviewed_digest）校验，校验失败拒绝加载, so that 篡改的知识包不会到达用户
17. As a 产品方, I want schema 版本不兼容的数据包被拒绝且不影响运行中的版本, so that 旧 app 遇到新包不会崩溃
18. As a 产品方, I want 数据包可本地安装（文件路径安装）, so that 本轮即可验证更新链路，云端渠道下一轮再接
19. As a 审核者, I want 每个包版本能对应到 wiki 知识页的 git commit, so that 知识变更有审计链
20. As a 用户, I want 知识包更新不重写我已确认的计划与历史, so that 我的数据不被知识运营动作影响

### Harness 收尾

21. As a 用户, I want app 崩溃后重新打开时上次中断的对话显示"已中断"并可继续新对话, so that 我不会面对一个永远转圈的会话
22. As a 产品方, I want 孤儿 run 在启动时被终态化并记录 terminalCode, so that 账本里不存在永远 streaming 的记录
23. As a 用户, I want 过期待确认卡片自动标记过期而不是永远等待, so that UI 状态真实
24. As a 产品方, I want 过期 pending action / action token / 到期 working memory 在 catchUp 周期被统一清扫并落 action log, so that 账本无腐肉且清扫可审计
25. As a 用户, I want 长对话时上下文自动裁剪且安全约束永远保留, so that 老会话不会因为超 token 而失败或丢安全护栏
26. As a 产品方, I want 上下文超预算时按确定性顺序降级（对话历史先裁，安全约束不裁）且压缩方式记入 manifest, so that 降级行为可复现可审计

### 个人知识层骨架

27. As a 产品方, I want 有四类个人知识条目（观测校准值/用户偏好/系统推断/未知）各带 provenance 与置信度, so that "这个用户身上学到的知识"有正式的存放位置
28. As a 用户, I want 系统推断类条目明确标注是推断（n=1、带证据窗）, so that 我不会把猜想当作事实
29. As a 产品方, I want 条目所依据的 Timeline 事实被更正时条目失效重建, so that 个人知识不与事实脱节
30. As a 产品方, I want 本轮个人知识层只提供读写接口、不接任何引擎消费者, so that 接入范围可控

### Eval 与上线门

31. As a 产品方, I want eval 覆盖工具选择/拒答边界/禁止声称三类各含正反用例（首轮人工编写 ≥30 条）, so that agent 行为可回归
32. As a 产品方, I want 禁止声称与领域拒答 100% 通过、工具选择零失误作为知识工具的上线门, so that 说错话的风险先于功能上线被锁死
33. As a 开发者, I want eval 用 ScriptedLLMProvider 在 CI 确定性运行, so that 不依赖真实模型额度
34. As a 产品方, I want 领域锚定词表版本化并存入知识包, so that 领域边界随知识包一起更新与审计

## Implementation Decisions

### 模块改动

- **知识包数据化（`src/knowledge/`）**：现有 `installedPack` 的内容（动作族目录、替代权重、规则包清单、wiki 文档引用）抽取为版本化 JSON 资源。新增**包加载器**：内置资源兜底 → 数据包覆盖；加载前校验 contentHash + reviewed_digest 签名与 schema 版本兼容性，任一失败拒绝并回退。数据包本轮经本地文件路径安装。`KnowledgePackRegistry` 的既有校验逻辑迁移为加载器的一部分，对外接口保持不变（引擎无感）。
- **知识检索工具（`src/coach/` 工具目录）**：新增两个只读工具——`knowledge.lookup_exercise`（按动作族/变式查询目录条目，返回肌群关联、器械、处方模式与免责声明全文）与 `knowledge.explain_rule`（按 ruleId 返回当前版本数值、证据锚点与"不能推出什么"）。两工具 `accessClass: "read"`、`offlineAvailable: true`；查无结果返回 typed `unknown`，不返回空字符串让模型自由发挥。
- **对话准则注入（provider 的 system prompt 构造点）**：prompt 增加两段版本化文本——行为改变准则（TTM 五阶段互动方式、MI 四过程、ask-offer-ask、不评判）与领域边界声明（三领域 + 分级拒答规则 + 固定转介话术）。准则版本号进入 context manifest。
- **输出过滤器（provider 流 → UI 投影之间）**：确定性规则过滤器，命中禁止声称清单或领域外内容时拦截并替换为固定安全文案；拦截事件落 ToolAudit/action log。禁止声称清单与领域锚定词表都是版本化数据，存入知识包随包更新。
- **孤儿 run 清扫（账本启动加载路径）**：加载 snapshot 时将非终态 run（streaming/resuming/suspended 超期）终态化为 `terminated`（terminalCode `process_lost`），不尝试恢复部分流；产生 action log 记录。
- **统一过期清扫器（既有 catchUp 周期）**：过期 pending human action 标记 expired、过期 apply/reject/undo/resume token 销毁、`expiresAt` 到期的 working memory 走 forget 流程；全部幂等并落 action log。
- **上下文预算（ContextAssembler）**：对话历史改为滑动窗口（最近 N 条原文）+ 更早消息按 run 分组摘要（复用 timeline 的 fact_ref_hierarchical 模式）；token 预算按 provider 上限留安全余量；超预算降级顺序固定为：对话历史 → working memory → 早期 timeline → 当前计划详情；**系统准则、安全约束、近期事实永远不裁**。压缩方式与裁剪计数记入 context manifest。
- **个人知识层骨架（新模块，挂在 knowledge 层下）**：四类条目的类型模型 + provenance（source facts 引用集、证据窗、置信度）+ CAS 读写接口；Timeline correction event 使依赖条目失效的钩子和 forget/supersede 生命周期。**本轮无任何引擎读取它。**

### 关键契约（来自拷问决策，固定语义）

```text
GradedRefusal =
  | { kind: "in_knowledge_base" }        → 精准回答，附证据引用
  | { kind: "in_domain_unverified" }     → 模型先验可答，末尾固定标注"未经验证的一般知识"
  | { kind: "out_of_domain" }            → 拒答 + 固定转介话术
领域 = 运动 | 健康 | 饮食；以健康/训练为锚点的交叉话题按领域内处理，但不做心理疏导/医疗诊断。

KnowledgePackSource =
  | { kind: "builtin" }                              — 编译期内置，永远可用
  | { kind: "installed", path, contentHash, reviewedDigest, schemaVersion }
加载失败（签名/hash/schema 任一不符）→ 回退 builtin，并记录拒绝原因。

PersonalKnowledgeEntry =
  | { kind: "observed_calibration", value, evidenceWindow, sourceFactRefs }
  | { kind: "user_preference", value, confirmedAt, locked }
  | { kind: "system_inference", value, confidence, evidenceWindow, sourceFactRefs }   — 永远标注推断
  | { kind: "unknown" }                                                              — 显式保留，禁止补齐
```

### 签发与审计

- 数据包签发：单人私钥 + git 审计；包版本与 wiki 知识页 commit 一一对应。预留双人复核接口，本轮不实现。
- 禁止声称清单的初始来源：workspace wiki 三张知识页（training-programming / nutrition-strategy / recovery-health-signals）中已明文化的清单。

### 前置依赖（spec 外执行项）

1. 13 条待验证断言的逐条核对（行为改变/FMS/筛查，来源已抓取带引述）。
2. 行为改变知识页入库 workspace wiki（核对完成后）。
3. `docs/design/knowledge-layering-and-distribution-v0.1.md`（分层/分发/个人层架构文档）。
三项先于实现完成，其中 1、2 是对话准则文本的内容来源。

## Testing Decisions

### 什么是好测试

只测外部行为：最终展示文本、工具调用序列、账本状态变化、manifest 内容。不测内部实现（正则怎么写、窗口怎么切）。所有 eval 与场景测试用 `ScriptedLLMProvider` 确定性运行，不依赖真实模型。

### 接缝（已与开发者确认，全部复用既有接缝）

| 接缝 | 测试内容 |
|---|---|
| CoachApplication facade + ScriptedLLMProvider（主接缝） | eval 全部用例：工具选择正确性、分级拒答、领域边界案例、行为准则遵守、过滤器拦截后的最终文本 |
| KnowledgePackRegistry 加载器端口 | 内置兜底、数据包覆盖、签名/hash/schema 失败回退、拒绝原因记录 |
| 账本启动加载 | 孤儿 run 终态化、action log 留痕、幂等（重复加载不重复记录） |
| Provider 流 → UI 投影 | 禁止声称拦截与替换文案、误伤用例（含"燃烧脂肪"等近义正常用语不拦截） |
| ContextAssembler manifest | 长会话上下文有界、降级顺序、压缩方式入 manifest |
| 既有 catchUp 周期 | 清扫器幂等、过期判定正确、action log 完整 |

### 既有先例

- `tools/coach-runtime/coachSessionRuntime.test.ts`（16 场景：HITL 重启续跑、stale、token 一次性、断流重试）
- `tools/coach-sqlite`（重启持久化）、`tools/coach-ui/coachStreamProjection.test.ts`（流投影）
- `KnowledgePackRegistry` 既有 contentHash/reviewed_digest 校验

### Eval 门槛（上线门，硬性的）

- 首轮人工编写 ≥30 用例：工具选择、拒答边界、禁止声称三类，每类含正反用例。
- 禁止声称与领域拒答：**100% 通过**；工具选择：**零失误**。未达门槛知识工具不启用。
- 真实会话采样用例：上线后有数据再补充，本轮不要求。

## Out of Scope

- **云端知识包分发渠道**（下一轮复用云 ProductData API；本轮只到本地安装路径）。
- **双人复核签发**（预留接口，不实现）。
- **结构化筛查（PAR-Q 决策树）进 onboarding**——落地形式已定（对话式采集 + 底层确定性问卷状态机），实施在下一轮。
- **个人知识层接引擎消费者**（营养维持热量、HRV 基线迁移等）。
- **动作筛查（FMS 式观察协议）**——受识别 profile validated 数量门控。
- **特殊人群边界扩展**（需单独 ADR）。
- per-tool 超时、账本增量存储、provider 流全量 replay（P2 工程项，见 gaps 文档 B5）。
- 对既有 25 张 MVP ticket 已实现内容的任何重构。

## Further Notes

- 设计文档：`docs/design/agent-harness-and-domain-knowledge-gaps-v0.1.md`（缺口清单与路线图）、`docs/design/domain-knowledge-upgrade-simulation-v0.1.md`（前后输出模拟）。
- 教练知识体系调研：`docs/research/2026-08-09-fitness-coach-knowledge-domains.md`（13 条待验证断言清单在第 ④⑤ 节）。
- 领域知识页：workspace `wiki/knowledge/{training-programming,nutrition-strategy,recovery-health-signals}.md`（禁止声称清单与证据锚点的来源）。
- 绑定关系：知识工具不得在 eval 门槛达标前启用；输出过滤器与领域词表随知识包版本化，单独发版即走包签发流程。
- 刻意不做（继承 gaps 文档 B6）：working memory 不提升为事实；远程失败不自动降级本地 LLM；同步冲突不自动合并。
