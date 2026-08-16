# 个人动作识别 profile 与骨架漂移诊断（2026-08-10）

## 结论

当前画面中的大幅骨架漂移主要来自 **MediaPipe Pose Landmarker Heavy 在仰卧、遮挡、头部出框和肢体贴近躯干时给出低置信度或错误的原始关节点**。Rust 没有打乱 BlazePose33 的点位编号；recognition profile 也不生成骨架，它只选择运动学信号并用状态机分段计数。

Rust canonical 层已经做三种有界恢复：高置信异常点拒绝、基于已学习骨长的弱肘腕融合，以及最长 150 ms 的速度预测。它能修复短时抖动，不能把数秒遮挡无限外推成“看起来正确”的人体；那会把动画猜测伪装成观测并制造假 rep。

恢复全部个人标注后，当前 research candidate 在 50 条源视频上达到：

- **总组数精确：44/50（88%）**；
- **总组数及所有人工边界都精确：41/50（82%）**；
- 464 个强边界中匹配 449 个，召回 96.77%，精确率 97.40%。

这些是同批个人数据上的 in-sample replay，不是未见用户“准确率”。未达到用户要求的 100%，也未达到可 promotion 的独立 held-out 验收条件，因此没有覆盖生产 profile。

## 实际识别框架

```text
视频帧
  → MediaPipe Pose Landmarker Heavy / BlazePose33（原始观测）
  → Rust Motion SDK（主体锁定、异常拒绝、骨长融合、≤150 ms 预测、unknown）
  → exercise × view recognition profile（信号、方向、阈值、时长）
  → ready → effort → peak → return（rep 封口、拒绝原因）
```

这不是 YOLO，也不是任意动作分类器。动作与机位由课程或用户先指定；Rust 再加载精确 context 的 profile。评审页默认绘制 Rust canonical，并可切换 Raw MediaPipe。人工真值/官方真值是时间轴监督层，不是 MediaPipe 输出。

## 为什么“视频里人很清楚”，MediaPipe 仍会失败

RGB 对人眼可判断，不代表模型训练域内也可判断。正面仰卧卧推对 BlazePose 是强透视、身体横向、杠铃和卧推架遮挡手腕的组合；单臂绳索后半段还存在转身、头部出框和工作臂贴躯干。抽查 `a51c...` 时，原始上肢关键点 visibility 合格比例只有约 43.98%；低增益骨长融合把 canonical 可用比例提高到约 59.9%，但没有恢复完整周期。

`b8af...` 14.55 s 的原始肘点 visibility 低于 0.5；Rust 当前把它标成短时 `predicted`，而不是接受原始跳点。更激进地信任弱坐标会让整组回放变差；本轮已经实验并回退该方案。

本地已有 RTMPose-M ONNX 也做了相同失败帧诊断：全帧推理仍出现错误的肘点拓扑，紧裁剪分数更低，因此它目前不是可直接替换 MediaPipe 的证据。

## 个人黄金数据与回放

语料为 50 条源视频、54 个训练/评测窗口。多出的 4 个窗口来自 4 条单臂绳索侧平举视频的显式机位切分：前半段 `frontLeft45`，后半段 `rearRight45`。切分只改变 context，不丢失或重复人工 rep。

人工组计数为 465；强 `start / turning-point / end` 边界为 464。差 1 次来自 `field-capture-2026-08-02T18-19-26-633Z`：组总数写 10，但只有 9 条逐 rep 边界，系统保留 count-only truth，没有伪造第十条边界。

| 指标 | v2 父候选 | 最终候选 | 变化 |
| --- | ---: | ---: | ---: |
| 源视频总组数精确 | 40/50（80%） | **44/50（88%）** | +4 条 / +8 pp |
| 源视频严格边界精确 | 39/50（78%） | **41/50（82%）** | +2 条 / +4 pp |
| 人工强边界匹配 | **451/464** | 449/464 | -2 |
| 逐 rep 匹配召回 | **97.20%** | 96.77% | -0.43 pp |
| 逐 rep 匹配精确率 | **97.62%** | 97.40% | -0.22 pp |
| 绝对次数误差 | **11** | 12 | +1 |

候选以“更多整条视频计数完全一致”为优化目标，因此 exact-set 改善，但边界总匹配数轻微退化。报告保留这项退化，没有用一个合并百分比掩盖。

### 当前 9 条严格失败源视频

