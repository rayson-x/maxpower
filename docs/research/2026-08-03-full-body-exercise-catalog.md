# 全身训练动作目录：胸、背、腿、肩、手臂

**日期：** 2026-08-03  
**目的：** 为 MaxPower 的动作选择、采集标签和后续专项动作识别建立一份小而完整的首版目录。这里的“首版”不是穷尽健身房的所有变式，而是每个肌群保留 5–8 个常见、可稳定拍摄、能被清楚命名的动作；器械、握法和单双侧等近邻变式作为别名或 `variationOf` 保存。

## 结论

1. 项目的现有 `exerciseRegistry.ts` 已包含五个肌群和 **43 个规范动作标签**；用户提出的前平举、单臂绳索侧平举、地雷管推举、Y 举、外旋和后束划船也已经以 `catalog_only` 标签存在。因此本轮的关键不是继续堆标签，而是把目录按肌群呈现，并按“可录制”与“已具专项分析”诚实区分。
2. 先将每个肌群的 5–8 个核心动作放在控制台首屏；其它已存在的动作在“更多变式”中保留。这样既覆盖常见训练，也避免相近动作被用户误选而让 2D 分段器给出看似精确、实则不适用的计数。
3. 只有 10 个动作目前有专项运动学 profile：杠铃划船、引体、高位下拉、坐姿划船、直臂下压、徒手深蹲、坐姿推肩、侧平举、后束飞鸟、面拉。它们仍为 `experimental`，不是“已验证评分”。目录中的其余动作应当先记录视频 + canonical 骨架 + 人工审批真值，累计足够同机位数据后再建立 profile。
4. 外旋应保留为**热身/肩袖控制采集**，而不是与大重量训练动作并列的质量评分项目。AAOS 的肩部方案把外旋列为肩袖/后束控制练习，并强调训练不应诱发疼痛；这支持其低负荷、人工复核优先的产品定位。[AAOS 肩部训练方案](https://orthoinfo.aaos.org/en/recovery/rotator-cuff-and-shoulder-conditioning-program?webid=2FDEE455)

## 选择原则与证据边界

目录按“主要训练肌群”归类，不声称动作只作用一个肌群：例如卧推也涉及三头和前三角、划船也涉及后束。ACSM 建议阻力训练覆盖主要肌群，并把 biceps curl、triceps extension、shoulder press、bent-over row 作为上肢示例；ACE 的运动库也分别按 chest、back、legs、shoulders、arms 与器械筛选动作。[ACSM：自由重量选择与使用](https://www.acsm.org/docs/default-source/files-for-resource-library/selecting-and-effectively-using-free-weights.pdf) [ACE 运动库](https://www.acefitness.org/resources/everyone/exercise-library/)

“规范标签”是产品数据模型的选择，不是生物力学或医疗处方。下表的**可复用**只表示可共用一个采集/目录标签；只有标注“可共享专项 profile”的项目才可能在取得真值后复用已有分段信号。没有采集验证时，必须维持 `catalog_only`。

## 胸：首版 6 项

ACE 的胸部库列出杠铃/哑铃胸推、上斜胸推、飞鸟、俯卧撑等，并将胸推按杠铃 + 长凳或哑铃 + 长凳等器械区分。[ACE 胸部动作库](https://www.acefitness.org/resources/everyone/exercise-library/body-part/chest/pectorals%28pecs%29/)

|规范标签|常用别名/变式|器械|产品建议|
|---|---|---|---|
|杠铃卧推 `barbell_bench_press`|平板卧推|杠铃、平凳|单列；卧推路径与其它胸推动作差异大。|
|哑铃卧推 `dumbbell_bench_press`|平板哑铃卧推|哑铃、平凳|作为杠铃卧推变式保留，但先单独收集；双手不共享同一器械轨迹。|
|上斜哑铃卧推 `incline_dumbbell_press`|上斜卧推|哑铃、上斜凳|作为哑铃卧推变式；机位/凳角度必须入标签。|
|器械推胸 `machine_chest_press`|坐姿推胸|推胸器械|目录可复用“胸推”族，但计数 profile 应另建。|
|绳索夹胸 `cable_chest_fly`|绳索飞鸟、夹胸|双滑轮绳索|单列；主信号是水平内收，不可借用卧推的肘角 profile。|
|俯卧撑 `push_up`|标准俯卧撑|自重|单列；身体整体移动使其与卧推不应共用 profile。|

## 背：首版 8 项

ACE 将 bent-over row、chin-up 等列为背/手臂相关动作；其器械页也明确列出 bent-over row、chest press 等，便于产品用器械做筛选。[ACE 手臂/背部动作索引](https://www.acefitness.org/resources/everyone/exercise-library/body-part/arms/) [ACE 杠铃器械索引](https://www.acefitness.org/resources/everyone/exercise-library/equipment/barbell/)

|规范标签|常用别名/变式|器械|产品建议|
|---|---|---|---|
|杠铃划船 `barbell_row`|俯身杠铃划船|杠铃|已有实验 profile；建议斜前 45°。|
|单臂哑铃划船 `one_arm_dumbbell_row`|单手哑铃划船|哑铃、凳|作为划船族变式；单侧轮次与躯干支撑需要新真值。|
|胸托划船 `chest_supported_row`|器械胸托划船|胸托器械或上斜凳|作为划船族变式；可减少躯干漂移，但仍不要直接套杠铃 profile。|
|坐姿划船 `seated_row`|坐姿绳索划船|绳索划船器|已有实验 profile；建议斜前 45°。|
|高位下拉 `lat_pulldown`|背阔肌下拉|高位滑轮|已有实验 profile；宽握 `wide_grip_lat_pulldown` 仅作同动作族变式。|
|引体向上 `pull_up`|正手引体|单杠|已有实验 profile；辅助引体 `assisted_pull_up` 应独立采集，配重平台改变身体位移。|
|直臂下压 `straight_arm_pulldown`|直臂绳索下拉|高位绳索|已有实验 profile；建议侧面。|
|单臂绳索划船 `single_arm_cable_row`|单手绳索划船|绳索|作为坐姿划船近邻变式，但单侧时应标出左右侧。|

## 腿：首版 8 项

ACE 的器械/动作索引列出 back squat、forward lunge、hip bridge、calf raises 等，并以腿、大腿、臀髋等目标部位分类。[ACE 杠铃器械索引](https://www.acefitness.org/resources/everyone/exercise-library/equipment/barbell/) [ACE 动作库](https://www.acefitness.org/resources/everyone/exercise-library/)

|规范标签|常用别名/变式|器械|产品建议|
|---|---|---|---|
|徒手深蹲 `bodyweight_squat`|深蹲、自重深蹲|自重|已有实验 profile；作为蹲类数据采集基线。|
|杠铃深蹲 `barbell_back_squat`|后蹲|杠铃、深蹲架|作为徒手深蹲变式；负重与杆遮挡使动作质量规则不能直接复用。|
|腿举 `leg_press`|倒蹬|腿举机|单列；座椅和踏板坐标系不同。|
|罗马尼亚硬拉 `romanian_deadlift`|RDL|杠铃或哑铃|单列；髋铰链需要侧面采集，尚无 profile。|
|行走箭步蹲 `walking_lunge`|弓步走|自重或哑铃|单列；应以单腿步次/左右为结构化真值。|
|保加利亚分腿蹲 `bulgarian_split_squat`|分腿蹲|哑铃、凳|单列；腿别和镜头侧必须入标签。|
|腿屈伸 `leg_extension`|坐姿腿屈伸|腿屈伸机|单列；主要是膝伸展信号。|
|腿弯举 `leg_curl`|俯卧/坐姿腿弯举|腿弯举机|单列；俯卧和坐姿至少应保存为变式字段。|
|提踵 `calf_raise`|站姿/坐姿提踵|自重或提踵机|应独立采集；站姿和坐姿变式不宜混合计数。|

> 腿部首屏建议保留前 8 项，把提踵放在“更多变式”；表中保留它以避免目录遗漏。

## 肩：首版 8 项 + 2 项热身/进阶项

ACSM 将 shoulder press 列为上肢主要肌群的自由重量训练示例；ACE 的肩部库按前三角/中束、后束与肩袖等分类。AAOS 的肩部方案则明确列出外旋、站姿划船等肩胛/肩袖控制动作，并建议先热身、疼痛时不要继续。[ACSM：自由重量选择与使用](https://www.acsm.org/docs/default-source/files-for-resource-library/selecting-and-effectively-using-free-weights.pdf) [ACE 肩部动作库](https://www.acefitness.org/resources/everyone/exercise-library/body-part/shoulders/anterior-and-medial-deltoids%28delts%29/) [AAOS 肩部训练方案](https://orthoinfo.aaos.org/en/recovery/rotator-cuff-and-shoulder-conditioning-program?webid=2FDEE455)

|规范标签|常用别名/变式|器械|产品建议|
|---|---|---|---|
|坐姿推肩 `seated_shoulder_press`|坐姿哑铃/器械推肩、肩上推举|哑铃或推肩器、凳|已有实验 profile；用户手动选择，暂不自动分类。|
|侧平举 `lateral_raise`|哑铃/器械/绳索侧平举|哑铃或绳索|已有实验 profile；绳索和器械变体需分别审批。|
|后束飞鸟 `rear_delt_fly`|反向飞鸟、反向蝴蝶机、俯身飞鸟|反向蝴蝶机或哑铃|已有实验 profile；斜后 45°更稳定。|
|绳索面拉 `face_pull`|面拉|绳索、绳索把手|已有实验 profile；斜前 45°。|
|前平举 `front_raise`|哑铃/绳索前平举|哑铃或绳索|可作为侧平举家族标签，但**不**复用侧平举 profile；平面不同。|
|单臂绳索侧平举 `single_arm_cable_lateral_raise`|单手绳索侧平举|绳索|作为侧平举变式；单侧采集须保存左右。|
|地雷管推举 `landmine_press`|地雷管单臂推举|杠铃、地雷管固定器|作为推肩近邻变式，非垂直轨迹，需新 profile。|
|后束划船 `rear_delt_row`|高位后束划船|绳索或哑铃|作为后束飞鸟近邻标签；水平拉而非飞鸟，需新 profile。|
|绳索 Y 举 `cable_y_raise`|Y 举|绳索|保留为控制/进阶采集；先只保存真值。|
|绳索/弹力带外旋 `cable_external_rotation`|肘贴身外旋|绳索或弹力带|保留为热身和肩袖控制。当前数据模型将其暂挂在 `shoulder_abduction`，**语义不准确**；实现时应新增 `shoulder_external_rotation` 运动模式，且不自动评分。|

## 手臂：首版 7 项

ACSM 把 biceps curl 和 triceps extension 作为自由重量上肢训练的示例。ACE 的手臂库列出 bicep curl、hammer curl、lying barbell triceps extension 等，并将器械、长凳、哑铃、杠铃、绳索等作为筛选条件。[ACSM：自由重量选择与使用](https://www.acsm.org/docs/default-source/files-for-resource-library/selecting-and-effectively-using-free-weights.pdf) [ACE 手臂动作库](https://www.acefitness.org/resources/everyone/exercise-library/body-part/arms/)

|规范标签|常用别名/变式|器械|产品建议|
|---|---|---|---|
|杠铃弯举 `barbell_biceps_curl`|杠铃二头弯举|杠铃|单列为弯举族基准；尚无 profile。|
|哑铃弯举 `dumbbell_biceps_curl`|哑铃二头弯举|哑铃|作为杠铃弯举变式；可采单双臂，但应保存左右/同步方式。|
|锤式弯举 `hammer_curl`|锤式二头弯举|哑铃|作为哑铃弯举变式；前臂旋转状态不同，单独审批。|
|绳索弯举 `cable_biceps_curl`|绳索二头弯举|绳索|作为弯举族变式；绳索方向需要入标签。|
|绳索下压 `triceps_pushdown`|三头下压|高位绳索|单列；主信号为肘伸展。|
|过顶臂屈伸 `overhead_triceps_extension`|绳索/哑铃过顶臂屈伸|绳索或哑铃|作为三头下压变式，但过顶臂位不同，不能共用 profile。|
|仰卧臂屈伸 `skull_crusher`|碎颅者、lying triceps extension|杠铃或哑铃、凳|作为三头家族变式；建议侧前机位，先只采集。|

## 采集与建模优先级

|阶段|目录状态|产品行为|验收信号|
|---|---|---|---|
|A：当前|`experimental` 的 10 项|允许手动选择、运行现有专项分段、保存完整 canonical 骨架与诊断、展示“实验”|每组可被视频回放和用户实际次数审批。|
|B：扩目录采集|`catalog_only` 的动作|允许录制、保存规范标签/变式/机位/左右侧；**不**展示专项自动质量结论|同一动作 × 推荐机位至少有足够可见性合格、人工批准的组。|
|C：专项 profile|已验证单一动作/机位|冻结 profile version，在留出的录像上比较计数与人工真值|公布按动作、机位、受试者切分的计数误差与拒答率，而非只报总体准确率。|

### 最小字段

每一组除现有录像与 canonical pose 外，应保存：`exerciseId`、`variationId`（或器械/握法）、`muscleGroup`、`cameraPosition`、左右侧/单双侧、用户实际次数、用户批准的候选分段、动作 profile version、模型版本。对于多关节和单侧动作，缺少左右侧或机位会让日后的训练数据不可比。

### 训练安全边界

这是一份动作目录，不是医疗建议或个体化康复计划。AAOS 明确建议肩部训练先进行低冲击热身，动作不应疼痛；若训练中出现疼痛，应咨询医生或物理治疗师。产品内应把这作为外旋/Y 举等控制动作的提示，而不是试图用姿态模型诊断伤病。[AAOS 肩部训练方案](https://orthoinfo.aaos.org/en/recovery/rotator-cuff-and-shoulder-conditioning-program?webid=2FDEE455)
