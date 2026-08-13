Status: in-progress

# 统一训练执行体验：Realtime 作为组级增强能力

> 来源：2026-08-13 客户端训练交互审查，以及 2026-08-14 训练路线原型与产品确认。
> 遵循：ADR 0001（本地 Coach 拥有决策与事实）、ADR 0002（云端拥有已确认产品资源）、`CONTEXT.md` 中 planned / performed / observed 分离、Rust canonical motion 单一真值与能力门控不变量。
> 覆盖决定：本规格取代既有客户端规格中“开始训练时选择普通记录或 AI 监控模式”的交互决定；不取代既有 WorkoutSession、Motion、SetOutcome、NextSetAdjustment 或云端确认契约。

## Problem Statement

用户已经拥有包含动作、组数、目标次数、推荐重量、RIR 和休息时间的训练计划，也能够在训练过程中修改动作、重量与次数。Realtime 的作用只是为支持的动作补充可信计次和动作观察，不应该成为开始训练前必须选择的一套独立模式。

当前客户端却把“直接记录”和“教练监控”放在训练开始时让用户二选一。进入监控后，Realtime 全屏替换主训练页面；结束一组后先看到独立的识别报告，再回到训练页面填写或确认实际次数、重量和 RIR。虽然底层仍使用同一个 WorkoutSession，但用户感受到的是两套产品、两次确认和一次不必要的上下文切换。

Realtime 页面也没有充分呈现当前计划上下文，却同时展示骨架、角度、识别阶段、录像状态、Agent 字幕、操作按钮和文本输入。组后报告把有效帧比例、决策 FPS 等诊断指标放在用户面前，但没有把计划目标、用户选择的重量、观察次数、RIR 与动作观察合并成一次可确认的 SetOutcome。

用户需要的是一款即使没有相机也完整好用的训练 App。Realtime 应该是当前组上按需开启的增强能力：可用时减少手工计次负担并提供有边界的动作观察；不可用、识别失败或用户不想使用时，训练流程仍然完整、连续且没有任何功能损失。

## Solution

客户端提供一个统一的 WorkoutSession 执行流程。用户从 Today 直接开始或恢复训练，不再选择“记录模式”或“监控模式”。训练页面始终围绕当前 ExerciseTask 和当前 Set 展示计划目标、可编辑的本组执行值、训练进度、后续动作与休息状态。

对具有 exact ExerciseVariant × view × runtime capability 的动作，当前组显示一个低干扰的 Realtime 入口。用户开启后，相机页面继承当前动作、组号、目标次数和用户确认的本组重量；Realtime 只消费 canonical motion evidence，输出 ConfirmedRep、NeedsReview、Rejected、phase 及允许的动作观察，不识别或推断重量、RIR、疼痛、肌肉激活或伤害风险。

无论用户手动完成还是使用 Realtime，结束本组后都进入同一个 Set Review。该页面同时展示不可变的计划快照、本组执行值、canonical observation、用户填写的实际重量与 RIR，以及最终要确认的实际次数。用户可以修正观察次数，但修正只改变 performed value，不覆盖原始 observed evidence。用户确认后才创建 SetOutcome；随后进入休息与下一组建议，再回到同一个训练执行页面。

Realtime 保持“锦上添花”：拒绝相机权限、动作不支持、低置信度、关键点缺失、用户中途退出或 native runtime 失败时，都必须无损降级到手动完成当前组，保留已填写的本组数据并且不复制 WorkoutSession、Set 或结果。

## User Stories

