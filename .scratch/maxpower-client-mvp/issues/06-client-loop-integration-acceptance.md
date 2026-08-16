# 06 — 既有客户端闭环接线与验收

**What to build:** 不重新设计客户端，把已经确认的 Today、Calendar、Plan、Progress、Workout、Profile、Coach Drawer、Timeline、Action Log 和 Artifact cards 全部接到真实 `CoachApplication` 数据与动作上。用户从首次建档完成一天训练、饮食和恢复后，第二天看到有证据的变化，并能在离线、重启、HITL、撤销和 Android 主路径下继续使用。

**Blocked by:** 05 — 多日趋势、平台审计与长期阶段切换

**Status:** wontfix

- [ ] 开始实施前逐条审计现有客户端、UI Demo 和本规格，列出 reused、already-green、gap、deferred；实现只处理 gap
- [ ] Today 保留顶部 Coach 动态、固定 Plan Summary、卡内滚动 Task List 和下方 Timeline，不因接入真实数据产生溢出或第二份页面状态
- [ ] 力量、徒手、有氧和休息日都使用既有 Today 信息架构，并显示真实 GoalCycle/PlanRevision/DailyEvaluation provenance
- [ ] Calendar 保留 week/month 和日期详情，按日期展示计划引用、Timeline facts、CorrectionEvent 和实际状态，不创建独立 Timeline
- [ ] Plan 保留动作新增、删除、修改、排序、锁定和平替，并且所有写入通过 CoachApplication 产生 PlanRevision
- [ ] Progress 使用真实 metrics 展示体重、围度、体脂方法、力量、执行率、Forecast、phase progress 和 PeriodicReview
- [ ] Workout 保留普通记录/监控切换、组级执行、训练中动作管理和前台 Coach 协作，并消费真实 canonical motion 与 Proposal
- [ ] Profile 保留档案、偏好、CoachingMandate 和 Working Memory 管理，默认不显示 Coach 入口
- [ ] Coach 从原底部气泡连续扩展为约四分之五屏 Drawer，可最小化并恢复同一 page/date/plan/workout/set context，不跳转独立聊天页
- [ ] 训练监控页可以保持摄像头/骨架前台的同时展开 Coach，并正确处理键盘、暂停、返回和权限降级
- [ ] canonical CoachRun events 投影为 AI SDK 风格 parts；tool input 只显示无事实 loading shell，validated tool result 使用 immutable artifactRef 原位渲染
- [ ] Card Registry 至少支持 GoalRoute/Forecast、TodayPlan、PlanChangeProposal、NextSetAdjustment、SetSummary/WorkoutReport、NextMealRecommendation、RecoveryBrief、PeriodicReview、Knowledge/Citation 和 ActionReceipt
- [ ] 同一 toolCallId/artifactId/presentationId 不重复堆卡；error、stale、applied、rejected、undone 和 unknown renderer 有可恢复状态
- [ ] 卡片 confirm/reject/undo 直接调用 typed action，不把按钮文字送回 LLM；解释和追问才创建新 CoachRun
- [ ] HITL 在收起 Drawer、切页和重启后恢复同一 run/toolCall，resume 前重读 revisions 并原子消费一次性 token
- [ ] Timeline UI 只展示真实用户经历和来源；Action Log UI 展示 read/judgement/proposal/apply/reject/correction/undo、before/after、证据、版本、影响范围和状态
- [ ] Action Log 发起 undo 后创建补偿 revision/event，Today、Calendar、Plan、Progress 和 Coach cards 一致更新且原历史保留
- [ ] 新增 NutritionDayLedger UI 与既有视觉语言一致，并完成四项进度、餐次、录入、编辑、MealDraft 和下一餐建议交互
- [ ] 页面切换、日期切换、Drawer 最小化和 App 重启不创建重复 Profile、Plan、Timeline fact、WorkoutSession、CoachSession 或 Artifact
- [ ] 远程 LLM/Web 超时、失败或离线时保留本地规划、Workout、营养、恢复、Action Log 和确定性卡片操作
- [ ] 原始 tool arg delta、模型自由 HTML、任意 JSON component tree、JSON Patch 和页面本地写入不能成为可信产品状态
- [ ] 单设备持久化恢复 active GoalCycle、Forecast、PlanRevision、Today、Workout、Meal、Recovery、CoachSession、pending HITL、Working Memory 和 Action Log
- [ ] 高体脂减脂人物走通建档 → 多阶段计划 → 一天执行 → 第二天调整；偏瘦增肌与平台人物使用同一客户端能力和导航完成等价验收
- [ ] 真实 Android 路径跑通首次进入、规划、Today、Workout AI 监控、餐食、Recovery、Timeline、Action Log 和第二天计划
- [ ] 共享 TypeScript 领域、应用、projection 和 cards 保持 iOS 可编译和结构 parity，不写 Android 专属业务规则；HealthKit 不作为关闭条件
- [ ] 单一有界集成 suite 从 CoachApplication 公开 seam 验证完整闭环，失败能定位到用户场景而不是依赖全仓库长测试
- [ ] UI 验收比较原 Demo 的交互决策而非重新设计像素：除每日营养账本外没有新增导航、页面或视觉系统
- [ ] 发布报告逐条映射本规格 User Stories、六张新票、复用的旧实现、明确 deferred 项和仍不可用的 motion capability

## Comments

- 这是接线和验收票，不是 UI 重做票。
- 账号、同步、加密备份和 Health 平台不得成为验收依赖。
