# 已归档视频：观察型 profile 回放

这是人工标注关键点 sidecar 的 in-sample 回放，不是重新运行 MediaPipe，也不是独立准确率或动作质量结论。

- 覆盖录像：24；可回放：21；无精确 profile：3
- 标注 rep：204；Rust 封装 rep：153；峰值匹配：128

| 动作 × 机位 | 录像 | 标注 rep | 封装 rep | 峰值匹配 | 精确计数录像 | profile 来源 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| barbell_row|rearRight45 | 2 | 21 | 0 | 0 | 0 | unavailable |
| barbell_row|front | 1 | 10 | 11 | 10 | 0 | observed |
| barbell_row|frontRight45 | 1 | 10 | 2 | 2 | 0 | simulated |
| barbell_row|rearLeft45 | 1 | 10 | 0 | 0 | 0 | unavailable |
| barbell_row|frontLeft45 | 2 | 16 | 14 | 13 | 0 | observed |
| lat_pulldown|rear | 1 | 8 | 7 | 7 | 0 | observed |
| lat_pulldown|rearLeft45 | 3 | 20 | 12 | 12 | 0 | observed |
| seated_shoulder_press|front | 6 | 44 | 58 | 35 | 1 | observed |
| lateral_raise|front | 7 | 65 | 49 | 49 | 0 | observed |

## 逐段

- field-capture-2026-08-02T18-16-42-757Z: barbell_row/rearRight45 · unavailable · 标注 12 / 预测 — / 匹配 — · No exact observed, built-in, or simulated recognition profile for this context.
- field-capture-2026-08-02T18-19-26-633Z: barbell_row/rearRight45 · unavailable · 标注 9 / 预测 — / 匹配 — · No exact observed, built-in, or simulated recognition profile for this context.
- field-capture-2026-08-02T18-24-38-253Z: barbell_row/front · observed · 标注 10 / 预测 11 / 匹配 10
- field-capture-2026-08-02T18-26-54-722Z: barbell_row/frontRight45 · simulated · 标注 10 / 预测 2 / 匹配 2
- field-capture-2026-08-02T18-30-30-478Z: barbell_row/rearLeft45 · unavailable · 标注 10 / 预测 — / 匹配 — · No exact observed, built-in, or simulated recognition profile for this context.
- field-capture-2026-08-02T18-34-19-006Z: barbell_row/frontLeft45 · observed · 标注 10 / 预测 11 / 匹配 10
- field-capture-2026-08-02T18-37-19-691Z: barbell_row/frontLeft45 · observed · 标注 6 / 预测 3 / 匹配 3
- field-capture-2026-08-02T18-41-05-284Z: lat_pulldown/rear · observed · 标注 8 / 预测 7 / 匹配 7
- field-capture-2026-08-02T18-41-55-780Z: lat_pulldown/rearLeft45 · observed · 标注 8 / 预测 4 / 匹配 4
- field-capture-2026-08-02T18-44-00-128Z: lat_pulldown/rearLeft45 · observed · 标注 6 / 预测 4 / 匹配 4
- field-capture-2026-08-02T18-46-52-295Z: lat_pulldown/rearLeft45 · observed · 标注 6 / 预测 4 / 匹配 4
- field-capture-2026-08-03T07-57-28-214Z: seated_shoulder_press/front · observed · 标注 12 / 预测 12 / 匹配 10
- field-capture-2026-08-03T07-59-35-213Z: seated_shoulder_press/front · observed · 标注 6 / 预测 9 / 匹配 4
- field-capture-2026-08-03T08-04-11-681Z: seated_shoulder_press/front · observed · 标注 5 / 预测 10 / 匹配 5
- field-capture-2026-08-03T08-09-44-714Z: seated_shoulder_press/front · observed · 标注 3 / 预测 5 / 匹配 3
- field-capture-2026-08-03T08-15-35-147Z: seated_shoulder_press/front · observed · 标注 8 / 预测 10 / 匹配 5
- field-capture-2026-08-03T08-22-48-938Z: lateral_raise/front · observed · 标注 8 / 预测 7 / 匹配 7
- field-capture-2026-08-03T08-24-48-386Z: lateral_raise/front · observed · 标注 10 / 预测 8 / 匹配 8
- field-capture-2026-08-03T08-27-17-330Z: lateral_raise/front · observed · 标注 7 / 预测 6 / 匹配 6
- field-capture-2026-08-03T08-30-12-186Z: lateral_raise/front · observed · 标注 10 / 预测 6 / 匹配 6
- field-capture-2026-08-03T08-34-27-223Z: lateral_raise/front · observed · 标注 12 / 预测 9 / 匹配 9
- field-capture-2026-08-03T08-36-58-723Z: lateral_raise/front · observed · 标注 10 / 预测 8 / 匹配 8
- field-capture-2026-08-03T08-38-55-907Z: lateral_raise/front · observed · 标注 8 / 预测 5 / 匹配 5
- field-capture-2026-08-03T09-03-30-328Z: seated_shoulder_press/front · observed · 标注 10 / 预测 12 / 匹配 8