1. As a 有今日训练计划的用户, I want 点击一次开始训练就进入当前组, so that 我不需要先理解产品内部的记录与监控模式。
2. As a 恢复未完成训练的用户, I want 回到同一个 WorkoutSession 和下一未完成组, so that 页面切换或 App 重启不会创建重复训练。
3. As a 不使用相机的用户, I want 完整执行动作、组数、重量、次数、RIR、休息和动作调整, so that Realtime 不是完成训练的前置条件。
4. As a 使用训练计划的用户, I want 当前组始终显示动作、组号、目标次数、推荐重量、RIR 与休息, so that 我无需来回查看计划页面。
5. As a 临场调整重量的用户, I want 在开始本组前直接修改本组使用重量, so that 器械档位或当天状态变化不会迫使我修改整份计划。
6. As a 临场调整次数的用户, I want 在开始本组前直接修改本组目标次数, so that 本组执行目标符合真实情况。
7. As a 需要长期计划稳定性的用户, I want 明确区分“仅改本组”和“修改后续计划”, so that 临场调整不会悄悄改写未来训练。
8. As a 使用支持动作的用户, I want 在当前组看到“Realtime 自动计次”入口, so that 我知道相机能力是本组可选增强。
9. As a 使用不支持动作的用户, I want 继续正常手动记录而不看到虚假的识别承诺, so that 动作目录名称不会被当作识别能力。
10. As a 第一次使用 Realtime 的用户, I want 只在点击本组 Realtime 后请求相机权限, so that 相机不会阻塞训练开始。
11. As a 拒绝相机权限的用户, I want 立即返回同一当前组并继续手动记录, so that 权限选择不会丢失训练进度。
12. As a Realtime 用户, I want 相机顶部看到动作、第几组、本组重量和目标次数, so that 我在训练过程中始终知道自己要完成什么。
13. As a Realtime 用户, I want 看到大而清晰的当前确认次数与目标次数, so that 我不需要分心阅读复杂数据。
14. As a 不方便看屏幕的用户, I want 可选择使用短促声音或震动确认可信 rep, so that 我可以专注于动作本身。
15. As a Realtime 用户, I want 获得简短的入框和机位提示, so that 相机不可判断时我知道怎样恢复观察。
16. As a Realtime 用户, I want 默认只看到当前最重要的一条动作观察, so that 多个提示不会干扰正在进行的负重动作。
17. As a 想查看细节的用户, I want 在安全的组后阶段展开骨架、角度和观察详情, so that 技术信息不会占据训练主界面。
18. As a 正在完成一组的用户, I want 训练期间不弹出键盘和完整 Coach 对话, so that 输入框不会遮挡相机或分散注意力。
19. As a 需要 Coach 帮助的用户, I want 在休息或组后阶段打开对话, so that 我可以在不干扰动作执行的时机获得解释。
20. As a 使用 Realtime 的用户, I want Realtime 只识别动作次数和可观察的动作表现, so that 系统不会声称识别了实际重量。
21. As a 使用 Realtime 的用户, I want 重量始终来自计划或我的输入, so that 训练负荷记录保持可信。
22. As a 使用 Realtime 的用户, I want RIR、疼痛和主观感受始终由我填写, so that 相机不会替我推断不可见状态。
23. As a 动作超出可判断范围的用户, I want 页面明确显示 cannot judge 或需要调整机位, so that 未知不会被伪装成动作正确或错误。
24. As a Realtime 用户, I want 只把 ConfirmedRep 纳入默认观察次数, so that NeedsReview 和 Rejected 不会静默变成正式训练量。
25. As a 出现 NeedsReview 的用户, I want 在组后看到待确认次数并自行决定, so that 边界动作不会被系统擅自计入或丢弃。
26. As a 中途退出 Realtime 的用户, I want 返回同一个当前组并保留本组重量与目标, so that 相机失败不会迫使我重新开始。
27. As a 手动完成一组的用户, I want 进入与 Realtime 相同的 Set Review, so that 产品只有一套稳定的组完成逻辑。
28. As a 完成一组的用户, I want Set Review 同时显示计划、执行值、观察值和最终实际值, so that 我能理解每个数字来自哪里。
29. As a 修正 Realtime 次数的用户, I want 我的确认成为 performed reps 而 canonical observation 保持不变, so that 用户结果和机器证据都可追溯。
30. As a 按计划完成的用户, I want 用一次操作接受预填重量、次数和 RIR, so that 正常训练不需要反复输入相同内容。
31. As a 实际表现偏离计划的用户, I want 在同一 Set Review 修改重量、次数和 RIR, so that 实际结果不会被计划值覆盖。
32. As a 完成 Set Review 的用户, I want 确认后自动进入组间休息, so that 训练节奏连续自然。
33. As a 休息中的用户, I want 看到剩余时间、下一组目标和加减休息时间, so that 我能控制训练节奏。
34. As a 收到下一组建议的用户, I want 在休息时看到 before、after、原因和影响范围, so that 我能判断是否接受调整。
35. As a 不接受下一组建议的用户, I want 保持原计划继续训练, so that Agent 建议不会自动修改我的 WorkoutSession。
36. As a 需要更换器械或动作的用户, I want 从当前动作菜单替换尚未开始的动作, so that 器械占用不会中断训练。
37. As a 跳过当前组的用户, I want 记录跳过及原因而不是把它算作完成, so that SessionOutcome 能反映真实执行。
38. As a 出现尖锐疼痛、胸部不适、眩晕或异常呼吸困难的用户, I want 随时进入安全暂停, so that Realtime 和普通记录都不能绕过安全边界。
39. As a 完成全部或部分训练的用户, I want 看到计划与实际、完成/跳过组、动作观察覆盖、用户修正和已接受调整, so that 训练日报能解释这次训练发生了什么。
40. As a 持续训练的用户, I want 只有确认的 SessionOutcome 进入 Timeline 和后续规划, so that 临时相机帧或未确认观察不会改变计划。
41. As a 弱网用户, I want 未获云端确认的结果保持明确待同步状态而不伪装成已保存, so that 客户端符合 confirmed product resource 的持久化边界。
42. As a 无障碍用户, I want 关键训练按钮具有足够触控面积、可读标签和清晰状态, so that 我能在训练环境中可靠操作。
43. As a 产品用户, I want 诊断性的有效帧率、决策 FPS 和 runtime 细节默认不出现在训练报告, so that 报告聚焦我的训练而不是实现细节。
44. As a 需要排查识别问题的测试人员, I want 在独立诊断入口查看 runtime、FPS、capability 和 evidence lineage, so that 隐藏用户诊断信息不会削弱可观测性。
45. As a 回到手动训练的 Realtime 用户, I want 识别入口保持可再次开启但不抢占主流程, so that Realtime 始终是可撤销的增强能力。
46. As a 不想被计划数字施压的用户, I want 动作卡片只突出实际完成组数而不显示 `2/5` 一类比例, so that 计划为我导航而不是制造未完成压力。
47. As a 使用递增、递减或持平负荷训练的用户, I want 点击“已完成 N 组”翻转当前动作卡片并逐组查看实际重量与次数, so that 我能立即理解刚才怎样完成，而不只看到一个总组数。
48. As a 在不同动作间穿插训练的用户, I want 点击动作行或左右滑动当前卡片切换动作, so that 我能按器械和现场节奏快速改变执行顺序。
49. As a 需要重新排列今日训练的用户, I want 长按动作后上下拖动并看到其他动作自然让位, so that 调整顺序符合常见移动端交互直觉。
50. As a 器械不可用或临时改变动作的用户, I want 从动作行直接重选、添加或移除动作, so that 现场调整不需要进入完整计划编辑器。
51. As a 训练中手部会自然抖动的用户, I want 轻微横向位移不会触发移除或卡片切换, so that 滚动、长按和横滑不会互相抢占手势。
52. As a 已完成部分组后更换动作的用户, I want 原动作保留已完成事实且替代动作紧跟原动作插入, so that 列表顺序能表达“从这里开始接替”，而不是把新动作错误追加到末尾。

