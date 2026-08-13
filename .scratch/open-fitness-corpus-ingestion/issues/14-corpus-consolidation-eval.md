# 14 — 跨来源审查与 Corpus Release

**What to build:** 对持续增量更新的 Wiki 做一次发布级全局审查，处理重复 Claim、冲突记录、孤立 Claim、失效引用、Topic 覆盖和许可证状态，生成可固定版本的 Corpus Release。该 Release 是后续知识编译的审核输入，不是 KnowledgeRelease，也不得直接被 Planner 执行。

**Blocked by:** 02. ISSN 蛋白质知识包; 03. ISSN 饮食与体成分知识包; 04. ISSN 营养时机知识包; 05. ISSN 肌酸知识包; 06. ISSN 咖啡因知识包; 07. HHS 普通成年人活动基线; 10. 行为改变证据补强与现有内容合并; 11. FoodData Central 营养数据切片; 13. 受限来源索引与禁止摄入清单

**Non-blocking known gaps:** 08. DGAC、09. NIDDK 平台期/水重、12. 中国营养本地化只要求把机器可达的安全终点与 gap 纳入快照；其 human-gated enrichment 不阻塞当前 Corpus Release，补齐后必须另发新版本。

**Status:** completed

- [x] 所有 Source、Claim、Topic、Dataset 和 Safety Boundary 页面通过 schema、链接和来源定位验证，且没有把题录索引当成全文证据
- [x] 重复 Claim 合并后仍保留各来源映射、适用条件、日期、证据类型和利益冲突；孤立 Claim 得到 Topic 归属或明确排除理由
- [x] 冲突 Claim 不静默覆盖，按人群、目标、条件、版本和证据等级生成冲突记录
- [x] 计算训练、营养、补剂、活动、行为、本地化和安全边界的 Topic 覆盖率，并列出仍未覆盖的知识缺口
- [x] deprecated、retracted、许可变化和失效引用均传播到依赖页面，不能进入 current Corpus Release
- [x] 发布带版本、内容哈希、来源清单、审核状态统计和已知缺口的 Corpus Release，并验证其中不含 Rule、Action、Fixture、DecisionRecord 或 KnowledgeRelease

## Comments

- 2026-08-13 完成：发布 frozen Corpus Release 1.0.0，固定 94 pins；隔离验证 95 records、0 warnings、0 errors。47 reviewed Claims、0 approved_for_product、0 runtime artifacts；许可受限与不可达来源以明确 gap 保留。
- 2026-08-13 依赖解释：`frozen` 表示“当前可合法、可核验语料的不可变快照”，不表示所有计划来源都已形成 Claim。08、09、12 的自动化工作已到安全终点，未完成项作为 human-gated enrichment 留在各自 ticket；它们不进入 reviewed Claim，也不阻止对现有 94 个 pins 固定版本。若人工补齐来源，必须发布新的 Corpus Release，不能改写 1.0.0。
