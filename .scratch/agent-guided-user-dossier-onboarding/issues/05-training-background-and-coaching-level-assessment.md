# 05 — Training background 与 Coaching level assessment

**What to build:** 新建档流程不再让用户自选 beginner/intermediate/advanced；Agent 从可追溯的训练背景和近期表现中形成多维、版本化的 Coaching level assessment，并让用户能够理解和纠正其事实依据。

**Blocked by:** 04 — Agent 动态表单与行动门槛

**Status:** wontfix

- [ ] 新建档流程不展示或要求用户选择训练等级，旧 `trainingExperience` 不作为新捕获事实。
- [ ] Training background 分别保存累计训练时间范围、近期连续性/停训、近期分化、exact exercise familiarity、可比训练组、训练环境、器械、日程和执行情况。
- [ ] Coaching level assessment 分别评估训练编排理解、动作熟悉度、当前可比表现、训练连续性、自我调节和执行稳定性，并为每项保留支持证据、反证、unknown、评估时间、适用范围和复核条件。
- [ ] 术语熟练度或训练年限不能单独提升等级；unknown 不自动等于 novice，assessment 不写成 User Profile 事实。
- [ ] 用户已说明近期四分化和深蹲 100×3、卧推 80×5、硬拉 110×4 后，不再收到“你是什么水平”的问题，也不被评估为普通无经验新手；exact variant、RIR 和连续性仅在会改变当前决策时追问。
- [ ] Assessment 作为新制品与旧等级读取并存但保持清晰优先级，为后续 Planner 迁移提供稳定契约；本票不删除旧字段。
- [ ] 用户修正原始训练事实后产生新 assessment revision，旧事实和旧 assessment 仍可回放。
