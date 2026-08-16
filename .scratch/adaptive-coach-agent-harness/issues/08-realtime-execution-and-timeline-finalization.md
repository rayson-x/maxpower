# 08 — 实时训练闭环与 Timeline 最终沉淀

**What to build:** 用户在训练中获得基于 Canonical packet 的即时动作/下一组建议；只有最终确认的实际训练剂量和有长期意义结果写入 Timeline，并影响恢复与风险。

**Blocked by:** 03 — TimelineChanged 风险触发与定时检查; 04 — 减脂目标合同与基础风险状态.

**Status:** wontfix

- [ ] Observation、LiveSessionState 和 Timeline fact 三层隔离；低置信或丢弃的提示不影响长期历史。
- [ ] 稳定证据可产生限频的当前动作、休息、下一组或安全暂停建议，且不创建第二套 rep/phase truth。
- [ ] 最终训练剂量偏离计划时生成带 provenance 的 Timeline fact，并由正常风险链评估未来影响。
