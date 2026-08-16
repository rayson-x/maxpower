# MaxPower 扩展动作运动契约：关节、人体轨迹、器械轨迹与稳定约束

> Status: design input for review
>
> Last aligned: 2026-08-15
>
> 本文先定义细粒度动作，再为每个动作定义应该运动、应该协同、应该保持稳定和需要追踪的关系。它是 `ActionMotionDefinition` 知识资产的人工可读来源，不代表任何动作已经获得可执行 Bundle、阈值校准或用户开放资格。

## 1. 使用顺序

```text
细粒度动作身份
→ 动作族运动契约
→ 姿态/支撑/器械/单双侧修饰
→ 完整 ActionMotionDefinition
→ exact camera view 投影
→ Rep、Feature、Comparison、Rule、Set report 与 Trace
```

禁止反向处理：不能先建立一套通用关节或手腕轨迹，再根据动作名称临时打补丁。宽泛父动作可以用于目录分组，但不能成为完整质量判断对象。

## 2. 每个动作必须回答的问题

| 字段 | 含义 | 判断方式 |
|---|---|---|
| `required_motion` | 完成动作必须发生的关节、身体或负载关系 | 在一个 Rep 内产生方向变化、足够可见幅度和正确阶段顺序 |
| `coordinated_motion` | 应与主运动同阶段发生的独立佐证 | 比较反转时间、阶段顺序、相对位移和相位差 |
| `stability_relations` | 动作中应尽量保持的相对关系 | 在动作局部坐标中保持在 exact-context 走廊；不是画面坐标绝对静止 |
| `substitution_relations` | 可能替代主关节完成负载路径的运动 | 与主运动同相、持续且幅度达到适用规则时才形成偏差 |
| `primary_tracks` | 定义 Rep 方向和端点的主体关联轨迹 | 优先真实器械；徒手动作使用身体关系 |
| `corroborating_tracks` | 用于确认 Rep、阶段与冲突的独立轨迹 | 不能与主轨迹由同一预测点重复计权 |
| `rep_boundary` | 起点、反转点和返回点的语义 | 由动作局部轴、滞回、最短阶段和佐证共识确定 |
| `limited_claims` | 当前单目视频不能可靠发布的判断 | 输出 `cannot_judge`，不换用无关关节代替 |

“应该动”不等于某个像素坐标必须单调变化；“应该稳定”也不等于完全不动。两者都是相对人体、器械或支撑锚点的阶段关系。

## 3. 通用器械与姿态修饰

这些修饰不能单独产生动作。每个叶级动作必须显式选择动作族契约和修饰，并物化为不可回退的完整定义。

### 3.1 器械拓扑

| 修饰 | 主追踪 | 必须保留的关系 |
|---|---|---|
| `bodyweight` | 动作定义的身体中心、关节或身体线 | 不制造器械轨迹；固定地面、横杆、双杠或支撑面作为锚点 |
| `rigid_bar` | 杠铃中心、轴线、左右端点 | 手腕只用于握持关联；端点倾斜与左右不同步是独立技术证据 |
| `rigid_frame` | 陷阱杠等围绕身体的单一刚体中心与可见边界 | 不能沿用直杠相对小腿的距离规则 |
| `smith_guided_bar` | 杠铃中心、端点、已知导轨轴 | 负载沿导轨运动；身体相对导轨的位置成为约束，不能使用自由杠铃路径规则 |
| `dual_free_load` | 左右哑铃分别追踪 | 每侧拥有独立端点、反转和失败状态；不得先求平均再判断左右差 |
| `single_free_load` | 单一哑铃、壶铃或杠铃片中心 | 追踪负载相对活动侧关节或身体中线的轨迹 |
| `cable_handle` | 每个手柄及可见拉索方向 | 手腕用于关联；手柄路径和拉索连续性是器械事实 |
| `cable_bar` | 绳索系统上的直杆、弯杆或宽杆附件中心与端点 | 附件是绳索承载件，不等于自由杠铃；同时保留拉索方向和杆端关系 |
| `linked_machine` | 联动手柄、摆臂或承载件 | 左右不能被当作独立负载；受约束轨迹与支撑关系是主事实 |
| `independent_machine` | 左右手柄或摆臂分别追踪 | 独立端点、相位与路径差；仍受机器弧线约束 |
| `landmine_lever` | 杆端和支点形成的弧形轨迹 | 杆端围绕固定支点运动，不能用自由直线轨迹判断 |
| `bodyweight_station` | 身体中心相对固定横杆、双杠或地面 | 固定器械是空间锚点，身体轨迹是主负载轨迹 |

### 3.2 姿态与支撑

| 修饰 | 应稳定的关系 | 允许的主运动例外 |
|---|---|---|
| `standing_free` | 双脚支撑、骨盆、膝和躯干仅在动作合同允许范围内变化 | 深蹲、弓步、硬拉、移动动作本身要求下肢运动 |
| `seated_backrest` | 骨盆与躯干相对座椅/靠背稳定 | 坐姿划船若定义允许轻微髋摆动，必须使用独立变式与走廊 |
| `seated_unsupported` | 骨盆位置稳定；躯干是否允许运动由动作合同决定 | 无胸托划船与坐姿核心动作可有显式躯干运动 |
| `seated_supported` | 骨盆稳定，指定上臂、肘部或大腿接触支撑面 | 仅合同声明的关节可以围绕支撑锚点运动 |
| `chest_supported` | 胸部和躯干相对胸托稳定 | 肩胛细节不可从稀疏骨架过度声称 |
| `supine_bench` | 肩、躯干与骨盆相对凳面稳定，脚部支撑保持 | 不从单目视频声称肩胛位置或腰椎形态 |
| `incline_bench` | 采用上斜凳面局部轴，肩、躯干与骨盆相对凳面稳定 | 不得沿用平板或下斜动作的轨迹走廊 |
| `decline_bench` | 采用下斜凳面局部轴，身体相对凳面和脚部固定点稳定 | 不得沿用平板或上斜动作的轨迹走廊 |
| `prone_pad` | 骨盆与躯干相对卧垫稳定 | 背伸合同中躯干—大腿关系是主运动，不继承此稳定项 |
| `supine_floor` | 肩背和双脚相对地面稳定 | 臀桥的骨盆与髋关系仍是主运动 |
| `side_lying` | 躯干、骨盆和支撑侧相对卧面稳定 | 仅活动侧前臂/负载按合同运动 |
| `fixed_hand_support` | 手部相对高位支撑面固定 | 身体线相对手部支点往返 |
| `fixed_foot_support` | 足部相对高位支撑面固定 | 身体线相对足部支点往返 |
| `floor_support` | 合同指定的肩背、骨盆、膝或脚与地面形成锚点 | 只允许合同声明的身体关系变化 |
| `split_stance` | 前后脚支撑位置、骨盆左右关系 | 弓步允许跨步；固定分腿蹲不允许脚位在 Rep 内漂移 |
| `kneeling` | 膝部支撑和骨盆位置稳定 | 若动作合同要求髋伸，则以该合同为准 |

### 3.3 单双侧

- `bilateral_rigid`：一个刚体主轨迹，左右关节作为佐证；Rep 只有一个边界。
- `independent_bilateral`：左右各自保留轨迹和边界，再按合同决定整次 Rep 共识。
- `unilateral`：活动侧定义 Rep；非活动侧是身体锚点或稳定证据。
- `alternating`：每侧分别封存 Rep，并验证另一侧在非活动阶段保持稳定。

## 4. 动作族完整运动契约

下列合同定义“应该动”和“应该稳定”。第 5 节中的每个叶级动作都必须引用其中一个合同并声明修饰或覆盖项。

### M01 俯身自由划船

- `required_motion`：肘屈曲；上臂相对躯干后移；真实负载沿动作局部回拉轴向躯干靠近。
- `coordinated_motion`：负载、手腕、肘和上臂应在回拉端附近发生一致反转；肩—肘关系随回拉变化。
- `stability_relations`：髋—躯干夹角、躯干倾角、膝角、骨盆高度与双脚支撑在 Rep 内尽量保持。
- `substitution_relations`：髋伸、膝伸或躯干抬起与负载回拉同相大幅发生；左右骨盆旋转驱动单侧负载。
- `primary_tracks`：杠铃/哑铃/T 杠手柄；`corroborating_tracks`：手腕、肘、肩、髋、膝。
- `rep_boundary`：负载远端起点 → 向躯干回拉 → 最近端反转 → 返回远端。
- `limited_claims`：不从基础骨架判断肩胛后缩幅度、握法或肌肉发力。

### M02 支撑划船

- `required_motion`：肘屈曲与肩伸展/水平外展；负载或手柄向胸托/躯干靠近。
- `coordinated_motion`：肘、腕和器械反转一致。
- `stability_relations`：胸部—胸托、骨盆—座椅、躯干倾角保持；支撑侧肩髋关系稳定。
- `substitution_relations`：胸部持续离开胸托、躯干旋转或肩部整体后摆替代肘肩运动。
- `primary_tracks`：真实手柄/哑铃与活动侧肘；佐证为腕、肩、胸托和骨盆。
- `rep_boundary`：手臂伸展端 → 回拉端 → 返回伸展端。
- `limited_claims`：胸托接触只有在支撑面或身体相对关系可见时判断。

