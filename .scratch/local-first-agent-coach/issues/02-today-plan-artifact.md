# 02 — TodayPlan Kernel、Artifact 与 Card Registry

**What to build:** 用户的本地 Goal、Plan 和 Timeline 种子事实通过纯确定性 CoachKernel 生成 TodayPlan Artifact，并由固定 Card Registry 得到可信卡片模型；未知版本安全降级，不依赖自然语言或页面假数据。

**Blocked by:** 01 — CoachApplication 主 seam 与 In-memory shell

**Status:** completed

- [x] CoachKernel 是纯领域模块：输入事实 snapshot/query，输出 TodayPlan decision/artifact，不访问 Store、LLM、时间或 UI
- [x] TodayPlan Artifact 不可变且包含 schema/render version、context refs、evidence refs、missingness 和 capability boundary
- [x] 固定 ArtifactCardRegistry 按 artifact kind/version 选择 renderer model，LLM 不能生成 renderer 或任意卡片 JSON
- [x] 未知 artifact kind/schema 使用安全 fallback，显示不可操作状态而不猜测字段
- [x] 相同事实 frontier 与版本生成相同 Artifact hash
- [x] CoachApplication 主 seam 场景测试从 seed facts 得到 TodayPlan card model
