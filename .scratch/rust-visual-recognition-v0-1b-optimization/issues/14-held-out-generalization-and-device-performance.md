# 14 — Held-out 泛化与端上性能集中验收

**What to build:** 在新参与者、新 source/session、设备和机位隔离数据上验收正式识别率，并在代表性 Web/Android/iOS 本地运行环境测量端到端性能。

**Blocked by:** 当前 known-video 是同一已知回归集，不具备 participant/source/session/device/view 隔离；也没有本轮代表性移动设备热稳态运行记录。缺的是新数据与验收环境，不是 Rust 结构实现。

**Status:** blocked-by-data-and-device-evidence

## Acceptance

- [ ] 冻结 held-out cohort、matcher、负窗口、指标和输入/runtime hashes；训练或调参过程不能读取评估切分。
- [ ] 按 action×view 报告 Confirmed-only Precision/Recall、exact-set、FP/FN、边界和负窗口误触发。
- [ ] 分别测量 pose input、equipment detector、tracker、local coordinate、fusion、Rep 的有效 cadence、evidence age、p50/p95/p99、drop、内存和热稳态。
- [ ] Known-video 结果只作为 deterministic regression；只有本票据可以形成跨用户/设备/机位的正式泛化声明。
