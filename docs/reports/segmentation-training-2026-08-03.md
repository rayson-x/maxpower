# 人工逐 rep 数据：分段、计数与抗干扰训练报告

生成时间：2026-08-03T13:59:51.944Z

## 结论

已导入 39 组、375 个逐 rep 时间段。29 组可进入当前 profile 的独立评估，23 组可用于参数选择，14 组作为困难样本保留，10 组因结构问题隔离。完整审核声明产生 179 个非 rep 区间（共 427.4 秒），用于统计误触发。本次发布 0 个经留一组验证优于冻结基线的参数档案。

这些标签只训练分段、计数和抗干扰，不作为标准动作轨迹。

## 分桶结果

| 动作 | 实际机位 | 总组/rep | 干净调参组/rep | 困难组 | 冻结基线（精确组；MAE；FP/FN） | 留一组校准 |
| --- | --- | ---: | ---: | ---: | --- | --- |
| single_arm_cable_lateral_raise | front | 4 / 68 | 0 / 0 | 4 | — | 样本不足，只评估 |
| lateral_raise | front | 7 / 65 | 5 / 47 | 2 | 4/7；MAE 1.57；FP/FN 1/10；负区间误触 1 | 3/5；MAE 2.00；FP/FN 1/9；不发布 |
| rear_delt_fly | front | 4 / 50 | 0 / 0 | 3 | — | 样本不足，只评估 |
| seated_shoulder_press | front | 6 / 44 | 6 / 44 | 0 | 1/6；MAE 2.83；FP/FN 8/15；负区间误触 16 | 1/6；MAE 1.83；FP/FN 8/9；不发布 |
| barbell_row | rearRight45 | 2 / 21 | 1 / 12 | 1 | 1/1；MAE 0.00；FP/FN 2/2；负区间误触 2 | 样本不足，只评估 |
| lat_pulldown | rearLeft45 | 3 / 20 | 3 / 20 | 0 | 1/3；MAE 0.67；FP/FN 2/0；负区间误触 2 | 样本不足，只评估 |
| barbell_row | frontLeft45 | 2 / 16 | 1 / 6 | 1 | 1/2；MAE 2.50；FP/FN 1/6；负区间误触 1 | 样本不足，只评估 |
| straight_arm_pulldown | frontRight45 | 2 / 16 | 2 / 16 | 0 | 2/2；MAE 0.00；FP/FN 0/0；负区间误触 0 | 样本不足，只评估 |
| barbell_row | front | 1 / 10 | 0 / 0 | 1 | 0/1；MAE 3.00；FP/FN 3/0；负区间误触 3 | 样本不足，只评估 |
| barbell_row | frontRight45 | 1 / 10 | 1 / 10 | 0 | 0/1；MAE 3.00；FP/FN 3/0；负区间误触 3 | 样本不足，只评估 |
| barbell_row | rearLeft45 | 1 / 10 | 1 / 10 | 0 | 0/1；MAE 1.00；FP/FN 0/1；负区间误触 0 | 样本不足，只评估 |
| seated_row | rearLeft45 | 1 / 10 | 0 / 0 | 1 | 0/1；MAE 2.00；FP/FN 2/0；负区间误触 2 | 样本不足，只评估 |
| lat_pulldown | rear | 1 / 8 | 1 / 8 | 0 | 1/1；MAE 0.00；FP/FN 0/0；负区间误触 0 | 样本不足，只评估 |
| straight_arm_pulldown | frontLeft45 | 1 / 8 | 1 / 8 | 0 | 1/1；MAE 0.00；FP/FN 2/2；负区间误触 1 | 样本不足，只评估 |
| seated_row | frontLeft45 | 1 / 6 | 1 / 6 | 0 | 0/1；MAE 1.00；FP/FN 1/0；负区间误触 1 | 样本不足，只评估 |
| pull_up | rearLeft45 | 1 / 5 | 0 / 0 | 1 | 0/1；MAE 1.00；FP/FN 1/0；负区间误触 1 | 样本不足，只评估 |

## 隔离样本

| Capture | 动作 | 原因 |
| --- | --- | --- |
| capture-001 | barbell_row | count_boundary_mismatch, low_rep_signal_coverage |
| capture-002 | 未标 | missing_exercise, missing_kinematics_profile |
| capture-003 | rear_delt_fly | unsupported_profile_view |
| capture-004 | rear_delt_fly | unsupported_profile_view |
| capture-005 | rear_delt_fly | unsupported_profile_view |
| capture-006 | rear_delt_fly | unsupported_profile_view, low_rep_signal_coverage |
| capture-007 | single_arm_cable_lateral_raise | missing_kinematics_profile |
| capture-008 | single_arm_cable_lateral_raise | missing_kinematics_profile |
| capture-009 | single_arm_cable_lateral_raise | missing_kinematics_profile |
| capture-010 | single_arm_cable_lateral_raise | missing_kinematics_profile |

## 使用边界

- 有备注的力竭、遮挡、机位变化和低覆盖录像作为 challenge set，不参与阈值选择。
- 只有用户声明整段视频已审核时，rep 以外的区间才作为抗干扰负样本。
- 每个动作与实际机位单独分桶，不跨机位合并参数。
- 未通过 capture-level 留一验证的参数不会进入客户端。
