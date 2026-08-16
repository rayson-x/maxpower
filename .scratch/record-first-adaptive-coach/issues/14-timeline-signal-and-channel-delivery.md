# 14 — Timeline 变化在正确渠道触发一次复核

**What to build:** 每次有意义的 Timeline、Goal contract、Active plan、Nutrition strategy 或 Readiness 变化先经过低成本固定检查。没有 material Signal 时不调用 LLM；Agent 代填的 Record 在同一对话返回结果，手动记录产生的 Signal 通过 Home 卡片或通知送达。

**Blocked by:** 13 — 用户知道问题来自记录、执行、时间、测量、恢复还是计划.

**Status:** completed

## Existing foundation and required change

- 保留现有 Timeline append/correct/source-change trigger、coalescing、Agent conversation 和 Artifact/card 中符合触发所有权的部分。
- 直接重写只钉 Timeline revision、默认 fat-loss 下游、generic risk 不能稳定送达和各入口自行通知的结构。
- 本 ticket 只覆盖手动入口与文本 Agent，不实现或依赖 Realtime Agent、低置信 cue、相机或识别结果。

## Acceptance criteria

- [x] Agent 代填并确认 Record 后，在同一 run 返回引用正式 Goal Path 结果的卡片，不产生重复系统通知。
- [x] 手动 Record 产生的 Signal 通过 Home 卡片或通知送达，并引用同一个固定判断 Artifact。
- [x] Goal、Active plan、Nutrition strategy 和 Readiness 的实质版本变化触发同一复核入口。
- [x] 食物描述本身不能制造高摄入 Signal；只有 confirmed Ledger 数值和正式趋势可参与营养 Signal。
- [x] 单次普通波动通常 monitor；累计模式、硬护栏和明显恶化产生不同 Signal。
- [x] 无新 material Signal 时不调用 LLM、不创建用户通知。
- [x] 相同 Record 通过手动和文本 Agent 入口得到相同固定结果，只有送达方式不同。
- [x] analysis failure 不回滚已经接受的 Record，也不修改 Active plan。
- [x] evaluated、skipped、coalesced、stale、failed 和 suppressed 都有稳定审计结果。
- [x] 默认客户端覆盖同 run delivery、manual background delivery、no signal、coalescing、stale 和 failure。
- [x] 删除旧 risk artifact、Timeline-only snapshot、局部通知分支和重复 trigger 路径。

