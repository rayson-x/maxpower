# 70 个动作的 AI 教练知识模式映射 v0.1

**Status:** Coverage map / not a validation claim  
**Date:** 2026-08-09  
**Registry source:** `src/pose/exerciseRegistry.ts` (70 exact exercise identities)  
**View seed:** `src/pose/simulatedKinematicPrior.ts` (uncalibrated recommendation only)

## 1. Reading this document

本映射回答“每个具体动作应该观察什么、可能启用哪些教练模式”，不表示这些动作已经具备可上线的实时纠正能力。

- `Family` 提供默认训练意图、主动/稳定特征和候选偏差模式。
- 具体动作行将 registry identity 映射到 family，并声明必须额外采集的证据。
- `primary view` 继承自模拟 kinematic prior，只是采集起点。必须用真机视频验证，不能当作生产机位保证。
- 每个动作仍要建立独立的 `exercise × variation × equipment × intent × view` profile 和验证报告。
- 默认按 `standard_variant` 分析；部分 ROM、允许借力、停顿、爆发等意图必须显式覆盖默认契约。

## 2. Coaching families

| Family | 默认训练目的与标准执行特征 | 主动 / 端点证据 | 稳定 / 协调证据 | 候选模式 | 典型效果解释与提示方向 |
|---|---|---|---|---|---|
| `LOC` locomotion | 协调、容量；完整开合/抬膝/步次 | 踝距、腕距、膝/髋相对高度、步次周期 | 左右顺序、手脚同步、躯干漂移 | `ROM_DEFICIT`, `BILATERAL_TIMING_GAP`, `COORDINATION_SEQUENCE_ERROR`, `SET_EXECUTION_DRIFT` | “完成同样高度/步幅”“手脚一起打开”；不推断单侧力量 |
| `CORE_FLEX` | 躯干/髋屈曲任务与受控返回 | 肩—髋—膝投影角、躯干相对地面变化 | 足/骨盆代理、回程连续性 | `ROM_DEFICIT`, `MOMENTUM_BORROWING`, `RETURN_CONTROL_LOSS`, `JOINT_STRATEGY_SUBSTITUTION` | 区分躯干屈曲与主要屈髋起身；不判断腰椎负荷 |
| `H_PULL` | 拉向躯干；目标肘/肩行程，支撑与躯干符合变式 | 肘角、腕/器械到躯干距离、肘后移 | 躯干俯仰/旋转、肩高、左右端点 | `ROM_DEFICIT`, `MOMENTUM_BORROWING`, `TRUNK_STRATEGY_DRIFT`, `JOINT_STRATEGY_SUBSTITUTION`, `BILATERAL_*`, `EQUIPMENT_PATH_DRIFT` | 躯干摆动或耸肩可能改变上背/斜方与目标拉动的相对需求；提示先稳躯干再拉肘 |
| `V_PULL` | 身体/把手纵向接近；完整下拉/上拉与受控返回 | 肘角、肩/腕相对高度、身体/把手纵向路径 | 躯干后仰、左右高度、摆动 | `ROM_DEFICIT`, `MOMENTUM_BORROWING`, `TRUNK_STRATEGY_DRIFT`, `BILATERAL_*`, `RETURN_CONTROL_LOSS`, `EQUIPMENT_PATH_DRIFT` | 后仰摆动可能把动作变成更水平的拉动；提示保持躯干再完成肘部行程 |
| `SQUAT` | 髋膝协同下降/站起；按变式完成深度 | 膝角、髋角、髋相对踝高度、器械高度 | 躯干角、骨盆水平、左右膝/髋时序、足部代理 | `ROM_DEFICIT`, `TRUNK_STRATEGY_DRIFT`, `BILATERAL_*`, `SEGMENT_ALIGNMENT_DRIFT`, `EQUIPMENT_PATH_DRIFT`, `SET_EXECUTION_DRIFT` | 描述髋膝策略和躯干变化；不能用 2D “膝不过脚尖”作通用正确性规则 |
| `HINGE` | 髋主导屈伸；躯干与髋协同，器械贴近合理路径 | 髋角、髋高度、躯干角、杠/手相对腿路径 | 膝角相对稳定范围、左右骨盆/肩、端点控制 | `ROM_DEFICIT`, `TRUNK_STRATEGY_DRIFT`, `JOINT_STRATEGY_SUBSTITUTION`, `EQUIPMENT_PATH_DRIFT`, `REVERSAL_BOUNCE` | 区分髋主导与过多下蹲/躯干独立变化；不声称脊柱中立或组织负荷 |
| `H_PUSH` | 推离躯干/水平内收；完整推压与回程 | 肘角、腕/器械相对肩胸路径、双腕间距 | 左右端点、肩/骨盆支撑代理、躯干整体 | `ROM_DEFICIT`, `BILATERAL_*`, `SUPPORT_DRIFT`, `EQUIPMENT_PATH_DRIFT`, `RETURN_CONTROL_LOSS` | 一侧提前或杠路漂移可能改变两侧任务；提示对齐端点/路径，不推断力量差 |
| `V_PUSH` | 过顶或斜向推举；肘伸与腕上移 | 肘角、腕相对肩高度、器械路径 | 躯干后仰、左右腕高、支撑/凳面 | `ROM_DEFICIT`, `TRUNK_STRATEGY_DRIFT`, `BILATERAL_*`, `JOINT_STRATEGY_SUBSTITUTION`, `EQUIPMENT_PATH_DRIFT` | 过度后仰更像改变推举方向；提示稳住躯干再向目标路径推 |
| `SH_ABD` | 手臂侧向/Y 向抬起；按目标范围受控返回 | 腕/肘相对肩高度、双腕横向间距 | 肘角、躯干侧倾/摆动、左右端点 | `ROM_DEFICIT`, `MOMENTUM_BORROWING`, `TRUNK_STRATEGY_DRIFT`, `BILATERAL_*`, `RETURN_CONTROL_LOSS` | 耸肩/摆动组合可能增加上斜方和躯干参与；提示减小摆动、保持肩线再抬臂 |
| `SH_FLEX` | 手臂向前抬起 | 腕相对肩高度/距离 | 躯干后仰、肘角、左右时序 | `ROM_DEFICIT`, `MOMENTUM_BORROWING`, `TRUNK_STRATEGY_DRIFT`, `RETURN_CONTROL_LOSS` | 后仰摆动改变外部路径与力臂；提示稳躯干再向前抬 |
| `SH_HABD` | 手臂水平展开 | 双腕横向间距、肘/腕相对肩路径 | 俯身角、左右端点、肘角 | `ROM_DEFICIT`, `TRUNK_STRATEGY_DRIFT`, `BILATERAL_*`, `MOMENTUM_BORROWING` | 俯身变化/耸肩可能改变后束飞鸟策略；提示保持俯身与肩线 |
| `SH_ER` | 固定上臂条件下前臂外旋 | 腕相对肘/肩路径（弱 2D 代理） | 肘贴身/上臂位置、躯干旋转 | `ROM_DEFICIT`, `SUPPORT_DRIFT`, `JOINT_STRATEGY_SUBSTITUTION` | 若上臂或躯干代替旋转，目标任务改变；2D 观测弱，优先 cannot-judge |
| `ELB_FLEX` | 肘屈曲与受控伸展 | 肘角、腕到肩距离/高度 | 上臂位置、肩高、躯干摆动、左右/交替节奏 | `ROM_DEFICIT`, `MOMENTUM_BORROWING`, `SUPPORT_DRIFT`, `BILATERAL_*`, `RETURN_CONTROL_LOSS` | 肩前移/躯干摆动可能改变肘屈任务；提示固定上臂、完整弯举 |
| `ELB_EXT` | 肘伸展与受控屈曲返回 | 肘角、腕相对肘/肩路径 | 上臂位置、躯干、左右端点 | `ROM_DEFICIT`, `SUPPORT_DRIFT`, `MOMENTUM_BORROWING`, `BILATERAL_*`, `RETURN_CONTROL_LOSS` | 上臂移动可能把任务转成肩关节动作；提示固定上臂再伸肘 |
| `KNEE_FLEX` | 机器约束下屈膝与受控回程 | 膝角、踝相对膝路径 | 髋/骨盆贴垫代理、左右端点、机器滚筒 | `ROM_DEFICIT`, `SUPPORT_DRIFT`, `BILATERAL_*`, `RETURN_CONTROL_LOSS`, `EQUIPMENT_PATH_DRIFT` | 髋抬起或行程缩短改变机器动作任务；需机器设置元数据 |
| `KNEE_EXT` | 机器约束下伸膝与受控回程 | 膝角、踝高度/滚筒路径 | 髋/躯干贴靠代理、左右端点 | `ROM_DEFICIT`, `SUPPORT_DRIFT`, `BILATERAL_*`, `RETURN_CONTROL_LOSS`, `EQUIPMENT_PATH_DRIFT` | 描述是否完成伸膝和是否离开靠背；不推断膝关节压力 |
| `ANKLE_PF` | 踝跖屈的上下行程和顶端控制 | 踝/足跟相对高度（Pose 代理有限）、身体纵向位移 | 膝角、左右高度、支撑位置 | `ROM_DEFICIT`, `BILATERAL_*`, `REVERSAL_BOUNCE`, `RETURN_CONTROL_LOSS` | 提示完成底部—顶部行程和停稳；足跟关键点不稳时需物体/鞋底证据 |

