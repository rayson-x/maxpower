# 15 — 开放证据雷达与更新队列

**What to build:** 建立面向当前 Corpus Release 的证据发现与 Wiki 维护流程，定期从 Crossref、OpenAlex、DOAJ、PMC Open Access 和 Europe PMC 查找新版、开放系统综述、勘误与撤稿。发现层只建立候选来源和更新任务，不跳过许可、提取及人工审核直接修改 reviewed Claim。

**Blocked by:** 14. 跨来源审查与 Corpus Release

**Status:** completed

- [x] 为每个知识模块建立主题、来源机构、作者、期刊、标识符和版本查询条件
- [x] 候选记录包含题名、作者、日期、标识符、开放位置、许可线索、关联旧来源和发现时间
- [x] 能识别更正、撤稿、新版和可能取代旧结论的材料，并生成明确的人工复核原因
- [x] Crossref、OpenAlex 和 DOAJ 仅作为发现与元数据层，不被标记为断言全文来源
- [x] 只有确认 CC0、CC BY 或项目明确允许的许可后，候选材料才能进入新的蒸馏任务
- [x] 演示一次完整更新周期，产生去重后的候选队列以及无更新时的可审计结果

## Comments

- 2026-08-13 完成：五个发现源、限时 live adapters、离线去重/版本/许可 fixture 与候选/无更新审计均已落盘；4/4 场景通过（含拒绝非冻结 Release、全源失败不覆盖旧队列），候选明确禁止自动创建 Ticket、Claim 或提升审核状态。