### M03 坐姿/站姿绳索与器械划船

- `required_motion`：手柄向躯干移动；肘屈曲；上臂后移。
- `coordinated_motion`：手柄与肘反转一致；双臂版本保留左右同步。
- `stability_relations`：骨盆相对座椅、膝角与脚部支撑稳定；strict 版本要求躯干倾角保持。
- `substitution_relations`：躯干前后摆动或髋屈伸成为手柄位移的主要来源。
- `primary_tracks`：真实绳索手柄/机器摆臂；佐证为腕、肘、肩、髋和躯干轴。
- `rep_boundary`：手柄远离躯干 → 拉近躯干 → 返回。
- `limited_claims`：座椅/脚部锚点不可见时只判断仍可观察的上肢和器械关系。

### M04 面拉与后束划船

- `required_motion`：手柄向面/上胸靠近；肘屈曲；上臂水平外展并保持较高肘路径。
- `coordinated_motion`：手柄、双腕和双肘在回拉端同步。
- `stability_relations`：骨盆、躯干倾角和颈部位置保持在可见走廊。
- `substitution_relations`：明显后仰、髋伸或肘持续下沉把动作变成普通低位划船。
- `primary_tracks`：绳索手柄/哑铃/机器摆臂及双肘；佐证为腕、肩、髋和躯干轴。
- `rep_boundary`：手臂展开端 → 手柄靠近面部/上胸端 → 返回展开端。
- `limited_claims`：无足够肩带关键点时不判断肩胛旋转或外旋质量。

### M05 自重垂直拉

- `required_motion`：身体中心相对固定横杆上升与下降；双肘屈伸；肩—横杆距离变化。
- `coordinated_motion`：左右肩肘与身体中心同步反转。
- `stability_relations`：髋膝关系和身体前后摆幅保持在动作变式走廊。
- `substitution_relations`：摆腿、屈髋或躯干摆荡成为上升的主要驱动；左右先后明显分离。
- `primary_tracks`：肩/髋中点形成的身体中心相对横杆轨迹；佐证为双腕、双肘和双肩。
- `rep_boundary`：身体最低伸展端 → 上升端 → 返回最低端。
- `limited_claims`：横杆、握法或上端关系不可见时不得声称握法和触杆端点。

### M06 高位下拉

- `required_motion`：横杆/手柄向下；肘屈曲并向下后方移动；肩—手柄距离缩短。
- `coordinated_motion`：器械和双肘同步反转。
- `stability_relations`：骨盆、膝垫/脚部、躯干倾角保持在 exact variant 走廊。
- `substitution_relations`：持续加大的后仰或躯干下沉替代肘肩运动。
- `primary_tracks`：真实横杆/手柄；佐证为双腕、双肘、双肩和躯干轴。
- `rep_boundary`：手臂伸展上端 → 下拉端 → 返回上端。
- `limited_claims`：握法、触胸和前后距离仅由 context 与适用机位支持。

### M07 直臂下拉

- `required_motion`：上臂相对躯干向下后方转动；手柄沿肩关节主导的弧线下降。
- `coordinated_motion`：左右手柄与肩角反转一致。
- `stability_relations`：肘角保持在小变化走廊；骨盆、膝和躯干保持。
- `substitution_relations`：明显肘屈曲把动作变成下拉；髋屈伸或躯干前压驱动手柄。
- `primary_tracks`：真实手柄/摆臂与腕；佐证为肩角、肘角、髋膝和躯干轴。
- `rep_boundary`：手臂抬高端 → 手柄下压端 → 返回抬高端。
- `limited_claims`：肩胛运动和肌肉参与不属于单目结论。

### M08 自由深蹲

- `required_motion`：髋、膝与可见踝关系共同屈曲后伸展；骨盆和负载下降—反转—上升。
- `coordinated_motion`：骨盆、膝、肩/负载反转顺序保持在 exact variant 走廊。
- `stability_relations`：双脚支撑与站距保持；负载相对身体的局部路径、左右骨盆关系保持。
- `substitution_relations`：左右重心明显漂移、膝髋阶段分离、负载横向漂移或躯干倾角超出该变式参考。
- `primary_tracks`：骨盆与真实负载中心；佐证为肩、髋、膝、踝和足部锚点。
- `rep_boundary`：站立端 → 下降最低端 → 返回站立端。
- `limited_claims`：深度、膝—脚关系和踝角仅在点位与机位足够时判断。

### M09 导轨/固定器械深蹲与腿举

- `required_motion`：髋膝屈伸；身体、承载架、踏板或杠铃沿机器约束路径往返。
- `coordinated_motion`：器械与髋膝反转一致。
- `stability_relations`：背部/肩部相对垫面、双脚相对踏板、骨盆相对座椅稳定。
- `substitution_relations`：骨盆持续离垫、左右腿阶段分离或身体相对导轨明显错位。
- `primary_tracks`：承载架、踏板、导轨杠铃或器械摆臂；佐证为骨盆、髋、膝和踝。
- `rep_boundary`：伸展端 → 屈曲端 → 返回伸展端。
- `limited_claims`：机器结构或承载件不可见时不得假设其路径形状。

### M10 弓步与分腿蹲

- `required_motion`：前腿髋膝踝和后腿膝髋协同；骨盆下降并返回。
- `coordinated_motion`：活动侧膝、髋与骨盆反转；行走/交替版本还要求正确换侧。
- `stability_relations`：骨盆左右关系、躯干倾角与足部支撑保持；固定版本脚位不漂移。
- `substitution_relations`：明显左右塌移、躯干侧倾、前后脚滑动或返回中心失败。
- `primary_tracks`：骨盆和活动侧髋膝踝；负重版本增加真实负载轨迹。
- `rep_boundary`：站立/分腿上端 → 下降端 → 返回上端；跨步版本还包括跨出和回收。
- `limited_claims`：膝—脚关系只有在脚点与适用视角均可靠时判断。

### M11 地面起始硬拉

- `required_motion`：髋伸与膝伸共同使负载从下端上升；下降阶段反向发生。
- `coordinated_motion`：肩、髋、膝与负载的离地和锁定顺序；负载保持接近身体。
- `stability_relations`：肘角近似固定、双脚支撑和杠铃左右端点保持。
- `substitution_relations`：髋先行而负载滞留、负载绕离身体、左右端点明显失衡或锁定前阶段停滞。
- `primary_tracks`：真实杠铃/陷阱杠/导轨负载中心；佐证为肩、髋、膝、腕和肘。
- `rep_boundary`：地面/下端静止 → 站立锁定端 → 受控返回下端。
- `limited_claims`：不从二维视频声称脊柱中立、离地力量或锁定关节力矩。

### M12 罗马尼亚硬拉

- `required_motion`：髋屈伸主导负载下降与上升；躯干—大腿夹角显著变化。
- `coordinated_motion`：髋、肩和负载反转一致；负载靠近腿部。
- `stability_relations`：膝角保持在较小变化走廊；肘稳定；足部与骨盆左右关系保持。
- `substitution_relations`：明显膝屈曲把动作改造成下蹲；躯干摆动与负载脱离；单腿版本骨盆大幅旋转。
- `primary_tracks`：真实负载中心与髋；佐证为肩、膝、踝和躯干轴。
- `rep_boundary`：站立端 → 髋铰链下端 → 返回站立端。
- `limited_claims`：不从二维投影判断脊柱节段或腿后侧拉伸感。

### M13 臀推与臀桥

- `required_motion`：髋伸使骨盆/负载上升，随后髋屈曲返回。
- `coordinated_motion`：骨盆、髋角与负载同步反转。
- `stability_relations`：肩或上背支撑、双脚支撑、膝角和左右骨盆关系保持。
- `substitution_relations`：左右骨盆明显不等高、脚位滑动、躯干整体滑离支撑或负载与骨盆不同步。
- `primary_tracks`：骨盆和真实负载/承载件；佐证为肩、膝、踝与左右髋。
- `rep_boundary`：髋屈曲下端 → 骨盆上升伸展端 → 返回下端。
- `limited_claims`：不从稀疏骨架判断腰椎过伸或肌肉收缩。

### M14 背伸

- `required_motion`：躯干相对大腿在支撑轴附近屈伸并返回。
- `coordinated_motion`：肩中点、髋角与可见负载同步。
- `stability_relations`：下肢相对支撑垫、膝角和左右肩髋关系保持。
- `substitution_relations`：膝部大幅屈伸或身体在垫面滑动驱动轨迹。
- `primary_tracks`：肩中点相对髋/支撑轴的轨迹；负重版本增加真实负载。
- `rep_boundary`：躯干屈曲端 → 伸展端 → 返回屈曲端。
- `limited_claims`：不区分逐节腰椎运动与髋伸展，不作脊柱安全判断。

