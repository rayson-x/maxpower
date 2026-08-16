# Rust Motion SDK canonical sidecar 兼容性评估

生成时间：2026-08-07T19:56:56.973Z

## 结论

本次只评估 Rust V1 已实现且机位 identity 精确匹配的 profile（高位下拉、坐姿推肩），覆盖 10/39 组。promotion **未通过**；未通过时继续显示 provisional，qualityVerdict 保持 null。

> 本报告输入是历史 canonical sidecar，不是原始 MediaPipe observation；它只能验证 rep-engine 兼容性，不能声明 MediaPipe→Rust 端到端准确率。实时录像重新推理必须单独报告。

|范围|组数|真值 rep|Raw trigger|Rust sealed|Precision|Recall|F1|Exact count|Raw/产品负窗 FP|
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
|全部支持动作|10|72|76|34|94.1%|44.4%|60.4%|20.0%|17/1|
|Held-out|3|22|26|17|94.1%|72.7%|82.1%|33.3%|4/0|
|Challenge|1|6|9|0|0.0%|0.0%|0.0%|0.0%|3/0|

## 边界

- 39 组、375 个人工 rep 区间、179 个已审核负窗口用于定义总体数据范围；Rust 尚未实现的动作不被伪装成失败或成功。
- 拆分按 capture ID 固定哈希完成，同一录像不会跨集合泄漏。
- 每组同时保留 TS 数量、Rust 数量、人工真值与首次边界分叉；raw trigger 与 sealed 产品结果分开统计。
- 这些标注只验证分段、计数与抗干扰，不是标准姿势轨迹真值。
- 重放同一录像只用于确定性验证，不增加样本量。

## 逐组差异

|Capture|动作|机位|Profile|人工|TS|Raw|Rust sealed|首次 Rust/人工分叉 ms|
|---|---|---|---|---:|---:|---:|---:|---:|
|field-capture-2026-08-02T18-41-05-284Z|lat_pulldown|rear|lat-pulldown/rear/bilateral/cable/v1|8|8|9|7|4748|
|field-capture-2026-08-02T18-41-55-780Z|lat_pulldown|rearLeft45|lat-pulldown/rear-left-45/bilateral/cable/v1|8|9|10|8|4466|
|field-capture-2026-08-02T18-44-00-128Z|lat_pulldown|rearLeft45|lat-pulldown/rear-left-45/bilateral/cable/v1|6|6|9|0|6526|
|field-capture-2026-08-02T18-46-52-295Z|lat_pulldown|rearLeft45|lat-pulldown/rear-left-45/bilateral/cable/v1|6|7|8|6|5573|
|field-capture-2026-08-03T07-57-28-214Z|seated_shoulder_press|front|seated-shoulder-press/front/bilateral/dumbbell/v1|12|14|13|3|1334|
|field-capture-2026-08-03T07-59-35-213Z|seated_shoulder_press|front|seated-shoulder-press/front/bilateral/dumbbell/v1|6|7|7|2|5046|
|field-capture-2026-08-03T08-04-11-681Z|seated_shoulder_press|front|seated-shoulder-press/front/bilateral/dumbbell/v1|5|6|2|0|6949|
|field-capture-2026-08-03T08-09-44-714Z|seated_shoulder_press|front|seated-shoulder-press/front/bilateral/dumbbell/v1|3|3|1|0|9816|
|field-capture-2026-08-03T08-15-35-147Z|seated_shoulder_press|front|seated-shoulder-press/front/bilateral/dumbbell/v1|8|10|1|0|6472|
|field-capture-2026-08-03T09-03-30-328Z|seated_shoulder_press|front|seated-shoulder-press/front/bilateral/dumbbell/v1|10|1|16|8|3349|
