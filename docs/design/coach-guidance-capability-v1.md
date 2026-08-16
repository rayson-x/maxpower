# Coach 引导能力改造：分析模式语料、主观信号、安全转介与判据体系

> 来源：2026-08-16 教练方法论采集（`docs/research/coaching-diagnostic-patterns-2026-08-16.md`，P01–P08 + S01 + G01 + M01/M02）与 grilling 两轮 11 项已确认决策。
> 遵循：AGENTS.md §2 产品理念（以执行者为准、需求驱动、先摸清情况再给方案、判据体系、措辞纪律）、CONTEXT.md 不变量、ADR 0001/0002。
> 状态：experimental 发布 → dogfood → 转正。

## Problem Statement

用户向 coach agent 咨询时，说的是表面诉求（"吃什么蛋白质""怎么瘦肚子""要不要停练"），而不是真正的问题。有经验的教练能听出背后缺失的是什么（基础训练强度、判据错误、生活方式来源），并给出对方够得着的第一步——这套判断力我们已经从作者身上采集成 8 条分析模式语料，但它目前只是一份研究文档，运行时的 agent 完全看不到。

同时：

- 用户口述的主观好变化（"爬楼不喘了""睡眠变好了"）没有记录类型可落账，复盘也不会回放——健身最有感的进步恰恰都不是数字，agent 无法"听见"用户。
- 用户描述红线症状（剧痛、肿胀、麻木、放射痛、外伤史）时，转介只依赖模型自觉，没有确定性兜底。
- "3 周体重不动先判真伪""短期波动 84% 是水"这类判据只存在于 wiki 知识页，agent 靠检索自觉，固定引擎不会主动这样判断。
- playbook v8 有恢复工具纪律，但缺少整层"怎么当教练"的常驻姿态（先摸清情况、判据修正、期望预埋、三层分层诚实）。

## Solution

六个改造面，把作者的分析方法搬进 harness：

1. **playbook v9（常驻姿态）**：先摸清情况再给方案、追问的唯一触发条件是答案改变方案、首诊姿态（第一次目标讨论先了解现状）、判据话术（体重=噪声、为围度/表现/主观信号庆祝、平台先判真伪）、三层分层（知识包证据/经验做法/用户自身历史）、S01 转介纪律、主动采集主观好变化。
2. **知识包 passages（按需检索，标 experimental）**：P01–P08 模式全文（表面信号→瓶颈假设→关键追问→回应形态→置信边界）+ 平台/recomp/停训修正话术 + 判据体系解释；每条带 sourceRef 钉语料文档，走 pack 构建管线 bump minor。
3. **wellness_note 新记录类型（v1 = 只记录 + 回放）**：自由文本 + 可选维度标签（精力/睡眠/功能/情绪），一等 Timeline 公民；复盘报告新增"你说过的好变化"回放 section；v1 不进风险评估引擎。
4. **S01 输入侧确定性检测**：用户消息命中红线模式（剧痛/肿胀/麻木/放射痛/不训练也持续疼/外伤史等）→ harness 向 run 上下文注入固定转介指令；模型组织语言但不可漏转介；只转介不下结论、不推测病名。
5. **固定引擎扩展**：平台判定决策树进 goal path 评估——多信号（围度+表现+主观）缩短判定窗，仅体重需 3–4 周移动均值；Goal contract 的 success measures 默认值按判据体系（围度/表现优先，体重降级为周均趋势）。
6. **eval 两层**：CI 确定性（S01 注入、wellness_note 落账、passages 命中、引擎判定）+ 定期真实模型抽检（语料案例对话脚本 + 评分表）。

## User Stories

### 需求挖掘与分析姿态

1. As a 咨询用户, I want 问"吃什么蛋白质"时被接住表面问题但指出我真正缺的是基础训练, so that 我不在错误的细节上纠结。
2. As a 咨询用户, I want 问"怎么瘦肚子"时听到一句话破除局部减脂误区 + 一条正确路径 + "肚子最后才瘦"的期望预埋, so that 我不会两周后因失望放弃。
3. As a 咨询用户, I want 我说"练了一个月体重没变"时先被纠正判据（新手期储水/围度才是信号）, so that 我不会因用错尺子而误判训练无效。
4. As a 咨询用户, I want 背景明显不足时 agent 先问目标与现状而不是给万能答案, so that 我拿到的建议是为我这个人做的。
5. As a 咨询用户, I want agent 只在"答案会改变方案"时追问, so that 对话不被无关问题打断。
6. As a 新用户, I want 第一次讨论目标时 agent 先主动了解我现在怎么吃、怎么练、什么生活节奏, so that 第一份方案落在我真实生活上。
7. As a 大基数用户, I want 方案从我生活的缝隙开始（爬楼梯、少 20%)而不是一张健身房课表, so that 我真的能开始。
8. As a 中断回归用户, I want 听到"没白练"的证据化解释和最低门槛复入路径, so that 我有勇气重新开始。
9. As a 咨询用户, I want agent 区分"文献证据/经验做法/我自己上次的结果"三层来源, so that 我知道每句话该信多重。
10. As a 咨询用户, I want agent 不确定时直说不确定, so that 我能信任它说的话。

### 主观信号

11. As a 用户, I want 说"最近爬楼不喘了"被当成进展记录下来, so that 非数字的进步不被漏掉。
12. As a 用户, I want 复盘时看到"你说过的好变化"回放, so that 我感到教练真的在听。
13. As a 用户, I want agent 定期主动问"最近有什么感觉变好的地方", so that 我没意识到的改善也被看见。
14. As a 开发者, I want 主观信号是一等 Timeline 记录（带维度标签）, so that 回放与分析有稳定数据面；v1 不进风险评估引擎。

### 安全转介

