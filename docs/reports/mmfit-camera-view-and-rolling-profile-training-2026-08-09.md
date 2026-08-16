# MM-Fit 人体朝向分析与滚动 Profile 训练报告

日期：2026-08-09

## 结论

当前 616 组 MM-Fit 全量回放为 **428/616 exact-set（69.48%）**，5563/6160 次，MAE 1.0146。这个结果没有达到 95%，不能作为产品级计数能力。

本轮确认了三件事：

1. MM-Fit 中能由骨架估计的是**人体相对画面朝向代理**，不是可追溯的真实相机机位；旧版把 `oblique45/side` 自动映射为 MaxPower `frontLeft45/left` 的做法不成立，现已取消。
2. 在 532 个具备 train/validation 证据的动作—朝向桶内，验证门禁后的候选把 exact 从 **68.42% 提到 74.06%**，MAE 从 **1.4474 降到 0.9680**；但投影到完整 616 组后仍只有 69.48%。
3. 整段多关节频谱/PCA 周期探针只有 **15.58% exact-set**。它的总次数 6069/6160 看起来接近，但逐组严重错位，证明不能用“整段周期总量”补 Rust 状态机的漏计。

当前结果与 MM-Fit 论文公开的 skeleton signal-processing exact 69.81% 接近。继续扩大固定阈值网格不会自然跃升到 95%；下一阶段需要目标域 MediaPipe Heavy 骨架、动作专用轻量 causal phase model 和 Rust 约束状态图。

## 人体朝向代理，不是相机机位

分析器使用 3D 肩髋轴和 2D 肩宽/躯干比例估计主体相对画面的朝向：

| `bodyOrientationProxy` | 片段数 | 占比 |
| --- | ---: | ---: |
| `front` | 461 | 74.84% |
| `oblique45` | 91 | 14.77% |
| `side` | 31 | 5.03% |
| `unknown` | 33 | 5.36% |

这个值只能用于研究分桶，不能选择正式 capture profile。原因是 MM-Fit 公开 pose/labels 没有相机 ID、外参或每段使用哪台相机的字段；同一个固定相机下，人体也会因动作改变朝向。

因此候选 identity 已改为：

> `exercise_id × body_orientation_proxy × pose_source(OpenPose-18)`

训练 artifact 中 `capturePosition` 固定为 `null`；`initializerCapturePosition` 只表示借用了哪个现有信号拓扑作为初始化，不代表 MM-Fit 的真实机位。候选 identity 升为 `/v2`，旧 `/v1` 候选不会被继续加载。

## 滚动训练结果

训练器一次只解压一个动作—朝向桶，只用官方 train split 选参，用 validation 作接受门禁，test 与 unseen_test 不参与选参。20 个桶中 11 个证据足够，3 个候选通过门禁：

| 桶 | 候选 | 主要结果 |
| --- | --- | --- |
| 正面哑铃肩推 | `torso-distance-18` | validation exact 66.67% → 88.89%；unseen 25.00% → 58.33% |
| 侧向仰卧起坐 | `direction-flip` | validation exact 20.00% → 60.00%；test 40.00% → 60.00% |
| 正面站姿哑铃划船 | `range-70-fast` | validation exact 44.44% → 55.56%；test 57.14% → 100% |

完整候选集目前表现最好的动作包括：

| 动作 | 全量 exact-set |
| --- | ---: |
| 交替哑铃弯举 | 100.00% |
| 侧平举 | 98.21% |
| 交替弓步 | 88.71% |
| 开合跳 | 87.72% |
| 哑铃肩推 | 81.67% |

主要失败集中在俯卧撑、过顶臂屈伸、深蹲和仰卧起坐。俯卧撑斜侧桶长期系统性少计，单纯降低幅度/时长阈值没有解决首尾相位与动作拓扑问题。

## 周期探针为什么不能补次数

新增的 research-only 周期可观测性基准对每段完整 set 做身体坐标归一化、平滑、每段 PCA 和多谐波频率搜索。这实际上比移动端实时模型拥有更多未来信息，因此只能作为离线上限探针。

