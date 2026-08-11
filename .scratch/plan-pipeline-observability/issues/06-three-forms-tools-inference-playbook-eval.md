# 06 — 三形态工具面 + 水平推断 + 场景 playbook eval

**What to build:** agent 的三种动作形态有真工具可用：① 代为操作——nutrition.record_observation（对话里记录饮食）、plan.substitute_exercise（引擎校验刺激等价后替换动作、负荷不复制）、workout.report_set（对话中报组）；② 主动提案——realtime 基于实测偏差的后续组调整建议（确认才应用）；③ 场景升级——plan.trigger_replan_with_context（"状态没变化/反弹"被结构化成重排上下文，进入规划流程出调整或阶段切换提案）。定制行为与早期表现沉淀为个人知识层水平推断条目（system_inference，带置信度与证据窗，永不直接改规则）。每个场景的 playbook（意图路由表+组合规则）进 system prompt 并版本化；建立 eval 门槛：意图→工具序列→落账状态的断言集在 CI 确定性通过（ScriptedLLMProvider），能力不达标不上线。

**Blocked by:** 02. 数据断桥修复与重排语义; 04. PlannerTrace + 首课计划 Proposal 化

**Status:** ready-for-agent

- [ ] "帮我记录吃了X" → draft 卡片 → 确认 → Timeline 落账（全链路 trace）
- [ ] "把A换成B" → 先查动作库存在与刺激等价 → 替换提案 → 确认 → 新负荷不复制旧负荷
- [ ] realtime 偏差证据 → 后续组调整提案（冻结当前组；周结构问题挂起至训练后）
- [ ] "状态没变化" → 结构化上下文触发 replan → 调整/阶段切换提案 → 确认生效
- [ ] 定制+早期表现 → system_inference 条目（置信度+证据窗+来源事实链）
- [ ] 每场景 playbook 进 prompt 且版本钉入 run manifest
- [ ] eval 集：三形态意图路由 + 拒答边界 + 禁止声称 ≥20 例，CI 确定性通过才启用新工具
