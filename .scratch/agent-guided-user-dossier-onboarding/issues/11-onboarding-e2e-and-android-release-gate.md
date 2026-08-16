# 11 — 完整 E2E 与 Android 真机发布门

**What to build:** 用一个可回放的最高层 Agent Harness 场景和真实 Android 客户端，证明新用户能够从登录完成对话式建档、自动水平评估、档案确认、首次计划生成和独立确认；真实设备只请求正式云服务，不依赖开发机本地服务器。

**Blocked by:** 10 — 移除旧固定建档与训练等级 fallback

**Status:** wontfix

- [ ] 确定性 E2E 从空档案登录开始，走完问候、四项 Baseline intake、自然语言捕获、动态表单、assessment/readiness、摘要确认、ProductData acknowledgement、Planner proposal 和计划确认。
- [ ] 卡片输入、自然语言输入和混合输入对相同明确事实形成等价领域结果，同时保留不同来源审计。
- [ ] 固定回放至少覆盖稳定有经验用户、近期回归用户、信息稀少新手、字段冲突、explicit unknown、安全门控、云端失败恢复和 stale proposal。
- [ ] 动态表单 E2E 覆盖文本、数字+单位、单选、多选、分段/滑动、日期时间和复合训练记录；验证控件由 Field Catalog 决定且数据往返不丢精度、unknown 或来源。
- [ ] 行为审计可从首次活动计划回溯到字段来源、表单选择原因、assessment、readiness、知识/规则版本、工具结果、两次用户确认和持久化 acknowledgement，且不包含 Chain of Thought。
- [ ] Android 真机使用真实账号、真实云 LLM Gateway 和正式 ProductData origin 完成同一流程；安装包默认配置不访问 localhost、局域网开发服务器或开发机端口。
- [ ] 真机覆盖首次安装、登录、键盘填写、卡片选择/滑动、退到后台、杀进程恢复、档案确认、计划展示与确认，并保存可复核的客户端日志或截图证据。
- [ ] 只有确定性 E2E、客户端集成测试和真机流程全部通过，才允许把新建档流程视为可发布。
