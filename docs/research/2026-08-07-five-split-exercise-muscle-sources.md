# 五分化训练动作：肌群与轨迹证据清单

日期：2026-08-07
范围：`src/pose/exerciseRegistry.ts` 中胸、背、腿、肩、手臂五类动作；不含原地踏步等 4 个居家 locomotion 动作。

## 结论先行

- Registry 当前包含 44 个五分化动作：胸 6、背 10、腿 11、肩 10、手臂 7。
- 本轮找到 22 个可直接落到具体 `exerciseId` 的动作页或具体动作资料；另有 10 个只覆盖 Registry 中某一个器械/姿势变体。其余 12 个动作应暂时标记为 `curated_general_reference` 或 `missing_exact_reference`，不能把资料库首页、同类动作或相邻变体写成精确证据。
- ACE 动作页常只给 `Target Body Part`，可以支持“目标身体区域”和动作步骤，却通常不足以单独支持“某肌肉是 primary、某肌肉是 secondary”。ExRx 的具体动作页明确列出 Target、Synergists、Stabilizers，适合支持角色层级；但它仍是动作学参考，不是用户当次真实肌电或肌肉力测量。
- 从单目骨架可较稳妥整理的是相位和可见关节运动。下表中的“轨迹模板”是从动作步骤做的运动学归纳，不表示已经观测到肌肉激活。

## 证据等级

| 标记 | 含义 | 数据库建议 |
|---|---|---|
| `EXACT-M` | 具体动作页且明确列出 Target/Synergists/Stabilizers 或主要肌肉 | 可作为 `exact_exercise_reference`，角色仍需逐项按来源录入 |
| `EXACT-R` | 具体动作页，但只支持目标身体区域和动作步骤 | 可作为精确动作身份/相位来源；primary/secondary 属于产品侧策展推断 |
| `VARIANT` | 只覆盖 Registry 合并身份中的一个器械、握法或姿势变体 | 不应为整个 Registry id 标成精确；建议拆分 identity 后再用 |
| `GAP` | 本轮未核验到精确动作页 | 保留候选映射，但 `evidenceStatus` 不得标 exact |

## 轨迹模板速记

- `press-horizontal`：回程为肘屈曲、肩水平外展；推起为肘伸展、肩水平内收。
- `fly`：张开为肩水平外展；合拢为肩水平内收；肘角近似保持。
- `row`：拉入为肘屈曲、肩伸展/水平外展；回程相反。肩胛运动在二维骨架中只能保守描述。
- `vertical-pull`：拉动为肘屈曲、肩内收/伸展；回程为肘伸展、肩屈曲/外展。
- `squat`：下蹲为髋/膝屈曲，起身为髋/膝伸展。
- `hinge`：下降为髋屈曲，起身为髋伸展；脊柱“稳定”不能由单个关节角等同为某块核心肌发力。
- `raise`：侧举为肩外展，前举为肩屈曲，后束飞鸟为肩水平外展。
- `curl`：向心段肘屈曲，回程肘伸展；`triceps-extension` 相反。

## 胸：6 个动作

