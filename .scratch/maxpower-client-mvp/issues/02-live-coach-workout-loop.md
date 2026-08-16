# 02 — AI 监控训练到组间与后续训练调整

**What to build:** 从既有 Today/Workout UI 开始或恢复真实 WorkoutSession。用户可在普通记录与 AI 教练监控间切换；摄像头 Input Stream 只进入 Rust Motion SDK，客户端渲染同一 CanonicalMotionOutput。每组结束后将可信动作观察与用户确认的重量、次数、RIR 和疼痛结合，生成下一组或剩余训练调整，训练结束后形成 SessionOutcome、训练日报和下一次训练反馈。

**Blocked by:** 01 — 用户档案到长期策略、周计划与今日计划

**Status:** wontfix

- [ ] 开始实施前盘点现有 Workout、Motion、Agent stream 和 UI 的公开行为，仅补公开闭环缺口
- [ ] Today 从 active SessionPrescription 创建或恢复唯一 WorkoutSession，并保存所依据的 GoalCycle/PlanRevision/phase refs
- [ ] 用户可选择仅记录或 AI 教练监控；拒绝相机权限不阻止训练
- [ ] 用户可在任意安全边界进入或退出监控，切换不复制 WorkoutSession、Set 或 task-scoped CoachSession
- [ ] 监控前提供当前 ExerciseVariant × view 所需的镜头、距离、方向和人体入框引导
- [ ] 客户端只提交 versioned CameraFrameInput stream 给 Rust Motion SDK，并处理权限、镜头、预览、orientation、mirroring、frame lifecycle 和 bounded latest-frame/backpressure
- [ ] Kotlin、Swift 和 TypeScript 不拥有并行 pose inference、骨架规范化、点位修补、镜像推测、计次、phase 或动作分析真值
- [ ] Rust SDK 输出同一 lineage 的 SkeletonPoint、profile/capability identity、CanonicalPacket、phase、rep disposition、tempo、允许的 observation findings 和 set lifecycle
- [ ] 当前动作明确显示 count、phase、ROM、tempo、trajectory、cue 中实际启用与不支持的能力
- [ ] 只有 exact action × variation × equipment × view × pose model × native bridge capability 能开启对应监控；目录或相似名称不能授权
- [ ] Live cue 采用优先级、去重和 cooldown，同一时刻至多展示一个主要提示；原始 frame/tool delta 不进入事实层
- [ ] 无 exact profile、低置信度、关键点丢失、人体离开或 lifecycle reset 时停止具体判断并降级手工记录
- [ ] `finish_set` 生成不可变 Canonical Set Observation，骨架显示、计次、持久化、训练日报和 Coach 使用同一 evidence ref
- [ ] ConfirmedRep 才计入 camera-confirmed 正式训练量；NeedsReview 在用户确认前排除；Rejected 永不计入
- [ ] 每组结束后用户可确认或修改实际 load、reps、RIR/RPE、疼痛、完成状态和备注
- [ ] SetAssessment 合并 canonical observation、用户输入、exact ExerciseVariant 历史、当前 TrainingStrategy、RecoveryConstraint 和器材档位
- [ ] 骨架或 LLM 不推断重量、RIR、疼痛原因、肌肉激活、伤害风险或不可见 3D 状态
- [ ] 当前 set 开始后 prescription 冻结；普通修改只作用于下一未开始 set、rest、remaining set count、未开始动作、顺序或安全替代
- [ ] NextSetAdjustment 可以提出 keep、increase_load、increase_reps、increase_sets、reduce_load、reduce_volume、extend_rest、substitute 或 stop，并显示 before/after、原因、证据、未知和影响范围
- [ ] 增肌规则根据动作质量、目标次数区间、RIR、可比较表现、器材最小档位、周刺激和恢复决定先加次数、重量还是组数
- [ ] 减脂规则优先保留主项相对强度和有效刺激，恢复下降时先审查辅助量、赤字、训练日供能和休息，不编码“减脂必须冲重量”
- [ ] 徒手进阶使用次数、节奏、停顿、ROM 和版本化难度图，不进行虚假公斤等价换算
- [ ] 用户按 CoachingMandate 接受、修改或忽略普通调整；疼痛/安全停止不能被 managed 模式绕过
- [ ] 训练中可新增、删除、修改、排序或平替尚未执行的动作，并继续在监控页面展开 Coach Drawer 对话
- [ ] paused、completed、partial、skipped 和 abandoned 都形成明确 SessionOutcome，已完成 SetOutcome 不被计划或 observation 覆盖
- [ ] 训练日报展示处方与实际、动作证据覆盖、Agent 调整、用户决定、训练趋势影响和下一步
- [ ] SessionOutcome 进入 Timeline 和 training_trend，并只在足够证据下影响下次 Session 或周期复核
- [ ] 重启后恢复同一未完成 Workout、已完成组、下一组、监控降级状态和 task-scoped CoachSession
- [ ] 至少一个真实 validated-analysis exact profile 跑通 CameraInputStream → Rust SDK → skeleton/rep/observation → SetAssessment → next-set adjustment → SessionOutcome
- [ ] Android/iOS Motion adapter contract 使用相同 frame/capability fixture 得到结构等价 canonical output；不得用静态骨架 Mock 代替产品验收
- [ ] CoachApplication 高层场景证明 planned、performed、observed 和 recommended 始终分离，并且 apply/undo 全部进入 Action Log

## Comments

- 沿用原 Workout 与摄像头 UI；本票新增的是真实数据闭环，不是页面重做。
- 其他未验证动作必须诚实降级为计数、记录或不可用。
