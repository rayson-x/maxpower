# MM-Fit / RepCount-A 对 Rust 动作识别的技术验证

日期：2026-08-09

## 结论

MM-Fit 的公开骨架数据对 MaxPower 有明确价值，但价值主要是**动作身份、计数状态机和跨人的失败模式验证**，不是直接学习动作纠正标准。

本次已把 MM-Fit 的 21 个会话、616 个动作组、6,160 次整组 repetition 转成研究专用的 BlazePose-33 兼容回放，并送入与 Android data-profile 相同的 Rust ABI。最终结果：

- 616 组中，398 组计数完全一致，exact-count ratio 为 **64.61%**；
- 496 组误差不超过 1 次，off-by-one ratio 为 **80.52%**；
- 真实 6,160 次，Rust 输出 5,300 次，平均每组绝对误差 **1.43 次**；
- 未见过的 subject split 精确组比例为 **53.96%**，说明当前宽松 initializer 还不能作为跨人生产 profile；
- 交替哑铃弯举在修正动作身份和 data-profile 状态机 ABI 后达到 **59/59 组完全一致、599/599 次**。

这证明 Rust 的轻量、离线、数据 profile 路线可行，也证明“动作名称映射正确”与“为交替动作选择正确状态图”比盲目调低阈值更重要。

## 数据取得与边界

### MM-Fit

- 从官方 multimodal archive 选择性保留 21 个 session 的 2D pose、3D pose 与 labels，共 63 个文件，约 1.0GB；
- 2D pose 是 COCO-18，标签是 `(set start frame, set end frame, set count, action)`；
- 每个动作组没有逐 rep 起止/极点，因此只能评估整组总数，不能计算 phase-boundary precision/recall；
- 提供的 2D pose 不是移动端 MediaPipe BlazePose 输出，且相机视角不能精确映射到 MaxPower 的 capture position；
- 缺失 BlazePose 关键点保持 `visibility=0`，COCO neck 等非同义点不做插值或伪造。

### RepCount-A / RepCount-pose

- 官方 pose archive 为 9.52GB，本机空间和当前许可条件不适合拉取全量，本次只保留官方 README、动作映射和下载元数据；
- 适配器已支持 RepCount-A 的 `cycle_bounds` 逐 rep 边界合同；
- 等取得明确的数据使用授权和足够磁盘后，可直接补做 phase boundary、missed-rep、false-rep 评估，不需要再改内部 schema。

两套数据暂按 `offline_research / benchmarking` 管理，明确禁止 `production_profile_promotion` 与 `form_reference`。代码仓库许可不自动等于数据集许可。

## 动作库变化

动作目录由 65 个扩展为 70 个，新增并保持 exact identity：

| 动作 ID | 中文 | 与已有动作的区别 | 当前能力 |
|---|---|---|---|
| `jumping_jack` | 标准开合跳 | 不等同于单侧迈步的 `step_jack` | 宽松 Rust initializer；研究集 87.72% 精确组 |
| `alternating_lunge` | 原地交替弓步蹲 | 不等同于持续前移的 `walking_lunge` | 宽松 Rust initializer；研究集 88.71% 精确组 |
| `standing_dumbbell_row` | 站姿双哑铃划船 | 不等同于长凳支撑的单臂划船 | 宽松 Rust initializer；研究集 67.19% 精确组 |
| `sit_up` | 仰卧起坐 | 新增 core/core-flexion 身份 | 宽松 Rust initializer；93.85% 的组误差不超过 1 次 |
| `alternating_dumbbell_biceps_curl` | 交替哑铃弯举 | 不等同于双臂同步弯举 | Rust alternating data profile；研究集 100% 精确组 |

所有新增动作仍为 `catalog_only`；可录制、可选择、可运行宽松计数 initializer，不代表已有动作纠正标准。

## Rust 基准结果

| 动作 | 组数 | 真值次数 | 预测次数 | 平均绝对误差/组 | 精确组 | 误差 ≤1 |
|---|---:|---:|---:|---:|---:|---:|
| 交替哑铃弯举 | 59 | 599 | 599 | 0.00 | 100.00% | 100.00% |
| 侧平举 | 56 | 559 | 558 | 0.02 | 98.21% | 100.00% |
| 原地交替弓步 | 62 | 624 | 599 | 0.44 | 88.71% | 91.94% |
| 开合跳 | 57 | 563 | 547 | 0.28 | 87.72% | 94.74% |
| 站姿双哑铃划船 | 64 | 644 | 519 | 1.95 | 67.19% | 71.88% |
| 徒手深蹲 | 64 | 639 | 480 | 2.48 | 64.06% | 65.63% |
| 哑铃推肩 | 60 | 598 | 395 | 3.38 | 58.33% | 58.33% |
| 过顶臂屈伸 | 64 | 645 | 521 | 2.13 | 54.69% | 68.75% |
| 仰卧起坐 | 65 | 640 | 584 | 0.92 | 36.92% | 93.85% |
| 俯卧撑 | 65 | 649 | 498 | 2.35 | 1.54% | 64.62% |

俯卧撑的精确组比例低但多数只差一次，说明 clip 起止上下文、动作起始极点和 seal 时机需要专门验证；不能仅凭总数把 elbow-angle threshold 下调。推肩、深蹲和过顶臂屈伸在不同 subject 上仍有明显漏计，应使用本项目同一移动端 pose 模型、明确机位和人工逐 rep 边界继续校准。

## 交替弯举问题与修复

原始 MM-Fit 文档明确说明左右臂交替。最初把它映射到普通 `dumbbell_biceps_curl` 后，双侧同步状态机只识别到 2/599 次。固定单侧代理后只能识别约一半（301/599），证明标签按每侧 repetition 计数。

最终修复：

1. 新增 `alternating_dumbbell_biceps_curl` exact identity；
2. 使用 Rust 已存在的 `alternating-ready-effort-return/v1`，一次 rep 内锁定先运动的一侧，回到 ready 后才允许另一侧开始；
3. 扩展 data-profile ABI 的 state-machine code `1`，Web/WASM 与 Android JNI 都使用同一 24 参数安装合同；
4. profile content hash 包含状态机 ID，旧 profile 不能静默冒充新状态图。

此改动把交替弯举提升到 599/599，并保持 Rust 是唯一 rep boundary 来源。

## 是否更新正式 Rust profile

没有把 MM-Fit 阈值写入 `approved-segmentation-v1.json` 或 observed recognition profiles，也没有生成动作纠正轨迹。原因：

- 数据许可仍需明确；
- MM-Fit 只有 set count，没有逐 rep 边界；
- pose topology/model 与移动端不同；
- capture view 未精确标定；
- unseen-subject 结果不足以支持生产晋级。

本次可正式保留的是**状态机能力、exact action identity、数据适配与回归基准**。数值 profile 仍应使用 MaxPower 自己录制、人工批准、同动作 × 同机位 × 同 pose model 的数据，经 leave-one-capture-out/held-out gate 后晋级。

## 可复现命令

```bash
# 数据源与下载策略（默认不下载 9.52GB RepCount）
sh tools/external-datasets/fetch.sh --help

# MM-Fit COCO-18 → research-only BlazePose33 clips
npm run prepare:mmfit

# 616 组经 Rust WASM/data-profile 回放
npm run benchmark:mmfit

# 本次相关 TypeScript/目录/Android envelope 合同
npm run test:external-fitness-data

# Rust SDK 全部合同
npm run test:rust
```

机器可读完整结果见 `docs/reports/mmfit-rust-profile-benchmark-2026-08-09.json`。