### M15 卧推

- `required_motion`：负载沿凳面定义的局部推举轴下降与上升；肘屈曲后伸展；上臂相对躯干关系变化。
- `coordinated_motion`：负载、手腕和肘在底端与顶端反转一致。
- `stability_relations`：肩/躯干/骨盆相对凳面和脚部支撑保持；杠铃或双负载保持各自拓扑的左右关系。
- `substitution_relations`：骨盆持续离凳、明显身体横移、左右负载阶段分离或器械与手腕关联丢失。
- `primary_tracks`：真实杠铃/哑铃；佐证为双腕、双肘、双肩、髋和凳面局部轴。
- `rep_boundary`：手臂伸展端 → 负载最低端 → 返回伸展端。
- `limited_claims`：不从单目稀疏骨架断言肩胛位置、胸部触碰或标准肘外展角。

### M16 坐姿/站姿推胸

- `required_motion`：手柄或负载相对躯干向前/斜前推出并返回；肘伸展后屈曲。
- `coordinated_motion`：手柄、腕和肘同步反转。
- `stability_relations`：坐姿版本骨盆与躯干相对靠背；站姿版本双脚、骨盆和躯干角保持。
- `substitution_relations`：躯干前冲、后仰或髋膝伸展驱动手柄。
- `primary_tracks`：真实手柄/负载；佐证为腕、肘、肩、躯干和支撑锚点。
- `rep_boundary`：手柄靠近身体端 → 推出端 → 返回靠近身体端。
- `limited_claims`：机器路径不可见时不得假定直线或固定弧线。

### M17 飞鸟/夹胸

- `required_motion`：上臂相对躯干水平内收；双手柄/负载向中线汇合后展开。
- `coordinated_motion`：左右手柄与肩角同步。
- `stability_relations`：肘角在动作合同走廊内保持；骨盆和躯干相对支撑稳定。
- `substitution_relations`：肘大幅屈伸把动作变成推举；躯干前冲或旋转完成汇合。
- `primary_tracks`：左右真实手柄/负载；佐证为腕、肘、肩和躯干轴。
- `rep_boundary`：展开端 → 汇合端 → 返回展开端。
- `limited_claims`：不从腕部汇合单独推断肩水平内收质量或胸肌发力。

### M18 俯卧撑与双杠臂屈伸

- `required_motion`：肘屈伸；身体中心相对地面或双杠下降—上升。
- `coordinated_motion`：肩、髋与身体中心同步；双肘同步。
- `stability_relations`：俯卧撑保持肩—髋—踝身体线；双杠版本保持髋膝摆动和左右关系在走廊内。
- `substitution_relations`：髋部先行下沉/抬起、身体摆荡或左右臂明显错相。
- `primary_tracks`：肩/胸中点相对固定支撑面的身体轨迹；佐证为双肘、双腕、髋和踝/膝。
- `rep_boundary`：身体高位伸展端 → 下降端 → 返回高位端。
- `limited_claims`：不把投影身体线升级为腰椎诊断。

### M19 坐姿过顶推举

- `required_motion`：负载/手柄上升与下降；肩和肘共同伸展后屈曲。
- `coordinated_motion`：器械、腕、肘反转一致。
- `stability_relations`：骨盆、躯干与靠背保持；双脚支撑和左右负载关系保持。
- `substitution_relations`：持续后仰、骨盆离座或左右负载明显分离。
- `primary_tracks`：真实杠铃、左右哑铃或机器手柄；佐证为腕、肘、肩和躯干轴。
- `rep_boundary`：负载下端 → 过顶伸展端 → 返回下端。
- `limited_claims`：不从单目投影声称肩胛上旋、撞击风险或标准肩角。

### M20 站姿过顶推举与地雷管推举

- `required_motion`：杠铃/哑铃纵向运动，或地雷管杆端沿固定弧线运动；肩肘伸展。
- `coordinated_motion`：负载、腕和肘同步；双侧版本保留左右关系。
- `stability_relations`：strict press 的髋角、膝角、骨盆和躯干倾角保持。
- `substitution_relations`：髋膝伸展、躯干后仰、旋转或侧倾驱动负载；若是 push press 必须建立另一动作合同，不能共用 strict press。
- `primary_tracks`：真实杠铃/左右哑铃或地雷管杆端；佐证为腕、肘、肩、髋和膝。
- `rep_boundary`：负载下端 → 伸展端 → 返回下端。
- `limited_claims`：二维视频不判断肩胛或脊柱节段状态。

### M21 阿诺德推举

- `required_motion`：肩部身份定义的轴向旋转序列与双哑铃过顶推举共同完成；只完成普通肩推不能确认为 Arnold press。
- `coordinated_motion`：左右哑铃、肘和腕轨迹应与轴向旋转阶段同步，但这些可见端点只是佐证，不能替代旋转 TaskPrimary。
- `stability_relations`：坐姿保持骨盆/躯干；站姿增加髋膝稳定。
- `substitution_relations`：躯干后仰、髋膝借力或左右阶段分离。
- `primary_tracks`：身份主关系是肩轴向旋转；左右哑铃、腕、肘、肩、躯干和髋膝只作为协同/稳定证据。
- `rep_boundary`：必须同时包含旋转起点、过顶伸展端、反向旋转和返回起点，不能只由哑铃上下周期封存。
- `limited_claims`：使用肩—肘—腕相对躯干的二维投影旋转序列识别动作阶段；不得把它解释为真实三维肱骨轴角、肩胛运动或关节安全结论。

### M22 侧平举、前平举与 Y 举

- `required_motion`：上臂相对躯干沿指定动作平面抬起并返回；真实负载/手柄或腕沿对应弧线运动。
- `coordinated_motion`：肩角、肘腕和器械端点同步反转。
- `stability_relations`：肘角保持在变式走廊；骨盆、髋膝和躯干在 strict 版本稳定。
- `substitution_relations`：躯干侧倾/后仰、髋膝借力、肘大幅屈伸或负载甩动。
- `primary_tracks`：真实哑铃/手柄/摆臂或腕；佐证为肘、肩、躯干、髋和膝。
- `rep_boundary`：手臂下端 → 指定动作平面上端 → 返回下端。
- `limited_claims`：无肩带点位时不判断耸肩；前举、侧举与 Y 举必须是不同动作平面合同。

### M23 后束飞鸟与直立划船

- 后束飞鸟 `required_motion`：肩水平外展、负载向两侧展开；肘角相对稳定。
- 直立划船 `required_motion`：器械上升、肘屈曲与肩外展；肘和负载高度关系变化。
- `coordinated_motion`：负载、腕、肘和肩角在各自端点同步反转。
- `stability_relations`：胸托/坐姿支撑或站姿髋膝躯干保持。
- `substitution_relations`：后束飞鸟变成肘屈曲划船；站姿版本躯干抬起或髋伸借力。
- `primary_tracks`：真实哑铃/手柄/杠铃或机器摆臂；佐证为腕、肘、肩、躯干和髋膝。
- `rep_boundary`：后束飞鸟为闭合端 → 展开端 → 返回；直立划船为下端 → 上拉端 → 返回。
- `limited_claims`：不从基础骨架推断肩关节安全区或肩胛运动。

### M24 肩外旋

- `required_motion`：肱骨相对躯干/肩带发生身份定义的轴向外旋并返回；这是动作身份主关系。
- `coordinated_motion`：前臂方向、腕部、手柄或哑铃轨迹应随外旋阶段变化，但这些二维端点只是佐证。
- `stability_relations`：肘相对躯干、支撑垫或肩外展位锚点保持；躯干和骨盆稳定。
- `substitution_relations`：肘部漂移、躯干旋转或肩整体平移替代前臂旋转。
- `primary_tracks`：身份主关系是肩轴向外旋；真实手柄/哑铃、腕绕肘轨迹、肘、肩、躯干和骨盆均为协同或稳定证据，不能替代主关系。
- `rep_boundary`：必须由可表达的外旋 TaskPrimary 定义外旋起点、终点和返回；不能只用腕绕肘周期封存。
- `limited_claims`：使用肩—肘—腕相对躯干的二维投影旋转序列识别动作阶段；不得把它解释为真实三维肱骨轴角、肩胛运动或关节安全结论。

### M25 肘屈曲

- `required_motion`：肘屈曲后伸展；负载/手柄向肩靠近后返回。
- `coordinated_motion`：负载、腕和肘角同步反转。
- `stability_relations`：上臂相对躯干或支撑面保持；骨盆和躯干在 strict 版本稳定。
- `substitution_relations`：肩前移、上臂摆动、躯干后仰或髋伸驱动负载。
- `primary_tracks`：真实杠铃/哑铃/手柄与腕；佐证为肘角、肩、上臂—躯干关系和骨盆。
- `rep_boundary`：肘伸展端 → 屈曲端 → 返回伸展端。
- `limited_claims`：握法和前臂旋转若不可见必须来自 context，不从骨架猜测。

