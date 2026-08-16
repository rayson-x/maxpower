# 五分化模拟轨迹先验：采集、审核与校准工作流

日期：2026-08-04  
状态：可执行的 `simulated_kinematic_prior` 工作流；不含“标准动作”结论。

## 交付边界

五个肌群（胸、背、腿、肩、手臂）的动作目录均有一个 32 节点（去程 16 + 回程 16）的相位方向模板。模板只描述“哪些可观察特征应在动作极值前后反向”，用于启动分段、合成抗噪测试和采集规划；它没有角度目标、人体标准轨迹或姿势评分。

每一条真实轨迹的 identity 必须完全匹配：`exerciseId`、`variation`、`equipment`、`capturePosition`、`trainingSide`、`coordinateSystem`、`poseModelVersion`。不匹配时创建新 profile，不做平均或迁移。

## 明日腿部训练：最小可用采集

优先录制你实际会做的动作，而不是为了填满目录临时增加动作。每个动作先完成一个主机位组即可。

| 动作 | 建议主机位 | 校准 capture | 同 identity 留出验证 |
|---|---|---|---|
| 杠铃深蹲 / 徒手深蹲 | 左侧（或右侧） | 8 个连续、完整 rep | 相同机位、设置与工作侧另录 6 rep |
| 腿举 | 左侧 | 8 个完整 rep，保留踏板与靠背 | 相同机位、踏板/靠背与足位另录 6 rep |
| 罗马尼亚硬拉 | 左侧 | 8 个完整 rep，躯干与髋全程入镜 | 相同机位、器械与站距另录 6 rep |
| 腿屈伸 / 腿弯举 | 左侧 | 8 个完整 rep，机器转轴与工作腿可见 | 相同机位、座椅/靠背与工作侧另录 6 rep |
| 臀推 / 提踵 | 左侧 | 8 个完整 rep，脚、髋与肩全程入镜 | 相同机位、长凳/台阶与足位另录 6 rep |

录制前填写实际变式、设备与 setup fingerprint；例如 `barbell_back_squat / high-bar / barbell / rack-height-6|stance-shoulder-width|flat-shoe / left / bilateral`，并固定 `cameraUpright=true`、`isMirrored=false`、`projectionClass=upright-image-2d`。不要只写“腿”。开始动作前后各留 2–3 秒，正常的走动、调设备、休息都保留在视频中——它们会成为抗干扰的负窗口，不能当 rep。

## 审核与校准

1. 在审核页逐个完整 rep 标出 `start → extreme → end`；这是分段真值，**不是**姿势质量标签。
2. 为每段补充可选备注，例如“调设备”“半程”“有人遮挡”“左腿工作”。这些片段不得进入校准样本。
3. 至少用 6 个同一 exact identity、人工批准的完整 rep 取每节点的中位数与 10%/90% corridor；每个 primary feature 的每个节点至少要有 4 次真实观测，才生成 `observed_personal_provisional` 轨迹。重复 rep、错位节点、自动分段和用模拟值补齐的缺失不得进入。
4. 以同一 exact identity 的另一整段录像作为留出 capture，检查 rep precision / recall、极值边界误差、unknown 率与负窗口误触发；不能拿不同机位代替留出，也不能按同一视频随机分拆 rep。
5. 只有独立视频通过后，才把该 identity 从“模拟先验”提升为“个人 provisional 轨迹”。没有专家 form 标签时，仍不输出正确率或伤病建议。

## 覆盖与后续顺序

生成命令 `npm run generate:simulated-priors` 会校验五分化动作目录与 prior 一一对应，并写出可被 SDK 或审核工具读取的 [five-split-v1.json](../../data/simulated-priors/five-split-v1.json)。每个动作都包含 32 个无量纲 nominal 节点，identity 固定为 `simulation-only`；它们用于合成测试和可视化，不能与任何真实 capture identity 匹配。

建议顺序是：明天先校准腿部实际做过的主 identity，再在精力允许时补同机位留出 capture；下次胸部训练校准胸部；背、肩、手臂沿用同一流程。若再录 45° 或另一侧，它是新的独立 identity，必须另行校准与留出。这样新视频能不断修正自己的 profile，而不会被已经练过的背、肩数据主导。

## 禁止事项

- 不用模拟节点补全缺失的真实关键点；缺失必须保留 `unknown`。
- 不把不同机位、设备或左右侧的轨迹合并。
- 不将用户的正常训练录像自动认定为标准动作，也不从中产出医疗或伤病风险判断。
