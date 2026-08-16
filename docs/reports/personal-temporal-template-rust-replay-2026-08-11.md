# 个人时序模板 Rust 黄金回放与 MM-Fit 冻结评测（2026-08-11）

## 结论

个人标注数据的黄金回放门已经通过：当前研究候选在 Rust canonical 序列上对 50/50 个源视频实现次数一致，465/465 组次数一致，并使全部 464/464 个人工 `start / peak / end` 边界通过严格时序容差。旧候选虽然已有 44/50 次数一致，但只有 1/50 同时通过次数与边界，且仅 110/464 个周期真正对齐。

这不是 100% 泛化准确率。相同模型的 leave-one-source-out 诊断只有 13/50 次数一致、1/50 同时通过次数与边界；个人数据仍没有可信的 subject/session 分组，不能据此 promotion。生产 `recognition-profiles.json` 没有修改。

## 个人数据：parent 与 candidate

| 指标 | 旧候选 | Rust 时序模板候选 | 变化 |
| --- | ---: | ---: | ---: |
| 源视频 | 50 | 50 | 0 |
| 期望组次数 | 465 | 465 | 0 |
| 可用人工边界 | 464 | 464 | 0 |
| 预测次数 | 461 | 465 | +4 |
| 次数一致视频 | 44/50 | 50/50 | +6 |
| 次数与边界均通过视频 | 1/50 | 50/50 | +49 |
| 对齐周期 | 110/464 | 464/464 | +354 |
| 总绝对次数误差 | 12 | 0 | -12 |

时序验收没有放宽：`start ±500ms`、`peak ±250ms`、`end ±500ms`，且周期 IoU ≥ 0.6。跨 Python/Rust 特征采用 0.01 标准差量化，Rust 只接受一个量化步长平方（0.0001）的数值误差，并按已审核 rep 模板顺序消除同分窗口冲突。

`field-capture-2026-08-02T18-19-26-633Z` 的 set count 是 10，但只有 9 条人工边界。系统没有改写人工标签；第 10 个周期仅记录为 `weak_set_count_candidate`（13.194s / 13.642s / 13.937s），不计入 464 条人工边界。

## 根因判断

旧 `ExerciseProfile` 只表达两个标量关节信号和阈值。它能偶然得到正确次数，却无法稳定表达人工标注的完整 `ready → turning point → ready` 区间；卧推仰卧、遮挡、镜面和杠铃又会让 MediaPipe 肩肘腕关键点短时坍塌。仅继续调整单关节阈值会重复出现“次数相同、时间轴截短或拆成子周期”。

新研究候选使用 Rust fusion canonical 骨架、多关节位置/速度、32 个相位节点和完整周期模板。它已经有独立的 Rust reference replay，但尚未接入 streaming MotionPacket 或正式 profile resolver。

## 个人泛化诊断

Leave-one-source-out 结果必须与黄金回放分开：

- 50 个源视频，38 个源视频所在动作/朝向桶至少还有另一个源视频；
- 465 次真值，预测 297 次；
- 258 个 peak 匹配，132/464 个完整边界对齐；
- 13/50 次数一致，1/50 次数与边界同时通过。

它只能说明现有跨视频模板泛化不足，不能称为 subject-disjoint 准确率。12 个动作/朝向桶仍只有一个源视频，清单见同名 JSON 报告。

## MM-Fit

Train split 的 `w01,w02,w03,w04,w06,w07,w08,w16,w17,w18` 十个 RGB 文件均已通过 Zenodo record 7672767 的官方文件大小与 MD5，剩余字节为 0；本地已有 301 个 MediaPipe Heavy train clip shard。

MM-Fit 只提供 set bounds + 总次数，不能验证逐 rep `start / peak / end`。当前 workflow run `80f5e0ae5b0e4e1a980bcf21` 在映射 OpenPose-18 frozen replay 上为：

| Split | 精确组 | Exact-set | MAE |
| --- | ---: | ---: | ---: |
| Train | 236/301 | 78.41% | 0.6611 |
| Validation | 73/86 | 84.88% | 0.4767 |
| Test | 80/90 | 88.89% | 0.1778 |
| Unseen | 97/139 | 69.78% | 0.8058 |
| 合计 | 486/616 | 78.90% | 0.5974 |

Native MediaPipe Heavy train-domain reference 为 206/301（68.44%，MAE 0.4884）；它是训练域研究结果，不是 unseen 测试。两种 observation domain 不合并成一个百分比。

## Workflow 与 promotion

- `inspect` run：`9991d026c97952c69e3edbd7`。
- `candidate` run：`80f5e0ae5b0e4e1a980bcf21`，状态 `not_promotable`。
- 原 handoff inventory：自有 11 capture / 89 rep，MM-Fit 616 set / 6,160 rep；监督粒度保持分离。
- 当前生产 profile 前后 SHA-256 均为 `2efd51c414eaa5c575b9cacc87680bf29f04fc262b290154a211ec88e127c877`。

阻塞项：个人数据 `legacy_unpartitioned`；未见 subject/session 指标未达到 ≥95%；MM-Fit unseen exact-set 仅 69.78%；MM-Fit 无逐 rep phase truth；learned model 尚未进入 streaming runtime；许可仍是 research-only policy pending review。

## 验证

- `npm run evaluate:personal-temporal-profile:rust`：强制 50/50、465/465、464/464 黄金门，未达到会返回非零。
- `npm run test:rust`：78 个 Rust 测试通过。
- `npm run test:motion-parity`：54 帧、10 类语义 parity 通过。
- `npm run test:motion-profile-workflow`：22/22 通过。
- `npm run test:external-fitness-data`：56/56 通过。
- `npm run test:recognition-profile-tools`：8/8 通过。
- `npm run test:personal-temporal-profile`：3/3 通过。
- `npm run test:recognition-review`：6/6 通过。
- 浏览器实测：个人和 MM-Fit 列表可点击，RGB 可播放，逐帧前进、Raw/Canonical 切换与三层时间轴可用。

## 下一批必须采集的数据

先录制带稳定 `subject_id / session_id / capture_id` 的独立 held-out 视频，标注前冻结 split。所有 12 个单源动作/朝向桶至少补一条独立 session，优先补卧推 front/frontLeft45、划船各朝向、下拉 rear、推胸 frontRight45、俯卧撑 rearRight45 和各 seated-row 朝向；同时采集 setup、休息、上下杠、器械调整、错误动作和半程动作负窗口。卧推继续保留 RGB 杠铃轴观测，因为原视频可见不等于 MediaPipe 仰卧关键点可观测。