### M26 肘伸展

- `required_motion`：肘从屈曲到伸展再返回；负载/手柄围绕肘部锚点移动。
- `coordinated_motion`：负载、腕和肘角同步。
- `stability_relations`：上臂和肘部锚点相对躯干/凳面保持；姿态支撑稳定。
- `substitution_relations`：肩部大幅运动、躯干前压/后仰或髋膝借力完成负载路径。
- `primary_tracks`：真实手柄/杠铃/哑铃与腕；佐证为肘角、肩、上臂和躯干轴。
- `rep_boundary`：肘屈曲端 → 伸展端 → 返回屈曲端。
- `limited_claims`：不从投影肘角判断关节锁死、安全或肌肉激活。

### M27 膝屈伸器械

- 腿屈伸 `required_motion`：膝伸展与踝/滚轮垫沿机器弧线抬起；腿弯举则为膝屈曲与踝/滚轮垫沿姿态特定方向运动。
- `coordinated_motion`：膝角与器械摆臂同步。
- `stability_relations`：髋、骨盆、躯干相对座椅/卧垫；非活动腿保持。
- `substitution_relations`：髋部离座、骨盆抬起、躯干摆动或左右腿阶段分离。
- `primary_tracks`：踝/滚轮垫和机器摆臂；佐证为膝角、髋、骨盆和躯干。
- `rep_boundary`：腿屈伸按膝屈曲端 → 伸展端 → 返回；腿弯举按膝伸展端 → 屈曲端 → 返回。
- `limited_claims`：器械转轴不可见时只使用可验证的踝与膝关系，不假设机器几何。

### M28 提踵

- `required_motion`：踝跖屈；脚跟相对前脚掌改变高度；身体或器械承载件沿约束轴移动。
- `coordinated_motion`：脚跟、踝关系和器械同步反转。
- `stability_relations`：站姿版本膝角近似稳定；坐姿版本髋膝与大腿垫稳定；左右脚同步。
- `substitution_relations`：膝屈伸、身体弹跳或脚部位置滑动驱动承载件。
- `primary_tracks`：脚跟相对前脚掌轨迹和真实承载件/负载；佐证为踝角、膝角和身体中心。
- `rep_boundary`：脚跟下端 → 跖屈上端 → 返回下端。
- `limited_claims`：足点遮挡时不能只用身体上下移动证明踝跖屈。

### M29 仰卧起坐与卷腹

- 完整仰卧起坐 `required_motion`：躯干—大腿夹角显著缩小后恢复，肩中点相对髋中点抬起并前移。
- 卷腹 `required_motion`：肩中点离开支撑但髋角变化受限；两者必须分为不同动作。
- `coordinated_motion`：肩中点、躯干—大腿关系和可见负载在端点同步反转。
- `stability_relations`：脚/膝支撑、骨盆左右关系保持。
- `substitution_relations`：髋整体滑移、左右肩旋转或用手臂摆动驱动起身。
- `primary_tracks`：肩中点相对髋/支撑面轨迹与躯干—大腿夹角；负重版本增加负载。
- `rep_boundary`：仰卧/展开端 → 起身或卷曲端 → 返回展开端。
- `limited_claims`：不判断腰椎节段或腹肌激活。

### M30 移动与热身

- 原地踏步/提膝 `required_motion`：左右髋屈曲与膝抬高交替；支撑侧保持站立。
- 侧步 `required_motion`：髋外展和踝横向分离—合拢。
- step/jumping jack `required_motion`：肩与髋外展/内收、腕踝开合；jumping 版本增加身体中心腾空周期。
- `coordinated_motion`：左右侧与手脚在各动作定义的阶段顺序同步或交替。
- `stability_relations`：躯干、骨盆左右关系和左右节奏保持。
- `substitution_relations`：持续侧倾、左右不同步或动作合同不允许的跳跃/冲击方式。
- `primary_tracks`：膝、踝、腕和身体中心；负重版本增加真实负载轨迹。
- `rep_boundary`：各动作的中心/闭合端 → 抬膝、侧开或开合端 → 返回中心/闭合端。
- `limited_claims`：落地冲击、地面反作用力和关节载荷不属于单目结论。

## 5. 扩展叶级动作目录与合同绑定

下列每个 ID 都是待审核的叶级身份。它继承指定 M 合同和第 3 节修饰；“覆盖项”是该动作与同族动作不可共享的判定差异。没有列为叶级的宽泛名称只能作为父目录。

### 5.1 水平拉与后束拉

| 叶级动作 | 合同与修饰 | 覆盖项 |
|---|---|---|
| `pronated_barbell_row` 正手杠铃划船 | M01 + rigid_bar + standing_free + bilateral_rigid | 髋—躯干、膝和躯干倾角为严格稳定项；杠铃、手腕、肘角、上臂—躯干角和肩点全部追踪 |
| `supinated_barbell_row` 反手杠铃划船 | M01 + rigid_bar | 握法来自 context；不得从骨架猜测 |
| `wide_grip_barbell_row` 宽握杠铃划船 | M01 + rigid_bar | 独立肘路径和杠铃—躯干端点参考 |
| `smith_machine_row` 史密斯划船 | M01 + smith_guided_bar | 负载沿导轨；身体相对导轨距离是技术约束 |
| `supported_one_arm_dumbbell_row` 单臂支撑哑铃划船 | M02 + single_free_load + unilateral | 支撑手/膝为锚点；活动侧躯干旋转为代偿 |
| `unsupported_one_arm_dumbbell_row` 单臂无支撑哑铃划船 | M01 + single_free_load + unilateral | 双脚与骨盆为锚点；严格检查躯干旋转和髋伸 |
| `standing_double_dumbbell_row` 站姿双哑铃划船 | M01 + dual_free_load | 左右负载独立反转和路径 |
| `incline_chest_supported_dumbbell_row` 上斜凳胸托哑铃划船 | M02 + dual_free_load + chest_supported | 胸部离托为代偿 |
| `seated_bilateral_cable_row` 坐姿双臂绳索划船 | M03 + cable_handle + seated_unsupported | strict 版本躯干保持；若允许摆动必须另建动作 |
| `seated_single_arm_cable_row` 坐姿单臂绳索划船 | M03 + cable_handle + unilateral | 活动肩—髋关系与躯干旋转 |
| `standing_cable_row` 站姿绳索划船 | M03 + cable_handle + standing_free | 髋膝与躯干稳定 |
| `high_cable_row` 高位绳索划船 | M04 + cable_handle | 高肘路径，不得回退为低位坐姿划船 |
| `low_cable_row` 低位绳索划船 | M03 + cable_handle | 手柄局部回拉轴独立 |
| `chest_supported_linked_machine_row` 胸托联动器械划船 | M02 + linked_machine + chest_supported | 一个联动器械轨迹，左右肘为佐证 |
| `chest_supported_independent_machine_row` 胸托独立器械划船 | M02 + independent_machine + chest_supported | 左右手柄独立结论 |
| `single_arm_machine_row` 单臂器械划船 | M02 + independent_machine + unilateral | 非活动侧和胸托为锚点 |
| `unsupported_seated_linked_machine_row` 无胸托联动器械划船 | M03 + linked_machine + seated_unsupported | 一个手柄/承载件主轨迹；躯干摆动为代偿 |
| `unsupported_seated_independent_machine_row` 无胸托独立器械划船 | M03 + independent_machine + seated_unsupported | 左右手柄独立；躯干摆动为代偿 |
| `chest_supported_t_bar_row` 胸托 T 杠划船 | M02 + linked_machine + chest_supported | 手柄/承载件受约束，胸托稳定 |
| `free_t_bar_row` 自由 T 杠划船 | M01 + landmine_lever | 杆端弧线；髋膝躯干稳定 |
| `narrow_landmine_row` 窄握地雷管划船 | M01 + landmine_lever | 双手关联单一杆端 |
| `wide_landmine_row` 宽握地雷管划船 | M01 + landmine_lever | 独立宽握肘路径 reference |
| `cable_face_pull` 绳索面拉 | M04 + cable_handle | 手柄到面部、双肘高位；后仰为代偿 |
| `cable_rear_delt_row` 绳索后束划船 | M04 + cable_handle | 肩水平外展为主，肘下沉为偏差 |
| `dumbbell_rear_delt_row` 哑铃后束划船 | M04 + dual_free_load | 躯干与髋稳定，双负载独立 |
| `linked_machine_rear_delt_row` 联动器械后束划船 | M04 + linked_machine | 一个受约束器械主轨迹 |
| `independent_machine_rear_delt_row` 独立器械后束划船 | M04 + independent_machine | 左右受约束轨迹独立 |

### 5.2 垂直拉

