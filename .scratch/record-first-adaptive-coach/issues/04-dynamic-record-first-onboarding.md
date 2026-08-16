# 04 — 无目标用户完成建档后进入记录首页

**What to build:** 用户在一个连续的全屏 Agent thread 中完成最小档案确认后，系统根据真实目标意图动态分流。没有明确目标时直接进入 record-first Home；有明确目标时留在同一 thread 继续目标协商；意图不清时只询问决定分流所需的最少问题。

**Blocked by:** 02 — 用户看到唯一的每日能量与宏量计算.

**Status:** completed

## Existing foundation and required change

- 保留现有 Onboarding conversation、durable Thread/Turn/Item、User dossier 和正常 App shell 中符合连续对话的部分。
- 直接重写建档后强制 Goal/首次 Plan、无 Plan 即 planner hold、固定模式选择和页面只消费局部消息的逻辑。
- record-first Home 读取 02 的正式 Daily Health Ledger，不建立无计划专用计算或记录路径。

## Acceptance criteria

- [x] 没有明确目标的用户不需要选择固定模式，也不会自动创建 Goal、Plan、计划完成度或普通计划提醒。
- [x] record-first Home 显示当日 Record/Ledger 摘要、趋势入口、Record/Add 和自由训练入口。
- [x] 有明确目标的用户留在同一 thread 继续 Goal contract 流程；模糊意图只触发最小澄清。
- [x] Dossier 完成本身永远不会创建 Active Goal 或 Plan。
- [x] Onboarding 消息、文本问题、结构化表单、摘要和回执按完整 thread projection 保留，已提交卡片原位只读。
- [x] V1 初始化不请求或处理图片、音频、视频、OCR 或其他多模态输入。
- [x] 对话根、滚动位置和任务上下文在卡片交互与后续步骤中保持稳定。
- [x] Today、Calendar、Record、Plan 和 Profile 的手动路径不要求创建或打开 CoachSession。
- [x] 默认客户端覆盖新账号、无目标、有目标、模糊目标、重启恢复、失败重试和账号切换。
- [x] 删除强制目标、强制首次计划、planner-hold 无计划语义和局部对话状态源，不留兼容路由。

