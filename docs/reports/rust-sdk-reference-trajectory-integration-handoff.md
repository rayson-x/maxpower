# Rust SDK 接入交接：高位下拉 provisional reference 与轨迹匹配

日期：2026-08-03
目标读者：负责将 TypeScript 参考实现迁移/接入 Rust SDK 的 Agent
范围：高位下拉 `lat_pulldown`；不包含实时 UI、动作分段模型训练、医疗判断或人群标准声明。

## 1. 结论先行

当前实现可以迁移到 Rust SDK，但必须保持以下产品语义：

- 它是**同 profile、同相位、同节点的 provisional corridor comparison**。
- 它不是无限制曲线拟合、DTW 模板匹配或“正确动作概率”。
- profile 生成阶段可以称为一种稳健的经验曲线估计：逐节点 `median + empirical q10/q90 + MAD`。
- 用户匹配阶段是逐节点区间偏离计算，不改变用户时间轴去迎合参考曲线。
- 当前 `calibrationStatus = uncalibrated`、`qualityVerdict = null`。Rust 端不得自行填入 0–100 分、合格阈值或“错误动作”结论。

一手证据、方法边界和校准实验见：

- `docs/research/2026-08-03-provisional-reference-generation-and-matching.md`
- `docs/research/lat-pulldown-reference-trajectory-spec.md`
- `docs/research/standard-exercise-trajectory-sources.md`

TypeScript 参考实现：

- `src/pose/referenceTrajectory.ts`
- `tools/reference-trajectory/referenceTrajectory.test.ts`
- `tools/reference-trajectory/generate.ts`

## 2. “是不是拟合度匹配”

可以在宽泛意义上说它比较“轨迹与个人临时走廊的贴合程度”，但不要把它命名成已经校准的 `fitness score`。

更准确的拆分是：

1. **Reference estimation：**将候选 rep 在 `start→bottom`、`bottom→end` 内分别归一化，逐特征/节点估计个人经验中心与范围。
2. **Observation alignment：**只用已知 `start/bottom/end` 做分段线性相位注册；不使用 DTW。
3. **Corridor comparison：**同一个 phase node 对同一个 phase node，计算是否落在经验带内以及超出多少。
4. **Decision policy：**尚未校准，因此不把偏离证据映射成“正确/错误”或质量分。

当前可以展示的结果：

```text
comparisonStatus
raw/normalized excess by feature and node
outsideNodeCount
outsideNodeRatio
maximumConsecutiveOutsideNodes
observed/unknown coverage
profile scope and calibration status
```

当前禁止展示：

```text
standard score
correctness probability
injury/safety score
automatic coaching verdict
```

## 3. 当前本地数据产物

默认生成路径：

```text
data/reference/private/lat-pulldown-personal-provisional-v0.json
```

该目录已加入 `.gitignore`，因为骨架轨迹属于个人派生数据。Rust Agent 在本机可直接读取；若要进入仓库，必须先去标识化并得到明确授权。

生成命令：

```bash
npm run generate:provisional-reference -- \
  /Users/Ruihan/Documents/power/field-capture-approvals-2026-08-03.json
```

当前 bundle：

| profile | capture 数 | rep 数 | 数据状态 |
| --- | ---: | ---: | --- |
| `rear` | 1 | 8 | 双侧核心点完整；个人单会话/会话未知的描述性走廊 |
| `rearLeft45` | 3 | 20 | 手腕、躯干、近侧左肘完整；远侧右肘系统性缺失 |

重要边界：

- 原 approval export 中 `approvals=0`，来源仍是 `human_edited_draft`。
- 没有逐 rep form-quality 标签。
- `participantCount=1`、`sessionCount=null`。
- `variation`、`equipment`、`trainingSide` 当前均为未记录占位状态。
- 28 个 rep 只通过了“手腕完成 pull→return 方向”的必要条件筛选，不等于28个标准 rep。

左后45°远侧右肘的实际覆盖示例：

```text
start:  0 / 20
bottom: 4 / 20
end:    2 / 20
```

Rust 端必须将这些节点保留为 `None/null`，不能插值、镜像左肘或用低 visibility 坐标补齐。

## 4. Profile identity：匹配前的硬门

以下字段必须完全一致：

```text
exerciseId
capturePosition
variation
trainingSide
equipment
coordinateSystem
featureSchemaId
poseModelVersion
```

当前 feature schema：

```text
lat_pulldown/source-image-piecewise-32/v1
```

任一字段不匹配，返回：

```text
status = profile_mismatch
mismatchReason = <field> 不匹配
```

禁止自动搜索“最像”的其他机位 profile。`rear` 和 `rearLeft45` 共享特征名称，不共享数值走廊。

## 5. Rust 建议公共接口

建议拆成三个稳定接口：