| 叶级动作 | 合同与修饰 | 覆盖项 |
|---|---|---|
| `pronated_pull_up` 正手引体 | M05 + bodyweight_station | 握法来自 context；身体相对横杆为主轨迹 |
| `chin_up` 反手引体 | M05 + bodyweight_station | 反握来自 context；独立参考 |
| `neutral_grip_pull_up` 中立握引体 | M05 + bodyweight_station | 固定中立握把 context |
| `wide_grip_pull_up` 宽握引体 | M05 + bodyweight_station | 独立肩肘走廊 |
| `narrow_grip_pull_up` 窄握引体 | M05 + bodyweight_station | 独立肩肘走廊 |
| `band_assisted_pull_up` 弹力带辅助引体 | M05 + bodyweight_station | 弹力带只作 context；不得把未知助力当负载测量 |
| `kneepad_assisted_pull_up` 跪垫辅助引体 | M05 + linked_machine + kneeling | 身体与膝垫反向轨迹协同 |
| `platform_assisted_pull_up` 站台辅助引体 | M05 + linked_machine | 身体与站台反向轨迹协同 |
| `wide_pronated_lat_pulldown` 宽握正手下拉 | M06 + cable_bar | 横杆端点与双肘同步 |
| `medium_pronated_lat_pulldown` 中握正手下拉 | M06 + cable_bar | 独立握距 context |
| `supinated_lat_pulldown` 反手下拉 | M06 + cable_bar | 握法由 context |
| `neutral_grip_lat_pulldown` 中立握下拉 | M06 + cable_handle | 中立握附件 context |
| `single_arm_lat_pulldown` 单臂高位下拉 | M06 + cable_handle + unilateral | 活动肩—髋与躯干侧倾 |
| `independent_machine_lat_pulldown` 独立双臂器械下拉 | M06 + independent_machine | 左右路径和端点独立 |
| `standing_straight_arm_pulldown` 站姿直臂下拉 | M07 + cable_handle + standing_free | 肘稳定、髋膝躯干稳定 |
| `kneeling_straight_arm_pulldown` 跪姿直臂下拉 | M07 + cable_handle + kneeling | 膝与骨盆为支撑锚点 |
| `single_arm_straight_arm_pulldown` 单臂直臂下拉 | M07 + cable_handle + unilateral | 活动肘稳定和躯干旋转 |
| `machine_straight_arm_pulldown` 固定器械直臂下拉 | M07 + linked_machine | 摆臂轨迹为主 |

### 5.3 深蹲、腿举、弓步与分腿蹲

| 叶级动作 | 合同与修饰 | 覆盖项 |
|---|---|---|
| `bodyweight_air_squat` 徒手深蹲 | M08 + bodyweight + standing_free | 骨盆主轨迹，无器械替代 |
| `high_bar_back_squat` 高杠后蹲 | M08 + rigid_bar | 高杠位 context；杠铃、髋膝踝与躯干独立走廊 |
| `low_bar_back_squat` 低杠后蹲 | M08 + rigid_bar | 低杠位 context；允许不同髋/躯干协同，不能套高杠阈值 |
| `front_barbell_squat` 杠铃前蹲 | M08 + rigid_bar | 前置杠铃和肘部支撑代理；独立躯干参考 |
| `box_squat` 箱式深蹲 | M08 + rigid_bar | 可见下降端停顿和重新上升是阶段事实；未观测箱面时不声称物理接触 |
| `bodyweight_sumo_squat` 徒手相扑深蹲 | M08 + bodyweight + standing_free | 宽站距来自 context；左右髋膝关系独立 |
| `loaded_sumo_squat` 单负载相扑深蹲 | M08 + single_free_load | 胸前或垂直负载 setup 必须精确；追踪负载中心 |
| `goblet_dumbbell_squat` 哑铃高脚杯深蹲 | M08 + single_free_load | 胸前负载—躯干距离 |
| `goblet_kettlebell_squat` 壶铃高脚杯深蹲 | M08 + single_free_load | 独立负载检测器 |
| `double_dumbbell_squat` 双哑铃深蹲 | M08 + dual_free_load | 左右负载分别追踪 |
| `smith_high_bar_squat` 史密斯高杠深蹲 | M09 + smith_guided_bar | 身体相对导轨位置 |
| `smith_front_squat` 史密斯前蹲 | M09 + smith_guided_bar | 前置杠位与导轨 context |
| `hack_squat_machine` 哈克深蹲 | M09 + linked_machine | 背垫、肩垫与踏板锚点 |
| `pendulum_squat_machine` 钟摆深蹲 | M09 + linked_machine | 承载件弧线而非直线 |
| `cable_belt_squat` 绳索腰带深蹲 | M09 + cable_handle | 骨盆附近拉索端点轨迹；躯干较自由但仍有 exact reference |
| `lever_belt_squat` 杠杆腰带深蹲 | M09 + linked_machine | 骨盆附近承载件弧线；不能套绳索路径 |
| `landmine_squat` 地雷管深蹲 | M08 + landmine_lever | 杆端弧线与负载—躯干距离 |
| `bilateral_leg_press` 双腿腿举 | M09 + linked_machine | 双膝与承载架同步 |
| `single_leg_press` 单腿腿举 | M09 + linked_machine + unilateral | 非活动腿不参与；骨盆旋转为稳定项 |
| `narrow_stance_leg_press` 窄站距腿举 | M09 + linked_machine | 站距由 context；独立参考 |
| `wide_stance_leg_press` 宽站距腿举 | M09 + linked_machine | 站距由 context；独立参考 |
| `walking_lunge` 行走箭步 | M10 + split_stance | 每 Rep 包含跨步、下降、上升并继续前移 |
| `alternating_forward_lunge` 原地前跨箭步 | M10 + alternating | 向前跨出后回到中心 |
| `alternating_reverse_lunge` 原地后撤箭步 | M10 + alternating | 向后撤步后回到中心 |
| `stationary_split_squat` 固定分腿蹲 | M10 + split_stance | 双脚在整组内固定 |
| `bulgarian_split_squat` 保加利亚分腿蹲 | M10 + split_stance | 后脚抬高支撑，前腿与骨盆为主 |
| `smith_split_squat` 史密斯分腿蹲 | M10 + smith_guided_bar + split_stance | 杠铃导轨与固定脚位同时约束 |

### 5.4 硬拉、髋铰链、臀推与背伸

| 叶级动作 | 合同与修饰 | 覆盖项 |
|---|---|---|
| `conventional_barbell_deadlift` 传统杠铃硬拉 | M11 + rigid_bar | 髋膝均为主运动；不得套划船稳定规则 |
| `sumo_barbell_deadlift` 相扑硬拉 | M11 + rigid_bar | 宽站距 context 与独立髋膝协同 |
| `trap_bar_deadlift` 陷阱杠硬拉 | M11 + rigid_frame | 负载中心位于身体两侧；不能套直杠身体距离 |
| `smith_machine_deadlift` 史密斯硬拉 | M11 + smith_guided_bar | 导轨主路径与身体相对导轨 |
| `barbell_romanian_deadlift` 杠铃 RDL | M12 + rigid_bar | 膝角稳定、杠铃靠近腿部 |
| `smith_romanian_deadlift` 史密斯 RDL | M12 + smith_guided_bar | 导轨路径，不套自由杠铃水平漂移规则 |
| `double_dumbbell_romanian_deadlift` 双哑铃 RDL | M12 + dual_free_load | 左右负载独立但髋反转共识 |
| `single_leg_dumbbell_romanian_deadlift` 单腿哑铃 RDL | M12 + single_free_load + unilateral | 支撑腿、游离腿和骨盆旋转必须追踪 |
| `cable_romanian_deadlift` 绳索 RDL | M12 + cable_handle | 拉索手柄相对髋的路径 |
| `barbell_hip_thrust` 杠铃臀推 | M13 + rigid_bar | 杠铃—骨盆同步与凳面支撑 |
| `smith_hip_thrust` 史密斯臀推 | M13 + smith_guided_bar | 导轨与骨盆同步 |
| `machine_hip_thrust` 固定器械臀推 | M13 + linked_machine | 承载件/腰垫受约束路径 |
| `single_leg_hip_thrust` 单腿臀推 | M13 + unilateral | 非支撑腿状态、左右骨盆稳定 |
| `bodyweight_glute_bridge` 徒手臀桥 | M13 + bodyweight + supine_floor | 骨盆轨迹为主 |
| `barbell_weighted_glute_bridge` 杠铃负重臀桥 | M13 + rigid_bar + supine_floor | 杠铃—骨盆同步 |
| `single_load_weighted_glute_bridge` 单负载臀桥 | M13 + single_free_load + supine_floor | 负载中心—骨盆同步 |
| `single_leg_glute_bridge` 单腿臀桥 | M13 + unilateral | 支撑脚与左右骨盆关系 |
| `45_degree_back_extension` 45度背伸 | M14 + seated_supported | 45度支撑轴的局部轨迹 |
| `horizontal_back_extension` 水平背伸 | M14 + seated_supported | 水平支撑轴，独立 reference |
| `machine_back_extension` 固定器械背伸 | M14 + linked_machine | 摆臂/背垫为主器械轨迹 |
| `weighted_back_extension` 负重背伸 | M14 + single_free_load | 负载与肩/躯干同步，不改变有限结论 |