`BILATERAL_*` 表示端点差与时序差两个独立模式，运行时不得合并成一个“平衡分”。

## 3. Concrete exercise mapping

| Exercise ID | 动作 | Family | Primary view seed | 动作级必补证据 / 限制 |
|---|---|---|---|---|
| `march_in_place` | 原地踏步 | `LOC` | front | 左右提膝顺序、脚离地；不以提膝高度直接判断训练效果 |
| `side_step_touch` | 侧步并步 | `LOC` | front | 左右横向步幅与回并事件 |
| `alternating_knee_raise` | 慢速交替提膝 | `LOC` | front | 膝相对髋高度、左右交替；躯干侧倾是辅助证据 |
| `step_jack` | 低冲击开合 | `LOC` | front | 单侧迈开与手臂开合的顺序，不可借用 jumping-jack 同步双脚规则 |
| `jumping_jack` | 开合跳 | `LOC` | front | 双脚同时开合、手臂同步；需要落地/脚部可见性 |
| `sit_up` | 仰卧起坐 | `CORE_FLEX` | left | 区分仰卧起坐与卷腹 identity；地面、膝角和足部固定方式 |
| `barbell_row` | 杠铃划船 | `H_PULL` | frontLeft45 | 躯干俯身角、杠到躯干路径；器械检测后才判断杠路 |
| `pull_up` | 引体向上 | `V_PULL` | front | 固定横杆/腕部、肩部纵向位移、摆动；横杆可见性 |
| `lat_pulldown` | 高位下拉 | `V_PULL` | rear | 把手/杠路径、躯干后仰、左右肘终点；rear view 需脸/朝向校验 |
| `seated_row` | 坐姿划船 | `H_PULL` | frontLeft45 | 躯干前后摆动、把手到躯干；脚踏/座椅设置 |
| `straight_arm_pulldown` | 直臂下压 | `V_PULL` | left | 肘角应为稳定特征，肩/腕弧线为主动特征 |
| `wide_grip_lat_pulldown` | 宽握高位下拉 | `V_PULL` | rear | 握距和器械必须与普通下拉分桶 |
| `bodyweight_squat` | 徒手深蹲 | `SQUAT` | left | 髋膝 ROM、躯干角；正面另采左右膝/骨盆证据 |
| `seated_shoulder_press` | 坐姿推肩 | `V_PUSH` | frontLeft45 | 凳背角、腕高、肘伸、躯干离背代理 |
| `lateral_raise` | 侧平举 | `SH_ABD` | front | 双腕/肘高度、躯干摆动、肩线；手掌旋转非 33 点可靠证据 |
| `rear_delt_fly` | 后束飞鸟 | `SH_HABD` | rearLeft45 | 俯身角、双腕展开、肘角；遮挡时拒答 |
| `face_pull` | 绳索面拉 | `H_PULL` | frontLeft45 | 把手接近面部、肘高；普通 Pose 不足以确认肩外旋 |
| `barbell_bench_press` | 杠铃卧推 | `H_PUSH` | frontLeft45 | 杠轴/倾斜、胸部端点、凳面和握距；仅腕点不能代替杠路 |
| `dumbbell_bench_press` | 哑铃卧推 | `H_PUSH` | frontLeft45 | 两只哑铃各自路径、左右端点、凳角 |
| `incline_dumbbell_press` | 上斜哑铃卧推 | `H_PUSH` | frontLeft45 | 凳角是 identity；不能借用平板卧推 envelope |
| `machine_chest_press` | 器械推胸 | `H_PUSH` | frontLeft45 | 座椅高度、把手/连杆路径、靠背接触代理 |
| `cable_chest_fly` | 绳索夹胸 | `H_PUSH` | front | 双腕合拢与肘角稳定；滑轮高度/站距 |
| `push_up` | 俯卧撑 | `H_PUSH` | frontLeft45 | 肩—髋—踝相对线、胸部下降/肘 ROM；不推断腰椎风险 |
| `one_arm_dumbbell_row` | 单臂哑铃划船 | `H_PULL` | frontLeft45 | 工作侧、支撑手/膝、躯干旋转、哑铃路径 |
| `standing_dumbbell_row` | 站姿双哑铃划船 | `H_PULL` | frontLeft45 | 双侧哑铃路径、俯身角；不可借用单臂支撑规则 |
| `chest_supported_row` | 胸托划船 | `H_PULL` | frontLeft45 | 胸托/凳角、胸部离垫代理；躯干摆动容差更小但需可见 |
| `single_arm_cable_row` | 单臂绳索划船 | `H_PULL` | frontLeft45 | 工作侧、躯干旋转、把手路径、滑轮高度 |
| `assisted_pull_up` | 辅助引体向上 | `V_PULL` | front | 辅助平台/膝垫运动与辅助等级，不能借用徒手阈值 |
| `barbell_back_squat` | 杠铃深蹲 | `SQUAT` | left | 杠轴/杠路、深度、躯干角；站距/鞋跟/杠位 |
| `leg_press` | 腿举 | `SQUAT` | left | 踏板/座椅角、机器行程、骨盆离垫代理；足部位置 |
| `romanian_deadlift` | 罗马尼亚硬拉 | `HINGE` | left | 杠贴腿路径、髋后移、膝角相对稳定、底端由 intent 定义 |
| `conventional_deadlift` | 传统硬拉 | `HINGE` | left | 地面起始、杠轴、髋膝协同；不可借用 RDL 周期和端点 |
| `walking_lunge` | 行走箭步蹲 | `SQUAT` | frontLeft45 | 工作侧切换、连续前移与着地事件；需相机视野容纳位移 |
| `alternating_lunge` | 原地交替弓步蹲 | `SQUAT` | frontLeft45 | 每次回到原地、左右顺序；不可与 walking lunge 混用 |
| `bulgarian_split_squat` | 保加利亚分腿蹲 | `SQUAT` | frontLeft45 | 工作侧、后脚支撑凳、骨盆侧移与深度 |
| `leg_extension` | 腿屈伸 | `KNEE_EXT` | left | 机器滚筒、座椅/靠背和单/双腿 identity |
| `leg_curl` | 腿弯举 | `KNEE_FLEX` | left | 当前 generic identity 必须先拆坐姿/俯卧，不能形成统一标准 |
| `hip_thrust` | 臀推 | `HINGE` | left | 肩背长凳、髋顶端、足距、杠铃/垫；避免过度把躯干当刚体 |
| `calf_raise` | 提踵 | `ANKLE_PF` | left | 足跟/平台/机器证据；MediaPipe 脚点精度需单独验证 |
| `front_raise` | 前平举 | `SH_FLEX` | frontLeft45 | 腕高、肘角、躯干后仰；哑铃/绳索分桶 |
| `single_arm_cable_lateral_raise` | 单臂绳索侧平举 | `SH_ABD` | frontLeft45 | 工作侧、躯干侧倾、滑轮高度与站位 |
| `landmine_press` | 地雷管推举 | `V_PUSH` | frontLeft45 | 杠端斜向路径、单/双侧、躯干旋转；不是纯垂直推 |
| `cable_y_raise` | 绳索 Y 举 | `SH_ABD` | front | Y 向而非纯侧向端点、双腕高度、滑轮路径 |
| `cable_external_rotation` | 绳索外旋 | `SH_ER` | frontLeft45 | 需要肘/腕清晰和上臂固定；前臂旋转不可见时优先拒答 |
| `rear_delt_row` | 后束划船 | `H_PULL` | rearLeft45 | 肘高/外展策略、躯干角；与普通划船分开审核 |
| `barbell_biceps_curl` | 杠铃弯举 | `ELB_FLEX` | frontLeft45 | 杠路径、双肘、上臂和躯干摆动 |
| `dumbbell_biceps_curl` | 哑铃弯举 | `ELB_FLEX` | frontLeft45 | 同时/交替必须固定；两只哑铃路径 |
| `alternating_dumbbell_biceps_curl` | 交替哑铃弯举 | `ELB_FLEX` | frontLeft45 | 左右交替顺序和每侧完整周期，不要求同步端点 |
| `hammer_curl` | 锤式弯举 | `ELB_FLEX` | frontLeft45 | 普通 Pose 不能确认中立握法；需手/器械证据或用户确认 |
| `cable_biceps_curl` | 绳索弯举 | `ELB_FLEX` | frontLeft45 | 滑轮高度、把手、站距和上臂漂移 |
| `triceps_pushdown` | 绳索下压 | `ELB_EXT` | frontLeft45 | 上臂固定、肘伸端点、滑轮/把手；绳/直杆分桶 |
| `overhead_triceps_extension` | 过顶臂屈伸 | `ELB_EXT` | frontLeft45 | 上臂过顶位置、肘伸、头后遮挡和器械类型 |
| `skull_crusher` | 仰卧臂屈伸 | `ELB_EXT` | frontLeft45 | 上臂角、肘伸、器械到头肩路径、凳角 |
| `decline_barbell_bench_press` | 下斜杠铃卧推 | `H_PUSH` | frontLeft45 | 下斜角、杠轴/触点、握距；独立于平板卧推 |
| `chest_dip` | 双杠臂屈伸（胸部版） | `V_PUSH` | left | 前倾胸部版 intent、肘 ROM、肩/髋整体路径、辅助方式 |
| `pec_deck_fly` | 蝴蝶机夹胸 | `H_PUSH` | front | 把手或肘垫形式、座椅高度、双侧连杆路径 |
| `chin_up` | 反手引体向上 | `V_PULL` | front | 反握由用户/手部证据确认；摆动和顶部端点 |
| `t_bar_row` | T 杠划船 | `H_PULL` | frontLeft45 | 胸托与否、把手、杠端路径和俯身角均需分桶 |
| `back_extension` | 罗马椅背伸 | `HINGE` | left | 45° 器械、髋主导 vs 脊柱主导 intent；不做腰椎负荷判断 |
| `front_squat` | 杠铃前蹲 | `SQUAT` | left | 前架/杠位、杠路、躯干和深度；独立于后蹲 |
| `goblet_squat` | 高脚杯深蹲 | `SQUAT` | left | 持重高度、器械、躯干和深度 |
| `seated_leg_curl` | 坐姿腿弯举 | `KNEE_FLEX` | left | 座椅/靠背/压腿垫、滚筒与髋贴靠代理 |
| `lying_leg_curl` | 俯卧腿弯举 | `KNEE_FLEX` | left | 髋垫、滚筒、骨盆抬起代理；独立于坐姿 |
| `glute_bridge` | 臀桥 | `HINGE` | left | 肩背在地面、髋顶端、足距；不可借用臀推 profile |
| `dumbbell_shoulder_press` | 坐姿哑铃推肩 | `V_PUSH` | frontLeft45 | 两只哑铃路径、凳背角、左右腕高 |
| `arnold_press` | 阿诺德推举 | `V_PUSH` | frontLeft45 | 旋转路径需要手部/器械证据；33 点只够观察推举部分 |
| `upright_row` | 直立划船 | `SH_ABD` | front | 握距、肘/腕高度、器械；不设置通用肩部安全阈值 |
| `preacher_curl` | 牧师凳弯举 | `ELB_FLEX` | frontLeft45 | 上臂垫、凳角、EZ 杠/哑铃和肘端点 |
| `incline_dumbbell_curl` | 上斜哑铃弯举 | `ELB_FLEX` | frontLeft45 | 凳角、上臂相对躯干、交替/同时和器械路径 |
| `close_grip_bench_press` | 窄握杠铃卧推 | `H_PUSH` | frontLeft45 | 握距是 identity；杠路、肘端点和凳面，不能借普通卧推阈值 |

