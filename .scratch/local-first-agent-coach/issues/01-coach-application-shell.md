# 01 — CoachApplication 主 seam 与 In-memory shell

**What to build:** 建立一个不依赖现有页面或原生 capture 文件的本地 CoachApplication shell。开发者可以通过同一公开 Facade 创建 CoachSession、写入种子事实并读取 canonical run events，为后续 TodayPlan、卡片和写入闭环提供稳定 Composition Root。

**Blocked by:** None — can start immediately

**Status:** completed

- [x] 定义 CoachApplication、CoachSession、CoachRun、FactRef、ArtifactRef、PresentationRef 与 canonical CoachRunEvent 的最小领域合同
- [x] Composition Root 通过构造注入 CoachLedger、LLMProvider、MotionRuntime、Health、Notification、Sync、Clock、ID 与 token primitives
- [x] InMemoryCoachLedger 可以保存独立聚合事实、Session events 与 seed data，并提供 revision-aware reads
- [x] CoachApplication 是 UI/测试唯一高层入口；领域与应用模块不 import 具体 Adapter 或平台 SDK
- [x] 现有应用入口、capture 主循环、原生 bridge 和用户未提交文件保持不变
- [x] 主 seam 测试可以创建/读取/暂停一个 CoachSession，并证明零网络调用