| 动作 / 机位 | 严格失败源视频 | 组数失败源视频 | 主要证据 |
| --- | ---: | ---: | --- |
| barbell bench press / front | 2 | 1 | 一条 4→6；另一条 8→8 但仅匹配 6 个边界，肘腕长期低置信度 |
| barbell row / rearRight45 | 1 | 1 | expectedCount=10，但只有 9 条人工边界；当前预测 8 |
| push-up / rearRight45 | 1 | 0 | 14→14，但 1 漏检 + 1 假检导致边界不精确 |
| rear-delt fly / front | 1 | 1 | 15→10，14 个 needs-review 周期未成为确认 rep |
| single-arm cable lateral raise / rearRight45 | 3 | 3 | 三条后半段分别 8→9、8→7、8→9；持续遮挡下峰谷不可分离 |
| straight-arm pulldown / frontLeft45 | 1 | 0 | 8→8，但 1 漏检 + 1 假检导致边界不精确 |

## 点位预测实验与 Stop condition

可以预测点位，但必须区分三类证据：

1. 可靠关节 + 学到的骨长：可做低增益运动学融合；已实现。
2. 短暂丢点：可做不超过 150 ms 的速度预测；已实现。
3. 数秒遮挡或整个人检测失败：需要独立训练的带 missing-mask 时序模型，并输出不确定度；不能无限延长上一帧速度。

本轮曾做一个 opt-in 的 200 ms 中值状态信号实验。它把 `frontLeft45` 单臂侧平举窗口从 3/4 提到 4/4 严格精确，但没有改善该源视频后半段的失败，也没有改善卧推、反向飞鸟、后右单臂侧平举、划船、俯卧撑或直臂下压。启用它需要新增 Rust ABI 的状态机编码，触发 handoff 的 Stop condition，因此代码与 WASM 已回退；实验 artifact 只保留在 git-ignored workflow run 中，不是可执行候选。

若要继续追求 100%，下一阶段不再是“调 JSON 阈值”，而是需要用户明确授权 Rust 时序/预测算法改造：使用当前动作模板、骨长约束、速度/加速度和历史 rep 相位，在缺失掩码下做有置信度的状态估计，同时保持重新检测和 unknown 退路。

## MM-Fit（必须与个人逐 rep 指标分开）

MM-Fit 冻结评测只有 set start/end + 总次数，没有逐 rep phase 真值。当前 616 组仍是官方 OpenPose/COCO-18 映射到 BlazePose33 槽位的回放：

| Split | 组数 | 完全一致率 | MAE |
| --- | ---: | ---: | ---: |
| train | 301 | 78.74% | 0.6611 |
| validation | 86 | 84.88% | 0.4767 |
| test | 90 | 88.89% | 0.1778 |
| unseen_test | 139 | 69.78% | 0.8058 |
| **全部** | **616** | **79.06%** | **0.5974** |

这些数字不能称为 MediaPipe RGB 或逐 rep 识别率。train split 的 `w01,w02,w03,w04,w06,w07,w08,w16,w17,w18` 共 10 个 RGB 文件已通过官方大小与 MD5 校验，`remaining_bytes=0`；本轮没有下载 validation/test/unseen。

## Promotion、产物与验证

生产 promotion 为 **false**。[recognition-profiles.json](/Users/Ruihan/Documents/power/maxpower/public/archives/confirmed-captures/recognition-profiles.json) 未修改，SHA-256 仍为 `2efd51c414eaa5c575b9cacc87680bf29f04fc262b290154a211ec88e127c877`。

- 黄金 approvals：[personal-golden-approvals-v2.json](/Users/Ruihan/Documents/power/maxpower/data/training/personal-golden-approvals-v2.json)
- 黄金 segmentation：[personal-golden-segmentation-v2.json](/Users/Ruihan/Documents/power/maxpower/data/training/personal-golden-segmentation-v2.json)
- 当前可执行 research candidate：[final-personal-v2-candidate.json](/Users/Ruihan/Documents/power/maxpower/data/workflows/motion-profile/personal-golden-v2/run-2026-08-10/candidates/final-personal-v2-candidate.json)
- 全量回放：[final-personal-v2-replay.json](/Users/Ruihan/Documents/power/maxpower/data/workflows/motion-profile/personal-golden-v2/run-2026-08-10/diagnostics/final-personal-v2-replay.json)
- 视频/骨架评审页：`http://127.0.0.1:4318`

验证通过：Rust continuity/rep/web contract 25/25、TS canonical continuity 10/10、recognition profile 5/5、review page 5/5、personal golden 3/3、workflow 22/22、external fitness/MM-Fit 56/56，共 **126/126**。MM-Fit train RGB 只读校验为 10 个文件、剩余 0 bytes。

Promotion 仍被以下事实阻塞：个人数据是 `legacy_unpartitioned`；没有独立 subject/session held-out；MM-Fit phase truth 不存在且当前 frozen replay 仍是 OpenPose 映射域；个人还有 1 个 count/boundary 冲突和 3 个退化 phase 时间点。
