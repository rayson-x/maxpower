# 05 — 个人知识层骨架

**What to build:** 新增个人知识层模块：四类条目（observed_calibration / user_preference / system_inference / unknown）的类型模型，每条带 provenance（sourceFactRefs、证据窗、置信度）；CAS 读写接口与 forget/supersede 生命周期；Timeline correction event 使依赖条目失效的钩子。本轮不接任何引擎消费者。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 四类条目可写入、读取、supersede、forget，CAS 冲突抛 typed error
- [ ] system_inference 条目强制带置信度与证据窗，unknown 条目禁止携带数值
- [ ] correction event 使引用被更正事实的条目失效（重建钩子存在且有测试）
- [ ] 全库无引擎/工具引用该模块的断言（接线检查）
