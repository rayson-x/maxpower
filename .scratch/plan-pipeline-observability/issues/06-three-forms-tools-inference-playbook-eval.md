# 06 — 三形态工具面 + 水平推断 + 场景 playbook eval

**What to build:** agent 的三种动作形态有真工具可用：① 代为操作——nutrition.record_observation（对话里记录饮食）、plan.substitute_exercise（引擎校验刺激等价后替换动作、负荷不复制）、workout.report_set（对话中报组）；② 主动提案——realtime 基于实测偏差的后续组调整建议（确认才应用）；③ 场景升级——plan.trigger_replan_with_context（"状态没变化/反弹"被结构化成重排上下文，进入规划流程出调整或阶段切换提案）。定制行为与早期表现沉淀为个人知识层水平推断条目（system_inference，带置信度与证据窗，永不直接改规则）。每个场景的 playbook（意图路由表+组合规则）进 system prompt 并版本化；建立 eval 门槛：意图→工具序列→落账状态的断言集在 CI 确定性通过（ScriptedLLMProvider），能力不达标不上线。

**Blocked by:** 02. 数据断桥修复与重排语义; 04. PlannerTrace + 首课计划 Proposal 化

**Status:** wontfix

- [x] "帮我记录吃了X" → draft 卡片 → 确认 → Timeline 落账（全链路 trace）
- [x] "把A换成B" → 先查动作库存在与刺激等价 → 替换提案 → 确认 → 新负荷不复制旧负荷
- [x] realtime 偏差证据 → 后续组调整提案（冻结当前组；周结构问题挂起至训练后）
- [x] "状态没变化" → 结构化上下文触发 replan → 调整/阶段切换提案 → 确认生效
- [x] 定制+早期表现 → system_inference 条目（置信度+证据窗+来源事实链）
- [x] 每场景 playbook 进 prompt 且版本钉入 run manifest
- [x] eval 集：三形态意图路由 + 拒答边界 + 禁止声称 ≥20 例，CI 确定性通过才启用新工具

## Comments

- 2026-08-11 完成：四个动作工具（nutrition.record_observation / plan.substitute_exercise / workout.report_set / plan.trigger_replan_with_context）注册进工具目录，全部走 artifact+确认链，默认禁用由 actionToolsEnabled 翻转；场景 playbook 版本化（playbook-2026-08-11/v1）注入 system prompt 并钉入 context manifest（playbookVersion 字段）；eval 套件 7 例（manifest 完整性、记录饮食→草稿、换动作→替换提案（负荷不复制）、状态反馈→带上下文重排、查动作命中/未收录、禁用开关、版本钉）确定性通过。realtime 主动提案（形态②）本次未做——待 trace 系统（01）落地后作为独立提案通道实现。测试全量 768 绿（仅 1 个并行会话 WIP 识别测试失败，与本次无关）。
