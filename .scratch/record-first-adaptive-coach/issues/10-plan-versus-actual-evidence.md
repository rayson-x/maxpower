# 10 — 计划执行产生计划与实际的正式证据

**What to build:** 用户从 Today 执行已确认计划后，计划安排与实际完成分别呈现；完成、部分完成、替换、跳过和提前结束形成不同 performed 结果。训练、饮食、恢复和身体记录按观察合同形成复核证据，未记录与明确未执行保持不同。

**Blocked by:** 09 — 用户获得并确认首个当前阶段计划.

**Status:** completed

## Existing foundation and required change

- 保留现有手动计划 Workout session、Today 计划卡、替换、跳过、outcome correction 和 performed Records 中符合 planned/performed 分离的逻辑。
- 补齐统一观察合同、coverage、计划对实际证据和客户端投影；删除把计划值复制为实际值或把未记录当 missed 的路径。
- 本 ticket 不实现或依赖 Realtime Agent；只保持来源无关的 finalized performed Workout Record admission 接口可供未来接入。

## Acceptance criteria

- [x] 完成、部分完成、替换、跳过和提前结束形成不同且可更正的 performed 结果。
- [x] 已执行事实不能被新 Plan revision、Nutrition strategy 或日常调整覆盖。
- [x] 每份确认计划包含身体数据、训练完成、代表性饮食、测量协议、观察窗口和复核信号。
- [x] 代表性饮食 coverage 只由确认的 numeric nutrient input 提高；食物描述本身不证明目标摄入。
- [x] 未记录项只降低 coverage，不进入执行失败分母；只有明确跳过或确认未执行才影响完成度。
- [x] 计划训练与自由训练进入同一 Timeline 和 Daily Health Ledger，并保留 Plan reference 差异。
- [x] Home 同时显示 planned 与 performed，不合并计划目标和实际事实。
- [x] 修改历史结果通过 CorrectionEvent 使依赖证据与后续判断 stale。
- [x] 默认客户端覆盖完整执行、部分执行、替换、明确跳过、无记录、修正和重启恢复。
- [x] 预留接口只接受 finalized performed Record，不暴露或引入 realtime session、cue、camera 或 recognition 状态。
- [x] 删除计划值冒充实际、unknown 当失败和重复 performed 投影。

