# 常见居家健身跟练动作目录与 MaxPower 首发建议（2026-08-05）

## 结论先行

目前居家跟练的高频动作可以归并为六组：**站立低冲击、基础徒手力量、地面核心、瑜伽/活动度、垫上普拉提、小器械力量**。跨来源反复出现的核心不是复杂编舞，而是深蹲、弓步、俯卧撑、平板支撑、臀桥、开合跳、原地步行，以及少量基础瑜伽体式。

MaxPower 不应把“市场常见”“研究数据里出现”和“已经可以可靠识别”混为一谈：

- 市场来源证明用户确实会跟练某动作；研究数据集只能补充动作命名、重复边界和识别研究可行性，**不代表市场热度**。
- 单目 2D 能较可靠地观察固定机位下的相位、投影角、相对高度、左右节奏和保持时间；不能判断呼吸、肌肉激活、真实 3D 关节角、受遮挡的脊柱/肩胛状态、负荷或医学结果。
- 推荐首发 16 个动作，但“v1 识别候选”仍需按 **动作 × 变式 × 器械 × 机位**建立独立 profile，并用留出标注视频验证。现有 simulated prior 不是动作质量标准。

## 调研方法、证据标签与口径

本目录先阅读现有[居家跟练内容景观报告](../reports/home-workout-content-landscape-2026-08-05.md)，再用平台/创作者官方内容和训练机构动作库核对动作身份。证据分为两条独立轴：

- **M（市场常见）**：消费平台、创作者或训练机构的一手课程/动作库中明确出现。
- **D（研究可用）**：原始论文或公开数据集官方页明确收录，可辅助评估计数/分类研究条件；不是消费市场排名，也不能直接移植为 MaxPower 阈值。

优先级：**P0**＝v1 识别候选（经单独采集和验证后）；**T**＝v1 仅跟练计时/动作切换；**R**＝后置研究。P0 不是“已经上线可评分”。

### 一手来源索引

