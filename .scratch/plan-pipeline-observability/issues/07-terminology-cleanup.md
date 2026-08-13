# 07 — 术语清理："处方" → "训练计划"

**What to build:** 全库"处方/prescription"语义改为正常"训练计划"语言。注释、文档、用户可见文本立即清理；类型级改名走 expand-contract：先加新名（别名并行，旧名不破坏），分批迁移调用点（每批 CI 全绿），最后删除旧名。

**Blocked by:** None — can start immediately.

**Status:** done

- [x] 用户可见文本与注释不再出现"处方"语义（统一为训练计划/安排）
- [x] 类型改名按 expand-contract 完成（新别名 → 分批迁移 → 删旧名），全程 CI 绿色
- [x] 领域词汇表（CONTEXT.md 与设计文档）同步更新

## Comments

- 类型级 expand-contract 已完成（新别名并行 → 迁移全部调用点 → 删旧名，每一步 tsc 绿）：
  `ExerciseSetPrescription → PlannedExerciseSet`、`ExerciseTaskPrescription → PlannedExerciseTask`、
  `SessionPrescriptionData → PlannedSessionData`、`PrescriptionRef → PlannedSessionRef`、
  `UpcomingWorkoutPrescriptionChange → UpcomingWorkoutPlanChange`、
  `ApplyUpcomingWorkoutPrescriptionChangeInput → ApplyUpcomingWorkoutPlanChangeInput`、
  `AppliedUpcomingWorkoutPrescriptionChange → AppliedUpcomingWorkoutPlanChange`、
  `applyUpcomingWorkoutPrescriptionChange → applyUpcomingWorkoutPlanChange`、
  `assertOnlyUpcomingPrescriptionChanged → assertOnlyUpcomingPlannedSessionChanged`、
  `CoachApplication.reviseUpcomingWorkoutPrescription/editUpcomingWorkoutPrescription → …WorkoutPlan`；
  文件 `UpcomingWorkoutPrescriptionEditor.ts → UpcomingWorkoutPlanEditor.ts`、
  测试 `rirRangePrescription.test.ts → rirRangeTargets.test.ts`。
- 注释、测试名、设计文档、wiki、首页原型的用户可见文案里的「处方」已换成训练计划/安排语言。
  研究报告与 MISSION 里指临床/康复语义的「处方」保留原义（那是它本来的意思）。
- CONTEXT.md 词汇表补了新类型名，并新增一条 **Ledger wire names**。

**范围决定（需要时另开 ticket）**：已落账的 DomainEvent 名与 payload 键
（`workout.prescription_revised`、`prescriptionRef`、`frozenPrescription`、`prescriptionSetId`、`prescriptionMode`）
保持不变。它们是既成事实的存储标识，改名等于改历史事件与 outbox payloadHash，
要配套账本 schema 迁移与云端协同，不在「类型级改名」的范围内。CONTEXT.md 已把这条边界写进词汇表。