```rust
fn normalize_lat_pulldown_rep(
    context: &ReferenceProfileContext,
    capture_position: CapturePosition,
    segment: RepSegment,
    poses: &[PoseEstimate],
) -> Result<NormalizedReferenceRep, ReferenceError>;

fn build_personal_provisional_reference(
    identity: &ProfileIdentity,
    reps: &[NormalizedReferenceRep],
) -> Result<ProvisionalReferenceProfile, ReferenceError>;

fn match_lat_pulldown_trajectory(
    profile: &ProvisionalReferenceProfile,
    observed: &NormalizedReferenceRep,
) -> TrajectoryMatchResult;
```

如果 Rust SDK 不负责 profile 生成，至少实现第一和第三个接口，并通过 `serde` 读取 TypeScript 生成的 profile JSON。

建议用：

```rust
Option<f64>       // JSON null / unknown
Vec<Option<f64>> // 每节点逐特征值
f64              // 计算过程，输出时按协议舍入
serde            // JSON contract
```

禁止用 `NaN` 表示缺失；标准 JSON 不支持 NaN，必须使用 `Option::None`。

## 6. 固定特征顺序

数组顺序属于 schema，Rust 端不得排序：

```text
0  leftWristHeight
1  rightWristHeight
2  leftElbowAngleDeg
3  rightElbowAngleDeg
4  leftUpperArmToTorsoDeg
5  rightUpperArmToTorsoDeg
6  leftWristLateral
7  rightWristLateral
8  bilateralWristHeightDelta
9  torsoLateralShift
10 torsoLateralTiltDeg
```

所有位置特征使用图像归一化坐标，并用肩中点到髋中点的躯干长度归一化。角度是二维图像投影角，不得命名为 ISB 三维关节角。

### 6.1 躯干尺度

```text
shoulderMid = midpoint(leftShoulder, rightShoulder)
hipMid      = midpoint(leftHip, rightHip)
torsoScale  = distance(shoulderMid, hipMid)
```

### 6.2 手腕相对位置

```text
wristHeight  = (wrist.y - shoulderMid.y) / torsoScale
wristLateral = (wrist.x - shoulderMid.x) / torsoScale
```

源图像坐标 `y` 向下，因此高位下拉 pull 阶段 `wristHeight` 总体增加。

### 6.3 角度

```text
elbowAngle          = angle(shoulder, elbow, wrist)
upperArmToTorsoDeg  = angle(hip, shoulder, elbow)
```

计算余弦前 clamp 到 `[-1, 1]`；任一向量长度退化时返回 `None`。

### 6.4 双腕高度差

```text
bilateralWristHeightDelta = leftWristHeight - rightWristHeight
```

### 6.5 躯干横移

必须相对 rep 起点计算，不能把图像构图当动作：

```text
torsoLateralShift(t) =
    (shoulderMid.x(t) - shoulderMid.x(start)) / torsoScale(start)
```

不要使用 `shoulder_x(t)/scale(t) - shoulder_x(start)/scale(start)`；该写法会把尺度变化伪造成横移。

### 6.6 躯干图像平面倾斜

```text
atan2(shoulderMid.x - hipMid.x, hipMid.y - shoulderMid.y)
```

输出 degree，只表示图像平面横向倾斜；正后机位不能从它推断前后仰。

## 7. 可见性与 unknown

当前 TypeScript 观测层参数：

```text
visibilityThreshold = 0.5
maximumSourceFrameDistanceMs = 180
```

它们是当前工程观测门，不是动作正确性阈值，后续需要真值校准。

每个 feature 独立声明依赖点；只有相关点不可用时，该 feature 才为 `None`。例如右肘缺失：

```text
rightElbowAngleDeg       = None
rightUpperArmToTorsoDeg  = None
rightWristHeight         = Some(...)  // 右腕仍可见时继续使用
left-side features       = Some(...)
torso features           = Some(...)
```

若最近源帧与目标节点相差超过180 ms，该节点的所有 feature 均为 `None`，并将 `sourceTimestampMs` 设为 `null`。

## 8. 分阶段归一化

每个 rep 必须满足：

```text
startMs < bottomMs < endMs
```

节点布局：

```text
node 0..15   pull:   start → bottom
node 16..31  return: bottom → end
```

pull 和 return 各16个线性等距目标节点；bottom 在两个相位边界各出现一次。每个节点保存：

```text
nodeIndex
phase
phasePercent
targetTimestampMs
sourceTimestampMs | null
values[11]
confidence[11]
```

当前实现选择距离目标时间最近的真实 pose，不在遮挡处插值。Rust 必须使用相同 tie-breaking：只有候选帧距离**严格小于**当前最近距离时才替换；等距时保留时间序列中更早出现的帧。

原始时间证据单独保留：

```text
pullMs
returnMs
totalMs
```

当前 matcher 尚未实现 timing-distance 判决；Rust 端也不要自行增加未经校准的节奏阈值。

## 9. 生物力学必要条件筛选

当前筛选只判断可观察的阶段方向：

- 左/右腕在 pull 阶段总体向下。
- 左/右腕在 return 阶段总体向上。
- 肘角和上臂角方向只作为附加证据；斜后投影可能压扁或反转二维角度，因此不能单独否决完整腕部周期。

状态：

