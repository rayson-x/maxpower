# 09 — 用户获得并确认首个当前阶段计划

**What to build:** LLM 使用已确认的 User profile、Timeline、Daily Health Ledger、Goal contract、Readiness、偏好、日程、器械和领域知识，组织当前阶段 Training plan、Nutrition strategy、渐进行为和观察合同。固定引擎验证能量目标、训练剂量、健康护栏、可观察性和提交有效性，只有通过验证的候选才能展示并确认。

**Blocked by:** 06 — 多周记录形成可信趋势与个人能量校准; 07 — 用户协商目标期限、代价与 Coach 权限; 08 — 危险行为或健康边界触发不可覆盖的安全处置.

**Status:** completed

## Existing foundation and required change

- 保留现有 Agent runtime、ToolRegistry、知识检索、Planner trace、Proposal、semantic diff、stale、immutable revision 和确定性 validators 中符合职责的部分。
- 将正式规划改为 bounded LLM candidate → typed tool results → deterministic validation → user/mandate confirmation；删除确定性模块直接组织最终计划和无验证提交路径。
- 规划营养工具只提供目标能量/宏量范围、confirmed Ledger 汇总和护栏，不注册 food lookup、meal estimate、OCR 或营养识别工具。

## Acceptance criteria

- [x] LLM 通过正式工具读取已确认事实、Ledger、目标、权限和知识，不从聊天摘要重新猜测正式输入。
- [x] PlanCandidate 同时包含 Training plan、Nutrition strategy、当前习惯变化、执行负担和观察合同。
- [x] 候选只定义当前阶段与推进规则，不提前物化未来全部阶段。
- [x] 固定工具提供安全能量路径、目标范围、训练剂量和硬护栏；LLM 不得发明边界。
- [x] 食物级建议只能定性或引用用户已确认的结构化值，不能声称未知食物或精确克数满足营养目标。
- [x] 长期高摄入用户可从足以改善路径的小改变开始，而不是默认极端限制或理想化饮食替换。
- [x] 缺少观察窗口、成功、推进、保持、回退和 stop 条件的候选不能提交。
- [x] 验证失败以结构化问题回灌同一 Agent run，并有确定最大返修次数；失败后当前状态不变。
- [x] 用户确认时重检完整事实和版本，并原子创建协调的 Plan revision 与 Nutrition strategy revision。
- [x] 路线、阶段、近期周、营养目标、diff、确认和提交回执留在同一 conversation root，并更新 Home、Plan、Calendar。
- [x] 默认客户端覆盖安全候选、unknown、不可达、返修、拒绝、stale、确认和 replay。
- [x] 删除旧首次规划 orchestration、food nutrition fallback、未验证提交、compat Adapter 和被替代测试。