## Implementation Decisions

- 客户端只有一个 WorkoutSession 执行界面和一套组完成状态机。开始或恢复训练直接进入该界面，不再展示训练模式选择 Sheet。
- 既有 whole-session `record_only` / `coach_monitor` 状态不再负责页面导航。遗留的未完成 session 打开时统一进入训练执行界面，并以 Realtime 未开启作为安全默认状态。
- Workout 执行模块继续作为最高层交互协调者，持有当前 task、当前 set、休息状态、下一组建议和后续 task 管理。Realtime 作为当前 set 的子流程，不成为平行 Workout 模块。
- Realtime 入口只在 exact ExerciseVariant、variation、equipment、view、pose model、native bridge 和 runtime capability 共同允许时显示。目录相似、名称匹配或通用动作类别不能授权识别。
- 打开 Realtime 时传递稳定的 set context：WorkoutSession ID、prescription set ID、动作身份、组序号、不可变计划目标、本组执行重量、本组目标次数和 capability identity。
- 计划值、执行草稿、canonical observation 与 SetOutcome 是四种不同语义：计划值说明原定安排；执行草稿说明用户当前准备怎么做；observation 说明相机看到了什么；SetOutcome 说明用户最终确认完成了什么。任何一层都不能覆盖另一层。
- Realtime 只消费 Rust canonical motion output。TypeScript、Kotlin、Swift 和 LLM 不建立第二套 pose、phase、rep counter 或动作判断真值。
- Realtime 不识别或推断 load、RIR/RPE、疼痛、肌肉激活、力、疲劳原因、伤害风险或不可见三维状态。重量来自计划或用户输入；RIR、疼痛和主观感受来自用户确认。
- 相机主界面优先展示动作、组号、用户输入重量、目标次数、confirmed rep count、构图状态和最多一条当前主要观察。骨架、角度、runtime 状态与详细 evidence 默认收起到诊断或组后详情。
- 训练进行中不展开完整 Agent composer。Coach Drawer 与文本输入可在未开始、暂停、休息或组后阶段打开；安全暂停始终可达。
- Realtime 结束时生成或引用不可变 Canonical Set Observation，但不直接创建 performed SetOutcome。
- 手动完成和 Realtime 完成都进入同一个 Set Review。Set Review 预填本组执行重量、目标次数或可信观察次数，并要求用户确认实际 reps、load、RIR 和可选主观状态。
- 当用户修正观察次数时，performed reps 使用用户确认值；observed rep dispositions 与 evidence lineage 保持原样，并在需要时记录 correction provenance。
- SetOutcome 只在用户确认并通过产品写入契约后创建。云端是已确认 WorkoutSession 和 Result 的持久化权威；本地状态不能把未获确认的写入呈现为云端已保存。
- SetOutcome 确认后自动启动该组对应的 rest timer，并在统一训练界面呈现下一组目标与可确认的 NextSetAdjustment。
- NextSetAdjustment 只能修改尚未开始的未来内容。用户必须明确应用；拒绝或忽略不改变当前计划。
- “调整本组”只修改执行草稿；“修改后续计划”通过明确的作用范围进入既有计划编辑契约。当前 set 开始后，其 prescription snapshot 保持冻结。
- Realtime 的任何失败都遵循无损降级：关闭相机、保留执行草稿、返回同一个 set、允许手动输入。失败不得创建重复 session、set、observation 或 result。
- 用户报告以训练语义为主：计划与实际、完成与跳过、RIR、观察覆盖、用户修正、接受的调整和下一步。有效帧率、决策 FPS、模型与 bridge 版本保留在诊断可观测性中。
- 完成、部分完成、跳过、暂停和放弃继续沿用既有 SessionOutcome 状态；只有用户确认的结果进入 Timeline 与后续 planning evaluation。
- Android 是首要交付与真机验收平台；共享 TypeScript 交互契约不能阻止 iOS 使用同一状态语义。平台差异只存在于相机和 native runtime adapter。
- 本规格以现有 Workout、Motion、Report、Rest、NextSetRecommendation、Task Editor 和 CoachApplication 能力为基础进行重组，不创建第二套训练领域模型。
- 训练执行采用已确认的“训练路线”信息架构：当前动作卡片位于顶部，今日动作按执行路线位于其后；卡片和列表均以实际发生的结果为主，不显示 `已完成/计划总数` 比例。
- 当前动作卡片复用既有平面卡片视觉语言，不添加投影或错层装饰。卡片右上角的“已完成 N 组 + 翻转图标”既是状态也是查看入口；没有完成记录时显示“尚未记录”且不产生无内容翻转。
- 卡片背面只呈现该动作已确认的 SetOutcome 顺序、每组实际 load × reps、相对上一组的加重/减重/持平与次数变化。计划组数、未完成组和相机推测值不得混入该历史。
- 卡片正反面只允许当前可见面参与点击、焦点与无障碍树；翻转不改变 WorkoutSession、当前 set 或已填写的执行草稿。
- 今日动作路线支持点击行切换、当前卡片左右滑动切换、添加、重选、移除、撤销移除和长按上下排序。所有操作只改变今日尚未开始的执行路线；已确认 SetOutcome 永不因列表操作被删除。
- 手势采用明确的意图仲裁：先容忍小范围自然抖动，再由水平距离与方向优势锁定横滑，或由静止长按锁定纵向排序。行左滑只展开移除操作，必须再次明确点击才真正移除；不能让轻微晃动直接执行破坏性操作。
- 长按排序时被选动作产生抬起反馈并随手指移动，其他动作使用位置让位动画，松手后回落。减少动态效果设置开启时必须使用等价的低动效反馈。
- “替换剩余组”以当前动作位置为语义锚点：若已有完成组，原动作保留并在其后一位插入替代动作；若尚未完成，替代动作占据原位置。后续动作依次顺延，不把替代动作追加到路线末尾。