| Registry id | 动作身份 | 建议肌群映射（不是实测激活） | 可见相位/关节运动 | 精确来源与支持范围 |
|---|---|---|---|---|
| `barbell_bench_press` | 平板杠铃卧推 | 候选：胸肌主，肱三头肌/三角肌前束辅 | `press-horizontal` | `EXACT-R` [ACE Chest Press—Barbell](https://www.acefitness.org/resources/everyone/exercise-library/5/chest-press/)：精确器械与凳面；支持 Arms/Chest/Shoulders 目标区域及肘屈伸步骤，不直接给 primary/secondary |
| `dumbbell_bench_press` | 平板双哑铃卧推 | 候选：胸肌主，肱三头肌/三角肌前束辅 | `press-horizontal` | `EXACT-R` [ACE Chest Press—Dumbbells](https://www.acefitness.org/resources/everyone/exercise-library/19/chest-press/)：支持目标区域、下降/上推相位和肘伸展 |
| `incline_dumbbell_press` | 45–60° 上斜双哑铃卧推 | 候选：胸肌、三角肌前束；肱三头肌辅 | 回程肘屈曲；斜向推起肘伸展 | `EXACT-R` [ACE Incline Chest Press](https://www.acefitness.org/resources/everyone/exercise-library/25/incline-chest-press/)：支持 Chest/Shoulders、凳角和分相步骤 |
| `machine_chest_press` | 坐姿选择片器械推胸 | 候选：胸肌主，肱三头肌/三角肌前束辅 | `press-horizontal` | `EXACT-R` [ACE Seated Chest Press](https://www.acefitness.org/resources/everyone/exercise-library/188/seated-chest-press/)：精确机器身份，支持 Chest 和肘伸/屈步骤 |
| `cable_chest_fly` | 双侧绳索夹胸 | 候选：胸肌主，三角肌前束辅 | `fly` | `GAP`：本轮没有核验到与滑轮高度、站姿和是否交叉均匹配的具体页 |
| `push_up` | 标准俯卧撑 | 候选：胸肌主，肱三头肌/三角肌前束；躯干稳定肌群稳定 | 下放肘屈曲；推起肘伸展；躯干近似刚体 | `EXACT-R` [ACE Push-up](https://www.acefitness.org/resources/everyone/exercise-library/41/push-up/)：支持 Arms/Chest/Shoulders、下放/推起相位和躯干对齐 |

## 背：10 个动作

| Registry id | 动作身份 | 建议肌群映射（不是实测激活） | 可见相位/关节运动 | 精确来源与支持范围 |
|---|---|---|---|---|
| `barbell_row` | 俯身杠铃划船 | 候选：背阔肌/肩胛后缩肌群主，肘屈肌辅，竖脊肌稳定 | `row`；髋角近似保持 | `EXACT-R` [ACE Bent-over Row](https://www.acefitness.org/resources/everyone/exercise-library/12/bent-over-row/)：支持 Arms/Back/Shoulders、髋铰链准备位和拉向腹部路径 |
| `pull_up` | 标准正手引体向上 | 候选：背阔肌主，肘屈肌/肩胛后缩肌群辅 | `vertical-pull` | `GAP`：找到的 ExRx 页面是加重窄握或辅助变体，不能替代标准正手身份 |
| `lat_pulldown` | 坐姿绳索高位下拉（未限定握宽） | 候选：背阔肌主，肱肌/肱桡肌/肱二头肌等辅 | `vertical-pull` | `VARIANT` [ExRx Cable Pulldown](https://exrx.net/WeightExercises/LatissimusDorsi/CBFrontPulldown)：页面明确为宽握；支持背阔肌 Target、肘屈肌等 Synergists 及拉至上胸路径，但不代表所有握法 |
| `seated_row` | 坐姿绳索划船 | 候选：背阔肌/肩胛后缩肌群主，肘屈肌辅 | `row` | `GAP`：ACE Seated High Back Rows 是选择片高位划船，不等同坐姿绳索划船 |
| `straight_arm_pulldown` | 直臂绳索下拉 | 候选：背阔肌主，肱三头肌长头动态稳定 | 肩伸展下压；回程肩屈曲；肘角保持 | `GAP` |
| `wide_grip_lat_pulldown` | 宽握坐姿绳索高位下拉 | 背阔肌主；肱肌、肱桡肌、肱二头肌、大圆肌等辅 | `vertical-pull` | `EXACT-M` [ExRx Cable Pulldown](https://exrx.net/WeightExercises/LatissimusDorsi/CBFrontPulldown)：明确 wide grip、Target、Synergists 和回程 |
| `one_arm_dumbbell_row` | 长凳支撑单臂哑铃划船 | 候选：背阔肌/肩胛后缩肌群主，肘屈肌辅 | 单侧 `row` | `GAP` |
| `chest_supported_row` | 胸托器械或斜凳划船 | 候选：肩胛后缩肌群/背阔肌主，后束与肘屈肌辅 | `row`；躯干由胸托固定 | `GAP`：Registry 合并了机器和斜凳两个 identity |
| `single_arm_cable_row` | 单臂绳索划船 | 候选：背阔肌/肩胛后缩肌群主，肘屈肌辅 | 单侧 `row` | `GAP` |
| `assisted_pull_up` | 辅助引体向上机 | 背阔肌主；肱肌、肱桡肌、肱二头肌、大圆肌、菱形肌等辅 | `vertical-pull` | `EXACT-M` [ExRx Machine-assisted Pull-up](https://exrx.net/WeightExercises/LatissimusDorsi/AsPullupOpen)：支持机器辅助身份、Target/Synergists 和完整回程 |

## 腿：11 个动作

| Registry id | 动作身份 | 建议肌群映射（不是实测激活） | 可见相位/关节运动 | 精确来源与支持范围 |
|---|---|---|---|---|
| `bodyweight_squat` | 徒手深蹲 | 候选：股四头肌/臀肌主；腘绳肌、小腿、躯干稳定肌群参与 | `squat` | `EXACT-R` [ACE Bodyweight Squat](https://www.acefitness.org/resources/everyone/exercise-library/135/bodyweight-squat/)：支持 Abs/Butt-Hips/Calves/Thighs 目标区域和髋膝屈伸相位 |
| `barbell_back_squat` | 杠铃后蹲 | 候选：股四头肌/臀肌主；腘绳肌、躯干稳定肌群参与 | `squat` | `EXACT-R` [ACE Back Squat](https://www.acefitness.org/resources/everyone/exercise-library/11/back-squat/)：支持 Butt-Hips/Thighs、杠铃后置和上下相位 |
| `leg_press` | 坐姿选择片腿举 | 臀肌、股四头肌、腘绳肌 | 回程髋/膝屈曲；推蹬髋/膝伸展 | `EXACT-M` [ACE Seated Leg Press](https://www.acefitness.org/resources/everyone/exercise-library/154/seated-leg-press/)：步骤直接写明 glutes/quadriceps/hamstrings 及髋膝伸屈 |
| `romanian_deadlift` | 杠铃或哑铃罗马尼亚硬拉 | 臀大肌、腘绳肌、竖脊肌、内收大肌；斜方肌和前臂屈肌参与 | `hinge`；膝保持轻屈 | `EXACT-M` [ACE Romanian Deadlift Exercise](https://www.acefitness.org/resources/everyone/exercise-library/317/romanian-deadlift/) 与 [ACE RDL 专题](https://www.acefitness.org/continuing-education/certified/may-2025/8865/the-ace-do-it-better-series-the-romanian-deadlift/)：支持主要肌肉、髋屈/伸和稳定边界 |
| `conventional_deadlift` | 传统杠铃硬拉，从地面起杠 | 候选：臀肌/大腿后侧与深层脊柱稳定肌群；起杠阶段亦含膝伸 | 下放髋膝屈曲；起杠髋膝伸展 | `EXACT-R` [ACE Deadlift](https://www.acefitness.org/resources/everyone/exercise-library/6/deadlift/)；[ACE Deadlift vs RDL](https://www.acefitness.org/resources/pros/expert-articles/7963/what-is-the-difference-between-romanian-deadlift-vs-deadlift/) 支持从地面起杠、臀肌/上腿和脊柱稳定描述 |
| `walking_lunge` | 行走箭步蹲 | 候选：股四头肌/臀肌主；腘绳肌、小腿稳定 | 前腿下降髋膝屈曲；蹬起髋膝伸展并换步 | `VARIANT` [ACE Forward Lunge](https://www.acefitness.org/resources/everyone/exercise-library/8/forward-lunge/) 只支持单次前跨弓步，不足以覆盖连续 walking identity |
| `bulgarian_split_squat` | 后脚抬高保加利亚分腿蹲 | 候选：前腿臀肌/股四头肌主；髋外展肌和躯干稳定 | 前腿下降髋膝屈曲；起身伸展 | `EXACT-R` [ACE Bulgarian Split Squat](https://www.acefitness.org/resources/everyone/exercise-library/366/bulgarian-split-squat/)：支持 Bench/Dumbbells 和 Butt-Hips 目标区域；不支持精细角色层级 |
| `leg_extension` | 坐姿器械腿屈伸 | 股四头肌 | 向心膝伸展；回程膝屈曲 | `EXACT-R` [ACE Seated Leg Extension](https://www.acefitness.org/resources/everyone/exercise-library/183/seated-leg-extension/)：精确机器和目标大腿区域；页面未给细分肌肉角色 |
| `leg_curl` | Registry 合并俯卧、坐姿腿弯举 | 候选：腘绳肌主，小腿后侧辅助 | 向心膝屈曲；回程膝伸展 | `VARIANT` [ACE Lying Hamstrings Curl](https://www.acefitness.org/resources/everyone/exercise-library/153/lying-hamstrings-curl/) 只覆盖俯卧机器；建议先拆 `lying_leg_curl`/`seated_leg_curl` |
| `hip_thrust` | 杠铃臀推，背靠长凳 | 臀大肌主；股四头肌协同；腘绳肌动态稳定；竖脊肌与腹肌稳定 | 底部髋屈曲；顶起髋伸展 | `EXACT-M` [ExRx Barbell Hip Thrust](https://exrx.net/WeightExercises/GluteusMaximus/BBHipThrust)：支持 Target/Synergists/Stabilizers 和髋伸展步骤 |
| `calf_raise` | Registry 合并站姿、坐姿、机器/自重提踵 | 候选：腓肠肌/比目鱼肌，比例取决于膝角 | 向心跖屈提踵；回程背屈 | `VARIANT` [ACE Barbell Calf Raises](https://www.acefitness.org/resources/everyone/exercise-library/51/calf-raises/) 与 [ExRx Smith Seated Calf Raise](https://exrx.net/WeightExercises/Soleus/SMSeatedCalfRaise) 分属不同 identity；后者明确屈膝时比目鱼肌为 Target，证明不能合并成同一肌群角色表 |

## 肩：10 个动作

| Registry id | 动作身份 | 建议肌群映射（不是实测激活） | 可见相位/关节运动 | 精确来源与支持范围 |
|---|---|---|---|---|
| `seated_shoulder_press` | Registry 合并哑铃、杠铃/机器、握法与靠背角 | 候选：三角肌前/中束主，肱三头肌辅；肩胛上回旋肌群参与 | 下放肘屈曲；上推肘伸展并抬高手腕 | `VARIANT` [ACE 肩部 EMG 报告](https://www.acefitness.org/certifiednews/images/article/pdfs/ACEShoulderStudy.pdf) 覆盖 dumbbell shoulder press 并支持三角肌前束，但不代表所有 Registry 变体 |
| `lateral_raise` | Registry 合并哑铃与绳索侧平举 | 候选：三角肌中束主；肩袖/斜方肌参与 | `raise`：肩外展上举，肩内收回程 | `VARIANT` [ACE Dumbbell Lateral Raise](https://www.acefitness.org/resources/everyone/exercise-library/26/lateral-raise/) 只覆盖哑铃；支持肩部目标区域与上/下相位 |
| `rear_delt_fly` | Registry 合并反向蝴蝶机、俯身/斜凳哑铃飞鸟 | 候选：三角肌后束、肩胛后缩肌群 | 肩水平外展；回程水平内收 | `VARIANT` [ACE Incline Reverse Fly](https://www.acefitness.org/resources/everyone/exercise-library/34/incline-reverse-fly/) 只覆盖斜凳哑铃；ACE 肩部 EMG 报告覆盖 seated rear lateral raise，仍不能代表反向蝴蝶机 |
| `face_pull` | 眼高位绳索面拉 | 三角肌后束、菱形肌主；中斜方肌、冈下肌、肱二头肌辅 | 拉入肘屈曲、肩水平外展并伴肩胛后缩；外旋在普通二维骨架中仅作弱特征 | `EXACT-M` [NASM Face Pull](https://www.nasm.org/resource-center/exercise-library/face-pull)：精确 cable+rope 身份，明确 Primary/Secondary muscles 和动作步骤 |
| `front_raise` | Registry 合并哑铃与绳索前平举 | 候选：三角肌前束主；胸大肌锁骨部等参与 | 肩屈曲前举；回程肩伸展 | `VARIANT` [ACE Dumbbell Front Raise](https://www.acefitness.org/resources/everyone/exercise-library/54/front-raise/) 只覆盖哑铃；支持 Shoulders 和上/下相位 |
| `single_arm_cable_lateral_raise` | 单臂低位绳索侧平举 | 三角肌中束主；三角肌前束、冈上肌、中下斜方肌、前锯肌协同 | 单侧肩外展/内收；肘角保持 | `EXACT-M` [ExRx Cable One Arm Lateral Raise](https://exrx.net/WeightExercises/DeltoidLateral/CBOneArmLateralRaise)：明确 Target/Synergists/Stabilizers，并明确动作是肩外展而非外旋 |
| `landmine_press` | 单臂地雷管斜向推举 | 候选：三角肌前束、胸肌上部、肱三头肌；躯干稳定 | 斜向上推肘伸展、肩屈曲；回程相反 | `GAP` |
| `cable_y_raise` | 双侧绳索 Y 举 | 候选：三角肌中/后束、下斜方肌、前锯肌 | 肩胛平面上举；回程下降 | `GAP` |
| `cable_external_rotation` | 肘贴身绳索/弹力带外旋 | 候选：冈下肌、小圆肌主；肩胛稳定肌群稳定 | 肩外旋；回程内旋；肘角保持 | `GAP`：Registry 还合并 cable 与 resistance band |
| `rear_delt_row` | 高肘后束划船，Registry 合并绳索/哑铃 | 候选：三角肌后束主；肩胛后缩肌群、肘屈肌辅 | 高肘拉入：肘屈曲、肩水平外展；回程相反 | `GAP` |

## 手臂：7 个动作

| Registry id | 动作身份 | 建议肌群映射（不是实测激活） | 可见相位/关节运动 | 精确来源与支持范围 |
|---|---|---|---|---|
| `barbell_biceps_curl` | 站姿杠铃弯举 | 候选：肱二头肌主；肱肌/肱桡肌辅 | `curl` | `EXACT-R` [ACE Barbell Bicep Curl](https://www.acefitness.org/resources/everyone/exercise-library/70/bicep-curl/)：精确器械，支持 Arms 和肘屈伸；不列 synergists |
| `dumbbell_biceps_curl` | Registry 未限定坐姿/站姿、交替/同时 | 候选：肱二头肌主；肱肌/肱桡肌辅 | `curl` | `VARIANT` [ACE Seated Biceps Curl](https://www.acefitness.org/resources/everyone/exercise-library/44/seated-biceps-curl/) 只覆盖坐姿同时弯举 |
| `hammer_curl` | 站姿双哑铃中立握锤式弯举 | 候选：肱肌/肱桡肌与肱二头肌 | `curl`，前臂维持中立握 | `EXACT-R` [ACE Hammer Curl](https://www.acefitness.org/resources/everyone/exercise-library/10/hammer-curl/)：精确器械和握法，支持 Arms 与肘屈伸 |
| `cable_biceps_curl` | 低位滑轮直杆弯举 | 肱二头肌主；肱肌、肱桡肌协同 | 向心肘屈曲；回程肘伸展 | `EXACT-M` [ExRx Cable Curl](https://exrx.net/WeightExercises/Biceps/CBCurl)：明确 Target/Synergists/Stabilizers 和动作步骤 |
| `triceps_pushdown` | 高位滑轮窄握下压 | 肱三头肌主；背阔肌、大圆肌、后束、胸肌和躯干肌群列为稳定者 | 向心肘伸展下压；回程肘屈曲 | `EXACT-M` [ExRx Cable Pushdown](https://exrx.net/WeightExercises/Triceps/CBPushdown)：明确 Target 与 Stabilizers；页面使用窄正握，不覆盖所有绳索附件 |
| `overhead_triceps_extension` | Registry 合并绳索/哑铃、站姿/坐姿 | 候选：肱三头肌主，长头在肩屈曲位参与 | 向心肘伸展；回程肘屈曲；上臂近似过顶保持 | `GAP`：需要按器械与姿势拆 identity 后补精确页 |
| `skull_crusher` | Registry 合并杠铃/哑铃仰卧臂屈伸 | 候选：肱三头肌主 | `triceps-extension` | `VARIANT` [ACE Lying Barbell Triceps Extensions](https://www.acefitness.org/resources/everyone/exercise-library/36/lying-barbell-triceps-extensions/) 只覆盖平板杠铃；支持 Arms 与肘屈伸 |

## 可直接写入数据库的精确证据包

优先级按“来源能否支持肌肉角色”排序：

1. `wide_grip_lat_pulldown`、`assisted_pull_up`、`hip_thrust`、`face_pull`、`single_arm_cable_lateral_raise`、`cable_biceps_curl`、`triceps_pushdown`：ExRx 或 NASM 明确给出 Target/Synergists/Stabilizers，可支撑角色字段。
2. `leg_press`、`romanian_deadlift`：ACE 正文直接点名肌肉和关节运动，可支撑较细的肌群字段。
3. `barbell_bench_press`、`dumbbell_bench_press`、`incline_dumbbell_press`、`machine_chest_press`、`push_up`、`barbell_row`、`bodyweight_squat`、`barbell_back_squat`、`conventional_deadlift`、`bulgarian_split_squat`、`leg_extension`、`barbell_biceps_curl`、`hammer_curl`：精确页可支撑动作身份、目标区域和相位；肌肉角色仍应标为策展映射，而不是来源直接结论。

## 必须先拆 identity 的条目

以下 Registry id 把会改变肌肉角色或轨迹的变体合并在一起，不宜直接提升为 `exact_exercise_reference`：

- `seated_shoulder_press`：哑铃、杠铃/机器、靠背角、握法。
- `lateral_raise`、`front_raise`：哑铃与绳索。
- `rear_delt_fly`：反向蝴蝶机、俯身哑铃、斜凳哑铃。
- `leg_curl`：俯卧与坐姿。
- `calf_raise`：站姿与坐姿；膝屈曲会改变比目鱼肌/腓肠肌相对角色。
- `overhead_triceps_extension`、`skull_crusher`：绳索/哑铃/杠铃与站姿/坐姿/仰卧。
- `chest_supported_row`：器械胸托与斜凳自由重量。

此外，`front_raise` 当前在 Registry 中的 `movementPattern` 是 `shoulder_abduction`，而具体动作页描述的是向身体前方抬臂，即肩屈曲。录入轨迹和肌群数据前应先修正这个语义错误，避免分类和特征模板发生冲突。

## 产品边界

- 这些资料支持“某个标准动作通常涉及哪些肌群”以及“骨架上可看到哪些关节运动”，不支持“当前用户这一帧实际激活了哪块肌肉”。
- 不能从二维骨架给出肌电百分比、左右肌力、肌腱负荷或关节净力矩。界面应继续使用“预计参与肌群”“动作通常训练”等措辞。
- 动作页的 target/body-part 标签与用户的实际发力策略可能不同；只有加入外力、身体参数和逆动力学/肌肉优化后，才能进一步估计关节力矩或模型肌肉力，而且仍是模型估计。
