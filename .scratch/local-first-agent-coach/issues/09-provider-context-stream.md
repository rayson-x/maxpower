# 09 — Provider Port 与 Context contract

**What to build:** 客户端可以用 Scripted 或现有远程 LLM Provider 进行 Coach 表达；Provider 获得 fixture 范围内完整训练、身体、饮食、睡眠、Timeline、历史与 Memory 语义，直接身份信息在本地去标识。Provider 失败不会改变结构化结果。

**Blocked by:** 02 — TodayPlan Kernel、Artifact 与 Card Registry; 08 — 跨 Session Working Memory 与用户控制

**Status:** completed

- [x] LLMProvider Port 使用项目自有 request/event 类型，Provider SDK 类型不穿透 Adapter
- [x] 提供 ScriptedProvider 与现有远程 Provider 的薄 Adapter，可由 Composition Root 替换
- [x] ContextAssembler 本轮实现 fixture/stub 级完整语义组装、直接身份去标识和 context manifest
- [x] 生产级 redaction policy、长历史分层压缩、token 优化和只读检索只定义 contract/fixtures，不伪称完成
- [x] Provider stream 归一化为 canonical CoachRunEvent，再由 UI Adapter 投影
- [x] Provider 超时、断流或非法 ToolCall 时保留本地结构化结果并回退确定性解释
- [x] 替换 Provider 不改变 Proposal、PlanRevision、ActionEvent 或 Artifact hash