## Testing Decisions

- 主要且唯一的高层验收接缝是客户端 `WorkoutSession execution loop`：从 Today 开始或恢复训练，经当前 set 的手动或 Realtime 路径进入统一 Set Review，确认 SetOutcome，进入 Rest，再到下一 set 或 SessionOutcome。
- 好的测试只断言用户可观察行为和持久化结果：显示什么、哪些操作可用、产生哪个 confirmed resource、重启后恢复到哪里，以及 planned / performed / observed 是否仍然分离；不断言 React component 层级、hook 数量、内部 reducer 字段或具体动画实现。
- 复用现有 CoachApplication WorkoutSession、canonical motion adapter、ProductProjection、云端 confirmed bridge 和 Android 客户端端到端测试接缝，不为本改造建立页面本地假数据服务。
- 手动基线路径必须证明：不授予相机权限也能开始、编辑本组、确认实际结果、休息、应用或拒绝下一组建议并完成训练。
- Realtime 路径必须证明：支持动作显示入口；进入后继承正确 set context；结束后进入统一 Set Review；相机输出不会直接创建 SetOutcome。
- capability 降级测试必须覆盖动作不支持、错误机位、权限拒绝、关键点缺失、低置信度、native runtime 错误和中途退出，并证明同一 set 草稿与 WorkoutSession 保留。
- evidence 测试必须覆盖 ConfirmedRep、NeedsReview、Rejected 和 cannot judge；只有 ConfirmedRep 默认进入观察次数，用户确认前 NeedsReview 不形成训练量。
- 用户修正测试必须证明 observed count 不被改写、performed reps 使用用户确认值、两者具有可追溯来源。
- 负荷边界测试必须证明 camera、LLM 和 motion adapter 均不能产生 actual load；没有用户输入或计划值时重量保持 unknown。
- 状态恢复测试必须覆盖 Realtime 前、Realtime 进行中断、Set Review、Rest 和训练部分完成后的 App 重启，且不得复制 WorkoutSession、SetObservation、SetOutcome 或 task-scoped CoachSession。
- 云端确认测试必须覆盖成功、幂等重试、revision conflict 和失败；失败时客户端不得宣称 confirmed Result 已持久保存。
- 下一组建议测试必须证明 suggestion 与 plan revision 分离，只有显式 apply 才改变尚未开始的 set，过期建议不能覆盖新事实。
- Android 真机验收必须跑通至少一个具备 validated-analysis exact profile 的动作，以及一个 unsupported 动作的手动降级；不能用静态骨架 Mock 代替产品路径。
- 交互验收记录关键路径的页面截图或录屏，并验证：Today 到当前组不出现模式选择、Realtime 页面含组上下文、结束后只出现一次 Set Review、休息后返回下一组。
- 可用性验收目标：从 Today 到当前组最多一次主要点击；正常按计划完成一组最多一次组后确认；从 Realtime 退出到手动记录不丢失任何用户输入。
- 无障碍测试覆盖屏幕阅读标签、关键按钮触控面积、动态文字缩放、横竖屏/安全区域和训练中高对比状态。
- 现有客户端 Workout 高层场景、Motion canonical fixture、Report/Replay、Timeline 和云端 product-resource 测试作为回归集，确保交互重组不改变领域事实语义。
- 交互验收以已确认的训练路线原型为设计基准，但测试断言用户可观察行为而非 HTML 结构：平面无阴影卡片、已完成组翻转、实际 load × reps 历史、列表现场编辑和实际结果保护必须在产品组件中成立。
- 手势冲突测试至少覆盖：小幅横向抖动不进入移除；明确左滑只展开移除；长按后可纵向排序；纵向滚动不触发横滑；当前卡片需达到提交阈值才切换动作；操作按钮区域不触发卡片滑动。
- 替换测试覆盖已完成部分组与尚未开始两种情况，并断言替代动作位于当前动作语义位置、后续动作顺延、完成组的 load/reps/RIR 与 provenance 保持原样。