15. As a 用户, I want 描述剧痛/肿胀/麻木/放射痛/外伤时得到明确的就医建议而不是训练分支建议, so that 我不被耽误。
16. As a 用户, I want 转介时 agent 不推测病名或严重程度, so that 我不会把 app 当医生。
17. As a 开发者, I want 红线输入触发确定性注入（不依赖模型自觉）, so that 转介不可被遗漏。

### 判据体系与固定引擎

18. As a 减脂用户, I want 单日体重波动被重新定性为噪声, so that 我不被正
常波动惩罚情绪。
19. As a 减脂用户, I want "3 周不动"先被判真伪（多信号缩短窗口、单体重需 3–4 周均值）, so that 我不会在假平台上乱改计划。
20. As a 减脂用户, I want 力量下降被当作真信号触发改方案, so that 我不在过大的缺口里硬扛。
21. As a 立目标的用户, I want 成功度量默认是围度/表现/趋势而不是"减到 X 斤", so that 我的目标本身就更健康。
22. As a 用户, I want 体脂率只以趋势/区间呈现, so that 我不被体脂秤单次读数误导。

### 内容与验收（内部）

23. As a 开发者, I want 语料模式经 pack 构建管线进包并带 sourceRef 钉版, so that 每条的出处可审计。
24. As a 开发者, I want 新内容标 experimental、dogfood 后转正, so that 话术质量有真实使用反馈再定稿。
25. As a 开发者, I want 引导能力有两层验收（CI 确定性 + 真实模型抽检评分表）, so that playbook 改动不会静默退化。
26. As a 开发者, I want 全部文案遵守措辞纪律（无医学措辞）, so that 产品语言与能力红线一致。

## Implementation Decisions

- **playbook v9**：新增常驻姿态条目（先摸清情况再给方案；首诊姿态；追问触发条件；判据话术；三层分层；S01 纪律；主观信号采集）。保持紧凑——姿态常驻，案例不常驻。
- **passages**:P01–P08 全文 + 平台/recomp/停训修正话术 + 判据体系解释，编译进知识包（minor bump)，每条带 sourceRef（钉语料文档与调研报告）;`search_installed` 可命中。标 experimental。
- **wellness_note**：新 record 类型（自由文本 + 可选维度标签：energy/sleep/function/mood/other）;`record_explicit` 扩展该类型；复盘报告新增回放 section（单一制品原则：UI 与 agent 共读）。
- **S01 输入检测**：确定性模式匹配（红线词表版本化）命中后向 run 上下文注入固定转介指令；playbook 定话术（转介、不下结论、不猜病名）；该注入是安全硬边界，不受"以执行者为准"影响（约束 agent 自身行为）。
- **固定引擎**：goal path 评估扩展平台判定决策树（真伪判定窗：多信号 1–2 周、单体重 3–4 周移动均值；力量/做功下降 = 真信号触发调整评估）；Goal contract success measures 默认值按判据体系生成。
- **eval**:CI 层覆盖 S2/S3/S4 接缝行为；抽检层为语料案例对话脚本（真实模型、非 CI）+ 评分表（是否关键追问/是否修判据/是否转介/是否分层诚实/措辞纪律）。
- **措辞纪律**：playbook、passages、界面文案禁用医学措辞（诊断/处方/疗程/医嘱），已写入 AGENTS.md §2。
- **发布流程**：起草 → Claude 自审（语料忠实度 + 措辞纪律）→ experimental 发布 → dogfood → 转正；不经作者逐字审。

## Testing Decisions

好测试 = 只测外部行为；缺失与未知必须显式断言。五条接缝：

- **S1 知识包构建缝**：passages 进包、sourceRef 钉版、search_installed 命中语料模式、experimental 标记存在。先例：packLoader / buildCorePack 测试。
- **S2 对话组装缝**：playbook v9 版本钉入 context manifest；红线输入 → run 上下文含转介指令注入；非红线 → 无注入；wellness_note 出现在记录工具面。先例：PiAgentConversationModule 的 run/context 测试。
- **S3 记录链路缝**：对话口述 → wellness_note 落 Timeline → 复盘回放可查询；维度标签可选；不进风险评估引擎（v1 断言）。先例：record_explicit 系列测试。
- **S4 固定引擎缝**：夹具（仅体重信号 3 周不动 → 不判平台；体重+力量下降 → 触发调整评估；多信号 → 窗口缩短）；success measures 默认值。先例：tools/goal-path 测试。
- **S5 引导质量抽检缝**（非 CI)：语料案例脚本 × 真实模型 → 评分表；playbook 变更前后各跑一次对比。

## Out of Scope

- wellness_note 进风险评估引擎（v2，需校准）
- 结构化首诊表单/流程（定为自由对话 + 姿态引导）
- 新的 LLM provider 或模型选型
- 食物成分数据库（精确级饮食的独立缺口）
- 红线症状的医学内容（病名/严重度/预后——永不生产）
- 社交/分享功能（判据体系的分享卡片另立项目）
- 语料的新增采集（P09+ 随时可补，不在本规格）

## Further Notes

- 语料源：`docs/research/coaching-diagnostic-patterns-2026-08-16.md`；知识裁决源：`muscle-recovery-windows-2026-08-16.md`、`fat-loss-plateau-2026-08-16.md`、`body-recomposition-2026-08-16.md`、`detraining-retraining-2026-08-16.md`（四份共 174 条核验引用）。
- wiki 三章节（恢复窗/平台/recomp/停训）已是知识层底座；passages 是它们在运行时的检索形态。
- 与 AGENTS.md §2 的每一条理念一一对应；本规格是 §2 的工程落地。
- 计划发布到 GitHub Issues（rayson-x/maxpower），当前被 token 只读权限阻塞（见会话记录）；解除后本文件内容即 issue 正文。