- **M1**：Nike 2026 将 push-up、squat、lunge、plank、glute bridge、jumping jack、burpee 等列为常见 calisthenics，并给出含 march、chair/air squat、incline/wall push-up、lunge、plank、glute bridge、bird dog 的 10 分钟回路：[Nike, What Is a Calisthenics Workout?](https://www.nike.com/a/what-is-calisthenics-workout)
- **M2**：Nike 无器械居家页列出 squat、lunge、lateral/reverse/walking lunge、glute bridge、push-up、plank、sit-up、bicycle crunch、mountain climber、high knees、jumping jack、burpee、squat jump 等：[Nike, No-Equipment Workouts](https://www.nike.com/a/exercise-with-no-equipment)
- **M3**：ACE 的居家徒手回路包含 incline/wide push-up、side plank、superman、squat/pulse/split squat、reverse/side lunge 等：[ACE, Body-weight Training](https://www.acefitness.org/resources/everyone/blog/7038/body-weight-training-don-t-let-a-lack-of-equipment-keep-you-from-your-goals/)
- **M4**：NHS 居家平衡动作明确列出 sideways walking、grapevine、heel-to-toe walk、one-leg stand、step-up：[NHS, Balance exercises](https://www.nhs.uk/live-well/exercise/balance-exercises/)
- **M5**：ACE 官方动作库收录 bodyweight squat、forward lunge、front plank、bird-dog、cat-cow、child's pose、cobra、downward-facing dog 等，并按无器械/难度分类：[ACE Exercise Library](https://www.acefitness.org/resources/everyone/exercise-library/)
- **M6**：Yoga With Adriene 的官方 Foundations 日历逐项列出 tabletop、child's pose、cat-cow、mountain、forward fold、runner's lunge、downward dog、plank、cobra、warrior I/II、chair、tree、bridge 等：[Yoga With Adriene Foundations](https://yogawithadriene.com/wp-content/uploads/2015/11/FWFG-Foundations-November.pdf)
- **M7**：Pilates Anytime 的官方经典垫上目录与 beginner sequence 包含 Hundred、Roll Up/Half Roll Down、Shoulder Bridge、Rolling Like a Ball、Swan、Swimming、Single Leg Circle/Stretch 等：[34 Mat Exercises](https://www.pilatesanytime.com/blog/mat/the-34-pilates-mat-exercises-)；[Beginner Mat Sequence](https://www.pilatesanytime.com/blog/mat/mat-sequences-for-every-level)
- **M8**：Calderdale and Huddersfield NHS Foundation Trust 的 Pilates 页列出 curl-up、Hundreds、one-leg stretch、four-point kneeling superman、clam、lift and lower、bridge、swan dive：[CHFT Pilates](https://www.cht.nhs.uk/services/clinical-services/physiotherapy-outpatients/the-low-back/pilates)
- **M9**：Nike 的居家小器械指南以 squat、hinge/deadlift、overhead press、row 为基本模式，并列 band row/shoulder press、banded squat/glute bridge/clam：[Nike, Weights for At-Home Workouts](https://www.nike.com/a/weights-for-at-home-workouts)
- **M10**：现有内容报告明确观察到站立步行、side step、knee raise、简化开合、squat、plank、push-up、仰卧核心、基础瑜伽及 Pilates 内容形态：[项目内容报告](../reports/home-workout-content-landscape-2026-08-05.md)
- **M11**：adidas 的官方居家股四头肌动作页明确列出 wall sit、banded squat walk、step-up、Bulgarian split squat 等：[adidas, At-Home Quad Exercises](https://www.adidas.com/us/blog/1089981-6-athome-quad-exercises-to-try)
- **D1**：MM-Fit 官方数据页含 squat、push-up、seated dumbbell shoulder press、lunge、standing dumbbell row、sit-up、overhead dumbbell triceps extension、alternating biceps curl、seated lateral raise、jumping jack，并提供同步 RGB-D、2D/3D pose 与可穿戴数据：[MM-Fit](https://mmfit.github.io/)
- **D2**：RepCount 官方页含 squatting、pull-up、front raise 等重复动作和 repetition boundaries：[RepCount](https://svip-lab.github.io/dataset/RepCount_dataset.html)
- **D3**：HSiPu2 原论文只覆盖 sit-up、push-up、pull-up，含双视角及 standard/non-standard 标签；它能说明研究设置，不能证明这些标签适合作为本产品标准：[HSiPu2, CVPRW 2021](https://openaccess.thecvf.com/content/CVPR2021W/VOCVALC/html/Zhang_HSiPu2_-_A_New_Human_Physical_Fitness_Action_Dataset_for_CVPRW_2021_paper.html)

## 动作目录

表内“空间/噪音”以普通住宅为假设：小＝约一张瑜伽垫或更少，中＝需前后/侧向迈步；静＝楼下友好，低＝脚不离地但有落步声，高＝跳跃落地。推荐机位默认全身入镜、固定相机。

### A. 站立低冲击、有氧与平衡

| 标准名（中 / English） | 模式、起始、节奏与常见变式 | 证据 | 居家条件 | 单目 2D / 机位 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| 原地踏步 / March in place | 站立；交替抬脚/摆臂；连续节拍；走步、轻抬膝 | M1,M10 | 无器械；小；低 | 高；正面；可看左右交替与节奏 | **P0** |
| 侧步并步 / Side step-touch | 站立；侧移再并步；连续；宽步、加手臂 | M4,M10 | 无；中；低 | 高；正面；需留足横向画面 | **P0** |
| 交替提膝 / Alternating knee raise | 站立；左右提膝；连续；慢提膝、高抬腿 | M2,M10 | 无；小；低至高 | 高；正面；慢速版 P0，高抬腿快跑为 T | **P0/T** |
| 低冲击开合 / Step jack | 站立；单脚侧点配合双臂；连续 | M1,M10（jumping jack 的低冲击变式） | 无；中；低 | 高；正面；左右相位清楚 | **P0** |
| 开合跳 / Jumping jack | 站立窄距到跳开并举臂；连续 | M1,M2,D1 | 无；中；高 | 中高；正面；速度、模糊和离地检测需验证 | **T→R** |
| 单腿站立 / One-leg stand | 站立；单脚支撑；定时保持；扶墙/提膝 | M4 | 可选墙/椅；小；静 | 高；正面；能测保持与明显落脚，不能断言平衡能力 | **P0** |
| 脚跟贴脚尖走 / Heel-to-toe walk | 直线前进；脚跟接脚尖；慢连续 | M4 | 可选墙；中；低 | 中；正面/斜前；前后深度压缩 | **T** |
| 台阶踏上 / Step-up | 面向稳定台阶；上、并、下；交替或单侧 reps | M2,M4 | 稳固台阶；中；低 | 中高；侧面；台阶易遮挡脚部 | **R** |

### B. 基础徒手力量

| 标准名（中 / English） | 模式、起始、节奏与常见变式 | 证据 | 居家条件 | 单目 2D / 机位 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| 徒手深蹲 / Bodyweight squat | 双脚站立；髋膝屈伸；单次循环；椅子深蹲、air squat | M1,M2,M3,M5,M10,D1,D2 | 无/可选椅；小；静 | 高；严格侧面；相位、髋高、投影膝髋角可见 | **P0** |
| 深蹲脉冲 / Squat pulse | 保持深蹲区间小幅上下；连续短周期 | M2,M3,M10 | 无；小；静 | 中高；侧面；必须与完整深蹲分 identity | **P0 后置** |
| 反向弓步 / Reverse lunge | 站立后撤、下降、回站；交替/单侧 | M2,M3 | 无；中；低 | 高；侧面或斜前 45°；左右腿分开 | **P0** |
| 前向弓步 / Forward lunge | 站立前迈、下降、回站；交替/单侧 | M1,M5 | 无；中；低 | 中高；侧面/斜前；需容纳前后位移 | **P0 后置** |
| 侧弓步 / Lateral lunge | 宽站或侧迈，一侧屈膝；左右交替 | M1,M2,M3 | 无；中；低 | 高；正面；左右 identity/相位分开 | **P0 后置** |
| 行走箭步蹲 / Walking lunge | 连续向前跨步；交替 reps | M2 | 无；大；低 | 中；斜前；人会快速离开固定画面 | **T/R** |
| 提踵 / Calf raise | 站立脚跟升降；双脚/单脚/扶墙 | M5，项目 registry | 无/可选墙；小；静 | 中高；侧面且脚踝需足够像素 | **P0** |
| 靠墙静蹲 / Wall sit | 背靠墙、髋膝屈曲；定时保持 | M11 | 墙；小；静 | 中高；侧面；墙与躯干边界需清楚 | **T→P0** |
| 墙面/上斜俯卧撑 / Wall or incline push-up | 双手撑墙/稳固高台；肘屈伸 | M1,M3 | 墙/稳固桌台；小；静 | 高；严格侧面；墙面与斜板不可共用 profile | **P0** |
| 跪姿俯卧撑 / Bent-knee push-up | 双膝着垫、手撑；肘屈伸 | M3,M5 | 垫；小；静 | 高；斜前 45°/侧面；与脚撑版分 identity | **P0 后置** |
| 标准俯卧撑 / Push-up | 手脚支撑；身体整体下降/推起 | M1,M2,M10,D1,D3 | 垫可选；小；静 | 高；斜前 45°或侧面；遮挡侧肘时拒答 | **P0** |
| 前臂/直臂平板 / Front plank | 俯撑静态保持；前臂或直臂 | M1,M2,M5,M10 | 垫；小；静 | 高；严格侧面；两个支撑版本分 identity | **P0** |
| 侧平板 / Side plank | 单侧前臂/手与脚支撑；保持；屈膝版 | M3,M6,M10 | 垫；小；静 | 高；正对身体侧面；上下侧必须记录 | **P0 后置** |
| 臀桥 / Glute bridge | 仰卧屈膝；骨盆抬起落下；保持/单腿 | M1,M2,M7,M8,M10 | 垫；小；静 | 中高；低机位侧面；地面会压缩躯干变化 | **P0 后置** |
| 鸟狗式 / Bird dog | 四点跪；对侧手脚伸展回收；交替 | M1,M5,M8 | 垫；小；静 | 中高；侧面/斜前；近远侧肢体有遮挡 | **P0 后置** |

### C. 地面核心与高强度组合

| 标准名（中 / English） | 模式、起始、节奏与常见变式 | 证据 | 居家条件 | 单目 2D / 机位 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| 卷腹 / Crunch or curl-up | 仰卧屈膝；肩胛小幅离地；reps | M2,M8,M10 | 垫；小；静 | 低；侧面低机位，躯干位移小且常遮挡 | **T/R** |
| 仰卧起坐 / Sit-up | 仰卧到坐起再回落；reps | M2,D1,D3 | 垫；中；静 | 中；侧面；头/躯干边界可见但脚固定方式影响大 | **R** |
| 自行车卷腹 / Bicycle crunch | 仰卧；交替屈膝与躯干旋转；连续 | M2,M10 | 垫；小；静 | 低；肘膝交叉、遮挡和身份边界复杂 | **T** |
| 死虫式 / Dead bug | 仰卧 tabletop；对侧手脚伸展；交替 | M10 | 垫；小；静 | 低至中；建议高位斜俯拍，但消费相机难固定 | **T/R** |
| 登山跑 / Mountain climber | 高平板；交替提膝；快连续 | M2 | 垫；小；低 | 低至中；高速、肢体交叠，先不纠姿 | **T/R** |
| 波比跳 / Burpee | 站立—下蹲—平板—回站/跳；组合 | M1,M2,M3,M10 | 无/垫；中；高 | 低；动作切换、贴地、离地和模糊叠加 | **T/R** |
| 深蹲跳 / Squat jump | 深蹲后跳起落地；reps | M2,M3 | 无；中；高 | 中；侧面，但落地和速度增加风险 | **T/R** |

### D. 瑜伽与活动度（只测可见构型/保持，不替代老师）

| 标准名（中 / English） | 模式、起始、节奏与常见变式 | 证据 | 居家条件 | 单目 2D / 机位 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| 山式 / Mountain pose (Tadasana) | 站立静态；手臂自然或上举 | M6,M10 | 无；小；静 | 高；正面；可做入镜/站姿校准，不作“体态诊断” | **P0** |
| 椅子式 / Chair pose (Utkatasana) | 站立屈髋膝、臂上举；保持 | M6 | 无；小；静 | 高；侧面；与动态深蹲分 identity | **P0 后置** |
| 战士一式 / Warrior I (Virabhadrasana I) | 前后分腿、前膝屈、臂上举；保持 | M5,M6 | 垫可选；中；静 | 中；斜前/侧面；髋朝向无法由单视角完整确认 | **T→P0** |
| 战士二式 / Warrior II (Virabhadrasana II) | 宽站、前膝屈、双臂平举；保持 | M6,M10 | 垫可选；中；静 | 高；正面；左右侧分开 | **P0** |
| 树式 / Tree pose (Vrksasana) | 单腿站、另一脚贴支撑腿；保持；扶墙版 | M6,M10；[创作者单体式页](https://yogawithadriene.com/tree-pose/) | 可选墙；小；静 | 高；正面；可测保持/落脚，不判内在稳定感 | **P0** |
| 猫牛式 / Cat-Cow | 四点跪；脊柱屈伸随呼吸；慢连续 | M5,M6 | 垫；小；静 | 低；脊柱曲线和呼吸均非现有骨架可靠量 | **T** |
| 下犬式 / Downward-facing dog | 四点支撑转倒 V；保持/转场 | M5,M6,M10 | 垫；小；静 | 中；侧面；能识别大构型，不能判断肩胛/脊柱细节 | **T→P0** |
| 眼镜蛇式 / Cobra pose | 俯卧上身伸展；保持/慢 reps | M5,M6 | 垫；小；静 | 低至中；侧面，贴地与小幅躯干变化 | **T** |
| 婴儿式 / Child's pose | 跪坐前屈、手臂前伸；保持 | M5,M6 | 垫；小；静 | 中；侧面；主要适合作为课程转场/计时 | **T** |
| 站立前屈 / Standing forward fold | 站立髋屈向下；保持/流动 | M6 | 无/垫；小；静 | 中高；侧面；可测大构型，不把柔韧度当质量分 | **T→P0** |
| 高弓步/跑者弓步 / High or runner's lunge | 前后分腿；前膝屈；保持 | M6 | 垫；中；静 | 中高；侧面；高/低弓步需分 identity | **T→P0** |
| 拜日式/连续流 / Sun Salutation or Vinyasa flow | 多体式连续转换、换面 | M6,M10 | 垫；中；静 | 低；身份边界、转身、遮挡复杂 | **T/R** |

### E. 垫上普拉提

| 标准名（中 / English） | 模式、起始、节奏与常见变式 | 证据 | 居家条件 | 单目 2D / 机位 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| 百次拍击 / The Hundred | 仰卧卷起、腿抬起、手臂快速拍动；呼吸计数 | M7,M8,M10 | 垫；小；静 | 低；手臂幅度小、髋膝重叠；呼吸不可测 | **T** |
| 半卷下 / Half Roll Down | 坐姿屈膝；骨盆/躯干后卷再坐起；慢 reps | M7 | 垫；小；静 | 中；侧面；细分脊柱逐节运动不可声称 | **T/R** |
| 卷起 / Roll Up | 仰卧长腿到坐姿前屈；慢 reps | M7 | 垫；中；静 | 中；侧面；体型、动量与遮挡影响大 | **R** |
| 肩桥 / Shoulder Bridge | 仰卧屈膝抬骨盆；经典版可加单腿 | M7,M8 | 垫；小；静 | 中；侧面；基础双脚版先跟练，单腿另建 identity | **T→P0** |
| 单腿伸展 / One Leg Stretch | 仰卧/卷起；交替伸腿；慢连续 | M7,M8 | 垫；小；静 | 低；髋膝交叠，版本差异大 | **T** |
| 单腿画圈 / Single Leg Circle | 仰卧，一腿抬高画圈；单侧 reps | M7 | 垫；小；静 | 低；运动多沿相机深度，骨盆细微变化不可见 | **T/R** |
| 蛤式开合 / Clam | 侧卧屈髋膝、脚跟并拢，抬上侧膝 | M8,M9 | 垫；小；静 | 低；上下腿重叠、骨盆旋转难判断 | **T/R** |
| 侧卧抬腿 / Side-lying leg lift | 侧卧直腿，上侧腿抬落 | M8 | 垫；小；静 | 中；正对身体侧面；遮挡下侧腿 | **T→P0** |
| 游泳式 / Swimming | 俯卧，对侧手脚交替抬起；连续 | M7,M8 | 垫；小；静 | 低；贴地、四肢交替和小幅位移 | **T/R** |
| 天鹅式 / Swan | 俯卧上身抬起；保持/慢 reps | M7,M8 | 垫；小；静 | 低至中；侧面；躯干幅度小 | **T** |

### F. 一对哑铃或弹力带（扩展库，不建议混入无器械 identity）

| 标准名（中 / English） | 模式、起始、节奏与常见变式 | 证据 | 居家条件 | 单目 2D / 机位 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| 哑铃罗马尼亚硬拉 / Dumbbell Romanian deadlift | 站立持铃；髋铰链往返；reps | M9 | 哑铃；小；静 | 高；侧面；重量、单/双铃必须记录 | **R** |
| 站姿哑铃划船 / Standing dumbbell row | 髋铰链持铃；肘向后拉回 | M9,D1 | 哑铃；小；静 | 中；侧/斜后，躯干遮挡远侧肘 | **R** |
| 哑铃推肩 / Dumbbell shoulder press | 坐/站持铃肩侧；上推下放 | M9,D1 | 哑铃/椅；小；静 | 中高；正面；坐姿与站姿分 identity | **R** |
| 交替哑铃弯举 / Alternating dumbbell biceps curl | 站立持铃；左右交替屈肘 | D1 | 哑铃；小；静 | 高；正面；可测交替相位，不能测负荷/发力 | **R** |
| 坐姿侧平举 / Seated lateral raise | 坐姿持铃；双臂侧举下放 | D1（市场相邻动作见项目既有 profile） | 哑铃/椅；小；静 | 高；正面；器械与坐姿构成独立 identity | **R** |
| 头上哑铃臂屈伸 / Overhead dumbbell triceps extension | 站/坐持铃过头；肘屈伸 | D1 | 哑铃；小；静 | 中；侧面；手和器械易出画 | **R** |
| 弹力带划船 / Resistance-band row | 坐/站、带固定；肘后拉 | M9 | 弹力带+可靠锚点；小；静 | 中；斜前/侧面；锚点和带张力不可由骨架证明 | **R** |
| 弹力带侧向走 / Banded lateral walk | 半蹲、带绕腿；侧向连续步 | M9 | 环形带；中；低 | 高；正面；带位置和张力须作为上下文 | **R** |

## 建议首发的 16 个动作

首发不是一次上线 16 个纠姿 profile，而是形成“市场入口 + 少数已验证互动动作”的内容池：

1. 原地踏步 / March in place
2. 侧步并步 / Side step-touch
3. 交替提膝（慢速）/ Alternating knee raise
4. 低冲击开合 / Step jack
5. 徒手深蹲 / Bodyweight squat
6. 反向弓步 / Reverse lunge
7. 提踵 / Calf raise
8. 墙面俯卧撑 / Wall push-up
9. 上斜俯卧撑 / Incline push-up（与墙面版分 profile）
10. 标准俯卧撑 / Push-up
11. 前平板 / Front plank
12. 鸟狗式 / Bird dog
13. 单腿站立 / One-leg stand
14. 山式 / Mountain pose
15. 战士二式 / Warrior II
16. 树式 / Tree pose

取舍理由：前 4 个动作是低门槛流量入口；5–11 有清楚的相位或保持状态；12–16 扩展到协调、平衡和瑜伽，但系统只报告可见构型与保持。臀桥虽常见，因消费机位过高时髋部投影变化很小，放在下一批验证。

## 6–10 分钟课程编排示例

### 课程 A：8 分钟正面站立低冲击启动

固定正面全身机位，不换镜头；每段 40 秒动作 + 20 秒过渡，共 8 段：原地踏步 → 侧步并步 → 交替提膝 → 低冲击开合，循环两轮。第一轮熟悉动作，第二轮跟拍节奏。系统只做入镜、当前动作、左右交替、节奏和完成进度；跳拍/遮挡时标记未知，不估算局部减脂或卡路里。

### 课程 B：8 分钟侧面基础力量

固定左侧全身机位：60 秒机位/试做校准；徒手深蹲 45 秒 + 休息 15 秒 × 2；左腿反向弓步 40 秒 + 休息 20 秒；右腿反向弓步 40 秒 + 休息 20 秒；提踵 45 秒 + 休息 15 秒；墙面俯卧撑 45 秒 + 休息 15 秒；最后 60 秒自由复练。只对已验证 profile 的完整周期给 confirmed/needs-review/rejected evidence；每个 rep 最多一条二维可执行提示。

### 课程 C：6 分钟正面平衡与基础体式

30 秒山式入镜校准；单腿站立左右各 30 秒；战士二式左右各 45 秒；树式左右各 45 秒；三次换动作/侧合计 30 秒；最后 60 秒自由选择复练，合计 6 分钟。老师负责呼吸、感受、变式和退出条件，系统只负责左右身份、明显构型、保持时间、失去全身可见和落脚事件。

## 对现有 MaxPower 的直接差距

- 当前 registry 已有 `bodyweight_squat`（experimental）、`push_up`、`walking_lunge`、`calf_raise`（后三者 catalog-only），但缺少 `march_in_place`、`side_step_touch`、`alternating_knee_raise`、`step_jack`、`reverse_lunge`、`wall_push_up`、`incline_push_up`、`front_plank`、`bird_dog`、`one_leg_stand`、`mountain_pose`、`warrior_ii`、`tree_pose` 等居家专用 identity。
- 不应因 registry 已有 `walking_lunge` 就复用给 reverse lunge，也不应把 wall/incline/knee/standard push-up 混为 `push_up`；这些动作的支撑点、位移、相位和可见条件不同。
- MM-Fit、RepCount、HSiPu2 可用于设计数据采集与复现基线，但其人群、镜头、动作定义、standard/non-standard 标签和传感器条件均不是本产品事实。需要按项目 canonical packet、缺失关键点保持 unknown、版本化 profile、留出视频验证的规则重新建立证据。

## 不应声称的内容

- 不从骨架声称“某块肌肉正在发力”、呼吸正确、核心已激活、负荷合适、疼痛原因、受伤风险、康复效果或局部减脂。
- 不把瑜伽/普拉提压缩成关节角“标准分”；体式价值还包含呼吸、感受、可选变式和老师口令。
- 不把动作库出现频率、视频播放量或数据集收录当作动作质量阈值。
- 不用 simulated prior、单个公开视频或训练集上的标签自动拒绝用户动作；看不清时应明确返回 unknown/needs review。

## 最终建议

内容上先覆盖 16 个首发动作，工程上先验证 **正面站立低冲击 4 个 + 侧面徒手深蹲 + 侧面墙面俯卧撑 + 侧面前平板**这 7 个精确上下文；上斜俯卧撑随后作为独立 identity 验证。瑜伽和平衡动作先做保持/可见性，普拉提仰卧/侧卧动作先做计时。这样既覆盖市场最常见的居家入口，也把 MaxPower 的承诺限制在单目 2D 真正可观察和可验证的范围内。
