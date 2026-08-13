# 01 — IUSCA 增肌来源端到端试点

**What to build:** 以 IUSCA 增肌立场声明完成第一次 Wiki 端到端发布：合法获取和登记来源，比较不同输入格式，生成并人工审核 Source Page 与多个 Claim Page，再将审核结论更新到相关 Topic Page。book-to-skill 只负责生成 Wiki Draft，不得直接生成 Agent Rule 或 Planner 行动。

**Blocked by:** 00. Wiki Schema 与发布纪律

**Status:** completed

- [x] 发布 1 个通过验证的 Source Page，完整记录标题、作者、DOI、版本、获取时间、原始入口、许可、内容哈希、资助和利益冲突
- [x] 比较网页结构化文本与 PDF 的提取结果，记录章节完整性、表格保真度、引用保留率、数值差异和噪声，不把自动提取结果直接标为 reviewed
- [x] 发布覆盖训练量、频率、负荷、休息、动作选择、动作幅度、接近力竭和周期安排的独立 Claim Pages
- [x] 每个 Claim 均带精确来源定位、适用人群、干预、对照、结果、时间范围、冲突状态和 cannot support，并完成数值人工核验
- [x] 至少更新“训练量与频率”及一个相关 Topic Page，以引用 Claim 的方式组织知识，不复制来源摘要代替 Topic
- [x] Wiki 全量验证、链接检查与索引构建通过，且没有生成任何可执行 Rule、Action、Fixture 或 KnowledgeRelease

## Comments

- 2026-08-13 完成：保存官方 HTML/PDF 与提取审计；发布 1 个 SourceRecord、10 个逐页核验的 reviewed ClaimRecords、3 个 TopicRecords，并更新训练编程综合页与 curation。隔离契约验证为 14 records、0 warnings、0 errors；未创建 Agent Knowledge 制品。
