# 00 — Wiki Schema 与发布纪律

**What to build:** 为公开健身语料建立一套可验证的 Wiki 发布契约，使任何采集代理都能把来源整理成可读、可审查、可追溯的 Source Page、Claim Page 和 Topic Page，同时严格区分 Wiki Draft、已审核证据和 Agent 运行知识。该任务只建设项目 Wiki 与 Corpus Release 规范，不生成 Planner 可执行规则。

**Blocked by:** None — can start immediately.

**Status:** completed

- [x] 定义 Source Page、Claim Page 和 Topic Page 的机器可验证 schema，并覆盖稳定标识、版本、状态、来源定位、适用人群、时间范围、内容哈希和更新时间
- [x] 定义许可证登记、冲突记录、知识缺口、术语、数据集和安全边界的最小结构，以及原始内容允许保存与禁止保存的规则
- [x] 定义 draft、source_verified、claim_extracted、reviewed、approved_for_product、disputed、deprecated 和 retracted 状态及合法状态迁移
- [x] Claim 必须记录 statement、population、intervention、comparator、outcomes、direction、source mappings、cannot support 和 conflict status；缺失关键字段时验证失败
- [x] 定义来源更新、勘误、撤稿和许可变化如何传播到 Claim、Topic 与 Corpus Release，且失效内容不能静默保持 current
- [x] 提供 Wiki 验证、索引构建、链接检查和来源更新检测的可运行入口，并以一组通过与失败 fixture 证明规则有效
- [x] 明确 book-to-skill 输出只能是 Wiki Draft，Wiki 不自动生成 Rule、Action、Fixture、DecisionRecord 或 KnowledgeRelease

## Comments

- 2026-08-13 完成：补齐 Wiki Corpus schema、工作流状态、许可与原文保留边界、来源 revision/hash pin、更新传播检查和 13 个契约 fixture；knowledge lint、eligible、detect-updates、Wiki lint/reindex 与 diff 检查全部通过。后续审查又补入严格未知 Schema 拒绝、生命周期编译门禁和冻结发布不可改写测试。
