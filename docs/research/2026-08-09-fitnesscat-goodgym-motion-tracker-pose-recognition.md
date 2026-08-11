# 健身猫、GoodGYM、Motion Tracker 与海外相机健身产品：骨架追踪与动作识别核验

日期：2026-08-09  
范围：只比较单目摄像头下的骨架检测、跨帧主体追踪、动作确认/阶段/计数。课程、社区、饮食、订阅和一般 AI 文案不进入技术结论。  
结论口径：应用商店和官网只能证明开发者公开宣称的产品能力；只有公开源码、官方框架文档或可复现实验才能支持实现层判断。

## 结论先行

1. **这条产品方向在技术上可行，但可行的是“规定机位 + 先选动作 + 可见性门控 + 阶段/次数识别”，不是开放环境下自动理解所有动作，更不是仅凭 2D 骨架可靠纠正姿势。** GoodGYM、Motion Tracker 以及多款独立开发者 App 实际上都采用这条窄路径：先选动作，再用少量关键点、角度/距离、平滑与状态机计数。
2. **健身猫是本次语境中与 MaxPower 产品方向最接近的对象，但公开技术证据最少。** 已唯一定位到 `fitnesscat.object-x.com.cn` 所对应的内测 App；第三方帖子明确称其为“抖音博主开发的健身猫 App，目前在内测”，官网声称相机实时分析和纠正，但没有公开模型、关键点、动作表、主体选择、端侧/云端、性能或准确率材料。[即刻识别线索](https://m.okjike.com/users/82B5C7F5-014F-441E-92D1-3D39620868B6) · [健身猫官网](https://fitnesscat.object-x.com.cn/)
3. **GoodGYM 是最值得做源码对照的轻量基线。** 桌面源码为 YOLOX-nano 人体框 + RTMPose-t/s/m（COCO-17）+ ONNX Runtime；动作由用户预先选择，11 个 JSON profile 用双侧关节角、5 帧平滑、上下阈值和 0.5 秒最短间隔计数。它没有动作分类器，没有姿势纠错实现，也没有可靠的多人主体锁定。[姿态处理源码](https://github.com/yo-WASSUP/Good-GYM/blob/ec0b2abcbf79a9ea53853313e1a2f05911f5c18b/core/rtmpose_processor.py#L39-L84) · [计数源码](https://github.com/yo-WASSUP/Good-GYM/blob/ec0b2abcbf79a9ea53853313e1a2f05911f5c18b/exercise_counters.py#L121-L219) · [动作配置](https://github.com/yo-WASSUP/Good-GYM/blob/ec0b2abcbf79a9ea53853313e1a2f05911f5c18b/data/exercises.json)
4. **MindDock/motion-tracker 更像展示型 Python 原型，不应当作生产算法基线。** 源码实际只有 MediaPipe backend、单人 33 点和 4 个手工动作状态机；README 所写 Apple Vision、YOLO11、3–5°、35+ FPS 和“生产级”没有随仓库提供对应 backend 或可复核基准。[MediaPipe backend](https://github.com/MindDock/motion-tracker/blob/3b9c645224e18c3badc2c0bc96b0f45848dc5452/src/backends/mediapipe_backend.py#L135-L204) · [缺少 backend 的公开 issue](https://github.com/MindDock/motion-tracker/issues/2)
5. **MaxPower 目前不是“骨架模型落后”，主要短板是证据覆盖与 Android 主体追踪不一致。** Web 已有最多 4 候选、基于骨架/框/躯干颜色的连续性成本、主体切换确认和点选目标；GoodGYM 每帧只取第一人，Motion Tracker 固定单人。可是 Android 当前 MediaPipe 路径仍最多一个人，尚未复用 Web 的多候选能力。应优先统一三端主体合同，并用 RTMPose 做同一批视频的 A/B evaluator，而不是立即替换 MediaPipe。
6. **当前“65/65 个动作有 executable profile”只证明引擎能装载和运行，不证明 65 个动作已识别准确。** 本地最新人工观测回放仅覆盖特定 action×view：73 个有 profile 的标注 rep 上得到 79 个确认、60 个峰值匹配，匹配召回 82.2%、精度 75.9%，且是同批数据回放，不是独立准确率。[当前 profile 盘点](2026-08-08-rust-motion-profiles-android-injection.md) · [观察回放](../reports/observed-profile-replay-2026-08-08.md)

## 1. 先把三个技术层分开

| 层 | 真正回答的问题 | 常见误判 |
| --- | --- | --- |
| 单帧 pose estimation | 这一帧里有哪些人体关键点、坐标和置信度？ | 画出骨架就说“能识别动作” |
| 跨帧 subject tracking | 下一帧的骨架是否仍属于同一个用户；丢失/遮挡后如何恢复？ | 模型内部 ROI tracking 被误称为多人身份锁 |
| 动作 recognition / phase / rep | 已知或未知动作下，如何判断动作种类、阶段、完整循环和次数？ | 用户先选动作后的阈值计数被说成“AI 自动识别所有动作” |

本报告中的“动作识别能力”优先指 MaxPower 第一版目标：**用户先选动作，系统实时确认当前动作、输出阶段并计数**。它不要求一个通用分类器在 65 个动作中猜动作，也不包含动作质量纠正。

## 2. 对象识别：这里的“健身猫”是哪一个

本次语境中的对象是 [健身猫官网](https://fitnesscat.object-x.com.cn/)。即刻页面在 2026-08-09 可见的帖子写明“抖音博主开发的健身猫 App，目前在内测中”，并直接链接该域名，因此可以排除同名或近名的健身房管理、教练撮合类旧产品。[即刻页面](https://m.okjike.com/users/82B5C7F5-014F-441E-92D1-3D39620868B6)

官网静态首屏声称：使用手机摄像头实时分析动作姿势并给出问题反馈；页面结构还为 iOS、Android/TestFlight/APK 下载、演示媒体和截图预留动态配置。但截至本次核验，动态配置接口返回 `503 no healthy upstream`，未能取得可安装包、商店链接或完整演示。因此可确认的只有**产品主张**，不能反推出实际算法。

公开材料未披露：

- 使用 MediaPipe、RTMPose、Vision、MoveNet 还是自研模型；
- 关键点拓扑、是否有世界坐标、单人还是多人；
- 主体如何锁定、用户是否必须居中、遮挡后是否维持身份；
- 支持动作清单、动作是否预选、阶段/计数状态机；
- 推理在端侧还是云端、设备要求、FPS、热量/功耗；
- 计数、阶段或纠正的标注集、错误率与适用机位。

所以健身猫可作为“相机 AI 教练”方向的市场参照，**不能作为 MaxPower 算法可行性、准确率或纠正能力的证据**。下一步若取得 TestFlight/APK，应做黑盒 10-rep protocol：同一动作至少覆盖两人、两距离、两光照、标准机位/偏移机位、单人/路人进入，并逐项记录漏计、误计、主体切换和拒绝状态。

## 3. GoodGYM 源码核验

### 3.1 单帧骨架

在固定提交 `ec0b2ab` 上，桌面源码通过 `rtmlib.Wholebody` 组合：

- YOLOX-nano 人体 detector，输入 `416×416`；
- RTMPose-t/s/m，姿态输入 `256×192`；
- ONNX Runtime，默认 CPU；
- COCO-17 点：鼻、眼、耳、肩、肘、腕、髋、膝、踝；
- 超过 640 的输入先缩小；关键点分数低于 0.5 时直接把坐标改为 `(0,0)`。

这些都可在 [RTMPoseProcessor 初始化和处理路径](https://github.com/yo-WASSUP/Good-GYM/blob/ec0b2abcbf79a9ea53853313e1a2f05911f5c18b/core/rtmpose_processor.py#L39-L98) 与 [逐帧处理](https://github.com/yo-WASSUP/Good-GYM/blob/ec0b2abcbf79a9ea53853313e1a2f05911f5c18b/core/rtmpose_processor.py#L157-L204) 中直接核对。

`rtmlib.Wholebody` 是 top-down 路径：每次先检测人体框，再对所有框运行姿态模型。[Wholebody 源码](https://github.com/Tau-J/rtmlib/blob/03a1693e59e4f7cd84582c0fb30459b3bf18ad42/rtmlib/tools/solution/wholebody.py#L51-L112) GoodGYM 没有调用 rtmlib 另提供的 `PoseTracker`；后者才支持每 N 帧重跑 detector，并用前帧框/IoU 维护 track id。[PoseTracker 源码](https://github.com/Tau-J/rtmlib/blob/03a1693e59e4f7cd84582c0fb30459b3bf18ad42/rtmlib/tools/solution/pose_tracker.py)

### 3.2 多人与主体选择

GoodGYM 得到多个人后直接读取 `detected_keypoints[0]`，注释把它称为“最高置信度的人”。[取第一人的源码](https://github.com/yo-WASSUP/Good-GYM/blob/ec0b2abcbf79a9ea53853313e1a2f05911f5c18b/core/rtmpose_processor.py#L178-L198) 这不是跨帧身份锁：

- 没有用户点选、空间区域、面积/可见性 dominance；
- 没有前后帧骨架距离、外观或 track id；
- 没有候选切换确认和 subject epoch；
- 当两人的 detector 顺序变化时，计数状态可能转移到另一人。

因此 GoodGYM 可称“每帧支持检测多人后选一人”，不能称“多人主体稳定追踪”。

### 3.3 动作与计数

桌面源码的 11 个动作是：深蹲、俯卧撑、仰卧起坐、二头弯举、侧平举、过顶推举、抬腿、提膝、夹膝/膝压、卷腹、引体向上。[动作映射](https://github.com/yo-WASSUP/Good-GYM/blob/ec0b2abcbf79a9ea53853313e1a2f05911f5c18b/core/rtmpose_processor.py#L206-L230)

它不是动作分类器。用户先在 UI 选 `exercise_type`，系统才调用该动作的 counter。每个 [JSON 动作配置](https://github.com/yo-WASSUP/Good-GYM/blob/ec0b2abcbf79a9ea53853313e1a2f05911f5c18b/data/exercises.json) 只包含：

- 左右各三个点形成的一个关节角；
- `down_angle` / `up_angle`；
- 方向和是否左右腿分开计数。

通用计数器对左右角取平均，使用 5 帧历史做中值去异常后求均值，再用 `up/down` 两状态和 0.5 秒最短 rep 间隔计数。[平滑](https://github.com/yo-WASSUP/Good-GYM/blob/ec0b2abcbf79a9ea53853313e1a2f05911f5c18b/exercise_counters.py#L121-L146) · [状态机](https://github.com/yo-WASSUP/Good-GYM/blob/ec0b2abcbf79a9ea53853313e1a2f05911f5c18b/exercise_counters.py#L155-L219) 视频处理层把推理节流到约 20 Hz，并在其余显示帧复用上次结果。[视频处理](https://github.com/yo-WASSUP/Good-GYM/blob/ec0b2abcbf79a9ea53853313e1a2f05911f5c18b/app/video_processor.py#L15-L56)

优点是结构小、动作可配置、容易扩展。限制是没有：完整 rep 的多阶段证据、required-joint coverage gate、机位 profile、遮挡恢复、partial/uncertain outcome、逐动作独立评估集或已发布计数指标。

### 3.4 “纠错”与 iOS 能力边界

仓库开发计划仍把“动作纠错提示”列为未完成，因此不能把实时骨架和角度展示称为已实现纠错。[README 开发计划](https://github.com/yo-WASSUP/Good-GYM/blob/ec0b2abcbf79a9ea53853313e1a2f05911f5c18b/README_CN.md#L52-L77)

iOS App 已正式上架。当前商店页称其支持深蹲、俯卧撑、二头弯举、推举、侧平举、提膝、侧抬膝、交替抬腿、臀桥、引体向上等，版本历史还显示姿态算法选择、骨架显示、手势切动作、语音提示、隐私模式等。[GoodGYM App Store](https://apps.apple.com/cn/app/goodgym-ai%E8%AF%86%E5%88%AB%E5%81%A5%E8%BA%AB%E8%AE%A1%E6%95%B0%E5%8A%A9%E6%89%8B/id6761142874) 但 GitHub 仓库没有 iOS 源码，所以：

- 不能确认 iOS 是否仍使用 RTMPose，也不能确认“算法选择”对应哪些模型；
- 不能从桌面 MIT 仓库推断 iOS 实现可复用；
- App Store 的“未收集数据”是开发者声明，不能单独证明所有推理路径均离线；
- 桌面 11 动作与当前 iOS 动作范围应分开记账。

GoodGYM 源码为 MIT，rtmlib 为 Apache-2.0；若商用复用仍需单独核对 ONNX checkpoint 和训练数据条款，而不能只看外层仓库许可证。[GoodGYM LICENSE](https://github.com/yo-WASSUP/Good-GYM/blob/ec0b2abcbf79a9ea53853313e1a2f05911f5c18b/LICENSE) · [rtmlib LICENSE](https://github.com/Tau-J/rtmlib/blob/03a1693e59e4f7cd84582c0fb30459b3bf18ad42/LICENSE)

## 4. MindDock/motion-tracker 源码核验

### 4.1 实际实现小于 README 声称范围

固定提交 `3b9c645` 的 `src/backends/` 只有 `mediapipe_backend.py`。它使用 MediaPipe Tasks Pose Landmarker，`VIDEO` 模式、`num_poses=1`、33 个 image landmarks 和 world landmarks，并始终取第一人。[backend 配置](https://github.com/MindDock/motion-tracker/blob/3b9c645224e18c3badc2c0bc96b0f45848dc5452/src/backends/mediapipe_backend.py#L135-L204) 仓库公开 issue 也在追问 README 所写的 Apple Vision 和 YOLO backend 在哪里。[Issue #2](https://github.com/MindDock/motion-tracker/issues/2)

MediaPipe 官方确实采用 detector + landmark tracker：第一帧或丢失后运行 detector，其余视频帧从上帧 landmarks 推导 ROI，以降低延迟；它输出 33 点与以髋中心为原点的 world coordinates。[MediaPipe Pose 说明](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md) 但这是 ROI/landmark 连续追踪，不是多人 identity association。`num_poses=1` 的应用仍会面临路人抢占或重新检测后换人的问题。

### 4.2 动作识别与计数

Fitness demo 只有 4 个动作：深蹲、俯卧撑、二头弯举、肩推；用户用参数或数字键 1–4 选择动作。[动作枚举与选择](https://github.com/MindDock/motion-tracker/blob/3b9c645224e18c3badc2c0bc96b0f45848dc5452/demos/fitness_trainer_demo.py#L1-L89)

每个动作只取左膝或左肘一个角度，使用固定高低阈值和 `idle/down/up` 状态机；`min_frames_between_reps=15` 是帧数而非真实时间。[计数状态机](https://github.com/MindDock/motion-tracker/blob/3b9c645224e18c3badc2c0bc96b0f45848dc5452/demos/fitness_trainer_demo.py#L91-L153) 当 FPS 改变或设备掉帧时，同一个动作的最短时长会变化。

所谓 form feedback 也是少量未校准阈值，例如左右膝差 15°、髋角或肩角区间。[反馈规则](https://github.com/MindDock/motion-tracker/blob/3b9c645224e18c3badc2c0bc96b0f45848dc5452/demos/fitness_trainer_demo.py#L161-L223) 仓库没有被试视频、人工 rep 标签、纠错金标准或误差报告；测试主要是合成坐标的角度单元测试。因此 README 的“3–5° athlete-grade”“35+ FPS”“battle-tested”应视为未经仓库证据支持的作者主张。[README 声明](https://github.com/MindDock/motion-tracker/blob/3b9c645224e18c3badc2c0bc96b0f45848dc5452/README.md#L17-L52)

### 4.3 对 MaxPower 的价值

- 可借鉴：MediaPipe world landmarks 的统一封装、角度计算和简单 demo；MIT 许可易于阅读参考。
- 不应借鉴：单人第一候选、按帧数限速、一个关节的无机位阈值、把固定阈值称为纠错。
- 不能直接使用：仓库 roadmap 仍把 iOS/iPadOS app 列为未来项；它不是可嵌入 Android/iOS 的生产 SDK。[README roadmap](https://github.com/MindDock/motion-tracker/blob/3b9c645224e18c3badc2c0bc96b0f45848dc5452/README.md#L191-L205)

## 5. 海外独立开发者/小团队 App 观察

这些产品证明“手机支架 + 相机 + 用户先选动作 + 端侧计数”已是独立开发者可交付的产品形态，但公开页几乎都没有可复核准确率。下表只记录骨架/动作层，不把营销功能混入。

证据等级定义：**A-code** = 核心实现源码可审计，但不代表产品成熟或准确；**B-tech** = 真实商店产品且公开点名 pose 框架或给出较具体技术边界，但核心代码不公开；**C-claim** = 真实商店产品，只有开发者功能声明；**D-landing** = 官网/内测宣传，尚无可取得构建或商店页。App Store 的开发者字段可以支持“个人/小开发者上架”，但没有一手材料披露其是否使用 AI coding 工具，所以本报告不把任何产品武断标成“vibe-coded”；这里只把它们作为与 vibe coding 时代相符的低团队门槛样本。

| 产品 | 等级 | 可核验的相机能力 | 动作范围与实现线索 | 不能据此宣称 |
| --- | --- | --- | --- | --- |
| [RepStandard](https://apps.apple.com/us/app/repstandard-home-workouts/id6761927539) | B-tech | iPhone；商店要求手机侧放，摄像头免手计数 | 俯卧撑、深蹲、仰卧起坐、平板；两位 maker 在 Product Hunt 称全部端侧，仰卧起坐因个体技巧/RoM 差异最难，旧 iPhone 长时间会发热。[maker 说明](https://www.producthunt.com/products/repstandard) | 未公开模型、关键点、多人锁、错误率；“tracks form”不是纠错验证 |
| [Fitnit](https://apps.apple.com/us/app/fitnit-ai-rep-counter/id6757887175) | C-claim | 单独开发者上架；声称 iPhone 端侧 pose、实时骨架/角度/提示 | 俯卧撑、深蹲、弯举、卷腹、引体；版本说明提到“跟踪正在训练的手臂、忽略换手”，说明边界条件需要专项规则 | 未公开模型和评测，商店的 form score 不能当生物力学正确性 |
| [PoseRep](https://apps.apple.com/us/app/poserep-ai-fitness-tracker/id6759505171) | C-claim | 单独开发者上架；明确声称端侧 17 点 | 深蹲、俯卧撑、弓步、弯举、肩推等，自动计数和 form 分析 | 17 点提示可能是 COCO 拓扑，但未披露具体框架；“precision”没有公开数据 |
| [Neon Pose](https://play.google.com/store/apps/details?id=com.justwitworks.neonpose) | B-tech | Android；明确写 Google ML Kit、实时骨架、分数 | 商店主文列深蹲/俯卧撑/仰卧起坐，更新又加入臀桥、卷腹、Pike push-up、Russian twist、Bird dog | ML Kit 只输出 pose；ROM/稳定/姿势/对称评分仍是开发者自定义逻辑，未公开验证 |
| [LoopCam](https://apps.apple.com/us/app/loopcam-ar-workout-counter/id6772089467) | B-tech | 单独开发者；iPhone 端侧 pose、本地录制、手势控制 | 商店页强调单人、完整可见、光照和机位；官网称只在可见性/置信度/人数满足时计数。[官网](https://getloopcam.com/) | 明确不保证 form quality，不是医疗或认证教练；动作细节与算法未公开 |
| [RepCounter AI](https://www.repcounterai.app/) | D-landing | 浏览器 PWA 官网；明确 MediaPipe 33 点、本地处理、可离线 | 俯卧撑看肘角/身体对齐，深蹲看髋膝踝角，另有开合跳；用户先选动作 | 官网“每次都正确”是营销语，没有商店/源码/评测支撑 |
| [PUSHUP — AI Rep Counter](https://apps.apple.com/jp/app/pushup-ai-rep-counter/id6761273317) | B-tech | 个人开发者上架；商店明确写 MoveNet + TensorFlow.js、完全离线 | 只做俯卧撑；显示动作阶段、深度、肘部与身体对齐，并允许手工 `+/-` 修正次数 | 单动作范围不能外推到通用健身识别，但证明“窄动作 + 可恢复计数”更容易做实 |
| [Rep Ref](https://apps.apple.com/us/app/rep-ref/id6778264765) | B-tech | 独立开发者公开称使用端侧 MediaPipe；相机结果用于挑战验证 | 当前重点是俯卧撑和深蹲；产品把骨架识别作为排行榜的可信证明层，而不是泛化纠错器。[开发者发布帖](https://www.reddit.com/r/apps/comments/1v4p68v/made_an_app_for_group_fitness_challenges_where/) | 开发者自述和早期用户量不是准确率评测 |
| [WorkoutSentinel](https://apps.apple.com/in/app/workoutsentinel/id6756504196) | B-tech | 个人开发者上架；商店明确 MediaPipe 端侧运行、语音反馈 | 俯卧撑、深蹲、开合跳、站姿髋外展、弓步；课后输出 A/B/C form grade | 没有公开 grade 的标签定义、校准集或跨人一致性 |
| [Lift App — AI Barbell Tracker](https://apps.apple.com/us/app/lift-app-ai-barbell-tracker/id6756862700) | C-claim | 独立早期 App；声称同时追踪杠铃片/杠铃轨迹与人体 pose | 速度、轨迹、跳跃和 Apple Watch 交叉验证；与 MaxPower 器械视频方向相关 | 评分与样本极少，模型和误差不公开，只能作为困难场景假设，不能作为可行性证据 |

同一口径下：GoodGYM 桌面源码为 **A-code**，GoodGYM iOS 为 **C-claim**，健身猫为 **D-landing**，MindDock/motion-tracker 为 **A-code**。等级只描述证据类型，不是产品排名。

共同模式比具体品牌更重要：

1. 动作集合普遍很小，常从深蹲、俯卧撑、卷腹/仰卧起坐和弯举开始；
2. 大多数是“预选动作后的专用 counter”，不是开放集 action recognition；
3. 端侧处理与声音/大号计数减少了用户边看屏幕边运动的负担；
4. 真正可信的产品会暴露“不确定/请调整机位”，而不是无骨架时继续猜；
5. 没有任何一个公开商店页足以证明它可在任意机位、多人、遮挡和器械场景稳定工作。

### 5.1 “Vibe coding 产物”能证明什么

“vibe-coded”不是 App Store 可检索或可审计的技术属性。除非作者主动披露开发过程，否则不能仅凭产品小、更新快或使用现成模型就给它贴这个标签。可确认的例子是 [ReadyWOD 的作者说明](https://www.readywod.com/about)：产品使用 Cursor 等 AI 编程工具构建，但它是训练计划/记录产品，没有相机 pose，因此不进入上面的骨架能力比较。

对本项目更有价值的事实是：Rep Ref、PUSHUP、Fitnit、PoseRep 等个人或小团队产品，都把成熟的 MediaPipe/MoveNet 当作 pose 层，把主要开发工作放在相机流程、动作专用状态机、语音、记录和失败恢复上。换言之，vibe coding 确实降低了“做出相机健身 App”的门槛，但**没有降低数据标注、跨人验证、主体身份稳定和纠错安全性的门槛**。没有公开源码或测试集时，产品能上架只能证明工程可交付，不能证明算法可靠。

## 6. 其他开源骨架方案：输出数据与追踪方式

| 项目/框架 | 单帧骨架数据 | 跨帧 tracking | 移动端与许可 | 对 MaxPower 的实际意义 |
| --- | --- | --- | --- | --- |
| [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) | BlazePose-33；image-normalized x/y/z、visibility；33 点 world x/y/z（米，髋中心原点） | 视频模式用前帧 ROI 降低 detector 频率；可配多个 pose，但不是持久身份/ReID | Android/iOS/Web/C++，Apache-2.0 代码；现有 MaxPower 主路径 | 继续作为移动端默认；保留 33 点和 world 坐标，外加自有主体锁 |
| [MoveNet](https://www.tensorflow.org/hub/tutorials/movenet) | COCO-17；Lightning / Thunder；另有 MultiPose | 模型本身可逐帧多人，稳定 identity 仍需应用层 association | TFLite / TF.js；官方称现代手机可实时 | 适合作为低端 Android 的备选基线；缺手/足细点和 world coords，迁移成本高于直接收益 |
| [ML Kit Pose Detection](https://developers.google.com/ml-kit/vision/pose-detection) | 33 点、InFrameLikelihood；Z 是实验性图像尺度，不是真实 3D | 只检测一人；两人时取最高置信者 | Android/iOS；base/accurate 两 SDK，目前仍 beta | 集成快，但单人限制与健身猫/GoodGYM同类抢人风险；不优于现有跨平台合同 |
| [RTMPose / MMPose](https://github.com/open-mmlab/mmpose) + [rtmlib](https://github.com/Tau-J/rtmlib) | 常用 COCO-17，也有 26/133 whole-body；top-down 通常先 detector 再按框 pose | `Wholebody` 每次检测；`PoseTracker` 可按 IoU/框复用并输出 track id，但不是外观 ReID | PyTorch/ONNX Runtime/OpenCV；MMPose 与 rtmlib Apache-2.0 | 最值得做离线 A/B；若能显著改善器械遮挡/侧面关键点，再评估移动部署 |
| [Ultralytics YOLO Pose + Track](https://docs.ultralytics.com/modes/track/) | 默认人体 COCO-17，单阶段检测+pose | 可接 BoT-SORT/ByteTrack 等；支持 track buffer、运动模型，BoT-SORT 可选 ReID | 可导出多种格式；AGPL-3.0 或商业许可证 | 多人/拥挤更强，但移动端包、功耗、许可与 ReID 成本较高，不适合第一版默认 |
| [OpenPifPaf](https://github.com/openpifpaf/openpifpaf) | 多人 2D，可扩 whole-body | TCAF 将跨帧关键点时空关联直接建模 | PyTorch；研究/商用需核对其许可说明 | 可作为复杂遮挡下的研究参考，不是轻量移动端首选 |
| [OpenPose](https://github.com/CMU-Perceptual-Computing-Lab/openpose) | 多人 BODY_25/COCO、手、脸、足 | 提供单人 tracking/平滑，但整体偏桌面/GPU | 代码只允许非商业研究，商业需另授权。[许可证](https://github.com/CMU-Perceptual-Computing-Lab/openpose/blob/master/LICENSE) | 不能直接进入商业移动产品；只适合离线对照或文献参考 |

重要判断：**关键点更多不等于计数更准。** 对深蹲只需要髋/膝/踝时，17 点可能足够；对握杆、足跟、脚尖、腕部遮挡或伪 3D 机位判断，BlazePose-33 更有用。选择模型必须按动作所需关节覆盖率、抖动、掉点和移动端预算评估，而不能按 README 的总点数排序。

### 6.1 它们实际上怎样维持“同一个人”

- **MediaPipe Pose Landmarker**：检测器负责首次定位/丢失重获；连续视频帧从上一帧 landmarks 推导 ROI，跳过部分全图检测。优点是移动端轻；缺点是 ROI 连续不等于多人 identity，重检后仍可能换人。[官方 detector-tracker 说明](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md#ml-pipeline)
- **rtmlib PoseTracker**：每 `det_frequency` 帧运行 detector，其余帧把上一帧关键点包成扩大约 1.25 倍的框继续做 pose；新旧框按 IoU 做贪心关联，默认阈值 0.3，并返回 track id。它没有 Kalman、外观 ReID 或长遮挡 track buffer，适合借鉴“检测降频 + pose ROI”，不够直接承担复杂主体锁。[实现源码](https://github.com/Tau-J/rtmlib/blob/03a1693e59e4f7cd84582c0fb30459b3bf18ad42/rtmlib/tools/solution/pose_tracker.py)
- **MoveNet MultiPose + TF.js tracker**：最多输出 6 人；应用层可选择 bounding-box 或 keypoint tracker，并获得 pose id。它是 Web/低端机可测试的轻量 identity 基线，但 COCO-17 对手足和器械遮挡的信息少于 BlazePose-33。[MoveNet 官方说明](https://github.com/tensorflow/tfjs-models/blob/master/pose-detection/src/movenet/README.md)
- **ByteTrack / BoT-SORT**：在检测框层维护轨迹。ByteTrack 会利用低置信检测救回短暂被遮挡的人；BoT-SORT 再加入运动预测、相机运动补偿、track buffer，并可选 ReID。思路值得吸收到 MaxPower 的轻量主体管理器，完整 YOLO + tracker 栈则不适合作为首版离线移动依赖。[Ultralytics tracker 配置](https://docs.ultralytics.com/modes/track/#tracker-selection)

MaxPower 可采用一个比完整 MOT 更轻的版本：首次 acquisition 对候选人体面积、required-joint coverage 和 pose 分数做宽松排序；进入 locked 后以预测框 IoU、归一化关键点距离、尺度变化和弱外观特征维持身份；0.3–1 秒低置信期间保留 track 但暂停计数；同时周期性全图检测以便重获。画面出现第二个人不应让追踪直接失败，也不应自动切换到更居中的人。

### 6.2 从骨架数据到动作识别的开源路线

公开项目主要有三条路线：

1. **规则/profile**：GoodGYM、Motion Tracker 和多数独立 App 先选动作，再计算关节角/距离，用平滑、滞回和有限状态机确认阶段与次数。数据量要求最低、可解释、适合首版，但必须按机位设计并允许 `cannot_judge`。
2. **标准化姿态 + 轻分类器**：MediaPipe 官方的 [pose classification/rep counting 指南](https://chuoling.github.io/mediapipe/solutions/pose_classification.html) 建议按躯干尺度和方向归一化坐标，收集不同人物、机位和动作变体，再以 kNN 判断姿态类别，并用两个终态概率阈值计数。这适合未来用来确认“用户是否在做已选动作”，而不是一次猜 65 类。
3. **时空骨架网络**：开源 [ST-GCN](https://github.com/yysijie/st-gcn) / [MMAction2 skeleton models](https://github.com/open-mmlab/mmaction2/tree/main/configs/skeleton) 把关节点作为图、把连续帧作为时间维度学习动作类别。它适合开放集动作分类或长序列识别，但需要按目标相机分布采集大量标注序列，模型、数据和调试成本都高于第一版需求。

因此首版不应引入通用 ST-GCN 分类器。当前 action×view profile 应继续作为事实源；可在以后加入很小的 kNN、MLP 或 1D temporal classifier，只做当前所选动作的“符合/不符合”门控，并保留规则状态机负责可解释计数。

## 7. 与 MaxPower 当前能力的正面对照

| 能力 | MaxPower 当前 | GoodGYM | Motion Tracker |
| --- | --- | --- | --- |
| pose schema | Web/Android 主线 BlazePose-33；有 world landmarks；另有 RTMPose 实验路径 | RTMPose COCO-17 | MediaPipe 33 |
| 多候选 | Web 最多 4；Android 当前最多 1 | detector 可见多人，但只取第 1 | `num_poses=1` |
| 主体锁 | Web/Rust 用骨架距离 75% + 框中心 20% + 躯干颜色 5%，切换需持续 300 ms；支持点选 | 无跨帧主体身份 | 只有 MediaPipe 内部 ROI tracking |
| 用户必须居中 | 否；初始 dominance 以人体框面积与平均可见性为主 | 未见中心要求，但第一 detector 结果可抢占 | 最突出单人 |
| 动作选择 | exact action×view profile | 先选 11 动作之一 | 先选 4 动作之一 |
| 计数 | 时间戳、phase、最小幅度、return hysteresis、duration/gap、sealed rep/outcome | 5 帧平滑、双阈值、0.5 秒 cooldown | 单角度、双阈值、15 帧 gate |
| 不确定/拒绝 | packet 有 acquiring/locked/uncertain/lost、needs-review/rejected 路径 | 无完整 outcome 模型 | 无完整 outcome 模型 |
| 纠错 | 实验规则 validationSampleSize=0；当前不应输出确定纠错 | README 明确尚未实现 | 有未校准固定阈值文案 |
| 已公开证据 | 有标注回放，但仍是 provisional/in-sample | 无计数评测集 | 无计数评测集 |

MaxPower Web 主体逻辑可在 [`PoseEngine.ts`](../../src/pose/PoseEngine.ts)、[`rust/motion-sdk/src/lib.rs`](../../rust/motion-sdk/src/lib.rs) 与 [dominant-subject 设计](2026-08-06-dominant-subject-pose-tracking.md) 中核对。Android 当前是单 pose 的事实见 [Rust profile/Android 注入盘点](2026-08-08-rust-motion-profiles-android-injection.md)。

## 8. 建议：按收益和风险排序

### P0：先修“能否稳定计数”的证据闭环

1. **冻结三层指标，不再用一个“识别准确率”混称。**
   - Pose：required-joint coverage、置信度、坐标 jitter、连续丢失时长；
   - Subject：ID switch、subject epoch 数、路人进入后的主体保持、丢失恢复时间；
   - Rep：phase frame accuracy、峰值误差、rep precision/recall、partial rep、首次入相位延迟。
2. **把 65/65 executable coverage 与 validated coverage 分开展示。** 65 表示可运行，不表示已准确；每个 action×view 应有 `unmeasured / provisional / held-out validated / unsupported`。
3. **建立 held-out protocol。** 每个第一批动作至少按 participant、session、device、camera position 分组留出，不能把同一人的相邻 rep 随机拆进训练与验证。

### P1：统一 Web 与 Android 的主体合同

1. Android 不应长期停在“MediaPipe 只给第一人”。最低要求是在 acquire 阶段明确提示“仅一人入镜”，一旦人数/主体置信不可靠就暂停计数。
2. 更完整的方案是让 Android 输出多候选，复用 Rust `DominantVisible`、连续性 cost、300 ms 切换确认、1.5 秒丢失窗口和点选主体；不要照抄 GoodGYM 的 `[0]`。
3. 保持“主体不必居中”：初始选择可继续以人体尺度与 required-joint visibility 为主，屏幕中心只可作为很弱 tie-breaker。

### P1：让 RTMPose 成为 evaluator，而不是立刻成为产品依赖

对现有人工标注视频离线同时跑：

- MediaPipe Lite/Full；
- RTMPose-t/s + YOLOX-nano；
- 必要时 MoveNet Lightning 作为低端基线。

每个 action×view 比较 required-joint coverage、jitter、掉点时长、推理时延和最终 peak match。只有当 RTMPose 在卧推/器械遮挡等关键失败集上稳定提升，并满足手机的包大小、内存、热量和许可证预算，才进入移动端实验。GoodGYM 已证明这条模型组合能在普通 CPU 桌面做 20 Hz 左右的应用节流，但没有证明其在目标 Android 上优于 MediaPipe。

### P1：保留置信度，不要把缺失点伪装成零坐标

GoodGYM 把低于 0.5 的点直接改为 `(0,0)`，会混合“真实图像左上角”和“缺失”。MaxPower 应继续保存坐标、visibility/presence 和连续性来源，动作 profile 明确声明 required joints；关键点不足时输出 `insufficient_required_joints`，不能继续计算角度再猜。

### P2：吸收 GoodGYM 的配置简洁性，但保留 MaxPower 的状态机深度

可借鉴它“一动作一小份 JSON profile、无需改 counter 代码”的扩展体验；不可退化为单角度 `up/down`。MaxPower profile 仍应包含 exact view、signal、direction、ready、min amplitude、hysteresis、min/max rep duration、gap、required-joint coverage、identity/hash 和 evidence 状态。

### P2：做真实移动端长时测试

独立产品 RepStandard 的 maker 公开提到较旧 iPhone 长时间运行会发热。[Product Hunt 讨论](https://www.producthunt.com/products/repstandard) MaxPower 的目标课程虽只有 6–8 分钟，也应至少跑：冷启动 8 分钟、连续两节 16 分钟、前后摄像头、低/中/高端 Android，并记录 pose Hz、掉帧、温升/降频、内存和电量。实时 UI 可 30/60 FPS，pose inference 不必逐显示帧运行；关键是使用真实 timestamp 而不是 Motion Tracker 的固定帧数门。

## 9. 第一轮技术验证建议动作

优先选择全身/关键关节容易入镜、周期明显、无需器械遮挡的动作：

1. `bodyweight_squat`：正面或 45°，髋膝踝周期明显；
2. `march_in_place` / `alternating_knee_raise`：正面，左右交替可验证 phase 与交替状态机；
3. `side_step_touch` / `step_jack`：正面，全身横向/竖向距离信号；
4. `lateral_raise`：正面，肩腕高度与双侧可见；
5. `push_up`：侧后 45°，作为地面动作与低机位压力测试。

杠铃卧推、固定器械胸推可继续保留为后续困难集，但不应作为第一轮“移动端端到端可行性”的成败动作。现有回放已经显示正面杠铃卧推肩—肘—腕完整可见率只有约 14%–24%，在换 pose backend 前也要先承认这是观测性/遮挡问题，而不是简单调松阈值即可解决。[观察回放](../reports/observed-profile-replay-2026-08-08.md)

## 10. 对 MaxPower 有直接价值的公开运动数据

公开数据不能替代我们自己的手机视频，因为人物、机位、器械遮挡和 pose backend 分布不同；但它们可以分别承担 **骨架评测、动作/次数评测、纠错规则研究**。价值排序如下。

| 优先级 | 数据集 | 数据与标注 | 对我们的直接用途 | 限制 |
| --- | --- | --- | --- | --- |
| P0 | [FLEX](https://haoyin116.github.io/FLEX_Dataset/) | 38 人、3 个技能等级、20 个负重动作、每动作 10 rep、5 视角，含 RGB、3D MoCap、sEMG、生理数据，以及 action keystep、错误类型、反馈和评分 | **与当前卧推最匹配**：包含平板/上斜/下斜杠铃卧推、平板/上斜哑铃卧推、飞鸟、肩推、深蹲、硬拉和多种划船。可用来设计 `action×view` profile、错误 taxonomy 和卧推观测性 benchmark | 数据不能公开直下，申请条款明确 academic purposes only、no commercial exploitation。[访问说明](https://github.com/HaoYin116/FLEX_AQA_Dataset#dataset-access-procedure) |
| P0 | [Fit3D / AIFit](https://fit3d.imar.ro/) | 611 个多视角序列、至少 5 个已标注 rep/序列、约 296 万 3D skeleton，37+ 重复动作，包含教练与学员 | 最适合检验 MediaPipe/RTMPose 的 2D/3D 骨架误差、掉点、地面动作与极端姿态；也可研究教练轨迹与学员轨迹的时空偏差 | 实验室多相机/MoCap 真值和手机单目分布不同；研究资源条款需要申请核对，不能默认获得商业训练权 |
| P0 | [MM-Fit](https://mmfit.github.io/) | 超过 800 分钟；20 个 workout session；同步 RGB-D、2D/3D pose、手机/手表/耳机 IMU。动作含深蹲、俯卧撑、哑铃肩推、弓步、哑铃划船、仰卧起坐、臂屈伸、弯举、侧平举、开合跳 | 最容易立即下载后建立 `pose availability → phase → count` 回归测试，也能验证“课程动作切换”而非只测孤立视频；[RGB 视频约 39 GB，Zenodo 可逐文件下载](https://zenodo.org/records/7672767) | 主要用于 exercise logging/segmentation，不提供可靠的错误动作与纠正金标准；代码 MIT 不等于视频数据商业权已自动澄清 |
| P1 | [RepCount / PoseRAC annotations](https://github.com/MiracleDance/PoseRAC) | in-the-wild 重复动作视频；RepCount-A 有单个重复动作的起止帧，含卧推、俯卧撑、深蹲、开合跳、前平举、仰卧起坐、引体等；PoseRAC 又补了代表性 pose 标签 | 可直接测试 rep precision/recall、phase 边界、变速和非标准背景，是比通用动作分类集更贴近 Rust counter 的 benchmark | 视频来源和许可需逐项核对；类别和机位不与我们的 profile 一一对应，不能直接学习阈值 |
| P1 | [Fitness-AQA](https://github.com/ParitoshParmar/Fitness-AQA) | 健身房自然视频，细粒度评价后蹲、过顶推举、杠铃划船三类动作错误 | 可参考器械遮挡、非理想机位下如何定义 form error，并为未来纠错评测建立方法 | 只有 3 个动作；官方明确仅限 non-commercial，需表单申请；不能覆盖卧推 |
| P1 | [FLAG3D](https://andytang15.github.io/FLAG3D/) | 180K 序列、60 类健身活动，含高精度 3D pose、自然手机视频和详细语言 instruction | 可用于未来轻量动作确认/动作 embedding，以及把课程文案映射到动作阶段；对扩展徒手课程有价值 | 重点是动作识别、跨域和语言，不是逐 rep 纠错；体量大，不应进入第一版移动端模型 |
| P2 | [SU-EMD](https://openaccess.thecvf.com/content/CVPR2023W/CVSports/html/Deyzel_One-Shot_Skeleton-Based_Action_Recognition_on_Strength_and_Conditioning_Exercises_CVPRW_2023_paper.html) | 7 个力量与体能动作、840 个 skeleton sequence，同时有 markerless 和 marker-based capture | 可研究“用少量标准样例注册新动作”的 skeleton metric embedding，未来用于确认当前所选动作 | 数据小、任务是分类不是计数/纠错；论文的 87.4% 是其 one-shot protocol，不能外推到手机视频 |
| P2 | [UI-PRMD](https://doi.org/10.3390/data3010002) / [KIMORE](https://pubmed.ncbi.nlm.nih.gov/31217121/) | UI-PRMD：10 人、10 个康复动作、正确/错误重复、Vicon+Kinect；KIMORE：78 人、5 个腰背康复动作、RGB-D/skeleton、临床特征和评分 | 适合研究 quality score、正确/错误模板距离和“无法判断”策略 | 康复动作和目标用户不同；Kinect 3D 不等于手机 2D，不能把临床分数直接移植成健身纠错 |

### 10.1 推荐的实际使用方式

1. **现在就用 MM-Fit + RepCount-A 做自动回归集。** 统一转成我们现有 `MotionPacket`，保存原始时间戳、动作、rep 起止和来源，再跑 Rust profiles。它们用于发现阶段/计数回归，不用于校准最终阈值。
2. **立即申请 FLEX 和 Fit3D 学术访问。** FLEX 尤其覆盖我们刚标注的平板/上斜杠铃卧推。先只做离线研究与基准，商业训练权另行处理。
3. **把公开数据和自有数据分层。** `external_research` 只能做预研/benchmark；`field_capture_approved` 才能进入产品 profile 校准；`held_out_internal` 永远只用于验收。
4. **统一骨架适配层。** 将外部 17/25/33 点 skeleton 映射到内部 joint schema，但保留 `sourceTopology`、image/world 坐标、visibility、camera view 和缺失掩码，禁止插值后冒充真实关键点。
5. **最终验证仍以自采手机视频为准。** 至少跨 participant、设备、距离、机位和 session 留出；公开数据只能补覆盖，不能证明 MaxPower 在目标环境准确。

### 10.2 我们应该沉淀的自有运动数据

对现阶段最有价值的不是保存更多“骨架截图”，而是形成每个 rep 的可回放证据包：

- `actionId + cameraView + device + distance + orientation`；
- 主体 ID/epoch、required-joint coverage、最长 tracking gap、重获耗时；
- 原始关键点与置信度、归一化角度/距离/速度信号；
- ready、eccentric、peak、concentric、complete 的人工或半自动时间边界；
- confirmed/partial/rejected 以及人工最终次数；
- 如果做纠正：具体错误类型、发生阶段、可观测机位、严重度、教练共识，而不是一个笼统的 0–100 分。

这些数据既能继续生成 deterministic Rust profile，也能在样本量足够后训练很小的 phase/action-verification 模型，同时不迫使移动端运行重型通用动作网络。

## 11. 其他产品实际做到什么程度

| 层级 | 代表产品 | 已公开达到的能力 | 证据边界 |
| --- | --- | --- | --- |
| 单动作端侧计数 | PUSHUP、Rep Ref | 俯卧撑或深蹲等 1–2 类；端侧 skeleton、phase/count、语音，部分支持手工改次数 | 真实可交付，但没有跨人、多人和纠错准确率报告 |
| 小动作库健身计数 | GoodGYM、Fitnit、PoseRep、WorkoutSentinel | 约 4–15 类常见徒手/哑铃动作；先选动作，再计数、显示骨架/角度/简单评分 | 公开源码仍以阈值状态机为主；`form score` 普遍无金标准 |
| 课程内动作确认 | [Peloton Guide / Peloton IQ](https://www.onepeloton.com/blog/what-is-peloton-iq) | 课程已知当前动作；新硬件官方称 2,000+ 个 movement-tracking-enabled workout 支持自动 rep、总训练量、音频/文字 form cue、自主节奏课程和重量建议 | “2,000+”是课程数量，不是 2,000 个已验证动作；算法、动作级指标和错误集不公开。早期 Guide 的 Movement Tracker 更偏“是否持续做对当前动作”，不能与现在的 Form Feedback 混为一谈 |
| 手机康复纠正 | [Kaia Motion Coach](https://kaiahealth.com/motion-coach/) | 普通前置相机、自动次数/保持时间、ROM/稳定性等指标和实时视听纠正；官方帮助页承认并非所有动作已启用，要求设备距离约 6–10 英尺 | 这是最强的“普通手机可以做窄动作纠正”证据。同行评审研究只比较了 6 个经过选择的康复动作，不能外推到自由重量训练。[JMIR 研究](https://www.jmir.org/2021/7/e26658/) |
| 大型边缘康复平台 | [Kemtai](https://kemtai.com/gold-standard/) | 官网称 111 点、2,000+ 动作/变式、每 rep 计数与评分、ROM、错误部位提示、骨架回放，Web/移动/桌面边缘运行 | 能力主要来自厂商页面；未公开骨架模型、动作级评测集和跨机位准确率。可作为目标接口参考，不能当算法基准 |
| 专用 3D 家庭健身硬件 | [Tempo Studio](https://shop.tempo.fit/) | ToF/3D motion capture、实时 rep、form feedback、重量建议、课程与器械闭环 | 使用专用深度硬件、固定屏幕和 6×8 英尺以上空间，明显比单手机 2D 条件强，不能用来证明普通手机同等可行 |

截至目前，没有公开证据证明某个纯手机 App 能在任意机位、多人进入、器械遮挡、地面/站立动作混合时，对数十种动作同时做到稳定主体身份、准确计数和可信纠错。成熟产品同样通过 **规定空间、已知课程动作、动作白名单、可见性门控和有限纠正 cue** 缩小问题。

对 MaxPower 的现实定位是：

- 主体连续性和跨端 Rust profile 设计已经不弱于多数开源/独立产品；
- 动作覆盖的“可执行数量”较多，但 held-out 验证明显不足；
- 第一阶段做到 GoodGYM 以上并不难：稳定追踪、课程已知动作、次数/阶段、录制回放；
- 要接近 Kaia，需要针对少量动作建立错误类型、可观测性和跨人纠错验证；
- 要接近 Peloton/Tempo 的完整体验，难点主要变成课程标注、动作库数据、专用硬件/空间控制和长期反馈数据，而不是单独换一个 pose 模型。

## 12. 最终判断

**继续做第一版“规定设备和机位、用户预选动作、相机持续确认/阶段/计数”是合理的。** GoodGYM 和多款独立 App 证明轻量端侧方案足以完成窄动作计数；MaxPower 已经拥有比这些开源 demo 更完整的主体连续性、profile lineage、拒绝状态和 Rust 跨端事实源。

当前不应该做的两件事：

- 因为 GoodGYM 使用 RTMPose 就整体替换 MediaPipe；公开证据不足以证明其在 MaxPower 数据上更好；
- 因为健身猫或应用商店写“实时纠正”就宣称 MaxPower 也能纠正；动作质量需要独立标签、机位可观测性、跨人验证与安全边界。

最短的正确路线是：**统一 Android 主体追踪 → 用同一标注集 A/B MediaPipe/RTMPose → 先把 5 个易观测动作做到 held-out 稳定计数 → 再扩大动作与机位。**

## 主要一手来源

- [健身猫官网](https://fitnesscat.object-x.com.cn/)
- [GoodGYM GitHub](https://github.com/yo-WASSUP/Good-GYM)
- [GoodGYM App Store](https://apps.apple.com/cn/app/goodgym-ai%E8%AF%86%E5%88%AB%E5%81%A5%E8%BA%AB%E8%AE%A1%E6%95%B0%E5%8A%A9%E6%89%8B/id6761142874)
- [MindDock/motion-tracker](https://github.com/MindDock/motion-tracker)
- [rtmlib](https://github.com/Tau-J/rtmlib)
- [MediaPipe Pose](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md)
- [MoveNet](https://www.tensorflow.org/hub/tutorials/movenet)
- [ML Kit Pose Detection](https://developers.google.com/ml-kit/vision/pose-detection)
- [MMPose](https://github.com/open-mmlab/mmpose)
- [Ultralytics tracking docs](https://docs.ultralytics.com/modes/track/)
- [FLEX dataset and access terms](https://github.com/HaoYin116/FLEX_AQA_Dataset)
- [Fit3D / AIFit](https://fit3d.imar.ro/)
- [MM-Fit](https://mmfit.github.io/)
- [RepCount pose annotations / PoseRAC](https://github.com/MiracleDance/PoseRAC)
- [Fitness-AQA](https://github.com/ParitoshParmar/Fitness-AQA)
- [FLAG3D](https://andytang15.github.io/FLAG3D/)
- [Kaia Motion Coach validation study](https://www.jmir.org/2021/7/e26658/)
- [Peloton IQ movement and form feedback](https://www.onepeloton.com/blog/what-is-peloton-iq)
- [Kemtai computer-vision capability statement](https://kemtai.com/gold-standard/)