## 4. What this exposes about the registry

当前 registry 有几个必须先解决的数据身份问题：

- `leg_curl` 的 aliases 同时覆盖俯卧与坐姿，而后面又有独立 `seated_leg_curl` / `lying_leg_curl`；generic identity 不能获得标准执行 envelope。
- 多个器械动作把 “barbell or dumbbell”“cable or resistance band” 放在同一 identity；计数可共用粗粒度模式，标准路径与偏差不能默认共用。
- 握法、凳角、支撑方式、单/双侧、允许借力和训练 tempo 都会改变判断契约，必须作为版本化 metadata，而不是藏在自然语言名称里。
- 模拟 prior 的主机位是采集假设，不是可观测性证明。正面适合双侧差，侧面适合矢状面 ROM；很多动作实际需要 45° 或双机位覆盖不同判断。

因此，70 行表示知识覆盖范围，不表示 70 个动作同时进入训练或发布。真正的发布单元是具体 claim，而不是动作名称。

## 5. Related contracts

- [教练偏差—影响知识矩阵](./ai-coach-deviation-effect-pattern-matrix-v0.1.md)
- [训练执行评估标准](./ai-coach-training-execution-assessment-standard-v0.1.md)
- [证据、采集、训练与人工标注标准](./ai-coach-evidence-and-training-data-requirements-v0.1.md)