```text
biomechanically_compatible_candidate
biomechanically_incompatible_candidate
unknown
```

这里的 `compatible` 只表示没有直接违反当前可观察动作方向，不表示正确、安全或适合作为人群标准。

## 10. Corridor 生成

每个 `phase × node × feature` 收集非 null 观测，并保存：

```text
nObserved
nSessionsObserved = null  // 当前没有可靠 session metadata
median
qLow  = empirical q10
qHigh = empirical q90
medianAbsoluteDeviation
medianConfidence
coverageRate
evidenceStatus = hypothesis
```

分位数使用线性插值：

```text
index = (n - 1) * p
lo = floor(index)
hi = ceil(index)
q = x[lo] + (x[hi] - x[lo]) * (index - lo)
```

q10–q90 是冻结在 v1 schema 中的描述性选择，不是生物力学接受阈值，也不是整条曲线的 simultaneous prediction band。

## 11. 用户轨迹比较

一个节点只有满足以下条件才可比较：

```text
observed.value != null
observed.confidence >= 0.5
profile.qLow != null
profile.qHigh != null
```

节点状态：

```text
within_observed_band
outside_observed_band
unknown
```

逐点 excess：

```text
inside: 0
below:  qLow - value
above:  value - qHigh
```

若存在可识别的非零尺度：

```text
scale = max(qHigh - qLow, 1.4826 * MAD)
normalizedExcess = rawExcess / scale
```

如果两个尺度都为0或不可用，`normalizedExcess = null`，不得用 epsilon 伪造极小方差。

每个特征汇总：

```text
comparableNodeCount
comparableNodeRatio
outsideNodeCount
outsideNodeRatio
maximumConsecutiveOutsideNodes
```

`maximumConsecutiveOutsideNodes` 在以下位置重置：

- 从 pull 切换到 return；
- 遇到 within 节点；
- 遇到 unknown 节点。

它目前只是描述性证据。不要实现“连续3点即错误”，因为归一节点不代表固定真实毫秒。

最终输出：

```text
status = comparison_available | insufficient_observation | profile_mismatch
calibrationStatus = uncalibrated
qualityVerdict = null
```

## 12. Rust parity 验收测试

必须至少移植 TypeScript 的4个行为测试：

1. **Piecewise normalization + partial unknown**
   pull/return 共32节点；远侧肘不可见只拒答远侧肘相关 feature。
2. **Pointwise comparison without DTW**
   连续改变若干左腕节点后，`outsideNodeCount` 和 `maximumConsecutiveOutsideNodes` 增加，但 `qualityVerdict` 仍为 null。
3. **Strict profile identity**
   改变 `capturePosition` 或 `equipment` 返回 `profile_mismatch`。
4. **Translation/scale separation**
   身体中心 x 不变、躯干尺度变化时，`torsoLateralShift` 必须保持0。

还应增加：

- JSON `null ↔ Option::None` round-trip。
- feature 顺序与 schema ID 不变。
- 输出中无 NaN/Infinity。
- percentile worked example 与 TypeScript 完全一致。
- 相同输入的 Rust/TypeScript JSON 数值误差在预先声明的浮点容差内。
- profile mismatch 不得降级为“尝试其他 profile”。
- unknown 不得因重新归一化权重而提高所谓总分。

TypeScript 当前全量验证：98项测试全部通过。

## 13. Rust Agent 推荐实施顺序

1. 用 `serde` 定义 bundle/profile/rep/match result 类型并完成 JSON round-trip。
2. 先移植 feature schema、身份门和 matcher；读取 TypeScript 生成的 profile。
3. 移植 `normalize_lat_pulldown_rep()`，用合成 fixture 做跨语言 parity。
4. 是否在 Rust 内生成 profile 作为第二阶段；不要一开始同时重写 generator 和 matcher。
5. 建立 TypeScript→JSON→Rust golden test。
6. 接入 SDK 公共 API，但先只暴露 comparison evidence。
7. 等新增跨 session 和控制变量 challenge set 后，再单独实现已校准 decision policy。

## 14. Definition of Done

Rust 接入只有在以下条件全部满足时才完成：

- 可以读取当前 private profile bundle。
- 可以根据严格 identity 选择 rear 或 rearLeft45 profile。
- 同一 observed rep 在 TypeScript 和 Rust 得到相同的逐节点状态与汇总。
- 缺失远侧肘时其他特征仍可比较。
- 不使用 DTW、不插值缺失肢体、不跨机位匹配。
- 输出 `calibrationStatus=uncalibrated`、`qualityVerdict=null`。
- 没有医疗、安全或人群标准措辞。
- Rust 单元测试和跨语言 golden tests 通过。

## 15. Suggested skills for the next Agent

- `implement`：按本报告的公共接口迁移 Rust 模块。
- `tdd`：先冻结 JSON round-trip 和 TypeScript/Rust parity seam。
- `code-review`：完成后审查数值一致性、unknown 传播和未经校准阈值。
- `research`：只有在准备冻结 timing/持续超界/质量映射阈值时再使用；不要重新调研已经引用的基础方法。