| Split | Exact | ±1 | MAE |
| --- | ---: | ---: | ---: |
| Train | 17.28% | 73.42% | 1.6047 |
| Validation | 16.28% | 74.42% | 1.5116 |
| Test | 15.56% | 71.11% | 1.9889 |
| Unseen users | 11.51% | 58.27% | 2.4388 |

虽然 aggregate rep ratio 为 98.52%，逐组 exact 只有 15.58%。所以任何“周期估计与 FSM 不一致时自动补一遍”的策略都会把误差隐藏到单组用户体验里，现阶段明确禁止。

## 自有录像的可观测性边界

自有 11 组已标注录像当前为 9/11 组 exact phase、84/89 次匹配、0 个 false rep。两组失败均为正面杠铃卧推：整体 pose coverage 约 95%，但每个已标注 rep 的腕/肘有效信号覆盖仅 2.35%–27.69%，长缺口达 0.7–3.2 秒。也就是说“检测到人”不等于“看得到正在完成卧推的手臂”。

这两组不能靠计数阈值修到 100%；正确策略是：

- 正面卧推在腕肘长期遮挡时拒绝给出可靠计数；
- 技术验证改用斜前 45°，当前同类自有录像已经能完整计数；
- 若必须支持正面机位，需要引入杠铃/杠铃片视觉轨迹，不能只靠人体骨架。

## Rust 首次动作边界修复

显式 `beginSet` 原本要求 500ms 稳定入场，但稳定样本只进入 SetGate，没有进入 RepEngine 基线。用户恰好稳定 500ms 后马上开始小幅动作时，第一帧动作可能被当成基线，导致第一遍漏计。

现已让 arming 阶段的可观测样本只更新 ready baseline，绝不推进 rep；稳定结束后的第一遍动作会相对真正的准备姿势计算。新增回归测试覆盖“恰好 500ms 稳定后立刻开始的小幅完整周期”，Rust rep contract 13/13 通过。

这个修复改善实机组首边界，但 MM-Fit 离线 replay 默认不使用显式 set lifecycle，因此不能拿它虚构 MM-Fit 指标提升。

## 下一阶段

95% 路线不再继续无限调固定阈值，而是逐动作推进：

1. 第一批只选高可观测动作：交替弯举、侧平举、开合跳，再加入目标域负样本。
2. 用移动端 MediaPipe Heavy 采集统一机位、完整首尾上下文和逐 rep `ready/effort/peak/return` 标注。
3. 训练小型动作专用 causal phase model；Rust 仍是唯一生命周期与计数所有者，模型只提供相位概率。
4. 按受试者切分，目标至少 627 组中的 596 组 exact；正式宣称 95% 时还应要求 Wilson 95% 下界超过 95%，约需 608/627。
5. 不可观测 set 单独计入 coverage/rejection 指标，不能硬输出一个错误次数。

## 产物与复现

- 朝向分析：`data/external/mm-fit/normalized/body-orientation-analysis.json`
- 滚动候选：`data/external/mm-fit/normalized/candidate-profiles.json`
- 滚动训练报告：`docs/reports/mmfit-rolling-profile-training-2026-08-09.json`
- 全量候选回放：`docs/reports/mmfit-candidate-profile-benchmark-2026-08-09.json`
- 统一硬门禁：`docs/reports/unified-recognition-corpus-gate-2026-08-09.json`
- 周期反例基准：`docs/reports/mmfit-periodicity-observability-2026-08-09.json`
- 95% 技术路线：`docs/research/2026-08-09-path-to-95-percent-pose-rep-counting.md`

```bash
npm run analyze:mmfit-orientation
npm run train:mmfit-profiles
npm run benchmark:mmfit:candidates
npm run report:recognition-corpus
npm run test:external-fitness-data
```

MM-Fit 候选仍为 research-only，未写入正式 Rust/Android profile bundle。