### 5.5 卧推、推胸、夹胸与徒手推

| 叶级动作 | 合同与修饰 | 覆盖项 |
|---|---|---|
| `flat_barbell_bench_press` 平板杠铃卧推 | M15 + rigid_bar + supine_bench | 杠铃中心/端点、腕、肘和肩角；平板局部轴 |
| `incline_barbell_bench_press` 上斜杠铃卧推 | M15 + rigid_bar + incline_bench | 上斜局部轴与独立参考 |
| `decline_barbell_bench_press` 下斜杠铃卧推 | M15 + rigid_bar + decline_bench | 下斜局部轴与独立参考 |
| `close_grip_barbell_bench_press` 窄握杠铃卧推 | M15 + rigid_bar | 握距来自 context；独立肘路径 |
| `wide_grip_barbell_bench_press` 宽握杠铃卧推 | M15 + rigid_bar | 仅在产品需要且有独立参考时启用 |
| `smith_flat_bench_press` 史密斯平板卧推 | M15 + smith_guided_bar | 导轨路径和身体相对导轨 |
| `smith_incline_bench_press` 史密斯上斜卧推 | M15 + smith_guided_bar | 上斜凳与导轨组合 context |
| `smith_decline_bench_press` 史密斯下斜卧推 | M15 + smith_guided_bar | 下斜凳与导轨组合 context |
| `smith_close_grip_bench_press` 史密斯窄握卧推 | M15 + smith_guided_bar | 握距与导轨双约束 |
| `flat_dumbbell_bench_press` 平板哑铃卧推 | M15 + dual_free_load | 左右独立端点与路径 |
| `incline_dumbbell_bench_press` 上斜哑铃卧推 | M15 + dual_free_load + incline_bench | 上斜局部轴 |
| `decline_dumbbell_bench_press` 下斜哑铃卧推 | M15 + dual_free_load + decline_bench | 下斜局部轴 |
| `single_arm_dumbbell_bench_press` 单臂哑铃卧推 | M15 + single_free_load + unilateral | 躯干旋转与非活动侧稳定 |
| `alternating_dumbbell_bench_press` 交替哑铃卧推 | M15 + dual_free_load + alternating | 非活动侧保持，按侧封存 Rep |
| `seated_linked_machine_chest_press` 坐姿联动器械推胸 | M16 + linked_machine + seated_backrest | 一个联动器械主轨迹 |
| `seated_independent_machine_chest_press` 坐姿独立器械推胸 | M16 + independent_machine + seated_backrest | 左右手柄独立 |
| `incline_linked_machine_chest_press` 上斜联动器械推胸 | M16 + linked_machine + seated_backrest | 斜向联动路径 |
| `incline_independent_machine_chest_press` 上斜独立器械推胸 | M16 + independent_machine + seated_backrest | 左右斜向路径独立 |
| `decline_linked_machine_chest_press` 下斜联动器械推胸 | M16 + linked_machine + seated_backrest | 向下前方联动路径 |
| `decline_independent_machine_chest_press` 下斜独立器械推胸 | M16 + independent_machine + seated_backrest | 左右向下路径独立 |
| `single_arm_machine_chest_press` 单臂器械推胸 | M16 + independent_machine + unilateral | 躯干旋转为稳定项 |
| `standing_bilateral_cable_press` 站姿双臂绳索推胸 | M16 + cable_handle + standing_free | 髋膝和躯干保持 |
| `split_stance_cable_press` 分腿站姿绳索推胸 | M16 + cable_handle + split_stance | 前后脚与骨盆关系保持 |
| `single_arm_cable_press` 单臂绳索推胸 | M16 + cable_handle + unilateral | 躯干旋转和侧倾 |
| `supine_cable_press` 仰卧绳索推胸 | M16 + cable_handle + supine_bench | 凳面支撑与双手柄轨迹 |
| `standing_cable_fly` 站姿绳索夹胸 | M17 + cable_handle + standing_free | 躯干前冲为代偿 |
| `incline_cable_fly` 上斜绳索夹胸 | M17 + cable_handle | 斜向汇合轨迹 |
| `decline_cable_fly` 下斜绳索夹胸 | M17 + cable_handle | 向下汇合轨迹 |
| `flat_dumbbell_fly` 平板哑铃飞鸟 | M17 + dual_free_load + supine_bench | 肘角稳定，左右独立轨迹 |
| `incline_dumbbell_fly` 上斜哑铃飞鸟 | M17 + dual_free_load + incline_bench | 上斜局部平面 |
| `pec_deck_fly` 蝴蝶机夹胸 | M17 + linked_machine + seated_backrest | 手柄/前臂垫汇合，躯干靠背稳定 |
| `single_arm_machine_fly` 单臂器械夹胸 | M17 + independent_machine + unilateral | 躯干旋转稳定项 |
| `standard_push_up` 标准俯卧撑 | M18 + bodyweight_station | 肩—髋—踝身体线 |
| `kneeling_push_up` 跪姿俯卧撑 | M18 + bodyweight_station | 肩—髋—膝身体线 |
| `incline_push_up` 上斜俯卧撑 | M18 + fixed_hand_support | 手部高位支撑轴 |
| `decline_push_up` 下斜俯卧撑 | M18 + fixed_foot_support | 脚部高位支撑轴 |
| `close_grip_push_up` 窄距俯卧撑 | M18 + bodyweight_station | 手距由 context，独立肘路径 |
| `wide_grip_push_up` 宽距俯卧撑 | M18 + bodyweight_station | 手距由 context，独立肘路径 |
| `chest_dip` 胸部双杠臂屈伸 | M18 + bodyweight_station | 前倾躯干合同，髋膝摆动稳定 |
| `assisted_chest_dip` 辅助胸部双杠臂屈伸 | M18 + linked_machine | 身体与辅助平台反向协同 |

### 5.6 推肩与过顶推举

| 叶级动作 | 合同与修饰 | 覆盖项 |
|---|---|---|
| `seated_barbell_shoulder_press` 坐姿杠铃推肩 | M19 + rigid_bar + seated_backrest | 杠铃端点、腕、肘、肩角和躯干 |
| `seated_dumbbell_shoulder_press` 坐姿哑铃推肩 | M19 + dual_free_load + seated_backrest | 左右负载独立 |
| `seated_linked_machine_shoulder_press` 坐姿联动器械推肩 | M19 + linked_machine | 一个机器主轨迹 |
| `seated_independent_machine_shoulder_press` 坐姿独立器械推肩 | M19 + independent_machine | 左右手柄独立 |
| `standing_barbell_overhead_press` 站姿杠铃推举 | M20 + rigid_bar + standing_free | strict 髋膝稳定；不得接受 push press 借力 |
| `standing_dumbbell_shoulder_press` 站姿哑铃推肩 | M20 + dual_free_load + standing_free | 双负载与髋膝稳定 |
| `seated_smith_shoulder_press` 坐姿史密斯推肩 | M19 + smith_guided_bar | 导轨与靠背 context |
| `standing_smith_shoulder_press` 站姿史密斯推肩 | M20 + smith_guided_bar | 身体相对导轨及髋膝稳定 |
| `seated_arnold_press` 坐姿阿诺德推举 | M21 + dual_free_load + seated_backrest | 投影肩旋转与过顶位移共同成立；不声称真实三维轴角 |
| `standing_arnold_press` 站姿阿诺德推举 | M21 + dual_free_load + standing_free | 投影肩旋转、过顶位移及髋膝/躯干稳定分别保留 |
| `single_arm_landmine_press` 单臂地雷管推举 | M20 + landmine_lever + unilateral | 杆端斜向弧线；躯干旋转/侧倾稳定 |
| `bilateral_landmine_press` 双手地雷管推举 | M20 + landmine_lever + bilateral_rigid | 双手关联同一杆端 |

### 5.7 肩部孤立与外旋

