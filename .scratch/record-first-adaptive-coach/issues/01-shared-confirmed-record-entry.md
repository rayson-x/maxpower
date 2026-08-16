# 01 — 用户手动或由 Coach 代填同一份可信 Record

**What to build:** 用户通过结构化表单或文本 Coach 记录同一件饮食、身体、活动、睡眠或恢复事实时，使用同一份 Record draft、业务校验、确认和 Timeline admission。Coach 只转录用户在当前文本中明确提供的字段；饮食营养数值必须经过共享表单确认，缺失字段保持 unknown。

**Blocked by:** None — can start immediately.

**Status:** completed

## Existing foundation and required change

- 保留现有 Timeline append、correction、provenance、confidence、source mutation、幂等和审计语义；这些是正式基础，不重建。
- 保留符合新语义的手动入口、typed tool 和 Timeline command；手动与 Coach 必须在业务校验前收敛到唯一 Draft。
- 直接删除 Nutrition observation/estimate provider、图片或远程识别、模型营养估算、`llm_estimate` provenance、估算确认页及其生产接线，不保留关闭开关或兼容 Adapter。
- 保留一个来源无关的正式 Record admission 接口，使未来已经 finalized 且确认的 Workout Record 可以进入 Timeline；本 ticket 不实现或测试任何 Realtime Agent、相机或动作识别能力。

## Acceptance criteria

- [x] 手动与文本 Coach 记录相同的饮食、身体、活动、睡眠和恢复事实时，产生业务等价且来源可区分的 canonical Record。
- [x] Coach 只能把当前用户明确陈述的字段填入共享 Draft，不得根据名称、份量、上下文或通用知识补充营养数值。
- [x] Coach 代填的饮食营养数值始终先展示可编辑表单并由用户确认；Coaching mandate 不得授权模型生成或静默提交营养数值。
- [x] 允许只记录食物描述、餐次和份量；未提供的热量、宏量和微量营养字段保持 unknown。
- [x] 明确且获授权的非营养低风险事实可以直接提交，并返回可更正的事实回执。
- [x] 补录和修正追加 CorrectionEvent，不覆盖原始事实；重试、失败和 stale 不重复提交。
- [x] V1 正式入口不接受图片、音频、视频、OCR、条码、食物数据库或模型营养估算结果。
- [x] knowledge search 和其他通用工具不能绕过来源校验回填食物营养字段。
- [x] 默认 CoachApplication 与真实手动/文本入口覆盖确认、unknown、直接执行、修正、失败和重放场景。
- [x] 全部正式调用方迁移后删除被替代的 Draft、provider、transport、vision、estimate、handler、export 和测试；仓库不存在 compat、fallback 或双写路径。
