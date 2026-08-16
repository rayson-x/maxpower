# 已归档视频：观察型 profile 回放

这是人工标注关键点 sidecar 的 in-sample 回放，不是重新运行 MediaPipe，也不是独立准确率或动作质量结论。

- 覆盖录像：11；可回放：8；无精确 profile：3
- 全部标注 rep：89；已有 profile 的机位标注 rep：73
- Rust 确认 rep：79；峰值匹配：60；匹配召回 82.2%；匹配精度 75.9%
- 另有待复核 outcome：21；拒绝 outcome：31

| 动作 × 机位 | 录像 | 标注 rep | 封装 rep | 峰值匹配 | 精确计数录像 | profile 来源 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| machine_chest_press / front | 3 | 21 | 21 | 17 | 1 | observed |
| barbell_bench_press / frontRight45 | 2 | 25 | 26 | 19 | 0 | observed |
| machine_chest_press / frontRight45 | 1 | 8 | 10 | 7 | 0 | observed |
| barbell_bench_press / front | 3 | 16 | 0 | 0 | 0 | unavailable |
| push_up / rearRight45 | 1 | 14 | 16 | 14 | 0 | observed |
| barbell_bench_press / frontLeft45 | 1 | 5 | 6 | 3 | 0 | observed |

## 结论

- 这些 profile 仍为 provisional；本报告是同批数据回放，只能证明链路可运行，不能当成独立准确率或生产发布结论。
- 三条正面杠铃卧推没有安装 profile：肩—肘—腕完整可见率仅约 14%–24%，低于当前骨架模型的可靠计数条件。录像与人工标签仍保留。
- 已安装的 45° 卧推和俯卧撑 profile 在遮挡机位使用近侧肘角；它们只支持动作确认/计数，不支持姿势质量或左右对称性判断。

## 逐段

- 1ffdb9483b96090c6caf40a2ca3e6c46: machine_chest_press/front · observed · 标注 9 / 预测 10 / 匹配 8
- 839e233f09acd809593551b125645bf7: barbell_bench_press/frontRight45 · observed · 标注 15 / 预测 12 / 匹配 10
- a3fc2037d42244565c2ffce9b2b0df24: machine_chest_press/frontRight45 · observed · 标注 8 / 预测 10 / 匹配 7
- a44741cba03352f1e689fd51276dfec5: barbell_bench_press/frontRight45 · observed · 标注 10 / 预测 14 / 匹配 9
- a51c8a692c2a5a5b40cda482065cc6d5: barbell_bench_press/front · unavailable · 标注 4 / 预测 — / 匹配 — · No exact observed, built-in, or simulated recognition profile for this context.
- b1af030833f8d7bfb61a55cfd76db4d8: machine_chest_press/front · observed · 标注 6 / 预测 5 / 匹配 4
- b8af1ab860d6bbb43cd3f2cadc71506c: barbell_bench_press/front · unavailable · 标注 8 / 预测 — / 匹配 — · No exact observed, built-in, or simulated recognition profile for this context.
- bc29e11c23f97a4b1ccaf321ba1e9db7: barbell_bench_press/front · unavailable · 标注 4 / 预测 — / 匹配 — · No exact observed, built-in, or simulated recognition profile for this context.
- cb71ee6302a7a378d75d1dcdf30cee6a: push_up/rearRight45 · observed · 标注 14 / 预测 16 / 匹配 14
- d8a6e62c017a63b0aa20493301147a47: machine_chest_press/front · observed · 标注 6 / 预测 6 / 匹配 5
- e963bc2e0819f5ef528561cc1260b7ef: barbell_bench_press/frontLeft45 · observed · 标注 5 / 预测 6 / 匹配 3