| 叶级动作 | 合同与修饰 | 覆盖项 |
|---|---|---|
| `standing_bilateral_dumbbell_lateral_raise` 站姿双哑铃侧平举 | M22 + dual_free_load + standing_free | 肩外展平面；髋膝躯干稳定 |
| `seated_bilateral_dumbbell_lateral_raise` 坐姿双哑铃侧平举 | M22 + dual_free_load + seated_unsupported | 骨盆躯干稳定，减少下肢代偿 |
| `single_arm_dumbbell_lateral_raise` 单臂哑铃侧平举 | M22 + single_free_load + unilateral | 躯干侧倾和非活动侧锚点 |
| `single_arm_cable_lateral_raise` 单臂绳索侧平举 | M22 + cable_handle + unilateral | 拉索方向与手柄轨迹 |
| `bilateral_cable_lateral_raise` 双臂绳索侧平举 | M22 + cable_handle + independent_bilateral | 左右手柄独立 |
| `linked_machine_lateral_raise` 联动器械侧平举 | M22 + linked_machine | 肘垫/摆臂联动路径 |
| `independent_machine_lateral_raise` 独立器械侧平举 | M22 + independent_machine | 左右摆臂独立 |
| `standing_bilateral_dumbbell_front_raise` 站姿双哑铃前平举 | M22 + dual_free_load | 肩屈曲平面，非侧平举 |
| `alternating_dumbbell_front_raise` 交替哑铃前平举 | M22 + dual_free_load + alternating | 非活动侧保持 |
| `seated_dumbbell_front_raise` 坐姿哑铃前平举 | M22 + dual_free_load + seated_unsupported | 骨盆躯干稳定 |
| `barbell_front_raise` 杠铃前平举 | M22 + rigid_bar | 杠铃端点与肘角 |
| `plate_front_raise` 杠铃片前平举 | M22 + single_free_load | 单一负载中心 |
| `single_arm_cable_front_raise` 单臂绳索前平举 | M22 + cable_handle + unilateral | 活动侧轨迹和躯干稳定 |
| `bilateral_cable_front_raise` 双臂绳索前平举 | M22 + cable_handle | 双手柄同步 |
| `linked_machine_front_raise` 固定器械前平举 | M22 + linked_machine | 受约束肩屈曲轨迹 |
| `standing_cable_y_raise` 站姿绳索 Y 举 | M22 + cable_handle | 斜向 Y 平面 |
| `incline_dumbbell_y_raise` 上斜凳哑铃 Y 举 | M22 + dual_free_load + chest_supported | 胸托稳定 |
| `prone_bodyweight_y_raise` 俯卧徒手 Y 举 | M22 + bodyweight + prone_pad | 躯干骨盆相对凳面稳定 |
| `prone_dumbbell_y_raise` 俯卧哑铃 Y 举 | M22 + dual_free_load + prone_pad | 双负载斜向轨迹，躯干骨盆稳定 |
| `linked_machine_y_raise` 固定器械 Y 举 | M22 + linked_machine | 摆臂斜向路径 |
| `bent_over_dumbbell_rear_delt_fly` 俯身哑铃后束飞鸟 | M23 + dual_free_load + standing_free | 髋躯干稳定，肘角稳定 |
| `seated_bent_over_rear_delt_fly` 坐姿俯身后束飞鸟 | M23 + dual_free_load + seated_unsupported | 骨盆稳定，躯干倾角保持 |
| `chest_supported_rear_delt_fly` 胸托后束飞鸟 | M23 + dual_free_load + chest_supported | 胸部离托为代偿 |
| `linked_reverse_pec_deck_fly` 联动反向蝴蝶机飞鸟 | M23 + linked_machine | 一个器械主轨迹 |
| `independent_reverse_pec_deck_fly` 独立反向蝴蝶机飞鸟 | M23 + independent_machine | 左右摆臂独立 |
| `standing_cable_rear_delt_fly` 站姿双臂绳索后束飞鸟 | M23 + cable_handle | 双手柄展开，躯干稳定 |
| `single_arm_cable_rear_delt_fly` 单臂绳索后束飞鸟 | M23 + cable_handle + unilateral | 躯干旋转稳定 |
| `barbell_upright_row` 杠铃直立划船 | M23 + rigid_bar | 器械上升和肘高位 |
| `smith_upright_row` 史密斯直立划船 | M23 + smith_guided_bar | 导轨路径 |
| `cable_upright_row` 绳索直立划船 | M23 + cable_handle | 手柄连续性 |
| `double_dumbbell_upright_row` 双哑铃直立划船 | M23 + dual_free_load | 左右端点独立 |
| `standing_elbow_tucked_cable_external_rotation` 站姿肘贴身绳索外旋 | M24 + cable_handle + unilateral | 投影肩旋转为主关系；肘贴身为稳定证据 |
| `standing_abducted_cable_external_rotation` 站姿肩外展位绳索外旋 | M24 + cable_handle + unilateral | 投影肩旋转为主关系；肘高位锚点为稳定证据 |
| `side_lying_dumbbell_external_rotation` 侧卧哑铃外旋 | M24 + single_free_load + side_lying | 投影肩旋转为主关系；腕/哑铃弧线为独立佐证 |
| `seated_supported_dumbbell_external_rotation` 坐姿肘部支撑外旋 | M24 + single_free_load + seated_supported | 投影肩旋转为主关系；肘部支撑为稳定锚点 |
| `linked_machine_external_rotation` 固定器械肩外旋 | M24 + linked_machine | 投影肩旋转为主关系；真实摆臂轨迹为独立佐证 |

### 5.8 肘屈曲与肘伸展

| 叶级动作 | 合同与修饰 | 覆盖项 |
|---|---|---|
| `standing_straight_bar_curl` 站姿直杠弯举 | M25 + rigid_bar + standing_free | 上臂—躯干稳定，杠铃端点 |
| `standing_ez_bar_curl` 站姿 EZ 杠弯举 | M25 + rigid_bar | 器械 context 不从骨架猜 |
| `smith_machine_curl` 史密斯弯举 | M25 + smith_guided_bar | 导轨路径和上臂稳定 |
| `standing_bilateral_dumbbell_curl` 站姿双哑铃弯举 | M25 + dual_free_load | 左右独立端点 |
| `standing_alternating_dumbbell_curl` 站姿交替哑铃弯举 | M25 + dual_free_load + alternating | 非活动侧保持 |
| `seated_bilateral_dumbbell_curl` 坐姿双哑铃弯举 | M25 + dual_free_load + seated_backrest | 骨盆躯干稳定 |
| `incline_dumbbell_curl` 上斜哑铃弯举 | M25 + dual_free_load + incline_bench | 上臂相对躯干/凳面稳定 |
| `hammer_curl` 锤式弯举 | M25 + dual_free_load | 中立握来自 context |
| `cross_body_hammer_curl` 交叉锤式弯举 | M25 + single_free_load + alternating | 负载向对侧肩方向，独立局部轴 |
| `concentration_curl` 集中弯举 | M25 + single_free_load + seated_supported | 上臂/肘相对大腿支撑稳定 |
| `standing_straight_bar_cable_curl` 直杆绳索弯举 | M25 + cable_handle | 手柄和拉索连续性 |
| `rope_hammer_curl` 绳索锤式弯举 | M25 + cable_handle | 握法来自 context |
| `single_arm_cable_curl` 单臂绳索弯举 | M25 + cable_handle + unilateral | 活动上臂稳定 |
| `high_cable_curl` 高位绳索弯举 | M25 + cable_handle | 上臂高位锚点，独立于下拉 |
| `ez_bar_preacher_curl` EZ杠牧师凳弯举 | M25 + rigid_bar + seated_supported | 上臂相对牧师凳稳定 |
| `dumbbell_preacher_curl` 哑铃牧师凳弯举 | M25 + single_free_load + unilateral | 单侧支撑 |
| `machine_preacher_curl` 固定器械牧师弯举 | M25 + linked_machine + seated_supported | 摆臂与上臂垫 |
| `straight_bar_pushdown` 直杆绳索下压 | M26 + cable_handle + standing_free | 上臂贴近躯干并稳定 |
| `rope_pushdown` 绳索下压 | M26 + cable_handle | 双手柄/绳端分别追踪 |
| `v_bar_pushdown` V杆下压 | M26 + cable_handle | 附件 context |
| `single_arm_cable_pushdown` 单臂绳索下压 | M26 + cable_handle + unilateral | 活动肘锚点 |
| `machine_triceps_pushdown` 固定器械下压 | M26 + linked_machine + seated_supported | 上臂/肘垫与摆臂 |
| `standing_cable_overhead_extension` 站姿绳索过顶臂屈伸 | M26 + cable_handle + standing_free | 上臂过顶稳定，躯干后仰为代偿 |
| `seated_cable_overhead_extension` 坐姿绳索过顶臂屈伸 | M26 + cable_handle + seated_backrest | 骨盆躯干与上臂稳定 |
| `seated_single_dumbbell_overhead_extension` 坐姿单哑铃过顶臂屈伸 | M26 + single_free_load + seated_backrest | 单一负载中心与双肘关系 |
| `standing_single_dumbbell_overhead_extension` 站姿单哑铃过顶臂屈伸 | M26 + single_free_load + standing_free | 增加髋膝稳定 |
| `single_arm_cable_overhead_extension` 单臂绳索过顶伸展 | M26 + cable_handle + unilateral | 活动侧肘锚点 |
| `ez_bar_lying_triceps_extension` EZ杠仰卧臂屈伸 | M26 + rigid_bar + supine_bench | 上臂角稳定、杠铃端点 |
| `straight_bar_lying_triceps_extension` 直杠仰卧臂屈伸 | M26 + rigid_bar + supine_bench | 器械 context |
| `double_dumbbell_lying_triceps_extension` 双哑铃仰卧臂屈伸 | M26 + dual_free_load + supine_bench | 左右独立路径 |
| `single_arm_lying_triceps_extension` 单臂哑铃仰卧臂屈伸 | M26 + single_free_load + unilateral | 非活动侧与躯干稳定 |
| `incline_ez_bar_lying_triceps_extension` 上斜凳 EZ 杠仰卧臂屈伸 | M26 + rigid_bar + incline_bench | 上斜局部轴 |
| `incline_dumbbell_lying_triceps_extension` 上斜凳哑铃仰卧臂屈伸 | M26 + dual_free_load + incline_bench | 左右负载独立的上斜局部轴 |
| `upright_triceps_dip` 三头版直立双杠臂屈伸 | M18 + bodyweight_station | 躯干更直立的 exact contract，与胸部版分离 |
| `assisted_triceps_dip` 辅助三头双杠臂屈伸 | M18 + linked_machine | 身体与辅助平台反向协同 |

