# 动作 × 机位适配指南（基于单目伪 3D 实测结论）

日期：2026-08-07
依据：[[2026-08-07-monocular-3d-accuracy-validation]] 的实测数据 + 判别特征运动平面原则。

## 核心法则

**判别特征的运动方向与相机光轴越平行，识别越不可信**（实测偏差 10–35°）；运动在成像平面内则可信（实测 0.5–6°）。因此选机位 = 把动作的判别平面放进成像平面：

| 判别平面 | 推荐机位 | 实测可信度 |
|---|---|---|
| 矢状面（前后+垂直行程） | **正侧面** left/right | 高 |
| 额状面（横向+垂直行程） | **正前/正后** front/rear | 高 |
| 垂直轴主导 | 正前或正后均可（选遮挡少的） | 高 |
| 水平面旋转 | 任何单机位都困难 | **低，标 hypothesis** |

遮挡规则：
- 坐姿/卧姿器械（腿被挡）：机位以能拍到判别关节为先；
- 单侧动作：机位必须在**工作侧**（实测远侧 visibility < 0.25）；
- 45° 机位是"什么都看到一点、什么都不够准"的折中，适合辅助视角而非主评分视角。

## A 类：矢状面动作 → 主机位正侧面

| 动作 | 现配置 | 建议 | 说明 |
|---|---|---|---|
| bodyweight_squat | left | ✅ 保持 | |
| barbell_back_squat | left | ✅ 保持 | 深度、髋膝关系全靠侧面 |
| romanian_deadlift | left | ✅ 保持 | 铰链判别本体在纵深 |
| conventional_deadlift | left | ✅ 保持 | |
| hip_thrust | left | ✅ 保持 | |
| leg_press | left | ✅ 保持 | |
| leg_extension | left | ✅ 保持 | |
| leg_curl | left | ✅ 保持 | |
| calf_raise | left | ✅ 保持 | ⚠️ 行程仅数厘米，z 噪声同级，靠 2D 垂直分量 |
| straight_arm_pulldown | left | ✅ 保持 | |
| walking_lunge | frontLeft45 | 🔧 **改 left/right** | 步幅、膝前移是纵深；front 可作辅助看膝盖内扣 |
| bulgarian_split_squat | frontLeft45 | 🔧 **改 left/right** | 同上 |
| push_up | frontLeft45 | 🔧 **改 left/right** | 身体直线 + 肘角都在矢状面；实测 45° 机位肘角偏差 31°（划船同视角） |
| front_raise | frontLeft45 | 🔧 **改 left/right** | 手臂径直前抬，正面纯纵深，重灾区 |
| landmine_press | frontLeft45 | 🔧 **改 left/right** | 前上推举弧线在矢状面 |
| overhead_triceps_extension | frontLeft45 | 🔧 **改 left/right** | 前臂绕肘矢状面旋转 |
| skull_crusher | frontLeft45 | 🔧 **改 left/right** | 同上 |
| barbell_row | frontLeft45 | 🔧 **改 left/right** | 躯干前倾 + 杠铃轨迹在矢状面；front45 辅助看肘 |
| seated_row | frontLeft45 | 🔧 **改 left/right** | 实测斜侧面远侧丢失，机位朝向固定就拍靠相机侧 |
| chest_supported_row | frontLeft45 | 🔧 **改 left/right** | |
| barbell/dumbbell/hammer/cable_biceps_curl | frontLeft45 | 🔧 **改 left/right** | 肘屈伸在矢状面，正面前臂朝向相机=纵深重灾区 |
| overhead/bench 推举类（barbell_bench_press、dumbbell_bench_press、incline_dumbbell_press） | frontLeft45 | 🔧 **改 left/right 主机位** | 杠铃轨迹+肘角在矢状面；front45 保留看左右对称 |
| triceps_pushdown | frontLeft45 | ⚠️ 可保留，side 更准 | 肘伸展偏垂直，front45 勉强可用 |
| seated_shoulder_press | frontLeft45 | ⚠️ 可保留，side 备选 | |
| machine_chest_press | frontLeft45 | ⚠️ 可保留，side 备选 | 注意座椅遮挡 |

## B 类：额状面动作 → 主机位正前/正后

| 动作 | 现配置 | 建议 | 说明 |
|---|---|---|---|
| lateral_raise | front | ✅ 保持 | 额状面典范，实测可信区 |
| cable_y_raise | front | ✅ 保持 | |
| single_arm_cable_lateral_raise | frontLeft45 | 🔧 **改 front** | 纯额状面，45° 反而引入纵深误差 |
| cable_chest_fly | front | ✅ 保持 | 双腕横向间距 |
| side_step_touch | front | ✅ 保持 | |
| step_jack | front | ✅ 保持 | |
| rear_delt_fly | rearLeft45 | ✅ 保持 | 后斜 45° 兼看横向展开与纵深，合理折中 |
| rear_delt_row | rearLeft45 | ✅ 保持 | |

## C 类：垂直轴主导 → 正前/正后均可

| 动作 | 现配置 | 建议 | 说明 |
|---|---|---|---|
| pull_up | front | ✅ 保持 | 实测正/背面肘角 1.3°/4.6°，均可信 |
| assisted_pull_up | front | ✅ 保持 | |
| lat_pulldown | rear | ✅ 保持 | 后视看肩胛，实测可信 |
| wide_grip_lat_pulldown | rear | ✅ 保持 | |
| march_in_place | front | ✅ 保持 | |
| alternating_knee_raise | front | ✅ 保持 | |

## D 类：特殊（单机位先天困难 / 机位迁就工作侧）

| 动作 | 现配置 | 建议 | 说明 |
|---|---|---|---|
| cable_external_rotation | frontLeft45 | ⚠️ 保持但**降级为 hypothesis 级** | 前臂水平面旋转，任何单机位都只能看到投影 |
| face_pull | frontLeft45 | ✅ 保持 | front45 是现有条件下的合理折中 |
| one_arm_dumbbell_row | frontLeft45 | 🔧 **机位迁就到工作侧**（working-side front45 或 working-side side） | 远侧 visibility<0.25，拍非工作侧=没拍 |
| single_arm_cable_row | frontLeft45 | 🔧 同上 | |
| single_arm_cable_lateral_raise | （见 B 类） | 若用 side 机位同样须在工作侧 | |

## 汇总

- **保持不动：20 个**（A 类 10 个下肢/矢状 + B/C 类全部现成的）
- **建议改主机位：约 18 个**，集中在：弓步类、俯卧撑、前平举、推举类、划船类、弯举/臂屈伸类——共性是现配置 frontLeft45 而判别平面是矢状面
- **需"机位迁就工作侧"逻辑：2 个**单臂动作
- **建议显式降级：1 个**（cable_external_rotation）

落地建议：给模板加 `discriminativePlane: "sagittal" | "frontal" | "vertical" | "horizontal"` 元数据，机位推荐与 viewGating 降权逻辑都由它驱动，避免逐动作硬编码规则。
