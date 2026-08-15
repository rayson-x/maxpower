# 08 — 恢复受治理的冻结回放并执行 v0.1b 验收

**What to build:** 以不可变、受训练数据治理验证的输入运行 Ticket 06 的识别率验收，输出仅本地保存的 action×view 回归报告。

**Blocked by:** `maxpower-training-data-governance` 的 `npm run audit` 当前失败：已登记资产 `visual-recognition-v0-1-known-video-baseline-report` 指向的 `docs/reports/visual-recognition-v0.1-baseline-2026-08-15.json` 缺失或不可读取。依据数据治理规则，在 audit 恢复前不得消费或重跑视频评测。

**Status:** blocked

## Required recovery

- [ ] 恢复或按治理流程替换缺失的冻结基线报告资产、哈希与 catalog 引用；`npm run audit` 必须通过。
- [ ] 确认 replay 使用的每个字段都能解析至 asset ID 和 admission 状态；不得把逐 capture 输出提交到仓库。
- [ ] 运行 v0.1b immutable replay，保留 raw proposal、Confirmed-only、Confirmed+NeedsReview、FP/FN、边界与 negative-window 指标的 action×view 细目。
- [ ] 报告明确标注为 known-video deterministic regression；不输出跨用户/设备/机位泛化或质量准确率结论。

## Expected handoff

Ticket 06 的实现可以完成报告 schema 和 aggregation；本 ticket 是唯一允许作出数值识别率结论的验收点。若 audit 恢复后仍缺 held-out participant/source/session/device/view 隔离数据，应另开 held-out acceptance，不得用 known-video 替代。
