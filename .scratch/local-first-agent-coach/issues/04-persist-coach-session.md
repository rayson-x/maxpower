# 04 — 基础 SQLite Ledger 与 CoachSession 恢复

**What to build:** 用户收起 Drawer、切换上下文或重启应用后，CoachSession、TodayPlan presentation 和待恢复状态仍保存在本地；SQLite 与 In-memory Adapter 遵守同一可替换合同。

**Blocked by:** 03 — Coach Drawer 演示面与 Stream Projection

**Status:** completed

- [x] 依据 Expo 57 版本文档安装并配置兼容的 SQLite 依赖，修改依赖文件前保留现有用户改动
- [x] 提供基础 SQLiteCoachLedger 与 InMemoryCoachLedger，并运行相同 conformance suite
- [x] CoachSession 支持 active、suspended、completed、archived，且允许零个或至多一个 active Session
- [x] CoachSession 不拥有 Plan、Timeline、WorkoutSession 或 Working Memory 事实，只保存引用与交互状态
- [x] restart 后恢复 Session、Run 摘要、TodayPlan presentation 与 context refs
- [x] 基础 migration/version failure 返回可恢复错误；生产级加密、备份恢复与复杂 migration recovery 明确留后
- [x] SQLite 与 In-memory 对同一种子生成相同 TodayPlan Artifact hash
