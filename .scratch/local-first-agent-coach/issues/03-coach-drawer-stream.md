# 03 — Coach Drawer 演示面与 Stream Projection

**What to build:** 用户可以在独立、可复用的共享客户端演示面从底部入口展开 Coach Drawer，看到 TodayPlan 从 loading 原位变为 ready；收起后页面上下文仍存在。该演示面不替换现有应用入口或 capture 主循环。

**Blocked by:** 02 — TodayPlan Kernel、Artifact 与 Card Registry

**Status:** completed

- [x] UI Stream Adapter 将 canonical CoachRunEvent 投影为 AI SDK 风格 tool/data states，AI SDK 类型不进入领域或 Ledger
- [x] 同一 toolCallId、artifactId 与 presentationId 原位 reconciliation，不追加重复 loading/result 卡
- [x] Drawer 从底部入口连续扩展到约四分之五屏并可最小化，保持触发页面的 context ref
- [x] Demo 支持 Today、Progress 与 Workout context，Profile context 不展示常驻 Agent 输入入口
- [x] 未知 renderer、stream error 与 empty state 都有稳定客户端展示
- [x] UI 作为新增隔离模块交付，不修改现有 App 入口、CameraPoseView 分发或原生 capture 文件