## Out of Scope

- 不新增动作识别 profile、训练语料、pose 模型或动作质量算法。
- 不让 Realtime 识别杠铃片、哑铃、器械档位或任何实际重量。
- 不输出单一“动作标准度”“正确率”或通用好坏分数。
- 不改变训练计划生成、分化选择、训练量规则、营养规划或长期 GoalCycle 算法。
- 不重新设计 Today、Calendar、Plan、Progress、Profile 或全局导航。
- 不改变云端认证、LLM Gateway、ProductData 或 MediaLibrary 的服务端架构。
- 不要求每个动作支持 Realtime；unsupported 是正常产品状态。
- 不把视频保存、上传、回放或社交分享作为完成统一训练闭环的必要条件。
- 不在本规格中重新命名 App 或虚拟教练品牌。
- 不以 iOS 真机交付阻塞 Android 首轮验收，但共享交互和数据语义必须保持跨平台可实现。

## Further Notes

- 产品定位是“首先是一款好用的训练 App，然后才是一款拥有 Realtime 教练能力的训练 App”。Realtime 的成功指标不是开启率越高越好，而是使用或不使用都不破坏训练连续性。
- 当前实现已经具备计划目标预填、实际值编辑、组目标修改、跳过、安全暂停、休息计时、下一组建议和同一 WorkoutSession；实施应优先重新组合这些能力，而不是重写领域逻辑。
- 既有 MaxPower Client MVP 中“用户选择仅记录或 AI 教练监控”的故事和票据应以本规格为准改读为：“用户在统一 WorkoutSession 中按当前 set 选择是否开启 Realtime”。
- Realtime 页面展示“做得好不好”时必须拆成可观察维度，并允许 cannot judge；不能把 recognition profile 或模拟基线包装成标准动作评判。
- 原始 runtime 指标继续进入 trace 与诊断工具，避免为了简化用户界面而损失全链路可观测性。
