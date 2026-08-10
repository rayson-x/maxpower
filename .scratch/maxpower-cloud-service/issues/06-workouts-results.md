# 06 — 保存 WorkoutSession 与结构化结果

**What to build:** 让用户把训练过程、完成总结和已确认的结构化结果保存为云端规范资源。

**Blocked by:** 05 — 保存计划与不可变版本

**Status:** completed

- [x] WorkoutSession 使用实际 PlanVersion 的冻结快照。
- [x] 训练和结果支持列表、读取、修改、完成与删除。
- [x] 所有写入有幂等与 revision 保护并保持账户隔离。
- [x] 云端模型不包含 Coach 对话、消息、Agent run 或 tool call。

**Verified:** PostgreSQL 17 persistence, cursor pagination, typed media-reference, and evidence-deleted provenance tests pass.
