# 居家健身视频中的主体人物选择与连续骨架追踪（2026-08-06）

## 结论先行

目前的方向应从“验证候选人是不是同一个身份”改成“持续追踪课程画面中的主体运动者”。两者的目标不同：前者容易把动作造成的体态、尺度和遮挡变化误判为换人；后者应当是**快速选中、优先保持、短暂丢失不切换、确认离场后才重选**。

MediaPipe Pose Landmarker 可以提供每帧最多 `numPoses` 个姿态、33 个关键点和关键点可见度，但官方 API 没有定义“主体人物”、稳定 `track id`，也没有承诺结果数组第一个元素始终属于同一个人。[MediaPipe Web 配置文档](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js#configuration_options)只把 `numPoses` 定义为最大检测人数；[结果文档](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js#handle_and_display_results)只定义关键点坐标与 `visibility`。因此，主体选择和跨帧身份保持必须由 Form Coach 的追踪层负责，不能把 `landmarks[0]` 当成稳定主体。

建议第一轮修复不引入完整 ReID 神经网络。移动端可以先采用轻量的**运动连续性 + 骨架/框重叠 + 关键点可用度 + 轨迹年龄**，把颜色外观仅作为多人歧义时的弱辅助。肩宽/躯干高、人体框尺度等会随深蹲、弯腰、举手和遮挡变化，不应再作为继续输出骨架的硬身份门槛。

> 边界：本报告给出的是主体追踪逻辑及验证口径。它能恢复“检测到人却被追踪层清空”的视频，但不能凭追踪逻辑让尚未实现 profile 的动作获得正确分类或计数；动作识别仍需按 `动作 × 变式 × 器械 × 机位` 单独验证。

## 一手证据

### 1. MediaPipe 是姿态检测/局部跟踪器，不是产品意义上的主体选择器

Pose Landmarker 的官方配置只提供最大姿态数、检测置信度、姿态存在置信度和跟踪置信度；默认 `numPoses = 1`，但没有“主体分数”、跨帧公共 `track id` 或主体选择策略。[官方配置表](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js#configuration_options)

BlazePose 原始论文把网络描述为对**单个人**输出 33 个关键点的移动端实时模型，并报告可在 Pixel 2 上超过 30 FPS；它证明轻量、实时姿态估计可用于健身跟踪，但不等价于一个稳定的多人物主体身份系统。[BlazePose 原始论文](https://arxiv.org/abs/2006.10204)

MediaPipe 的输出为归一化图像坐标、世界坐标和 `visibility`；`visibility` 表示关键点在图像中可见的可能性。因此可以用关键点可见度/是否在画面内衡量候选是否适合动作分析，但不能把它当做人脸或身份置信度。[官方结果说明](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js#handle_and_display_results)

### 2. 视频模式内部会回用 ROI，但这不足以成为稳定主体 ID

MediaPipe 当前 Pose Landmarker 图在 stream mode 中回传上一帧由关键点生成的 pose rect；当上一帧已经追踪到足够数量的姿态时会跳过新的 pose detector。检测器再次运行时，旧 rect 与新检测 rect 通过 `AssociationNormRectCalculator` 合并，`minTrackingConfidence` 被直接用于矩形关联的最小相似度。[官方源码：stream loopback、detector gate 与 rect association](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/cc/vision/pose_landmarker/pose_landmarker_graph.cc#L336-L370)

这说明 MediaPipe 已经提供局部 ROI 连续性，不需要 Form Coach 再用“身体比例必须几乎不变”重复做一次严格身份验真。但它的关联仍然以矩形重叠为基础；多人交叉、快速位移、遮挡或检测器重新介入时，宿主仍需维护产品自己的主体状态。

此外，MediaPipe 当前只对单姿态模式启用 landmark smoothing；官方源码明确指出多人 landmark smoothing 尚不支持。[官方源码：单人 smoothing 限制](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/cc/vision/pose_landmarker/pose_landmarker_graph.cc#L303-L318) 如果 Form Coach 设置 `numPoses > 1`，应在选定主体之后自行做时间平滑，不能假设 MediaPipe 已平滑每个人。

### 3. 不得依赖候选数组顺序

官方公开 API 只把输出定义为姿态列表，没有说明按面积、中心距离、置信度或稳定身份排序。[官方结果说明](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js#handle_and_display_results)

更重要的是，底层 association calculator 会合并多个输入向量：重叠时保留后输入流的元素，并通过删除旧元素、把新元素追加到列表的方式构造结果。[官方 AssociationCalculator 语义](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/calculators/util/association_calculator.h#L34-L45)，[官方列表合并实现](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/calculators/util/association_calculator.h#L125-L150)。因此即使某个样本里 `poses[0]` 看似稳定，也没有可依赖的公共排序契约。

宿主层必须对每帧所有候选计算与现有主体轨迹的关联成本，再选最匹配者；“每帧取第一个”只可作为没有历史状态且只有一个候选时的退化路径。

### 4. 成熟实时追踪采用轨迹生命周期，而不是一帧失败就删除

SORT 原始论文用卡尔曼滤波预测运动，并用匈牙利算法完成检测与轨迹的全局匹配，说明实时跟踪可以在很轻的计算量下以运动模型为主完成关联。[SORT 原始论文](https://arxiv.org/abs/1602.00763)

Deep SORT 在 SORT 上加入人物外观关联，原始论文报告它能跨越更长遮挡并降低 identity switches；其官方实现把新轨迹分为 tentative / confirmed / deleted，并允许 confirmed track 连续丢失 `max_age` 帧后才删除，默认 `n_init = 3`、`max_age = 30`。[Deep SORT 原始论文](https://arxiv.org/abs/1703.07402)，[官方 tracker 实现](https://github.com/nwojke/deep_sort/blob/master/deep_sort/tracker.py#L19-L38)，[官方 track 删除规则](https://github.com/nwojke/deep_sort/blob/master/deep_sort/track.py#L148-L160)

ByteTrack 的核心发现是：遮挡会让真目标变成低分检测，如果直接丢弃这些检测会造成轨迹缺失和碎片；它先关联高分检测，再用低分检测恢复未匹配轨迹。[ByteTrack 原始论文](https://arxiv.org/abs/2110.06864)，[官方两阶段关联实现](https://github.com/FoundationVision/ByteTrack/blob/main/yolox/tracker/byte_tracker.py#L329-L398)。这直接支持 Form Coach 的策略：低可见度帧应降低动作证据置信度，但只要仍与主体轨迹连续，就不应立即把人物变成全 unknown 或切换到别人。

## 建议的 Form Coach 主体追踪模型

下面的阈值是**面向当前居家健身视频的工程初值**，不是上述论文给出的通用真值；必须用项目现有全部视频做留出验证后固化。

### 状态机

```text
NO_SUBJECT
  └─ 候选连续出现 → PROVISIONAL
       ├─ 连续匹配 2 帧（唯一候选）或 3 帧（多人）→ TRACKED
       └─ 立即消失 → NO_SUBJECT

TRACKED
  ├─ 匹配到连续候选 → TRACKED
  ├─ 仅低质量但连续的候选 → TRACKED_WEAK
  └─ 未匹配 → LOST_GRACE

LOST_GRACE
  ├─ 原主体在 0.9 秒内重新匹配 → TRACKED
  └─ 超过 0.9 秒仍未匹配 → RESELECT

RESELECT
  └─ 新候选连续稳定 3 帧 → TRACKED（生成新的 subject epoch）
```

原则是：**锁定容易，保持宽松，切换谨慎**。`TRACKED_WEAK` 可以降低动作计数/纠正的置信度，但不应因为一次严格身份检查失败就输出 33 个 unknown。真正没有当前观测的 `LOST_GRACE` 期间也不应伪造关键点；可以保留主体身份和最后 ROI 用于重关联，同时暂停计数并在 UI 标注“追踪暂时中断”。

### 初次主体选择：不使用屏幕中心

在 3–5 帧短窗口内为每条候选轨迹计算：

```text
initial_score =
    0.45 × required_joint_completeness
  + 0.25 × track_persistence
  + 0.20 × visible_body_area
  + 0.10 × pose_presence_quality
```

- `required_joint_completeness`：按当前动作需要的关键点计算，而不是要求所有 33 点均可见。例如站立提膝应优先肩、髋、膝、踝；引体向上不能因脚出画就否定上肢主体。
- `track_persistence`：短窗口内连续出现的比例；偶然路人不容易胜出。
- `visible_body_area`：用可见关键点外接框或 pose rect 的画面面积；面积大只是主体线索，不是身份特征。
- `pose_presence_quality`：关键点的 presence/visibility 汇总。
- **屏幕中心权重为 0**。用户可以站在画面左侧或右侧；中心只能在产品明确要求固定站位时作为 UI 校准条件，不能作为主体身份规则。

若画面只有一个达到最低可用度的候选，立即把它作为 `PROVISIONAL` 输出，第二个连续匹配帧转 `TRACKED`；不要再等待固定 500 ms 才输出任何骨架。

### 已锁定后的关联成本

先为上一主体轨迹预测本帧 ROI，再对所有候选计算：

```text
continuity_cost =
    0.40 × predicted_roi_distance
  + 0.30 × (1 - roi_iou)
  + 0.20 × normalized_joint_motion_error
  + 0.10 × appearance_distance_optional
```

- `predicted_roi_distance` 应按上一主体框尺度归一化，人物从左侧走到右侧是正常运动，不与屏幕中心比较。
- `roi_iou` 和速度预测承担主要的短期连续性；这与 SORT/MediaPipe 自身的矩形关联思路一致。
- `normalized_joint_motion_error` 只比较双方都可见的关节，并按躯干尺度归一化；快速动作时应放宽 gate。
- `appearance_distance_optional` 仅在两个候选运动成本接近时作 tie-break。若当前端侧预算不允许 ReID，可以先用低分辨率躯干颜色直方图；它不能成为输出骨架的硬门槛。
- 肩宽/躯干高、检测框尺度、身体比例不作为 hard reject。它们随姿势、透视和遮挡变化太大，只能作为极弱辅助或异常诊断特征。

如果只有一个可用候选，并且它的运动/ROI 与上一主体没有明显断裂，应优先续接；如果多人交叉使两名候选都可行，则保持上一主体轨迹为 `TRACKED_WEAK`，而不是立即改选分数更高的候选。

### 切换规则

只有同时满足下列条件才生成新的主体 epoch：

1. 原主体已经超过 `lost_grace_ms` 没有可靠或弱匹配；
2. 新候选连续出现至少 3 帧；
3. 新候选的主体分数达到最低可用度；
4. 新候选不是在原主体预测 ROI 周围重新出现的恢复候选。

默认建议 `lost_grace_ms = 900`，并在 600–1200 ms 范围用现有视频扫描。时间必须用帧 timestamp 计算，不能假定所有视频恒为 30 FPS。Deep SORT/ByteTrack 的 `max_age`/buffer 证明“轨迹先进入 lost、过一段时间才删除”是成熟追踪的常规设计，但 900 ms 是本产品为运动速度、反馈延迟和视频帧率作出的假设，不是论文常数。

## 识别输出应拆成三层

| 层 | 回答的问题 | 失败时行为 |
| --- | --- | --- |
| Pose detection | 当前帧有没有人体候选和可见关键点？ | 没有观测，不生成伪骨架 |
| Subject tracking | 哪条候选轨迹是课程主体？ | 保留主体 epoch 进入 grace，暂停计数；不立即换人 |
| Action recognition | 主体是否在做指定动作、处于什么相位？ | 返回 unknown/unsupported action，但不能反过来清空主体骨架 |

当前系统“未达到严格身份锁定就把 canonical packet 全部变成 unknown”把第二层失败扩散到了第一层。应改为：只要存在与主体连续、质量达到显示下限的当前观测，就发布这条骨架；动作层独立决定该帧是否足以计数或纠正。

## 对“目前提供的视频都可识别”的验证口径

不能只看最终 UI 是否偶尔出现骨架。建议给所有现有视频补齐一张 manifest：`video_id / expected_subject / expected_action / view / supported_profile / annotated_intervals`，然后逐视频输出以下指标：

1. **主体选择**：首次出现可用候选后 500 ms 内进入 `TRACKED`；主体不要求靠近屏幕中心。
2. **主体保持**：预期主体未离场的视频，`subject_epoch_count = 1`，不发生人物切换。
3. **骨架覆盖**：在 MediaPipe 至少存在一个与主体连续的可用候选帧中，canonical skeleton 发布率不低于 95%；不能再出现“候选存在但因比例阈值失败而全 unknown”。
4. **遮挡恢复**：短于 900 ms 的丢失不会生成新 subject epoch；恢复后沿用同一主体。
5. **动作结果**：只有 `supported_profile = true` 的视频要求动作标签、相位和计数正确；无 profile 的动作必须明确返回 `unsupported`，不能把“人物已追踪”误报成“动作已识别”。
6. **逐视频诊断**：失败报告必须区分 `no_pose_candidate`、`subject_association_failed`、`insufficient_required_joints`、`unsupported_action_profile` 和 `action_mismatch`。

建议额外保留三类压力样本：主体偏左/偏右、路人进入后离开、主体短暂被器械或身体自身遮挡。它们分别验证“不以中心为主体”“不轻易换人”和“有 grace 的恢复”。

## 不应继续采用的假设

- 不假设 `poses[0]` 是最大、最中心、最显著或与上一帧同一个人。
- 不把画面中心距离作为主体评分项或 hard gate。
- 不要求肩髋比例、人体框尺度或 torso geometry 在健身动作中近似不变。
- 不因一帧 tracking confidence 下降就删除主体或发布 33 个 unknown。
- 不把 MediaPipe 的 ROI association 当作稳定业务 `track id`。
- 不把“识别到主体人物”与“已支持该动作 profile”合并成一个状态。
- 不在 `numPoses > 1` 时假设 MediaPipe 已替每个人做 landmark smoothing；应先选择主体，再在主体 epoch 内平滑。

## 建议实施顺序

1. 先移除 `CentralStable` 中身体比例/颜色对骨架发布的硬否决，把它改为 `DominantSubjectTracker` 状态机。
2. 用全部现有视频建立 manifest 和逐帧追踪诊断，先做到主体 epoch 稳定、骨架覆盖恢复。
3. 将动作 profile 的覆盖/失败与人物追踪分离验收；缺失 profile 单独补齐，不再通过收紧追踪门槛掩盖。
4. 多人交叉仍有明显换人时，再评估端侧轻量 ReID；在证据表明必要前，不引入完整 Deep SORT 外观网络。

## 来源索引

- Google, [Pose landmark detection guide for Web](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
- Google MediaPipe, [PoseLandmarkerGraph source](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/cc/vision/pose_landmarker/pose_landmarker_graph.cc)
- Google MediaPipe, [AssociationCalculator source](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/calculators/util/association_calculator.h)
- Bazarevsky et al., [BlazePose: On-device Real-time Body Pose Tracking](https://arxiv.org/abs/2006.10204)
- Bewley et al., [Simple Online and Realtime Tracking (SORT)](https://arxiv.org/abs/1602.00763)
- Wojke et al., [Simple Online and Realtime Tracking with a Deep Association Metric (Deep SORT)](https://arxiv.org/abs/1703.07402)
- Wojke et al., [Deep SORT official implementation](https://github.com/nwojke/deep_sort)
- Zhang et al., [ByteTrack: Multi-Object Tracking by Associating Every Detection Box](https://arxiv.org/abs/2110.06864)
- FoundationVision, [ByteTrack official implementation](https://github.com/FoundationVision/ByteTrack)