### 5.9 膝屈伸、腿弯举与提踵

| 叶级动作 | 合同与修饰 | 覆盖项 |
|---|---|---|
| `bilateral_seated_leg_extension` 双腿坐姿腿屈伸 | M27 + linked_machine + seated_backrest | 双膝与滚轮垫同步 |
| `single_leg_extension` 单腿腿屈伸 | M27 + linked_machine + unilateral | 非活动腿保持 |
| `independent_bilateral_leg_extension` 独立双侧腿屈伸 | M27 + independent_machine | 左右摆臂独立 |
| `bilateral_seated_leg_curl` 双腿坐姿腿弯举 | M27 + linked_machine + seated_backrest | 踝/滚轮垫向下后方弧线 |
| `single_leg_seated_curl` 单腿坐姿腿弯举 | M27 + linked_machine + unilateral | 非活动腿与骨盆稳定 |
| `bilateral_lying_leg_curl` 双腿俯卧腿弯举 | M27 + linked_machine + prone_pad | 踝/滚轮垫向上弧线，骨盆不抬起 |
| `single_leg_lying_curl` 单腿俯卧腿弯举 | M27 + linked_machine + unilateral + prone_pad | 左右骨盆稳定 |
| `standing_single_leg_curl` 站姿单腿腿弯举 | M27 + linked_machine + unilateral + standing_free | 支撑腿、骨盆与躯干稳定 |
| `standing_cable_leg_curl` 站姿绳索腿弯举 | M27 + cable_handle + unilateral | 踝带轨迹与支撑腿稳定 |
| `standing_machine_calf_raise` 站姿固定器械提踵 | M28 + linked_machine + standing_free | 肩垫/承载件与脚跟同步 |
| `smith_standing_calf_raise` 史密斯站姿提踵 | M28 + smith_guided_bar | 导轨、膝角与脚跟 |
| `standing_barbell_calf_raise` 站姿杠铃提踵 | M28 + rigid_bar + standing_free | 杠铃与身体中心同步 |
| `standing_dumbbell_calf_raise` 站姿哑铃提踵 | M28 + dual_free_load + standing_free | 左右负载与身体中心同步 |
| `seated_machine_calf_raise` 坐姿固定器械提踵 | M28 + linked_machine + seated_supported | 大腿垫、膝角与脚跟 |
| `seated_single_load_calf_raise` 坐姿自由负重提踵 | M28 + single_free_load + seated_supported | 负载—大腿关联 |
| `leg_press_calf_raise` 腿举机提踵 | M28 + linked_machine | 膝角稳定、踏板/承载架轨迹 |
| `hack_machine_calf_raise` 哈克机提踵 | M28 + linked_machine | 背垫和承载件锚点 |
| `single_leg_calf_raise` 单腿提踵 | M28 + unilateral | 支撑脚主轨迹、骨盆左右稳定 |

### 5.10 核心、背伸、移动与热身

| 叶级动作 | 合同与修饰 | 覆盖项 |
|---|---|---|
| `floor_sit_up` 地面仰卧起坐 | M29 + floor_support | 完整躯干—大腿夹角变化 |
| `decline_bench_sit_up` 斜板仰卧起坐 | M29 + decline_bench | 凳面局部轴和脚部锚点 |
| `weighted_sit_up` 负重仰卧起坐 | M29 + single_free_load | 负载与躯干同步 |
| `floor_crunch` 地面卷腹 | M29 + floor_support | 肩离地但髋角变化受限，不能继承 sit-up 端点 |
| `march_in_place` 原地踏步 | M30 + standing_free | 左右髋屈曲和膝轨迹交替 |
| `single_load_weighted_march_in_place` 单负载原地踏步 | M30 + single_free_load + standing_free | 负载与躯干稳定，不能代替膝轨迹 |
| `double_dumbbell_weighted_march_in_place` 双哑铃原地踏步 | M30 + dual_free_load + standing_free | 左右负载分别追踪并相对躯干稳定 |
| `alternating_knee_raise` 慢速交替提膝 | M30 + standing_free | 膝抬高与踝同步，躯干后仰稳定 |
| `high_knees` 快速高抬腿 | M30 + standing_free | 更短的活动侧髋屈曲周期，不能套慢速踏步阈值；单目骨架不声称腾空或冲击 |
| `side_step_touch` 侧步并步 | M30 + standing_free | 踝横向分离—合拢 |
| `resistance_band_lateral_walk` 弹力带侧步 | M30 + standing_free | 弹力带只作 context；髋膝与步幅独立规则 |
| `crossover_side_step` 交叉侧步 | M30 + standing_free | 脚部交叉顺序为主任务 |
| `step_jack` 低冲击开合 | M30 + standing_free | 不腾空、左右踏出返回 |
| `jumping_jack` 开合跳 | M30 + standing_free | 双脚与双腕同步开合；与交替单侧踏出的 step jack 分离，单目骨架不声称腾空或冲击 |

## 6. 杠铃划船完整示例

`pronated_barbell_row` 不是“追踪手腕上下移动”。它的完整判断对象是：

```text
应该运动
  杠铃中心沿动作局部回拉轴靠近躯干再返回
  左右肘由较伸展变为屈曲再返回
  上臂相对躯干向后移动再返回
  手腕与杠铃保持主体关联，并与肘/杠铃同步反转

应该保持稳定
  躯干—大腿夹角在 Rep 内保持在 strict-row 走廊
  躯干相对画面/动作局部轴的倾角保持
  膝角、骨盆高度和双脚支撑保持
  杠铃左右端点维持刚体关系

需要追踪
  器械：杠铃中心、轴线、左右端点
  人体：双腕、双肘、双肩、双髋、双膝、双踝
  派生关系：肘角、上臂—躯干角、髋角、膝角、躯干倾角、杠铃—躯干距离

偏差候选
  髋伸、膝伸或躯干抬起与回拉同相大幅发生
  杠铃完成回拉但肘/肩佐证不一致
  左右杠端或左右肘反转明显错相
  杠铃轨迹主要由身体抬起而不是肘肩回拉产生
```

偏差只有在点位覆盖、器械关联、机位适用和 exact-context RulePack 都满足时才能发布；否则保留事实并输出 `cannot_judge`。

## 7. 从本文到可执行资产的完成标准

1. 第 5 节每个叶级动作都拥有稳定 action identity，宽泛父动作不再安装完整 Bundle。
2. 每个叶级动作将 M 合同、器械、姿态、单双侧和覆盖项物化为完整 `ActionMotionDefinition`，而不是运行时继承猜测；它是唯一动作语义权威。
3. ExecutionContract、RecognitionProfile、FeatureProgram 和 RulePack 必须从 `ActionMotionDefinition` 生成或逐字段验证一致，不得重新定义 TaskPrimary、Rep/阶段、稳定、代偿或结论语义。
4. 每个 required/stability/substitution relation 都进入 operator-resolution，并固定单位、scope、coverage 和 source requirements。Identity-defining relation 找不到可表达 operator 时保留完整语义并产生能力拒绝，不得删除或改用相关端点代理。
5. 定义、依赖或下游资产缺失/冲突是构建失败，不是能力拒绝；第 5 节任何叶级动作不完整都会阻止本规格验收。
6. 成功计划中的全部 Identity-defining TaskPrimary、主轨迹和 Rep boundary 必须可计算；只有非身份定义关系和次级质量维度可以 `cannot_judge`。
7. exact camera view 只能决定投影方式与 judgeability，不能改变该关系属于主运动还是稳定/代偿。
8. 未校准数值保持为候选走廊或 `cannot_judge`；不得把本文的定性说明变成跨动作、跨机位常量。
9. 每个用户结论都能沿 Source → Coordinate → Fusion → Rep/Phase → Feature → Comparison → Rule → SetPattern → Conclusion 复现。
10. 除 M21/M24 当前缺失身份定义轴向旋转 operator 的叶级动作外，其余可以由必备二维/局部轨迹 operators 表达的动作必须至少有一个受支持机位成功生成计划并运行完整 set lifecycle；全机位拒绝属于未实现。
