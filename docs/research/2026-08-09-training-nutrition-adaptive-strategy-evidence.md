---
title: 训练与饮食联合策略：证据边界与 Agent 自适应决策框架
slug: training-nutrition-adaptive-strategy-evidence
type: research
project: maxpower
date: 2026-08-09
status: active
confidence: provisional
tags: [training, nutrition, fat-loss, hypertrophy, recovery, carb-cycling, plateau, agent]
---

# 训练与饮食联合策略：证据边界与 Agent 自适应决策框架

> 适用范围：没有需要临床营养或医疗康复处方的健康成年人，以增肌、增力、减脂保肌或一般体能为目标。本文不是疾病诊断、伤病康复、饮食障碍治疗、竞技脱水或极端备赛指南。
>
> 本文不是替代已有的 [营养策略知识库](../wiki/nutrition-strategy.md)、[训练编程知识库](../wiki/training-programming.md) 与 [恢复约束知识库](../wiki/recovery-and-health-signals.md)，而是补充三者之间的联合决策、民间说法判定、平台期诊断和目标切换规则。

## 1. 结论先行

1. **“必须先有一定肌肉量，才能把体脂降到 12%”不是生理定律。**体脂率是估算的脂肪质量占体重比例，没有研究确立“达到某个体脂率前必须具备多少肌肉”的门槛。肌肉量会影响减脂后的外观、绝对静息能耗、训练表现和保留瘦体重的价值，但不构成能否减到某个百分比的必要条件。是否先增肌，应由当前脂肪量、训练经历、目标外观、期限、可持续性和恢复状态共同决定。
2. **“长期低碳必然压低代谢”过度概括。**减重后能量消耗通常下降，部分来自身体变轻，部分可能来自适应性产热和活动补偿；系统综述认为适应性产热存在，但个体差异、能量平衡状态和测量方法影响很大。现有证据不能把它归因于低碳本身，也不能从平台期反推“代谢已损坏”。[Nunes et al., 2022](https://doi.org/10.1017/S0007114521001094)
3. **低碳不是独立的“快速刷脂机制”。**受控喂养研究中，降低碳水会提高脂肪氧化，但并不等于消耗更多身体脂肪；在等热量缺口下，降低脂肪的一组反而出现更大的短期体脂损失。12 个月 DIETFITS 试验也未发现健康低脂和健康低碳在体重变化上有显著差异。[Hall et al., 2015](https://pubmed.ncbi.nlm.nih.gov/26278052/) · [Gardner et al., 2018](https://pubmed.ncbi.nlm.nih.gov/29466592/)
4. **碳循环是“周预算与训练供能的排程方式”，不是独立减脂法。**高碳日可以贴合高训练量日，低碳日可以贴合休息日；若周热量和蛋白相同，没有可靠证据证明它比持续均衡缺口更快减脂。
5. **Refeed 与 diet break 不能承诺“重启代谢”。**在阻力训练人群中，连续限制和间歇限制总体产生相近的脂肪和去脂体重结果；短期维持热量休息可能改善饥饿、易怒或局部肌耐力，因此可作为依从性和训练质量工具，而不是必需的激素重置。[Peos et al., 2021](https://pubmed.ncbi.nlm.nih.gov/33587549/) · [Siedler et al., 2023](https://pubmed.ncbi.nlm.nih.gov/37181269/)
6. **“大强度抗阻 + 大强度有氧 + 低碳/低能量”真正的问题是总恢复预算可能不够，不是 App 可以诊断的“皮质醇锁脂”。**短期低碳可能提高静息或运动后皮质醇，高强度运动本身也会造成正常的急性皮质醇反应；但长期低碳对静息皮质醇的结果不一致，皮质醇也不能由训练安排推算，更不能作为脂肪无法分解的单因果解释。[Whittaker & Harris, 2022](https://pubmed.ncbi.nlm.nih.gov/35254136/) · [Hill et al., 2008](https://pubmed.ncbi.nlm.nih.gov/18787373/)
7. **减脂保肌的高优先级组合是：可持续能量缺口、足够蛋白、阻力训练、与恢复相容的有氧。**对超重/肥胖成人，在饮食减重中加入抗阻训练有助于减少去脂体重损失并增加脂肪损失；对于较瘦、训练程度高的人，缺口通常应更保守。[Binmahfoz et al., 2025](https://pubmed.ncbi.nlm.nih.gov/40909191/) · [Garthe et al., 2011](https://pubmed.ncbi.nlm.nih.gov/21558571/)
8. **“没有肌肉就必须先增肌”也不能作为 Agent 的自动结论。**在年轻超重男性的一项四周受控试验中，高蛋白、明显能量缺口与高训练量并存时仍观察到瘦体重增加和脂肪减少；这说明重组可能发生，但不能外推为所有人都会发生或极端方案适合普通用户。[Longland et al., 2016](https://pubmed.ncbi.nlm.nih.gov/26817506/)
9. **平台期首先是事实审计问题。**体重水分、称量条件、漏记、进食估算、依从性、NEAT/步数变化、训练疲劳和真实能量需求变化都可能解释“没变”。数学模型研究显示，间歇性不依从可以形成常见的早期平台形态；不应一看到两次体重相同就继续砍热量。[Thomas et al., 2014](https://pubmed.ncbi.nlm.nih.gov/25080458/)
10. **长期策略不能被单日噪声改写。**每日恢复评估只能调整当天或下一次尚未执行的内容；热量/宏量通常按至少两个可比较周复核；训练负荷按同动作连续可比表现复核；改变减脂、维持、增肌等主策略需要跨窗口证据和用户确认。

MaxPower 的权威层级应固定为：

```text
长期目标
  → 多阶段路线（cut / maintenance-recompose / gain / cut ...）
    → 当前阶段联合 Training + Nutrition + Recovery Strategy
      → WeekPlan
        → DailyEvaluation
          → TodayPlan
```

**碳循环不属于长期目标。**它只是当前减脂/维持/训练阶段下的一种营养排程候选，需要由训练频率与训练量、关键训练日表现、饥饿和依从性、做饭/外食及生活日程共同触发。新用户默认先用简单、均衡且可校准的方案，不能因为目标写了“快速减脂”就直接生成碳循环。

## 2. 证据语言

本文和 MaxPower 规则包必须使用以下四类标签：

| 标签 | 含义 | Agent 行为 |
|---|---|---|
| `EvidenceFact` | 组织立场、系统综述、Meta、随机试验或原始人体研究直接支持的结论 | 可以解释，但必须保留人群和局限 |
| `ProductPolicy` | 为了保守、可预测、可测试而选择的默认阈值、窗口或动作 | 必须版本化、可覆盖、可撤销，不能包装成科学定律 |
| `Unknown` | 证据不足、定义不统一、无法从当前输入判断或个体差异过大 | 输出不确定性或请求最小必要信息；默认 `hold` |
| `SafetyBoundary` | 超出一般健身产品授权或出现需专业评估的信号 | 停止自动处方或调整，建议合格专业人员/及时就医 |

同一条输出可以同时包含多种标签。例如：

```text
EvidenceFact: 低能量可用性可能损害健康与表现。
ProductPolicy: 连续两周表现下降 + 高疲劳时，暂停继续减热量并提出维持期。
Unknown: App 不能据自报摄入计算并诊断 REDs。
SafetyBoundary: 晕厥、胸痛、异常呼吸困难时停止训练并寻求医疗帮助。
```

## 3. 常见民间说法：哪些可用，哪些不能用

### 3.1 “要降到 12% 体脂，必须先有肌肉”

**判定：作为审美建议有条件成立；作为生理门槛不成立。**

- `EvidenceFact`：能量缺口会削弱阻力训练带来的瘦体重增长；减脂时做阻力训练有助于保留瘦体重。[Murphy & Koehler, 2022](https://pubmed.ncbi.nlm.nih.gov/34623696/) · [Binmahfoz et al., 2025](https://pubmed.ncbi.nlm.nih.gov/40909191/)
- `EvidenceFact`：体脂测量并非精确真值。2026 年 BIA 对四分室模型的系统综述报告，个体体脂率一致性界限常跨约 15–20 个百分点；设备均值看似接近，不代表个人精确。[Oliver et al., 2026](https://pubmed.ncbi.nlm.nih.gov/41718193/)
- `Unknown`：没有统一的“健康成年人男性 12%”或跨性别通用视觉/健康阈值，更没有“达到 12% 前必须有 X kg 瘦体重”的验证规则。
- `ProductPolicy`：体脂目标必须保存测量方法、日期和误差状态。Agent 优先追踪同条件的体重、腰围、表现、照片（若用户自愿）和同设备趋势，不把 `12.0%` 当精确终点。
- `ProductPolicy`：如果用户真正目标是“有明显线条/更强壮的外观”，Agent 应拆成脂肪趋势和肌肉/力量趋势；当继续减脂预计只会让体重更轻而非满足外观偏好时，可以提出维持/重组/增肌路径，但不能宣称用户“没有资格减脂”。

### 3.2 “没有肌肉量不能长期低碳，会把代谢压死”

**判定：把多个问题混成了错误因果链。**

- `EvidenceFact`：减重期间静息能耗和总能耗会随体重、瘦体重、食物热效应和活动变化而下降，并可能存在额外适应性产热；其幅度和持续性高度不一。[Nunes et al., 2022](https://doi.org/10.1017/S0007114521001094)
- `EvidenceFact`：DIETFITS 中健康低脂与健康低碳 12 个月减重没有显著差异；没有证据支持“低碳特异性损坏代谢”的通用说法。[Gardner et al., 2018](https://pubmed.ncbi.nlm.nih.gov/29466592/)
- `EvidenceFact`：极端长期负能量平衡和低能量可用性可能伴随生理、心理与表现不良；IOC 明确认为 REDs 是多因素临床诊断，不能用单个自报能量可用性数值诊断。[IOC REDs Consensus, 2023](https://pubmed.ncbi.nlm.nih.gov/37752011/)
- `ProductPolicy`：系统关注的是**能量可用性风险、体重下降速度、表现与恢复趋势**，而不是给用户贴“代谢低”标签。
- `Unknown`：普通 App 无法只凭饮食结构、体脂秤或一次平台判断代谢适应程度。

### 3.3 “高强度力量 + 高强度有氧 + 低碳会让皮质醇升高，反而不分解脂肪”

**判定：前半句可能在部分情境出现，后半句缺乏支持。**

- `EvidenceFact`：短期（少于约三周）低碳在健康男性研究的 Meta 中与较高静息皮质醇相关；长于三周的结果不一致。长时运动后的皮质醇反应也可能更高。[Whittaker & Harris, 2022](https://pubmed.ncbi.nlm.nih.gov/35254136/)
- `EvidenceFact`：中高强度运动可急性提高皮质醇，这是正常应激反应，不等同于慢性高皮质醇疾病。[Hill et al., 2008](https://pubmed.ncbi.nlm.nih.gov/18787373/)
- `EvidenceFact`：人体急性皮质醇与脂解的关系依赖胰岛素、肾上腺素、浓度和脂肪部位；急性和慢性糖皮质激素作用方向并不相同。[Djurhuus et al., 2017](https://pubmed.ncbi.nlm.nih.gov/28177189/)
- `EvidenceFact`：在一项高缺口、高蛋白、高强度混合训练试验中，血清皮质醇变化与体成分变化的相关性只解释很小一部分差异，不能支持“皮质醇锁脂”。[Longland et al., 2016](https://pubmed.ncbi.nlm.nih.gov/26817506/)
- `ProductPolicy`：Agent 不估算皮质醇、不用“皮质醇过高”解释平台。它检查总训练量、实际完成、睡眠、主观疲劳、局部酸痛、体重下降速度、碳水可用性和进食依从性。
- `ProductPolicy`：当高强度抗阻、高强度有氧、明显能量缺口和持续恢复下降同时存在时，优先只动一个变量：减少有氧强度/量、减少可选抗阻组、提高能量、把碳水移到关键训练日前后，或安排短期维持；不继续叠加压力。

### 3.4 “碳循环可以快速刷脂”

**判定：可帮助排程和依从性；未证明有独立的快速减脂优势。**

- `EvidenceFact`：不同宏量分配在能量和依从性可比时都能减脂。[Aragon et al., 2017](https://doi.org/10.1186/s12970-017-0174-y)
- `EvidenceFact`：阻力训练的碳水效果依情境变化。进食状态下、每肌群不超过约 10 组的常规训练通常未显示额外碳水显著改善表现；高训练量、糖原已消耗、一天两练等情境更可能获益。[Henselmans et al., 2022](https://pubmed.ncbi.nlm.nih.gov/35215506/)
- `EvidenceFact`：生酮饮食虽然增加运动时脂肪氧化，但对运动表现总体中性或不利；最大力量通常相近，但其并非增肌或高强度表现的默认最优策略。[ISSN Ketogenic Diet Position, 2024](https://pubmed.ncbi.nlm.nih.gov/38934469/)
- `ProductPolicy`：碳循环必须保持周能量预算、蛋白目标和每日脂肪底线不变；高碳日绑定高需求训练，低碳日不自动变为生酮、禁食或极低热量。
- `ProductPolicy`：若用户发现循环复杂、饥饿加剧、外食难执行或训练下降，优先退回均衡缺口，而不是继续降低低碳日。

### 3.5 “Refeed/diet break 能重启代谢、突破平台”

**判定：不能承诺重启；可以作为行为和恢复工具。**

- `EvidenceFact`：ICECAP 试验中间歇和持续能量限制的身体成分与表现总体相近。[Peos et al., 2021](https://pubmed.ncbi.nlm.nih.gov/33587549/)
- `EvidenceFact`：一项 27 人小型试验报告两天高碳 refeed 更好地保留去脂体重和静息代谢，但样本小、结果与其他试验并不一致。[Campbell et al., 2020](https://pubmed.ncbi.nlm.nih.gov/33467235/)
- `EvidenceFact`：训练女性六周 25% 缺口试验未见 diet break 对体成分或静息代谢的优势，但支持其在不害怕脂肪反弹的情况下短暂回到维持。[Siedler et al., 2023](https://pubmed.ncbi.nlm.nih.gov/37181269/)
- `EvidenceFact`：ICECAP 的一周 diet break 二次分析观察到腿部肌耐力、饥饿和易怒等短期改善，但力量没有改变。[Peos et al., 2021 secondary analysis](https://pubmed.ncbi.nlm.nih.gov/33630880/)
- `ProductPolicy`：diet break 的适用理由只能是“提高后续依从性、缓解持续饥饿/饮食疲劳、配合高需求训练或社会日程”，不能写“修复代谢”。

### 3.6 “增肌要高碳”

**判定：碳水是训练供能与可执行性工具，不是肌肉增长的单独开关。**

- `EvidenceFact`：增肌的基础是渐进阻力训练、足够蛋白与不长期处于明显能量缺口。Meta 回归显示能量缺口削弱瘦体重增长；约 500 kcal/day 是研究中的群体关联，不是每个人的硬阈值。[Murphy & Koehler, 2022](https://pubmed.ncbi.nlm.nih.gov/34623696/)
- `EvidenceFact`：小型训练者试验中，较大能量盈余并未稳定带来更多肌肉或力量，却更明确增加皮褶厚度，因此“大吃才能大长”不成立。[Helms et al., 2023](https://doi.org/10.1186/s40798-023-00651-y)
- `EvidenceFact`：碳水对高量、糖原受限或高频训练更可能有价值，但普通训练不存在已验证的统一最低克数。[Henselmans et al., 2022](https://pubmed.ncbi.nlm.nih.gov/35215506/)
- `ProductPolicy`：增肌默认从保守盈余或维持附近校准，先固定蛋白与脂肪底线，再把剩余能量给碳水；高训练量日可多分配碳水，但不自动提高周总热量。

### 3.7 “平台就是代谢坏了”

**判定：不成立；平台是待分类现象。**

平台可能来自：

- 时间窗太短；
- 月经周期、糖原、盐、肠内容物、炎症或旅行引起的水重；
- 称量条件和设备变化；
- 餐食遗漏、外食估算偏差、份量漂移；
- 目标执行率下降；
- 体重降低后维持需求下降；
- NEAT、步数或其他活动补偿下降；
- 训练量变化、酸痛与糖原恢复掩盖脂肪趋势；
- 真正的能量缺口已经很小；
- 目标速度或期限不现实。

`ProductPolicy`：在没有完成数据审计前，不得使用“代谢损伤、胰岛素锁脂、皮质醇锁脂”等不可验证解释，也不得自动连续砍热量。

## 4. 核心实践问题：什么时候先减脂，什么时候先增肌再减脂

用户提到的“没肌肉不要直接刷到 12%”更合理的解释不是体脂生理门槛，而是**阶段路径选择**：同样的目标体脂率，瘦体重较少的人需要到达更低的绝对体重，最终外观可能仍不符合“有线条、有体积”的真实目标，而且更低体重通常意味着更小的绝对维持能量预算。但这仍然不是所有人都应先增肌的规则。

### 4.1 肌肉量为什么会影响路径，但不是“代谢护盾”

#### 目标体重的数学关系

若暂时把 fat-free mass（FFM）当作不变估算：

```text
目标体重 ≈ FFM / (1 - 目标体脂率)
```

例如，同样以 12% 为目标：

- 估算 FFM 为 60 kg，数学目标体重约为 `60 / 0.88 = 68.2 kg`；
- 估算 FFM 为 50 kg，数学目标体重约为 `50 / 0.88 = 56.8 kg`。

这说明低 FFM 用户若执着于同一个百分比，可能需要到更低绝对体重。然而这只是演示，不是处方：减脂中 FFM 不会严格不变，体脂估算本身也可能有很大个体误差。因此 Agent 不能把公式结果显示为“你必须减到 56.8 kg”。

#### 增肌对静息代谢的贡献没有民间说法那么大

- `EvidenceFact`：器官—组织模型使用的成人骨骼肌静息代谢系数约为 `13 kcal/kg/day`，远低于肝、脑、心和肾等高代谢器官。[Wang et al., 2010](https://pubmed.ncbi.nlm.nih.gov/20962155/)
- 以该模型粗略理解，增加 3 kg 骨骼肌对应的静息消耗量级约 39 kcal/day，而不是每天自动多吃数百千卡。
- `EvidenceFact`：一项九个月阻力训练队列的间接测热结果中，平均 RMR 从 `1653±302` 增到 `1726±291 kcal/day`，即约 `+73±158 kcal/day`；个体差异非常大，变化只部分由 FFM 和甲状腺激素解释。[Aristizabal et al., 2015](https://pubmed.ncbi.nlm.nih.gov/25293431/)
- `ProductPolicy`：MaxPower 不以“增肌提高基础代谢”作为让用户先增肌的主要承诺，也不把每增加 1 kg 肌肉直接加到日常热量目标。热量仍需由摄入与体重趋势校准。

#### 先增肌真正可能带来的价值

1. 让最终“低脂”同时拥有用户想要的肌肉体积和线条，而不是只得到更低体重；
2. 提高力量、动作能力和可承受的训练量，为后续减脂保留更强的训练刺激；
3. 在更高 FFM/体重和更多训练活动下，用户的绝对维持摄入通常可能更高，但幅度必须实际校准；
4. 让后续减脂阶段拥有更多可以保留的瘦体重，且目标体重不必压得同样低；
5. 给新手时间学习动作、建立负荷历史和稳定饮食，而不是同时追逐极低体脂。

#### 先增肌的成本

1. 需要数月而不是数周，不能满足近期减脂优先级；
2. 能量盈余通常会伴随一定脂肪增长，尤其是盈余过大时；
3. 当前脂肪量较高的用户可能更在意先降低腰围、体重和健康风险；
4. 新手/回归者可能在维持或温和缺口中同时改善力量和体成分，不一定需要先进入明确盈余；
5. 如果用户并不追求肌肉外观，强迫先增肌违背其目标。

### 4.2 三条可选路径

#### A. `cut_first`：先减脂，再维持/增肌

优先条件：

- 当前脂肪/腰围下降是用户明确最高优先级；
- 当前体重或脂肪水平明显高于用户可接受范围；
- 用户能执行温和缺口、足够蛋白和阻力训练；
- 期限允许保守减重，且恢复/训练没有持续下降；
- 用户接受“第一阶段先变小、肌肉外观以后完善”。

实施：使用减脂保肌方案，不因“肌肉少”拒绝减脂；达到阶段目标、依从性/恢复变差或外观目标转向后，进入维持校准，再决定增肌。

#### B. `maintenance_recompose`：维持或温和缺口重组

优先条件：

- 新手、回归者或从未有稳定阻力训练；
- 脂肪不是需要快速处理的唯一主目标；
- 体脂读数和真实目标不清晰，用户实际想要“更紧实、更强”；
- 同时学习训练和饮食，复杂 phase cycling 可能降低依从性；
- 近期已经出现腰围改善和力量增长，即使体重较平。

实施：维持附近或温和缺口，训练采用可持续的渐进超负荷，按腰围、体重、训练表现和照片偏好（用户自愿）联合复核。若连续趋势显示脂肪不降而用户更重视减脂，再切 `cut_first`；若脂肪可接受且力量/肌肉优先，再切增肌。

#### C. `gain_then_cut`：先增肌，再减脂

优先条件：

- 用户已经相对较瘦，但对肌肉体积/力量明显不满意；
- 用当前 FFM 估算的目标体重会非常低，且不符合用户期望的最终外观；
- 用户把肌肉/力量放在近期体脂数字之前；
- 用户接受更长周期、缓慢增重和一定脂肪增长风险；
- 已有可靠训练执行能力，或先完成一段维持校准期；
- 没有要求先减重的健康/专业约束。

实施：从维持到保守盈余，追踪实际重量/次数/RIR 和慢速体重趋势；当力量/肌肉阶段目标完成、腰围/脂肪趋势触及用户预先确认的边界或依从性下降时，先回到维持，再进入减脂。

### 4.3 选择树

```text
用户真实目标是什么？
│
├─ 近期首要是降低脂肪/腰围/体重
│  └─ 能安全执行温和缺口 + 阻力训练？
│     ├─ 是 -> cut_first
│     └─ 否 -> maintenance / simplify / professional boundary
│
├─ 首要是“更好看、更强”，体脂数字只是代理
│  └─ 新手/回归者或体脂数据不可靠？
│     ├─ 是 -> maintenance_recompose
│     └─ 否 -> 当前已相对较瘦且肌肉体积不足？
│        ├─ 是，且接受长期增重 -> gain_then_cut
│        └─ 否 -> cut_first 或 maintenance_recompose，由偏好决定
│
└─ 同时要求快速减脂 + 快速增肌 + 显著增力
   └─ GoalFeasibility Proposal：修改优先级或期限
```

### 4.4 阶段切换条件

| 当前阶段 | 进入复核的触发 | 可选下一阶段 | 不允许的自动结论 |
|---|---|---|---|
| `cut` | 达到阶段趋势；连续恢复/表现下降；两次有界调整无响应；外观优先级变化 | `maintenance`、继续保守 cut、目标复核 | “代谢坏了所以必须增肌” |
| `maintenance_recompose` | 至少两个可比较周体重稳定；连续训练进展/停滞；腰围趋势和用户偏好明确 | `cut`、继续重组、`gain` | “体重没变所以无效” |
| `gain` | 体重趋势超上限；腰围/脂肪触及预先边界；训练没有相应进步；阶段目标完成 | 调低盈余、`maintenance`、之后 `cut` | “多吃一定长得更快” |
| `maintenance_break` | 预定结束日；饥饿/恢复和执行状态复核 | 原阶段、延长维持、目标复核 | “代谢已经重启” |

`ProductPolicy`：从 cut/gain 切换主目标必须让用户确认；自动模式最多提出 `review_goal`。进入新阶段前，默认用至少两个可比较周建立或复核维持基线；这是防振荡策略，不是生理硬门槛。

### 4.5 Agent 应怎样解释这项建议

合格表述：

> 你的目标更接近“降低体脂后仍有明显肩背和胸部体积”，而不只是达到 12%。按当前不确定的体成分估算，继续直接减到该百分比可能需要很低的目标体重；先用一段维持/增肌阶段提高训练表现，再减脂，可能更符合外观目标。但增肌需要更长时间，也可能增加一些脂肪。我们可以比较三条路径的预计阶段、权衡和复核点，由你选择。

不合格表述：

> 你的肌肉量不够，不能减到 12%；先增肌提高代谢，否则低碳会锁脂。

### 4.6 示例：100 kg、估算约 30% 体脂的多阶段路线

假设某用户 100 kg，设备估算体脂约 30%，则数学上的 FFM 约为 70 kg。**这不是已知真值**：BIA 个体误差可能很大，减脂过程中 FFM、糖原和水分也会变化。只为了帮助讨论路线，若暂时假设 FFM 保持 70 kg：

| 目标体脂估算 | 数学目标体重 | 用途 |
|---:|---:|---|
| 20% | `70 / 0.80 = 87.5 kg` | 第一阶段复核区间上沿示例 |
| 15% | `70 / 0.85 = 82.4 kg` | 第一阶段复核区间下沿示例 |
| 12% | `70 / 0.88 = 79.5 kg` | 长期方向示例，不是一次 cut 的强制终点 |

Agent 不能据此输出“必须从 100 kg 直接减到 79.5 kg”。更合理的阶段图是：

```text
Phase 1  Cut + resistance training
100 kg / 约30%（估算）
  ↓ 目标：先降低脂肪并尽量保留/增加训练表现
15–20% 复核区间（不是精确设备读数门槛）
  ↓
Gate A  维持校准与目标复核
  ├─ 新手仍在进步、腰围仍下降、恢复良好
  │    → Maintenance/Recomp；不必急着盈余增肌
  ├─ 已相对较瘦、肌肉/力量成为主优先、接受增重
  │    → Conservative Gain
  └─ 脂肪下降仍是最高优先，表现/恢复正常
       → 可继续保守 Cut，而非机械切增肌
  ↓
Phase 2  Maintenance/Recomp 或 Conservative Gain
  ↓ 目标：建立更多可验证的训练表现与肌肉阶段成果
Gate B  阶段完成、腰围边界、体重趋势或偏好复核
  ↓
Phase 3  Second Cut
  ↓ 以新的 FFM/体重/训练历史重新估算，不沿用旧目标体重
12%方向或用户确认的新终点
  ↓
Maintenance / 下一循环 / 目标结束
```

#### Phase 1：为什么通常先 cut

- 当前脂肪减少是明显需求，直接进入盈余会把长期终点推远；
- 阻力训练 + 足够蛋白可帮助保留 FFM；超重/肥胖人群的系统综述支持在饮食减重中加入抗阻训练。[Binmahfoz et al., 2025](https://pubmed.ncbi.nlm.nih.gov/40909191/)
- 新手或回归者可能在缺口中同时改善训练表现甚至增加部分瘦体重，但不能保证；Longland 试验说明这种重组“可以发生”，不是所有用户的结果承诺。[Longland et al., 2016](https://pubmed.ncbi.nlm.nih.gov/26817506/)
- 饮食默认是可持续的均衡缺口；碳循环只有在关键训练日需要、用户愿意承担复杂度且依从性良好时再提议。

Phase 1 的 exit/review conditions：

- 进入预先约定的 15–20% **估算复核区间**，或腰围/外观达到第一阶段目标；
- 两个趋势窗内体重/腰围、训练表现和日志支持继续 cut，则可继续，而不是强制在 20% 停止；
- 连续表现下降、高疲劳/饥饿、目标速度过快或安全信号出现，则提前转维持/安全复核；
- 两次有界调整仍没有高置信响应，停止继续砍热量并做完整审计。

#### Gate A：为什么中间不一定要热量盈余

如果用户在维持附近仍能加次数/重量、腰围仍改善、恢复良好，那么 `maintenance_recompose` 可能比立即进入 surplus 更符合多目标。只有当：

- 肌肉/力量已成为明确主目标；
- 当前脂肪范围被用户接受；
- 训练动作和负荷记录可靠；
- 用户接受更长周期与一定脂肪回升；
- 维持阶段显示训练进步需要更多能量或用户主动选择增肌；

才进入 `conservative_gain`。这组条件是 `ProductPolicy`，不是研究证明的唯一切换点。

#### Phase 2：增肌/重组的 exit conditions

- 预定力量、次数、周量或体型阶段目标达到；
- 体重增长超过保守趋势两个可比较周；
- 腰围/脂肪趋势触及用户事先确认的边界；
- 盈余增加但训练表现没有对应进步，先调低盈余或复核训练；
- 用户重新把脂肪下降设为主目标。

#### Phase 3：为什么必须重新估算

第二次 cut 前必须根据新的体重、腰围、同方法体脂趋势和实际训练历史生成新 revision。若 Phase 2 增加了 FFM，原先 `79.5 kg @ 12%` 的算术目标已经失效；若所谓 FFM 增加只是糖原/水分或设备误差，也不能把它当真实增肌。最终目标应由体型、表现、可持续性和用户偏好共同确认，而不是不断循环直到设备显示某个数字。

`SafetyBoundary`：12% 或更低不能作为跨性别、跨个体的默认目标或健康承诺。若进一步变瘦伴随持续疲劳、异常生殖/月经信号、反复伤病、明显表现下降、严重食物焦虑或其他低能量可用性风险，停止自动减脂路线并建议专业评估。

## 5. 联合方案：不同目标下训练与饮食怎样配合

以下数值沿用已有知识库的保守产品默认，不表示唯一最优处方。精确数值由版本化规则引擎生成，LLM 只解释。

### 5.1 新手或回归者：体型重组优先

**适合：**训练历史少、停训后回归、体脂相对较高、同时希望变瘦和变强，且没有极短期限。

**训练：**

- 以稳定动作学习和全身/上下肢基础阻力训练为主；
- 每个主要动作/肌群从低到中等工作量开始，不追求力竭；
- 使用次数范围与 RIR 双进阶，先建立实际重量和动作上下文；
- 加入可恢复的低至中强度有氧和日常活动，不把每次训练都做成 HIIT。

**饮食：**

- 维持附近或温和缺口；
- 蛋白按已有营养知识库设置；
- 选择均衡缺口或用户容易执行的低碳偏好，不默认碳循环；
- 训练日保证可执行的餐前/餐后供能。

**Agent 关注：**力量/次数是否进步、腰围/体重趋势、训练完成率、饥饿和恢复。若体重变化慢但腰围下降、表现提升，不应因为秤重而继续砍热量。

### 5.2 减脂保肌

**适合：**脂肪减少是明确主目标，同时希望保留力量和瘦体重。

**训练：**

- 阻力训练仍是主刺激，不创建所谓“燃脂次数区间”；
- 尽量保留可恢复的相对强度和关键动作暴露；
- 先删低优先级辅助组，再动关键主项；
- 有氧服务于心肺、偏好和能量预算；高量有氧与力量训练冲突时，优先调整频率、时长、模式或与下肢主训练的间隔。

并行有氧与抗阻训练并非天然互斥。Meta 分析显示整体肌肥大通常不会明显受损，但跑步、较高耐力频率/时长以及已训练者下肢力量可能更容易出现干扰。[Lundberg et al., 2022](https://pubmed.ncbi.nlm.nih.gov/35476184/) · [Petré et al., 2021](https://pubmed.ncbi.nlm.nih.gov/33751469/)

**饮食：**

- 从可持续缺口开始；越精瘦、训练程度越高、期限越长，默认越保守；
- 蛋白优先，脂肪保留底线，剩余给碳水；
- 均衡缺口是默认；低碳、碳循环作为偏好/供能排程选项；
- 不把 refeed 当自由放纵日，也不把 rest day 变成极低能量日。

**Agent 关注：**七日体重趋势、腰围、餐食完整度、训练表现、恢复、饥饿、用户可持续性。目标达成但体型外观不符合预期时，应评估测量误差和肌肉目标，而不是无限继续减脂。

### 5.3 增肌

**适合：**肌肉体积是主目标，用户接受缓慢体重上升和一定脂肪增长风险。

**训练：**

- 以可恢复周量、稳定动作和渐进超负荷为主；
- 先次数，再最小器材负荷，再在恢复允许时增加组数；
- 不要求每组力竭；单次泵感/酸痛不足以加量；
- 有氧用于健康和体能，避免无必要地挤占关键训练恢复预算。

**饮食：**

- 估算维持 `+5%` 左右作为现有产品默认，随后按至少两周体重趋势校准；
- 训练经验越高，盈余越保守；
- 蛋白达标后，用脂肪与碳水满足总能量；高量训练日优先分配碳水；
- 体重快速上涨而训练/肌肉指标没有相应进步时，先减少盈余，不用“脏增肌”。

### 5.4 增力且体重稳定

**适合：**力量是主目标，不希望明显增重或有体重级别/生活偏好限制。

**训练：**关键动作特异性和较高负荷暴露优先；已有训练者可做简单波动，但不需要复杂日变化。

**饮食：**维持到小盈余；蛋白充分；关键训练日前后保证供能。不因一次大重量训练自动增加周热量，也不把增力等同于必须增肌期。

### 5.5 恢复优先／非医疗“康复”

**适合：**普通肌肉酸痛、生活压力、睡眠下降、训练疲劳、停训后恢复，而不是已诊断伤病康复。

**训练：**根据已有 `RecoveryConstraint` 输出 `NORMAL / SLIGHT_REDUCTION / RECOVERY_FIRST / PAUSE_AND_CONFIRM`；只调整尚未执行内容。优先减少可选组、提高目标 RIR、改练不受影响肌群、缩短训练或设置恢复日。

**饮食：**保持蛋白和基本能量；训练量下降可以减少训练日碳水排程，但不自动创建激进缺口。持续限制且表现/恢复下降时，优先考虑回到维持而不是再加有氧。

**边界：**新发锐痛、关节痛、显著动作受限、术后、医生限制或系统性症状进入专业评估；Agent 不生成伤病康复动作处方。

## 6. 策略选择：均衡缺口、低碳、碳循环还是 diet break

| 策略 | 首选条件 | 不应使用的理由 | 退出条件 |
|---|---|---|---|
| 均衡能量缺口 | 默认减脂；餐饮环境复杂；新用户数据少 | “不够高级”“不够快” | 高质量依从性仍差，或用户明确偏好另一可持续结构 |
| 低碳偏好 | 用户本来就偏好低碳食物、饥饿控制更好、训练量可支持 | 为了“胰岛素归零”“防止代谢下降” | 高量训练下降、饮食单调/难执行、持续疲劳，或脂肪/纤维/微量营养结构不合理 |
| 训练供能型碳循环 | 周内训练需求差异明显；用户愿意管理不同日目标 | 为了独立加速减脂或“重置激素” | 复杂性降低依从性、低日变成极端限制、训练无收益 |
| Refeed（1–2 天维持附近） | 高需求训练、短期饥饿/饮食疲劳管理 | 为了补偿失控进食、重启代谢 | 引发过度进食、周预算失控或无主观收益 |
| Diet break（约 1 周维持） | 长期限制后的依从性/生活安排/训练质量恢复 | 为了保证更快减脂 | 用户希望继续、恢复没有改善、或维持期执行不清楚 |
| 生酮 | 用户知情且强偏好，并能接受训练表现和食物选择权衡 | 为了最大脂肪氧化、快速刷脂、通用增肌 | 训练下降、难坚持、安全/医疗上下文不适合 |

`ProductPolicy`：首版可实现前三种和 diet break Proposal；生酮不应作为自动推荐 preset。任何策略都必须先满足安全边界、蛋白目标、脂肪底线和周能量约束。

## 7. Strategy Library：可实现的联合阶段策略目录

`Strategy` 表示一段时间内训练、营养和恢复的联合方向，不是单日菜单，也不是 LLM prompt。每个实例必须符合统一合同：

```ts
interface PhaseStrategyDefinition {
  id: string;
  version: string;
  primaryGoal: string;
  evidenceClasses: EvidenceClass[];
  requiredInputs: string[];
  eligibility: string[];
  contraindications: string[];
  trainingDirection: string[];
  nutritionDirection: string[];
  recoveryDirection: string[];
  monitorMetrics: string[];
  dailyAllowedAdjustments: string[];
  dailyForbiddenAdjustments: string[];
  reviewCadence: string;
  exitCriteria: string[];
  nextPhaseCandidates: string[];
}
```

### 7.1 Catalog 总览

| Strategy ID | 核心用户/阶段 | 主目标 | 常见下一阶段 |
|---|---|---|---|
| `HF_CUT_RECOMP@1` | 脂肪较高的新手/回归者 | 减脂，同时建立训练能力并尽量保留/增加 FFM | `CUT_PRESERVE`、`RECOMP_MAINTAIN`、`MAINTENANCE_RECOVERY` |
| `CUT_PRESERVE@1` | 一般减脂、已有或正在建立阻力训练 | 以可持续速度减脂并保留力量/瘦体重 | 继续 cut、`MAINTENANCE_RECOVERY`、`RECOMP_MAINTAIN`、`LEAN_GAIN` |
| `FINAL_CUT@1` | 已较瘦、仍明确要求进一步减脂的有经验用户 | 更保守地降低脂肪并严格监测恢复/表现 | `MAINTENANCE_RECOVERY`、目标结束 |
| `RECOMP_MAINTAIN@1` | 新手/回归者、体脂目标不精确或多目标并重 | 体重大致稳定下提高训练表现、改善腰围/体型 | `CUT_PRESERVE`、`LEAN_GAIN`、继续 recomp |
| `MAINTENANCE_RECOVERY@1` | 阶段过渡、长期限制后、需重新校准 | 稳定体重与执行，恢复训练/饮食可持续性 | 原阶段、`RECOMP_MAINTAIN`、`LEAN_GAIN`、`CUT_PRESERVE` |
| `LEAN_GAIN@1` | 肌肥大优先且接受慢速增重 | 通过保守盈余与渐进训练增加肌肉 | 继续 gain、`MAINTENANCE_RECOVERY`、`CUT_PRESERVE` |
| `STRENGTH_STABLE@1` | 增力优先且偏好稳定体重 | 提高目标动作力量、维持体重或慢速增长 | 继续 strength、`LEAN_GAIN`、`MAINTENANCE_RECOVERY` |
| `RECONDITIONING@1` | 停训/低活动后回归 | 重建动作、容量和事实基线 | `RECOMP_MAINTAIN`、`CUT_PRESERVE`、`LEAN_GAIN`、`STRENGTH_STABLE` |
| `SPECIALIZATION_MAINTAIN@1` | 高级训练者的维持或专项块 | 维持全身、集中有限恢复预算到专项 | 继续专项、`MAINTENANCE_RECOVERY`、其他目标 phase |
| `POST_LOSS_CONSOLIDATE_GAIN@1` | 大幅减重后准备重组/增肌 | 先巩固维持，再用受控周均小盈余发展训练 | `RECOMP_MAINTAIN`、`LEAN_GAIN`、`CUT_PRESERVE` |
| `DIET_BREAK@1` | 能量限制中的短期计划性维持 | 改善依从性、饮食疲劳或训练排程 | 返回原 cut、`MAINTENANCE_RECOVERY`、目标复核 |
| `DELOAD_OVERLAY@1` | 任一训练阶段出现重复表现/恢复信号 | 暂时降低训练压力，不改变长期目标 | 回到宿主 phase、`MAINTENANCE_RECOVERY` |

体脂率不是 `HF`、`STANDARD` 或 `FINAL` 的唯一分类器。分类还需腰围/体重趋势、测量置信度、训练经历、减脂历史、恢复状态和用户目标；缺失时选择更简单、更保守的策略。

### 7.2 `HF_CUT_RECOMP@1`：高脂肪起点的新手/回归者

| 字段 | 定义 |
|---|---|
| Required inputs / eligibility | 成人；脂肪/腰围下降为主目标；无安全禁用；训练经历少或停训回归；能安排至少基础阻力训练；体脂可为低置信估算，不要求精确 |
| Training direction | 动作学习和稳定完成优先；每主要肌群低到中等起始周量；一般不力竭；次数→负荷双进阶；低/中强度有氧与日常活动逐步建立 |
| Nutrition strategy | 默认均衡、温和至中等缺口；蛋白优先、脂肪底线；不初始自动碳循环；从真实餐次和体重趋势校准 |
| Recovery strategy | 每日简短 check-in；单晚睡眠/设备异常不取消训练；高疲劳优先删可选组或改低强度活动 |
| Monitor | 七日体重趋势、腰围、餐食完整度、实际训练完成、同动作次数/重量/RIR、疲劳/酸痛、步数趋势 |
| Daily allowed | 动作简化/平替、目标 RIR 上调、删可选组、训练/休息日互换、在周预算内移动训练日碳水、基于剩余额度推荐下一餐 |
| Daily forbidden | 因单日体重砍热量；同时加抗阻量和 HIIT；用骨架估算重量/RIR；切换长期目标 |
| Review | 每两周趋势复核；约四周做阶段可行性复核（产品默认） |
| Exit | 达到第一阶段脂肪/腰围区间；新手进步适合转 recomp；连续恢复恶化；两次有界调整无响应；用户目标改变 |
| Next | `CUT_PRESERVE`、`RECOMP_MAINTAIN`、`MAINTENANCE_RECOVERY` |
| Evidence class | 抗阻训练在减重中保护 FFM 为 `EvidenceFact`；具体缺口、窗口与分流为 `ProductPolicy` |

### 7.3 `CUT_PRESERVE@1`：标准减脂保肌

| 字段 | 定义 |
|---|---|
| Required inputs / eligibility | 可靠体重趋势或可建立趋势；减脂是主目标；有可执行阻力训练；至少可记录主要餐次与训练完成 |
| Training direction | 保留关键动作与可恢复相对强度；减脂不自动改成高次数循环；需要降压时先删低优先级辅助组；有氧按偏好和恢复预算加入 |
| Nutrition strategy | 现有知识库默认约 `-10%` 至 `-20%` 起始；越精瘦/有经验越保守；蛋白与脂肪底线优先；碳水按训练需求分配 |
| Recovery strategy | 训练表现、主观疲劳、酸痛、睡眠趋势联合判断；穿戴信号只佐证 |
| Monitor | 每周体重变化率、腰围、饮食日志覆盖/估算不确定性、训练表现、饥饿、恢复和计划完成率 |
| Daily allowed | 在周预算内切换 day type、移动碳水、删可选训练内容、下一个安全边界减重/次数、下一餐推荐 |
| Daily forbidden | 每日改总热量；用皮质醇/胰岛素叙事解释平台；一个低恢复分触发整周 deload |
| Review | 通常两个可比较周后调整热量；每 4–6 周做阶段复核（产品默认） |
| Exit | 阶段目标达到；目标变化；表现/恢复持续下降；目标速度不可行；两次有界调整失败；安全边界 |
| Next | 继续本 phase、`MAINTENANCE_RECOVERY`、`RECOMP_MAINTAIN`、`LEAN_GAIN` |
| Evidence class | 缺口、蛋白和抗阻保肌为 `EvidenceFact`；调整量与窗口为 `ProductPolicy` |

### 7.4 `FINAL_CUT@1`：较低脂肪阶段的保守 final cut

| 字段 | 定义 |
|---|---|
| Required inputs / eligibility | 成人；用户明确知情选择；已有稳定训练和饮食记录；至少两个趋势窗；体脂只作同方法趋势；无低能量可用性/饮食障碍/医疗风险信号 |
| Training direction | 保留关键力量暴露；不追求额外周量增长；有氧只按可恢复预算；减少失败组和无必要高强度并行压力 |
| Nutrition strategy | 小于标准 cut 的保守缺口；较慢目标趋势；蛋白与脂肪底线；优先训练供能；可 Proposal diet break，但不承诺加速减脂 |
| Recovery strategy | 主观状态与训练表现权重提高；持续疲劳、异常生殖/月经/反复伤病等信号进入 Safety Gate |
| Monitor | 体重/腰围、同动作表现、饥饿/饮食焦虑、睡眠、疲劳、伤病/疾病频率、用户可持续意愿 |
| Daily allowed | 仅软降级、训练日碳水移动、下餐满足剩余蛋白/能量；允许主动休息 |
| Daily forbidden | 自动进一步扩大缺口；自动增加 HIIT；因目标日期绕过安全信号；推断激素 |
| Review | 每周健康/恢复审查；热量仍需趋势窗；阶段期限必须预定义并可提前结束 |
| Exit | 目标/外观达到；任何安全信号；表现/恢复持续下降；用户不再愿意；期限不可持续 |
| Next | `MAINTENANCE_RECOVERY` 或目标结束；不能直接循环更激进 cut |
| Evidence class | 精瘦/训练者慢速减重和低能量风险为 `EvidenceFact`；“final cut”准入和每日权限为 `ProductPolicy` |

### 7.5 `RECOMP_MAINTAIN@1`：维持附近重组

| 字段 | 定义 |
|---|---|
| Required inputs / eligibility | 新手/回归者，或体重稳定但腰围/力量都重要；用户不要求短期快速秤重；能执行渐进阻力训练 |
| Training direction | 稳定动作、双进阶、按恢复渐进周量；有氧以健康和偏好为主 |
| Nutrition strategy | 维持附近，或根据脂肪优先级使用极温和缺口；蛋白充分；不为制造变化而频繁改热量 |
| Recovery strategy | 支持训练连续性，避免所有目标同时加压 |
| Monitor | 4–6 周腰围/体重趋势、同动作表现、照片偏好（自愿）、计划完成、恢复 |
| Daily allowed | 训练组级调整、餐次和碳水排程、动作管理、恢复日 |
| Daily forbidden | 因一周体重不变断言失败；自动切 cut/gain |
| Review | 两周确认维持范围；至少 4–6 周判断体型/表现方向（产品默认） |
| Exit | 腰围无改善且减脂优先→cut；脂肪可接受且肌肉优先→gain；表现/依从性差→maintenance recovery |
| Next | 继续 recomp、`CUT_PRESERVE`、`LEAN_GAIN`、`MAINTENANCE_RECOVERY` |
| Evidence class | 新手可同时改善体成分有条件支持；具体人群预测仍是 `Unknown`，选择规则为 `ProductPolicy` |

### 7.6 `MAINTENANCE_RECOVERY@1`：维持与阶段过渡

| 字段 | 定义 |
|---|---|
| Required inputs / eligibility | cut/gain 之间；长期限制后的饮食/训练疲劳；需要校准真实维持；日程变化；用户主动请求 |
| Training direction | 维持关键动作技术和可恢复训练；按恢复 hold/deload，不追赶漏练量 |
| Nutrition strategy | 逐步或一次有界回到估算维持，随后用趋势校准；蛋白保持；碳水配合恢复训练；不称“反向饮食修复代谢” |
| Recovery strategy | 恢复睡眠/日程和主观状态；区分普通疲劳与 SafetyBoundary |
| Monitor | 两周体重稳定范围、饥饿、训练完成/表现、疲劳、日志完整度 |
| Daily allowed | 餐次排程、日类型调整、训练软降级、恢复任务 |
| Daily forbidden | 为“补偿”之前 cut 而无界增加热量；无确认切入 gain |
| Review | 通常至少两个可比较周；阶段时长按目的预定义 |
| Exit | 维持校准完成且用户/恢复适合进入下一主阶段；或需要专业评估 |
| Next | 原 phase、`RECOMP_MAINTAIN`、`LEAN_GAIN`、`CUT_PRESERVE` |
| Evidence class | 维持可用于计划与行为恢复有试验支持；具体长度/回加方法为 `ProductPolicy/Unknown` |

### 7.7 `LEAN_GAIN@1`：保守增肌

| 字段 | 定义 |
|---|---|
| Required inputs / eligibility | 肌肥大为主目标；用户接受慢速增重；无安全禁用；训练记录和器材上下文可用；最好有维持基线 |
| Training direction | 足够、可恢复的周量；动作稳定；次数→最小负荷→组数；不默认力竭 |
| Nutrition strategy | 现有产品默认从维持 `+5%` 左右开始；蛋白充分、脂肪底线、其余偏碳水；大盈余不作为快速增肌手段 |
| Recovery strategy | 监测多个肌群恢复、表现、睡眠和时间预算；疲劳时先调整训练压力，不用更多热量掩盖错误编程 |
| Monitor | 两周体重趋势、腰围、同动作次数/重量/RIR、实际周量、恢复、饮食执行 |
| Daily allowed | 训练日碳水上移、组间/下次 session 的双进阶动作、删可选组、下一餐满足剩余宏量 |
| Daily forbidden | 同时加重量/组数/降低 RIR；按体脂秤单次变化 cut；每天增加热量 |
| Review | 两周复核体重；4–6 周复核肌肉/训练阶段 |
| Exit | 体重/腰围趋势超边界；训练无对应进步；阶段目标达到；用户改目标；恢复恶化 |
| Next | 继续 gain、降低盈余、`MAINTENANCE_RECOVERY`、之后 `CUT_PRESERVE` |
| Evidence class | 蛋白/阻力/能量可用性为 `EvidenceFact`；盈余与速率为 `ProductPolicy`，最佳盈余为 `Unknown` |

### 7.8 `STRENGTH_STABLE@1`：稳定体重增力

| 字段 | 定义 |
|---|---|
| Required inputs / eligibility | 力量主目标；用户偏好体重稳定或只有小幅增长；目标动作与器材明确 |
| Training direction | 目标动作特异性、较高负荷但非默认力竭；主动作靠前；已有训练者可用简单波动 |
| Nutrition strategy | 维持到小盈余；蛋白充分；关键训练供能；不因大重量日自动 bulk |
| Recovery strategy | 重点看主项实际表现、疲劳与技术可控性；高强度有氧避免干扰关键下肢 session |
| Monitor | 主项负荷/次数/RIR、周体重、训练完成、恢复与日程 |
| Daily allowed | 在安全边界减负/减次数、调整辅助项、移动碳水、改期 |
| Daily forbidden | 无历史推算 1RM 百分比公斤数；用摄像头确认真实重量 |
| Review | 每两个可比 session 做负荷判断；每 4–6 周做 phase 复核 |
| Exit | 目标达成；需要肌肉量→lean gain；恢复/日程不支持→maintenance recovery |
| Next | 继续 strength、`LEAN_GAIN`、`MAINTENANCE_RECOVERY` |
| Evidence class | 较高负荷和特异性对力量为 `EvidenceFact`；周期结构为 `ProductPolicy` |

### 7.9 `DIET_BREAK@1`：短期饮食维持阶段

| 字段 | 定义 |
|---|---|
| Required inputs / eligibility | 当前处于能量限制；用户出现饮食疲劳/饥饿/日程压力或计划性训练需求；没有把它当失控进食许可 |
| Training direction | 保持或与宿主 phase 协调；可把需要肌耐力/专注的训练放在维持周，不要求加量 |
| Nutrition strategy | 回到估算维持；通常以增加碳水完成但保持蛋白和脂肪底线；餐次仍记录 |
| Recovery strategy | 观察饥饿、情绪、训练和执行恢复，不宣称激素重置 |
| Monitor | 体重水分变化、饥饿/满足、训练表现、计划执行、是否诱发过度进食 |
| Daily allowed | 餐次与碳水排程、训练软调整 |
| Daily forbidden | 把短期糖原/水重当脂肪；无界“cheat day”；承诺 RMR 修复 |
| Review/exit | 预定义结束日（常见一周是产品模板，不是最佳生理长度）；结束时返回原 cut 或转 maintenance review |
| Next | 宿主 cut、`MAINTENANCE_RECOVERY`、目标复核 |
| Evidence class | 饥饿/局部表现可能改善为有限 `EvidenceFact`；代谢/体成分优势为 `Unknown`；模板为 `ProductPolicy` |

### 7.10 `DELOAD_OVERLAY@1`：训练降载叠加层

它是 overlay，不取代宿主营养/目标 strategy。

| 字段 | 定义 |
|---|---|
| Eligibility | 至少两个可比较 session 的表现下降 + 一个独立支持信号，或用户主动请求/已知日程窗口 |
| Training direction | 减可选组、远离力竭、保留技术暴露；不默认完全停训 |
| Nutrition direction | 保持蛋白；仅在真实训练需求下降时调低训练日碳水；不创建更大缺口 |
| Recovery direction | 睡眠/疲劳/酸痛优先；到安全边界停止而非 deload 自行处理 |
| Monitor | 热身和正式组表现、疲劳/酸痛、完成率、用户恢复感 |
| Daily allowed | 进一步软降级、改其他肌群、休息、缩短训练 |
| Daily forbidden | 因单次 wearable 分数触发；自动补回删掉的训练量 |
| Exit | 实际恢复和表现支持返回；无改善则进入 `MAINTENANCE_RECOVERY` 或专业评估 |
| Evidence class | Deload 实践共识存在，但最佳时机/幅度是 `Unknown`；触发为 `ProductPolicy` |

### 7.11 `RECONDITIONING@1`：停训后的回归阶段

| 字段 | 定义 |
|---|---|
| Required inputs / eligibility | 曾训练但连续中断、近期活动显著下降，或用户主观认为“恢复训练”；旧 PR/周量存在但已经过期 |
| Training direction | 旧表现只作参考；降低起始组数和接近力竭程度；重新确认动作/器材/ROM；用 2–4 次可比暴露重建负荷和容量基线 |
| Nutrition strategy | 默认维持附近或按当前体重目标使用温和策略；不因为“肌肉记忆”直接大盈余；训练日保证基本供能 |
| Recovery strategy | 预期酸痛与异常疼痛分离；保留更多恢复间隔；单次酸痛不证明训练有效 |
| Monitor | 训练完成、RIR 误差、酸痛/动作限制、旧/新上下文差异、体重/饮食变化 |
| Daily allowed | 降负荷/组数、动作回退、延长恢复、替换器材、改期 |
| Daily forbidden | 从旧 PR 直接处方当前重量；连续追重；把初期快速进步外推为长期速率 |
| Review/exit | 至少 2–4 次可比暴露且恢复/完成稳定；然后按当前主目标进入 cut/recomp/gain/strength |
| Evidence class | 渐进阻力训练的一般原则为 `EvidenceFact`；回归窗口与降幅为 `ProductPolicy/Unknown` |

### 7.12 `SPECIALIZATION_MAINTAIN@1`：高级训练者维持/专项阶段

| 字段 | 定义 |
|---|---|
| Required inputs / eligibility | 多年可靠训练历史；明确专项动作/肌群/表现目标；一般能力只需维持；数据足以区分直接组和次要暴露 |
| Training direction | 把有限恢复预算集中到专项；其余肌群维持暴露；负荷/周量变化依动作特异表现；不由通用人群阈值推算 MRV |
| Nutrition strategy | 维持到与专项目标相符的小盈余；训练日供能；总热量由体重趋势而非训练“高级”标签决定 |
| Recovery strategy | 分专项局部疲劳与全身恢复；必要时 deload overlay；高级身份不能绕过安全信号 |
| Monitor | 专项目标表现、相关肌群直接组、非专项维持表现、体重/腰围、恢复和日程 |
| Daily allowed | 专项内负荷/RIR/组间调整、非专项删可选组、碳水移动、动作特异平替 |
| Daily forbidden | 同时提高所有肌群周量；把高级训练者模板套给缺少历史者；用通用 MEV/MRV 数字声称个体最优 |
| Review/exit | 4–8 周产品模板或目标事件；专项进步停滞、恢复预算冲突、主目标改变 |
| Evidence class | 特异性和周期组织对力量有支持；精确专项量与持续时间为 `ProductPolicy/Unknown` |

### 7.13 `POST_LOSS_CONSOLIDATE_GAIN@1`：大幅减重后的受控重组/增肌

相同的当前 `15%` 体脂估算不能推出相同策略。长期偏瘦的新手和从 30% 左右经过长期减重到 15% 的用户，在饮食疲劳、反弹风险、维持摄入置信度、训练历史和用户心理上可能完全不同。

| 字段 | 定义 |
|---|---|
| Required inputs / eligibility | 有明确大幅减重历史；当前脂肪范围可接受；准备重组/增肌；需要先校准维持；无安全信号 |
| Entry route | 必须先 `MAINTENANCE_RECOVERY` consolidation；至少两个可比较周评估七日均重、腰围、饥饿、餐食执行和训练恢复；不是从 cut 当天直接进入 surplus |
| Training direction | 继续渐进阻力训练；从实际 cut 末期可恢复周量重建；先恢复表现/容量，再决定加组；不因回到维持就同时大幅加量 |
| Nutrition strategy | 先维持；若训练日需求高，可训练日较高碳、休息日较低或维持，保持周均能量明确；进入 gain 时只用受控周均小盈余，依七日均重/腰围和训练表现校准 |
| Recovery strategy | 监测持续饥饿、饮食疲劳、睡眠、恢复和食物焦虑；把反弹史当风险上下文，不指责用户 |
| Monitor | 七日均重、腰围、力量/次数/RIR、实际训练量、饥饿、餐食完整度、过往反弹模式、用户对体重回升的接受度 |
| Daily allowed | 在周预算内移动训练日碳水、下一餐建议、训练组级调整；异常饥饿可提出 review |
| Daily forbidden | 单日体重回升触发 cut；把糖原/水重称为脂肪反弹；直接套“偏瘦新手高碳增肌”模板；无界盈余 |
| Review/exit | 两周体重/腰围趋势，4–6 周训练与阶段复核；体重/腰围超预先边界、训练无进步、饥饿/执行失稳时回维持；稳定且训练进展可转 `LEAN_GAIN` |
| Next | `RECOMP_MAINTAIN`、`LEAN_GAIN`、必要时 `CUT_PRESERVE`，但不得日级来回切换 |
| Evidence class | 减重后生理/行为补偿与 diet break 证据支持谨慎巩固；具体日碳水差、周盈余和时长为 `ProductPolicy/Unknown` |

这与长期偏瘦新手的差异：后者若脂肪范围可接受、没有长期限制/反弹史且增肌为主目标，可以更直接进入 `LEAN_GAIN`，把蛋白与脂肪底线后的较大能量份额分给碳水以支持训练；仍不需要固定“高碳克数”或大盈余。大幅减重后用户则先稳定维持与饮食行为，再决定是否进入小盈余。

### 7.14 Phase tactic catalog

下列 tactic 只能挂载到一个 active phase，不得独立成为 Goal：

| Tactic | 可挂载 phase | 触发 | 不改变什么 |
|---|---|---|---|
| `BALANCED_DEFICIT` | cut | 默认 | 长期目标、蛋白、训练主结构 |
| `LOW_CARB_PREFERENCE` | cut/maintenance | 用户偏好且训练可执行 | 不声称额外减脂优势 |
| `TRAINING_FUEL_CARB_CYCLE` | cut/maintain/gain | 周内训练需求明显不同、日志和依从可用 | 周能量、蛋白、脂肪底线 |
| `REFEED_DAY` | cut | 高需求训练或短期依从性用途 | 不“重启代谢”，不改历史 deficit |
| `CARDIO_REBALANCE` | cut/health | 有氧与关键训练/恢复冲突 | 不自动砍食物或加力量量 |
| `EXERCISE_SUBSTITUTION` | any training phase | 器材、日程、局部酸痛/动作可用性 | 不把新动作历史与旧动作合并 |
| `DELOAD_OVERLAY` | any training phase | 重复表现 + 恢复证据 | 不自动改长期营养目标 |

### 7.15 Strategy application：组合而不是 persona 套模板

最终应用对象应由四层组成：

```text
AppliedPhaseStrategy =
  BasePhaseStrategy
  + HistoryModifiers[]
  + CurrentStateModifiers[]
  + RiskGuardrails[]
```

#### BasePhaseStrategy

描述当前要完成的工作：`cut_preserve`、`recomp_maintain`、`lean_gain`、`strength_stable`、`maintenance_recovery`、`reconditioning` 或 `specialization`。

#### HistoryModifiers

| Modifier | 影响 |
|---|---|
| `NOVICE` | 动作学习、低起始量、负荷低置信；可能重组，但不保证 |
| `RETURNING_AFTER_LAYOFF` | 旧 PR 过期、重建基线、酸痛保护 |
| `POST_MAJOR_WEIGHT_LOSS` | 先维持巩固、保守盈余、关注饥饿/反弹史和体重回升体验 |
| `REPEATED_GAIN_CUT_HISTORY` | 审计过去各 phase 的真实响应，避免重复无效模板 |
| `ADVANCED_TRAINING_HISTORY` | 动作特异基线、专项/维持量、较慢变化预期 |
| `PAST_LOW_ENERGY_RISK` | 更高安全敏感度；可能禁止自动 deficit |
| `PROFESSIONAL_DIRECTIVE_PRESENT` | 专业限制优先，普通规则不能覆盖 |

#### CurrentStateModifiers

| Modifier | 影响范围 |
|---|---|
| `HIGH_ADIPOSITY_CONTEXT` | cut 可作为主方向，但不决定训练水平 |
| `LEAN_CONTEXT_LOW_CONFIDENCE` | 不依据体脂数进入 final cut；先改善测量/目标定义 |
| `FATIGUE_ELEVATED` | 只影响近期训练/恢复，除非跨窗持续 |
| `SCHEDULE_CONSTRAINED` | 缩短/改期/器材适配，不标记恢复差 |
| `GYM_EQUIPMENT_CHANGED` | 新动作上下文，冻结直接负荷进阶 |
| `DIET_ADHERENCE_LOW` | 简化和解决障碍，不进一步砍热量 |
| `WEIGHT_TREND_CONFOUNDED` | 延长观察，禁止 energy ratchet |

#### RiskGuardrails

安全、专业指令、最低宏量边界、变化上限、冷却窗口、目标切换确认、错误来源隔离和 Action Log。Guardrail 只能收紧普通策略权限，不能为了目标更快而放宽。

人群描述（“偏瘦”“skinny-fat”“高体脂”“高级训练者”）只是带时间戳的路由上下文，不是永久身份，也不能直接成为领域真值。每次阶段复核都重新求值 modifiers；历史原始事实不删除。

#### 同为当前约 15% 体脂，历史不同，Applied Strategy 不同

```text
Case A：长期偏瘦新手
  当前约15%（低/中置信）
  长期体重稳定、没有长期限制/反弹史、训练历史少
  目标：增加肌肉和力量
  → Base: LEAN_GAIN 或先 RECONDITIONING
  → History: NOVICE
  → Current: LEAN_CONTEXT_LOW_CONFIDENCE
  → 行为：保守盈余/维持校准，更多剩余能量可给碳水支持训练

Case B：从约30%大幅减重到当前约15%
  近期长期缺口、可能有高饥饿/饮食疲劳、维持需求未校准
  目标：接下来增肌，但担心反弹
  → Base: MAINTENANCE_RECOVERY
  → Route: POST_LOSS_CONSOLIDATE_GAIN
  → History: POST_MAJOR_WEIGHT_LOSS
  → Current: 依实际恢复/饥饿/趋势设置
  → 行为：先至少两个可比周维持巩固；训练日碳水排程；稳定后才周均小盈余
```

因此 Strategy Selection 不能接收 `bodyFat=15%` 后直接返回同一个模板。它必须读取 `WeightHistory / PhaseHistory / DietHistory / TrainingHistory`，并在解释中说出是哪些历史事实改变了应用策略。

### 7.16 人群/阶段路由矩阵

| 当前上下文（非永久标签） | 建议 Base/Route | 关键 modifier | 不能默认做什么 |
|---|---|---|---|
| 偏瘦新手，肌肉/力量优先 | `RECONDITIONING` 或 `LEAN_GAIN` | `NOVICE` | 仅因偏瘦就大盈余、固定高碳 |
| “Skinny-fat”新手，外观和腰围并重 | `RECOMP_MAINTAIN`，必要时温和 `CUT_PRESERVE` | `NOVICE + LEAN_CONTEXT_LOW_CONFIDENCE` | 仅看体脂秤选择 aggressive cut/gain |
| 高脂肪起点新手 | `HF_CUT_RECOMP → CUT/RECOMP` | `NOVICE + HIGH_ADIPOSITY_CONTEXT` | 直接 carb cycle、只做有氧、不做阻力 |
| 多轮 gain/cut 用户 | 当前目标 Base + 正式 route review | `REPEATED_GAIN_CUT_HISTORY` | 复制上次周期而不看真实响应 |
| 普通增肌用户 | `LEAN_GAIN` | training status modifier | 大盈余、每组力竭、每日调热量 |
| 普通增力用户 | `STRENGTH_STABLE` | exact exercise context | 无历史给精确公斤或强迫 bulk |
| 高级训练者维持/专项 | `SPECIALIZATION_MAINTAIN` | `ADVANCED_TRAINING_HISTORY` | 用新手周量或统一 MRV |
| 停训回归 | `RECONDITIONING` | `RETURNING_AFTER_LAYOFF` | 直接恢复旧 PR/旧周量 |
| 疲劳累积 | 宿主 phase + `DELOAD_OVERLAY`，必要时 maintenance | `FATIGUE_ELEVATED` | 单设备分数取消整个 phase |
| 大幅减重后准备增肌 | `MAINTENANCE_RECOVERY → POST_LOSS_CONSOLIDATE_GAIN` | `POST_MAJOR_WEIGHT_LOSS` | 与长期偏瘦者用同一 surplus 模板 |
| 有临床康复/专业限制 | 只执行 professional-directed constrained mode | `PROFESSIONAL_DIRECTIVE_PRESENT` | 诊断伤病、生成康复处方、越过限制 |

### 7.17 Strategy selection engine

选择优先级必须固定：

```text
1. SafetyBoundary / professional directive
2. User primary goal and explicit priority
3. Goal feasibility (deadline, training budget, dietary constraints)
4. Data quality and baseline maturity
5. Current phase continuity and minimum observation window
6. Body/waist trend + training status + phase history
7. Recovery and adherence constraints
8. Choose one PhaseStrategy
9. Optionally attach zero or more compatible tactics
10. Generate multi-phase route and review gates
```

冲突处理示例：

- 用户要快速降脂又要最大增肌：选择主优先级，另一项降为 preserve/secondary；不能生成同时 aggressive cut 与 lean gain。
- 用户体脂较高但新手：默认 `HF_CUT_RECOMP`，不是直接碳循环，也不是直接 gain。
- 用户已经较瘦、训练历史稳定、肌肉外观优先：可以 `MAINTENANCE_RECOVERY → LEAN_GAIN → CUT_PRESERVE`。
- 用户数据少：选择简单 provisional strategy，并生成采集计划；不因为“专业模式”而制造精确数字。
- 用户当前 phase 未走完观察窗：默认延续，单日 `DailyEvaluation` 只做局部变化。

Engine 输出：

```ts
interface StrategySelectionResult {
  activeStrategyId: string;
  status: "provisional" | "calibrated" | "review_required";
  route: Array<{ strategyId: string; purpose: string; entryGate: string; exitGate: string }>;
  attachedTactics: string[];
  evidenceSnapshot: DecisionFactRef[];
  explanation: RecommendationExplanation;
  missingInputs: string[];
  rejectedStrategies: Array<{ strategyId: string; reasonCode: string }>;
  reviewAt: string;
  requiresConfirmation: boolean;
}
```

### 7.18 Daily adaptation 与 Phase revision 必须分离

| 维度 | `DailyAdaptation` | `PhaseRevision` |
|---|---|---|
| 作用域 | 今天、下一组、下一次尚未执行任务 | 多周方向、能量水平、主目标、phase/tactic |
| 证据窗 | 当日状态 + 最近训练上下文 | 至少规定趋势窗 + 完整阶段事实 |
| 可改训练 | 目标 RIR、后续组、可选动作、改期/恢复日 | 周量、频率、阶段训练重点、deload overlay |
| 可改营养 | 下一餐、剩余额度、周预算内日类型/碳水移动 | 总能量、宏量策略、低碳/碳循环、diet break |
| 可改目标 | 不可 | 只能 Proposal，用户确认 |
| 权限 | mandate 内可自动执行低风险变更并通知/可撤销 | 默认 human-in-the-loop；安全暂停除外 |
| 冷却 | 下一安全边界或次日重新求值 | 未达到最小观察窗不得重复同向改动 |

关键不变量：某天睡差可以把今天从重腿改为轻量/恢复，但不能把整个 `LEAN_GAIN` 自动切成 `CUT`；当天多吃一餐会改变“还可吃多少”的账本和下一餐建议，但不能反向修改长期热量策略。

### 7.19 Deterministic metrics、tools 与硬转移规则

LLM 不直接读取一堆 Timeline 后“凭感觉”决定 phase。Application Engine 先调用确定性 metric tools 生成版本化结果，再调用 exit/transition tools。

#### Metric tools

| Tool | 必需输入 | 核心输出 | 关键边界 |
|---|---|---|---|
| `body_trend` | 同来源体重、时间/时区、测量条件；可选腰围和同方法体脂 | 7 日中心、周变化率、腰围趋势、`confidence/confounders` | 不同设备不静默拼接；体脂不作单点真值 |
| `training_trend` | 可比动作上下文、实际重量/次数/组、RIR、完成/停止事实 | 每动作与目标模式的 `improving/stable/declining/insufficient`、连续可比次数 | 计划组不是完成组；骨架不能补重量/RIR |
| `nutrition_adherence` | 每日餐次、宏量/热量、估算来源、漏记状态、用户主观执行 | 日志覆盖、餐次完整度、估算占比、目标范围命中、`confidence` | 不把缺日志当欺骗；不产生伪精确百分比真值 |
| `recovery_trend` | 主观疲劳/睡眠/酸痛/疼痛、训练表现、可选同源设备趋势 | 当前约束、跨日方向、支持/矛盾/缺失域 | 单一 wearable 不能硬暂停或切 phase |
| `phase_progress` | active strategy、阶段目标、上述趋势、开始/复核日期 | `on_track/off_track/goal_reached/insufficient`、证据窗口、未达项 | 只按 phase 定义的 metrics 评分，不做隐藏总分 |
| `goal_feasibility` | GoalContract、期限、当前趋势、训练/饮食/日程 guardrails | `feasible/needs_priority/needs_deadline_change/unsafe/insufficient` | 不承诺精确体脂或肌肉增长日期 |
| `forecast_goal_scenarios` | GoalContract、多阶段 route、当前趋势、执行历史、日程/饮食约束、计划性维持周 | strict/balanced/flexible 三种预计区间、假设、代价和重估日 | 不输出单点承诺；不使用固定 `7700 kcal/kg` 线性外推；安全上限不能被“严格模式”覆盖 |

推荐的统一 metric envelope：

```ts
interface MetricResult<T> {
  tool: string;
  version: string;
  evaluatedAt: string;
  window: { from: string; to: string; comparableDays: number };
  value: T;
  confidence: "insufficient" | "low" | "moderate" | "high";
  evidenceRefs: string[];
  confounders: string[];
  missing: string[];
}
```

#### Transition tools

| Tool | 行为 | 是否写状态 |
|---|---|---|
| `evaluate_phase_exit` | 读取 active strategy、metric results、用户请求、guardrails 和 Action Log，输出唯一 engine state 与 reason codes | 否，纯函数 |
| `propose_phase_transition` | 只在 `REVIEW_PHASE` 时生成 1–3 个 eligible next phase、before/after、预期权衡、缺失事实和复核日 | 只写 Proposal，不激活 |
| `confirm_transition` | 校验 Proposal 未过期、用户/授权主体确认、guardrails 仍成立；关闭旧 revision 并激活新 revision | 是，原子写入并追加 Action Log |

Engine state 只有四种：

```ts
type PhaseEvaluationState =
  | "CONTINUE"
  | "DAILY_ADJUST"
  | "REVIEW_PHASE"
  | "SAFETY_PAUSE";
```

- `CONTINUE`：phase 不变，TodayPlan 按原策略物化；
- `DAILY_ADJUST`：只允许 mandate 内、可撤销的今天/下一安全边界变化；
- `REVIEW_PHASE`：冻结新的自动 phase-level ratchet，允许生成转阶段/改目标 Proposal；
- `SAFETY_PAUSE`：停止相关自动训练/营养处方，执行安全提示或专业计划边界。

#### `evaluate_phase_exit@1` 硬规则优先级

以下阈值属于版本化 `ProductPolicy`，但在该规则版本内是确定性硬规则，不得让 LLM自由裁量：

```text
1. safety guardrail hit
   -> SAFETY_PAUSE

2. user explicitly requests review / changes primary goal
   -> REVIEW_PHASE immediately

3. critical data insufficient or conflicting
   -> CONTINUE or DAILY_ADJUST only
   -> evidence-based automatic phase switch forbidden

4. ordinary phase active < 14 days
   -> no outcome-based phase switch
   -> exceptions: safety, user request, professional directive, goal infeasible

5. goal_feasibility = unsafe
   -> SAFETY_PAUSE

6. goal_feasibility = needs_priority / needs_deadline_change
   or active goal/guardrail has become unreachable
   -> REVIEW_PHASE

7. two consecutive bounded changes of the same decision family
   completed their review windows with high-confidence no response
   -> REVIEW_PHASE; further same-direction ratchet forbidden

8. possible weight plateau
   -> do not label high-confidence plateau before 21 comparable days by default
   -> first run measurement/adherence/activity/recovery audit

9. phase exit criterion met or phase goal reached
   -> REVIEW_PHASE

10. acute/current facts need only local modification
   -> DAILY_ADJUST

11. otherwise
   -> CONTINUE
```

`14 days` 是普通阶段最小结果观察窗；`21 comparable days` 是首版把“平台”升级为高置信诊断的默认窗。二者作用不同：14 天可以支持一次有界热量/行为调整，21 天才支持平台相关的完整 phase review。月经周期、水分、旅行、训练变化、日志缺口等可把 21 天继续延长。

#### 一次一个 bounded change

每个 phase revision 记录 `decisionFamily`：

```text
energy_target | activity_target | resistance_volume | resistance_load
| cardio_dose | macro_distribution | schedule | phase_goal
```

普通 review 一次只能改变一个主要 `decisionFamily`。碳水在周预算内移动而总能量不变可作为低风险 tactic；但不能与减热量、加 HIIT 和加抗阻周量一起发生。Action Log 必须能查询“当前观察窗正在评估哪一次改变”，新变化不能覆盖它。

#### Phase switch 与 human-in-the-loop

- `propose_phase_transition` 不能直接激活 phase；
- 默认只有 `confirm_transition` 经用户确认后才能切换；托管权限也不能把 cut 自动变 gain、把 gain 自动变 cut 或改主目标；
- 用户主动改目标可以立即 review 并确认新的 provisional phase，不必等待 14 天；但数据不足必须展示在 Proposal，不能声称这是证据推导的最优切换；
- Safety pause 不等待普通确认才停止危险自动化，但恢复普通计划仍需要用户/专业边界允许；
- 确认时再次求值 Safety Gate、Proposal 版本、事实新鲜度和冲突；任一失效则拒绝提交并重新 review。

#### `evaluate_phase_exit` 输出合同

```ts
interface PhaseExitEvaluation {
  state: PhaseEvaluationState;
  reasonCodes: string[];
  activeStrategyRevisionId: string;
  metrics: Array<MetricResult<unknown>>;
  minimumWindowSatisfied: boolean;
  currentBoundedChange?: {
    decisionFamily: string;
    appliedAt: string;
    reviewNotBefore: string;
    response: "pending" | "responded" | "no_response";
  };
  noResponseCount: number;
  eligibleNextStrategies: string[];
  forbiddenActions: string[];
  requiresHumanConfirmation: boolean;
  rule: { id: "evaluate_phase_exit"; version: 1 };
}
```

### 7.20 多情景目标预测：严格、平衡与宽松路线

用户需要看到的不是“预计 11 月 3 日完成”，而是**在不同执行强度和生活弹性下，目标大概需要多久、需要付出什么、什么情况会使预测失效**。预测是计划工具，不是效果保证。

#### 三种情景不是三种生理定律

| Scenario | 含义 | 执行体验 | 适用限制 |
|---|---|---|---|
| `strict_aggressive` | 在安全和阶段规则允许范围内使用更快目标趋势、较窄执行区间和更高记录覆盖 | 餐食/训练计划更固定，偏差后不做惩罚性补偿，但需要较高持续投入 | final cut、低能量风险、恢复不良、数据不足或专业限制时禁用/降级 |
| `balanced` | 默认推荐；在效果、训练表现、恢复和生活之间取中间范围 | 允许正常外食/调整，保持主要周目标 | 大多数一般健身目标 |
| `flexible` | 使用较慢目标趋势、更宽餐食/日程范围和较少精确记录 | 用户不必每天完全命中，但仍需最低事实覆盖以便复核 | 适合长期可持续、旅行/外食多、严格记录负担高的用户 |

“严格”只代表选择了更高执行负担的方案，不代表用户品格更好；“宽松”也不是没有计划。三种情景都必须满足蛋白/脂肪/安全底线、训练最低有效刺激和恢复约束。

#### 预测输入

1. 当前体重、腰围和同方法体脂趋势及其误差；
2. 目标是体重、体脂区间、腰围、肌肉/力量里程碑还是组合目标；
3. 当前及后续 phase route，包括计划性 maintenance/diet break；
4. 过去的真实趋势、餐食记录覆盖、训练完成率和偏差模式；
5. 每周可训练时间、器材、外食/做饭能力、旅行和社会日程；
6. 当前恢复状态、安全 guardrails 与用户可接受的体重/腰围变化；
7. 预测置信度和最早重新校准日期。

用户尚无历史时，执行率只能来自用户选择和宽松先验，必须标 `provisional`。至少走完 14–21 个可比较日后，用真实结果替换先验；不能一直拿建档估算预测一年后的日期。

#### 减脂情景的首版速率带

以下仅作为 `forecast_policy@1` 的版本化 `ProductPolicy` 起点，不是所有人的科学临界值：

| 上下文 | Flexible | Balanced | Strict/aggressive |
|---|---:|---:|---:|
| 高脂肪起点、恢复和训练可执行 | 约 `0.25–0.50% BW/周` | 约 `0.50–0.75% BW/周` | 最高约 `0.75–1.00% BW/周`，需要更频繁复核 |
| 一般减脂保肌 | 约 `0.25–0.50% BW/周` | 约 `0.40–0.70% BW/周` | 仅在 guardrail 允许时接近上沿 |
| 较低体脂 final cut | 更慢、以表现/恢复为先 | 约 `0.25–0.50% BW/周` 的保守方向 | 默认禁用 aggressive |

预测器必须按体重变化动态重算绝对 kg/周，并把维持周、旅行、预计漏执行和阶段转换算进日历；不能用“目标减 15 kg ÷ 初始 1 kg/周 = 15 周”作为最终答案。

例如 100 kg、约 30% 体脂用户若先以 85 kg 附近作为第一阶段复核方向，纯速率算术可能分别落在约 15–60 周的很宽范围。真实展示应进一步加入前两周校准、可能的 maintenance、体重变轻后的目标速率变化及测量误差，形成类似：

```text
严格路线：约 18–26 周
  假设：高记录覆盖、每周训练和餐食结构较稳定、恢复持续允许
  代价：执行负担高；若训练表现/恢复下降则自动降级，日期后移

平衡路线：约 24–36 周
  假设：大部分周完成主要目标，保留正常外食和日程调整
  推荐原因：更容易维持训练质量和长期执行

宽松路线：约 36–60 周
  假设：只维持核心行为，允许更多未命中日和计划性维持期
  代价：趋势更慢、预测区间更宽，但不要求每天严格记录
```

上例只演示输出形式，不能作为所有 100 kg 用户的固定答案。

#### 增肌、增力、重组与康复不能套减重公式

- `LEAN_GAIN` 可以预测体重趋势和训练里程碑复核时间，但不能把体重增加直接称为肌肉增长；较快盈余只会提高体重/脂肪风险，不保证更快增肌。
- `STRENGTH_STABLE` 以动作重量、次数、RIR 和阶段目标生成范围，不承诺某日达到某个 1RM。
- `RECOMP_MAINTAIN` 优先输出 4–8 周复核窗口和判断条件，不伪造“X 周增肌 Y kg、减脂 Z kg”的精确日期。
- clinician-led rehab 只能展示专业计划提供的阶段/里程碑及执行趋势；MaxPower 不预测组织愈合或医疗清关日期。

#### 输出合同

```ts
interface GoalForecastScenario {
  scenario: "strict_aggressive" | "balanced" | "flexible";
  eligibility: "eligible" | "degraded" | "forbidden";
  estimatedWindow?: { earliest: string; latest: string };
  targetTrendRange: string;
  phaseRoute: Array<{ strategyId: string; expectedRange: string; reviewGate: string }>;
  executionAssumptions: string[];
  requiredBehaviors: string[];
  tradeoffs: string[];
  guardrails: string[];
  invalidationConditions: string[];
  confidence: "provisional" | "low" | "moderate" | "high";
  evidenceRefs: string[];
  productPolicyRefs: string[];
  recalibrateAt: string;
}
```

Agent 推荐其中一个情景时仍需输出 `RecommendationExplanation`：为什么适合当前用户、为什么另外两个更慢/风险更高、引用哪些研究方向、哪些速率和日期只是产品模型。用户可以选择另一情景；选择后形成 Goal/Strategy revision，并在后续真实趋势偏离时更新区间，而不是把“没按预测完成”归咎于用户。

## 8. 平台期诊断与动作状态机

### 8.1 “平台”进入规则

以下是 `ProductPolicy`，不是生理定律：

1. 不比较两个孤立体重点；优先每天或每周至少三次、相近条件称重的七日中位数/均值。
2. 一般需要至少两个可比较周才允许一次有界调整；默认要有 21 个可比较日，才把减脂/增肌趋势升级为高置信 `plateau` 并用于完整 phase review。
3. 月经周期、旅行、疾病、碳水/盐明显变化、刚开始训练或大酸痛等存在时，延长观察或把趋势标为低置信。
4. 没有足够摄入记录时，只能说“趋势没有按预期变化，原因不确定”，不能说“热量目标无效”。

### 8.2 六步诊断

```text
Step 0  Safety Gate
  -> 急性症状、饮食障碍风险、持续异常疲劳/生殖或骨健康信号：暂停自动调整

Step 1  Measurement Audit
  -> 称量频率/条件、设备、腰围、体脂方法、水分/盐/糖原/周期/肠内容物

Step 2  Intake & Adherence Audit
  -> 漏记餐次、外食估算、调味油/饮料/零食、份量漂移、日志完整度、主观执行难度

Step 3  Activity & Training Audit
  -> 实际步数/日常活动、计划与完成训练、有氧时长强度、近期训练量、表现与疲劳

Step 4  Trend Classification
  -> on_target | too_fast | too_slow | flat_high_confidence | insufficient_data | confounded

Step 5  One Bounded Proposal
  -> hold | simplify | calorie_change | activity_change | carb_redistribution | deload | maintenance_break | goal_review
```

### 8.3 决策矩阵

| 证据包 | 默认 Proposal | 禁止动作 |
|---|---|---|
| 数据不足或趋势受水分等混杂 | `hold`，请求最小缺失事实 | 砍热量、加有氧、宣称代谢异常 |
| 趋势偏慢且依从性低/日志不完整 | 简化餐食、份量和记录；解决障碍 | 用更低热量“惩罚”用户 |
| 连续两周高置信趋势偏慢，恢复和训练良好 | 热量减少 `min(5%, 200 kcal/day)` **或**小幅增加可持续活动，二选一 | 同时砍热量、加 HIIT、加力量周量 |
| 下降过快，或一周快速下降并伴疲劳/饥饿/表现下降 | 小幅增加能量，评估低能量可用性信号 | 赞美极端速度、继续加压 |
| 体重平台但腰围下降、表现提升 | `hold`，解释重组/水分可能性 | 只因体重不变就调整 |
| 高疲劳 + 多次训练表现下降 | 先 deload/减少有氧压力/维持热量；必要时 diet break | 继续减热量或加量 |
| 两次有界调整后仍无高置信响应 | 冻结自动 ratchet，进入完整策略复核 | 无限每两周再减 200 kcal |

这里的 `5%/200 kcal`、两周和“两次调整”均为可版本化 `ProductPolicy`。它们的目的在于避免振荡，而不是声称存在唯一正确的生理剂量。

### 8.4 NEAT 和运动补偿怎么处理

- 可穿戴设备的消耗热量不是能量支出的真值，不直接“吃回去”。
- 同一设备的步数/活动分钟可以作为行为趋势，不把设备品牌间数值直接拼接。
- 如果训练增加后日常活动明显下降，只解释为“总活动结构变化”，不推断身体故意阻止减脂。
- 优先恢复可持续步数/生活活动；不要为了补偿 NEAT 自动堆叠 HIIT。

## 9. 何时保持、调整、deload、diet break 或改目标

### 9.1 保持当前方案

满足任一条件时优先 `hold`：

- 目标趋势达成；
- 只有一周或数据不足；
- 体重不变但腰围/表现朝目标方向；
- 单次训练表现差、单晚睡眠差或单个穿戴信号异常；
- 计划刚调整，还没走完最小观察窗；
- 多来源冲突，无法确认事实。

### 9.2 调整热量或宏量

- 热量变化需要至少两个可比较周的高置信趋势，安全情形除外；
- 一次只改变一个主要能量变量；
- 蛋白一般不作为碳循环变量；
- 训练表现下降但体重下降符合目标时，先检查碳水排程、总训练压力和睡眠，而非立即提高/降低总热量；
- 低碳转均衡可以只移动碳水与脂肪比例，不改变周热量；解释中必须明确“这不是加速减脂，而是提高训练与执行质量”。

### 9.3 Deload

Deload 是训练压力管理，不是饮食作弊周。沿用训练知识库：至少两个可比 session 表现下降，加一个独立支持信号，才提出自适应 deload；单次睡眠/HRV/酸痛不能触发整周 deload。优先减辅助组和接近力竭程度，不默认完全停训。[Bell et al., 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/)

### 9.4 Diet break / 维持期

可以提出的条件：

- 多周饮食疲劳、饥饿或执行压力明显升高；
- 训练质量下降且总压力与缺口同向；
- 社交/旅行窗口使持续缺口不现实；
- 用户已处于长期限制，需要一个清晰的阶段边界；
- 完成减脂阶段，准备进入维持观察。

不能提出的唯一理由：`体重三天没变`、`皮质醇可能高`、`需要骗过身体`。

### 9.5 从减脂切到增肌/重组，或修改目标

Agent 可以**建议复核**，不能未经用户确认切换主目标。

#### 必须提示修改目标或期限

- 当前目标期限要求超过产品允许的保守减重速度；
- 用户要求精确体脂百分比，但测量方法不支持这种精度；
- 目标同时要求快速减脂、快速增肌、显著增力且训练/时间预算不足；
- 当前日程、器材或训练频率无法支撑声明的路径；
- 已触发安全边界。

#### 可以提出“维持/重组后再决定”

- 用户是新手/回归者，腰围下降且训练表现增长；
- 用户追求外观而非医学意义上的体重，当前体脂读数不可靠；
- 减脂继续推进但训练表现、恢复和可持续性持续恶化；
- 用户已经接近个人可持续下限，却仍对肌肉外观不满意。

#### 可以提出“转增肌”

- 用户明确把肌肉/力量表现升级为主目标；
- 至少一个正式复核窗口显示继续减脂与用户外观/表现优先级冲突；
- 用户接受体重缓慢上升和脂肪增长风险；
- 已先经过维持/稳定窗口或已有可靠维持基线。

#### 不能作为切换依据

- 仅凭“体脂低于/高于某数字”；
- 仅凭照片、BMI 或体脂秤；
- 仅凭一次平台；
- 仅凭 LLM 对用户“肌肉太少”的视觉判断；
- 因为两次策略没奏效就断言用户生理上无法减脂。

## 10. MaxPower Agent 的确定性决策框架

### 10.1 长期到每日的层级

```text
UserProfile + GoalContract + SafetyDirectives
        ↓
MultiPhaseRoute
  - ordered PhaseStrategy references
  - entry / review / exit gates
        ↓
Active AppliedPhaseStrategy
  = BasePhaseStrategy
  + HistoryModifiers
  + CurrentStateModifiers
  + RiskGuardrails
  - coordinated TrainingStrategy
  - coordinated NutritionStrategy
  - coordinated RecoveryStrategy
        ↓
Mesocycle / Active Phase + ReviewSchedule
        ↓
WeekPlan
        ↓
DailyEvaluation
  - facts / missing / conflicts / confidence
        ↓
TodayPlan
  - training tasks
  - energy/macros and meal budget
  - recovery/rest tasks
        ↓
Timeline facts from actual behavior
        ↓
Proposal → Human confirmation/mandate → New plan revision
```

长期目标生成多阶段路线；当前 Applied Phase 定义本阶段训练、营养、恢复的联合方向和允许变化范围。`TodayPlan` 是某天基于最新事实的实例，不能反过来无声重写当前 phase、多阶段路线或长期目标。

### 10.2 必需输入

#### 最小档案

- 成人确认、身高、当前体重；
- 主目标、优先级、期限与允许的体重方向；
- 训练经历、每周可训练次数/时长、器材与可用动作；
- 饮食偏好、禁忌/过敏声明、常见就餐方式；
- 用户主动披露的安全限制。

#### 训练事实

- 处方与真实完成分离；
- 动作、变式、器材、ROM/设置上下文；
- 用户确认重量、次数、工作组、RIR/RPE、失败/停止信号；
- 训练时长、计划偏差和主观 session 反馈；
- Rust Motion SDK 的骨架/运动分析只作可见动作事实，不能推出真实重量、疼痛、肌肉激活或精确 RIR。

#### 营养事实

- 每日餐次列表及每餐食物/份量/估算来源；
- 已摄入与目标热量、蛋白、碳水、脂肪；
- 日志完整度、用户确认、外食/拍照估算的不确定范围；
- 体重与腰围趋势；
- 食物推荐的地区、预算、做饭/外卖/餐馆可用性属于个性化约束，不属于营养事实。

#### 恢复事实

- 当日疲劳、主观睡眠质量、目标肌群酸痛、疼痛/动作限制、生活压力/可用时间；
- 睡眠总时长与规律；
- 同人同来源的 HRV/RHR 趋势只作佐证；
- 日程可改变可执行性，不能被推断为生理恢复。

### 10.3 数据质量状态

每个输入必须显式区分：

```text
known | estimated | user_confirmed | device_observed
missing | stale | partial | conflicting | not_supported | permission_denied
```

缺失不能编码为 0；估算不能升级成事实；LLM 补全不能写入 Timeline。

### 10.4 最小观察窗

以下为首版 `ProductPolicy`：

| 决策 | 最小证据窗 | 例外 |
|---|---|---|
| 下一组重量/次数 | 当前已完成组，在组间安全边界 | 停止信号立即暂停 |
| 下一次同动作负荷进阶 | 至少两个可比 session 达到目标 | 明显过重可立即回退 |
| 当天恢复降级 | 当日新鲜主观事实；设备只能佐证 | 安全事实立即暂停 |
| 周量增减 | 至少两个可比较暴露 + 完整完成记录 | 用户明确修改或安全降级 |
| 热量调整 | 通常两个可比较周 | 下降过快并伴不适可提前增加能量 |
| 碳水排程变化 | 可在下一个未执行日 Proposal | 不改变周能量时权限较低 |
| Deload | 两次表现下降 + 一个独立支持域 | 用户主动请求可提前 |
| Diet break | 跨周饮食疲劳/恢复/日程证据 | 用户可主动选择 |
| 主目标切换 | 至少一次正式阶段复核，通常两个趋势窗 | 安全边界或用户主动改变目标 |

### 10.5 规则求值顺序

```text
1. SafetyGate
   命中 -> stop/pause，禁止普通策略覆盖

2. GoalFeasibility
   检查目标、期限、可执行训练/饮食预算

3. DataQualityGate
   过滤 stale/conflict/estimated，形成 missing facts

4. LongTermStrategy
   选择 hypertrophy / strength / fat_loss_preserve / maintain_recompose

5. PhaseState
   normal / intensification / deficit / maintenance_break / deload / transition

6. DailyRecoveryEvaluation
   NORMAL / SLIGHT_REDUCTION / RECOVERY_FIRST / PAUSE_AND_CONFIRM

7. TrainingDecision
   hold / add_rep / load_step / reduce_load / remove_optional_set / substitute / rest

8. NutritionDecision
   hold / redistribute_carbs / simplify / bounded_energy_change / maintenance_break

9. ConflictResolver
   检查训练与营养是否同时增加压力；冲突时选择保守动作

10. Proposal + Explanation + Human-in-the-loop
   保存 before/after、事实快照、规则版本、权限和撤销边界
```

### 10.6 联合压力预算规则

`ProductPolicy`：同一复核窗口内，训练和饮食引擎不能各自独立地把压力推高。

禁止组合：

- 同周自动减少热量 + 增加 HIIT + 增加抗阻周量；
- 增加主项重量 + 增加组数 + 减少目标 RIR；
- 训练降载同时把饮食改成更激进缺口；
- 低碳日绑定高量腿部/全身训练，却不披露供能权衡；
- 恢复信号恶化时以“加练提高代谢”作为默认动作。

允许组合：

- 热量不变，只把更多碳水移到高需求训练日；
- 减少低优先级训练组，同时维持蛋白和总能量；
- 平台且恢复良好时，只选择小幅热量变化或活动变化之一；
- diet break 期间维持蛋白并保持可恢复的训练技术暴露。

### 10.7 反漂移规则

1. **LLM 不拥有数值处方权。**数值由规则引擎/计算器生成，LLM 只能选择已授权 tool、解释结果或请求信息。
2. **计划、事实、估算分层。**计划不能变成已完成事实，骨架观察不能变成用户真实重量或疼痛事实。
3. **冻结证据快照。**每个 Proposal 保存评估时的输入 ID、时间、来源、置信度和规则包版本。
4. **单主变量变化。**普通复核一次只改变一个主要训练或能量压力变量。
5. **冷却窗口。**变更后未达到最小观察窗不得再次同向调整。
6. **变化上限。**热量、组数、重量和有氧变化都受 mandate 与规则包上限约束。
7. **冲突默认保持。**关键来源矛盾或数据不足时输出 `hold/ask`，不能选择对目标最激进的解释。
8. **不改写历史。**新数据可生成更正/替代事实，但过去决策保留当时依据。
9. **目标切换必须确认。**托管模式可以在授权范围内调整每日计划，但不能自动把减脂主目标切成增肌。
10. **失败升级为复核。**两次有界调整没有效果时停止 ratchet，进入策略复核，而不是继续同方向迭代。
11. **安全规则优先级固定。**LLM、用户普通 mandate 或增长目标不能覆盖 Safety Gate。
12. **每个建议可撤销。**撤销创建新的反向 revision，不删除原 Action Log。

### 10.8 推荐的类型

```ts
type EvidenceClass =
  | "evidence_fact"
  | "product_policy"
  | "unknown"
  | "safety_boundary";

interface DecisionFactRef {
  factId: string;
  kind: string;
  observedAt: string;
  provenance: "user" | "device" | "rust_motion_sdk" | "derived";
  quality: "known" | "estimated" | "partial" | "stale" | "conflicting";
}

interface AdaptiveProposal {
  proposalId: string;
  scope: "next_set" | "next_session" | "today" | "week" | "phase" | "goal";
  decision:
    | "hold"
    | "add_rep"
    | "increase_load"
    | "reduce_load"
    | "remove_set"
    | "rest_day"
    | "redistribute_carbohydrate"
    | "change_energy"
    | "diet_break"
    | "deload"
    | "review_goal";
  before: unknown;
  after: unknown;
  triggeringFacts: DecisionFactRef[];
  corroboratingFacts: DecisionFactRef[];
  contradictingFacts: DecisionFactRef[];
  missingFacts: string[];
  evidenceClasses: EvidenceClass[];
  explanation: RecommendationExplanation;
  rulePack: { id: string; version: string };
  confidence: "low" | "moderate" | "high";
  reviewNotBefore: string;
  requiresConfirmation: boolean;
  reversible: true;
}
```

## 11. 用户解释合同

每个计划、阶段选择、训练/饮食/恢复调整都必须携带同一次决策生成的结构化 `RecommendationExplanation`。LLM 可以把它改写成适合新手或专业用户阅读的语言，但不能新增事实、理由或文献。

### 11.1 必须回答的问题

1. **长期方向是什么？**例如“当前处于 12 周减脂保肌阶段的第 4 周”。
2. **今天/本周发生了什么变化？**列出真实事实，不写隐含推断。
3. **为什么这些事实足以或不足以调整？**说明窗口、冲突、缺失和置信度。
4. **具体改了什么、没改什么？**例如“总热量不变，只把 45 g 碳水移到腿部训练日”。
5. **预期观察什么，而不是承诺什么？**例如“观察未来两次训练完成度和下周体重趋势”。
6. **何时再评估？**不能每天反复改同一个长期变量。
7. **替代方案是什么？**例如热量小幅调整与步数恢复二选一。
8. **用户如何确认、修改、拒绝或撤销？**必须链接 Action Log 和上一版本。
9. **研究证据支持什么、不支持什么？**引用与当前 claim 直接相关的来源，并展示适用人群和局限。
10. **哪些只是产品规则？**把观察窗、阈值、默认调整幅度明确标为 `ProductPolicy`，不能伪装成论文结论。

### 11.2 解释来源必须分层

计划卡不能把“你的事实”“确定性规则”和“普遍研究证据”混成一句话：

| 层 | 回答的问题 | 来源 |
|---|---|---|
| `UserEvidence` | 为什么这次建议适合这个用户 | Profile、Timeline、Workout、Meal、Recovery 和 metric result 的不可变 refs |
| `RuleReason` | 哪条硬规则把结果求值为 continue/adjust/review/pause | 版本化 RulePack、reason code 和 before/after |
| `ResearchEvidence` | 为什么这一类方法在相似人群中有合理依据 | 本地审核过的 Citation Registry |
| `Uncertainty` | 哪些事实缺失、估算或无法从 App 判断 | Metric envelope 的 confidence/confounders/missing |
| `Alternative` | 为什么没有选择另一种方案 | 被拒策略、冲突规则和用户优先级 |

例如“选择大幅减重后的维持巩固”应拆成：

- `UserEvidence`：用户近期结束长期缺口、七日均重仍受回补水分影响、饥饿较高，训练表现尚未稳定；
- `RuleReason`：命中 `POST_MAJOR_WEIGHT_LOSS` modifier 和 `MAINTENANCE_BASELINE_REQUIRED`；
- `ResearchEvidence`：diet break/维持阶段可用于依从性和训练恢复，但没有稳定证据证明会加速脂肪下降；
- `Uncertainty`：真实维持热量尚未校准；
- `Alternative`：暂不选择直接小盈余增肌，因为体重/腰围和训练基线仍不稳定。

### 11.3 文献引用必须来自本地 Citation Registry

LLM 禁止自行生成 DOI、PMID、作者、标题或 URL。知识库构建阶段把审核过的文献登记为结构化记录，规则和策略通过 `claimId/evidenceId` 引用：

```ts
interface EvidenceCitation {
  evidenceId: string;
  claimId: string;
  evidenceClass: "position_statement" | "systematic_review" | "meta_analysis" | "rct" | "controlled_trial" | "observational";
  title: string;
  authorsOrOrganization: string;
  year: number;
  doi?: string;
  pmid?: string;
  canonicalUrl: string;
  supportedClaim: string;
  population: string;
  applicability: "direct" | "partial" | "indirect";
  limitations: string[];
  lastReviewedAt: string;
}

interface RecommendationExplanation {
  summary: string;
  userEvidence: Array<{ factRef: string; statement: string; quality: string }>;
  ruleReasons: Array<{ ruleId: string; version: string; reasonCode: string; statement: string }>;
  researchEvidence: Array<{
    claim: string;
    citationRefs: string[];
    evidenceClass: EvidenceClass;
    applicability: "direct" | "partial" | "indirect";
    caveat: string;
  }>;
  alternatives: Array<{ option: string; rejectedBecause: string }>;
  uncertainty: string[];
  expectedObservation: string[];
  reviewAt: string;
}
```

引用规则：

1. 每个可验证的研究 claim 至少链接一个直接支持该 claim 的来源；不能用“蛋白有助于增肌”的论文支持“本用户明天应增加 150 kcal”。
2. 优先组织立场、系统综述/Meta 和随机试验；竞品、博主和论坛只能作为 `CompetitorPrecedent`，不能作为有效性证据。
3. 文献只支持群体方向，不替代个体事实。个体调整仍由 metric tools 和 RulePack 决定。
4. 证据间冲突时同时保留，并把 applicability/confidence 降级；不能只挑支持当前建议的一篇。
5. `ProductPolicy` 可以引用形成其方向的研究，但必须明确具体阈值或窗口由产品选择。
6. Citation Registry 随 RulePack 版本冻结；旧 Action Log 必须仍能还原当时使用的标题、结论和版本。
7. 离线时仍展示本地保存的标题、作者/组织、年份、supported claim 和局限；联网后才打开 DOI/PubMed 页面，显示引用不依赖网络。

### 11.4 UI 渐进披露

计划卡默认只显示不会淹没新手的信息：

- `为什么这样安排`：2–4 条与用户直接相关的事实；
- `这次改变`：before/after 和没有改变的部分；
- `何时复核`：观察什么、复核日期；
- `依据 · N`：展开后显示规则标签、文献标题、年份、适用人群和局限；
- `其他方案`：展示 1–2 个候选及未选择原因。

专业模式可以展开完整 metric window、reason codes、RulePack/Citation Registry 版本和 Action Log；普通模式仍使用同一结构化 artifact，只减少展示密度，不能换成一套更模糊的理由。

### 11.5 合格与不合格示例

合格示例：

> 过去 21 个可比较日的七日均重和腰围都低于本阶段预期变化，18/21 天餐食记录完整，训练表现与恢复没有下降，因此命中“高置信平台复核”。建议只把每日目标减少 150 kcal，蛋白和训练计划保持不变，两周后复核。150 kcal 是防止连续加码的产品调整幅度，并不是论文规定值。研究支持持续能量缺口决定长期脂肪趋势，但不同宏量结构没有稳定的独立减脂优势。外食份量仍是估算，所以本建议置信度为中等。另一方案是保持热量并恢复日常步数，两项不能同时自动执行。［依据：ISSN diets and body composition, 2017；Thomas et al., adherence and plateau model, 2014］

不合格示例：

> 你的皮质醇太高导致不燃脂；明天开始低碳日并加两次 HIIT。

## 12. SafetyBoundary

### 12.1 不自动生成或修改减重/宏量处方

- 未满 18 岁；
- 怀孕、哺乳，或备孕同时要求减重；
- 当前/疑似饮食障碍、催吐、泻药/利尿剂滥用、强迫性限制或暴食清除行为；
- 糖尿病或使用降糖药、肾/肝/内分泌等会显著受饮食影响的疾病；
- 减重药物、减重手术或医疗饮食正在由专业人员管理；
- 用户要求脱水、极端禁食、快速做体重或其他危险方法；
- 专业人员已有冲突指令。

### 12.2 暂停训练自动调整并建议及时专业评估

- 胸部不适、晕厥/严重眩晕、异常呼吸困难、意识异常；
- 新发锐痛、明显关节痛、显著动作限制；
- 不明原因快速体重变化；
- 持续疲劳与表现下降并伴生殖/月经、骨健康、反复伤病等信号；
- 用户表达严重食物焦虑或无法满足基本进食。

产品可以记录并导出事实，不能把这些信号诊断为 REDs、过度训练、皮质醇异常或具体伤病。

### 12.3 支持 clinician-led rehab plan，但不提供医疗康复处方

当用户已经获得物理治疗师、运动医学医生或其他合格专业人员的康复计划时，MaxPower 可以进入 `CLINICIAN_DIRECTED_REHAB_SUPPORT` 模式。这是受约束的计划执行/记录能力，不是本产品自行选择的 fitness phase。

允许：

- 导入或由用户录入专业计划、动作、频率、负荷/ROM/疼痛停止规则、复诊日期和来源；
- 把专业限制设为高优先级 guardrail，锁定普通 Agent 不得改写的字段；
- 安排日程、提醒、展示专业人员规定的动作说明；
- 记录用户实际完成、主观反应、疼痛/动作限制和 Rust Motion SDK 的可见运动事实；
- 在专业计划明确给出的范围内，例如“无痛且完成两次后增加 1 组”，执行或提出有审计的 Proposal；
- 把偏差、停止信号和趋势整理成报告供用户带回专业人员；
- 专业人员更新指令后创建新 revision，历史版本保留。

禁止：

- 诊断组织损伤、疾病或恢复阶段；
- 自行选择伤病康复动作、负荷、ROM、测试或回归运动标准；
- 因骨架看起来正常就覆盖疼痛或专业限制；
- 超出专业计划授权范围自动进阶；
- 把普通训练规则、竞品建议或 LLM 推断当成医疗指令；
- 在胸痛、晕厥、异常呼吸困难、新发锐痛等情况下生成绕过方案。

如果只有用户说“我在康复”而没有专业计划，产品只能提供一般活动记录、生活管理和就医/专业评估提示；不能生成 clinician-led rehab plan 的替代品。

## 13. 明确未知

1. 健康成年人达到或维持某个精确体脂率所需的最低肌肉量。
2. 某个体脂百分比对不同性别、年龄、测量方法和个人一定安全或可持续。
3. 普通力量训练者低碳/碳循环的最佳克数和训练日差额。
4. Carb cycling 在等周能量与蛋白条件下是否对体脂有独立优势；目前没有高确定性支持。
5. Diet break/refeed 的最佳持续时间、频率，以及谁能获得代谢或体成分优势。
6. 从 App 数据准确估算能量可用性、皮质醇、瘦体重变化或真实 TDEE。
7. 对个体而言平台中适应性产热、NEAT、漏记和水分各自贡献多少。
8. 何种训练疲劳阈值应对应多少热量、碳水、组数或 RIR 变化。
9. 何时从减脂切换增肌存在唯一最优点；这是偏好和多目标决策，不是单一生物阈值。
10. 消费级骨架/视频能否跨动作、跨设备可靠预测 RIR、疲劳、疼痛或实际负荷；当前不能作为事实使用。

## 14. 对 MaxPower MVP 的直接建议

首版 RulePack 应覆盖本研究 Catalog 的全部一般健身阶段与路由，包括偏瘦新手、高脂肪起点、skinny-fat 重组、多轮 cut/gain、大幅减重后巩固、普通增肌/增力、高级专项、停训回归、diet break、deload 和 maintenance/recovery。实施可以按依赖顺序分批接线，但不能以“后续扩展”为理由让某类用户落入错误的通用模板。

完整闭环应包含：

1. `GoalContract`：主目标、期限、优先级、保守性、允许的体重方向。
2. `LongTermStrategy`：训练、营养、恢复三份协调策略和复核日期。
3. `TodayPlan`：训练任务、每日热量/三大营养素、餐次与剩余额度、恢复任务。
4. `Timeline`：真实训练组、餐食、体重/腰围、恢复 check-in 和来源。
5. `DailyEvaluation`：只做当日训练/恢复可行性，不重写长期策略。
6. `PeriodicReview`：按可比较窗口评估体重、饮食执行、训练表现和恢复。
7. `AdaptiveProposal`：有界变更、解释、确认、撤销和 Action Log。
8. Deterministic tools：`body_trend / training_trend / nutrition_adherence / recovery_trend / phase_progress / goal_feasibility / forecast_goal_scenarios / evaluate_phase_exit / propose_phase_transition / confirm_transition`。
9. Knowledge tools：`search_local_knowledge / get_strategy_definition / get_evidence_for_claim / compare_strategy_options / research_external_options / save_knowledge_candidate`。

RulePack 至少注册：

- `HF_CUT_RECOMP@1`
- `CUT_PRESERVE@1`
- `FINAL_CUT@1`
- `RECOMP_MAINTAIN@1`
- `MAINTENANCE_RECOVERY@1`
- `LEAN_GAIN@1`
- `STRENGTH_STABLE@1`
- `RECONDITIONING@1`
- `SPECIALIZATION_MAINTAIN@1`
- `POST_LOSS_CONSOLIDATE_GAIN@1`
- `DIET_BREAK@1`
- `DELOAD_OVERLAY@1`

以及 `HistoryModifiers / CurrentStateModifiers / RiskGuardrails`、多阶段 Route、Daily/Phase 两层求值和 Action Log。碳循环、低碳偏好、refeed 与 cardio rebalance 是 tactic，不是缺少某个 phase 时的替代模板。

不需要在 MVP 自动推荐：生酮、极低碳、极低热量、竞技备赛、自主医疗康复处方或按皮质醇/激素调整。首版可以管理 clinician-led rehab plan 的执行、记录、专业限制和回传报告，但不得自行诊断或改写专业处方。

## 15. 本地知识库与联网研究架构

MaxPower 客户端应内置可离线使用的本地知识库，同时允许 Agent 在用户发起讨论或本地知识不足/过期时联网查询其他方案。两者不能具有相同权威：**本地审核内容可以参与确定性策略求值；联网结果默认只能作为候选知识和解释材料。**

### 15.1 本地知识库不是一堆 Markdown

Markdown Wiki 适合人类阅读，但 Agent 的策略能力需要四层分离：

| 层 | 内容 | 是否可以直接改变计划 |
|---|---|---|
| `KnowledgePack` | 研究综述、来源元数据、民间 claim 判定、适用人群和未知 | 否 |
| `CitationRegistry` | 结构化论文/共识记录、supported claim、局限和更新时间 | 否，只提供引用 |
| `StrategyCatalog` | 本文定义的 phase、tactic、modifier、guardrail 和组合关系 | 只定义候选能力 |
| `RulePack` | 版本化 metric、硬阈值、优先级、允许动作和测试 fixture | 是，必须经过 Application Engine/HITL |

本地存储首版不需要引入复杂向量数据库。可以使用随 App 发布的结构化 JSON/SQLite 表，加 SQLite FTS 做 claim、策略、动作和来源检索；语义 embedding 可以作为以后可替换的索引 Adapter，不能成为唯一检索路径。

### 15.2 本地知识工具

```ts
interface KnowledgeQuery {
  query: string;
  goalContext?: string;
  strategyContext?: string;
  filters?: {
    evidenceClass?: string[];
    population?: string[];
    updatedAfter?: string;
  };
  limit: number;
}

interface KnowledgeHit {
  knowledgeId: string;
  kind: "claim" | "strategy" | "rule_explanation" | "citation" | "unknown";
  title: string;
  summary: string;
  applicability: "direct" | "partial" | "indirect";
  evidenceRefs: string[];
  rulePackRefs: string[];
  limitations: string[];
  version: string;
}
```

| Tool | 用途 | 边界 |
|---|---|---|
| `search_local_knowledge` | 按目标、阶段、claim 和人群检索本地知识 | 返回 refs，不生成新事实 |
| `get_strategy_definition` | 读取完整 phase/tactic/modifier/guardrail 合同 | 只读；调用者不能覆盖字段 |
| `get_evidence_for_claim` | 返回直接支持、反对或不确定的 Citation records | 必须同时返回适用人群和局限 |
| `compare_strategy_options` | 用同一用户事实比较 2–3 个已注册策略 | 比较不等于激活；保存 rejected reasons |
| `get_rule_explanation` | 把 reason code 映射为用户解释、ProductPolicy 与证据 refs | 不允许 LLM重写规则含义 |

离线 Agent 可以仅依赖这些工具完成建档、阶段路线、今日计划、解释、引用和调整建议。

### 15.3 联网查询是 Candidate Discovery，不是动态热更新规则

联网查询适用于：

- 用户问“还有没有其他做法”；
- 本地条目明确标为 `Unknown`；
- 引用超过复审日期；
- 新的正式组织指南或系统综述可能改变现有结论；
- 用户询问地区性饮食、器材、餐馆/外卖或当前可购买产品。

推荐工具：

| Tool | 输出 | 是否进入计划权威层 |
|---|---|---|
| `research_external_options` | 带 URL、作者/组织、日期、来源类型、摘要、支持/反对 claim、适用性和抓取时间的 `ExternalResearchResult` | 否 |
| `compare_external_with_local` | 与本地 claim、RulePack 和 Unknown 对比，标记 corroborates/conflicts/new/low_quality | 否 |
| `save_knowledge_candidate` | 把有价值结果保存为待审核 candidate，并记录查询和来源 | 否；审核发布后才进入新 KnowledgePack |
| `open_source_for_user` | 打开论文、组织指南或网页 | 无写入能力 |

`ExternalResearchResult` 必须显式标记：

```ts
interface ExternalResearchResult {
  resultId: string;
  query: string;
  fetchedAt: string;
  sourceType: "official_guideline" | "position_statement" | "systematic_review" | "trial" | "article" | "blog" | "forum" | "commercial";
  title: string;
  publisherOrAuthor: string;
  publishedAt?: string;
  canonicalUrl: string;
  claimSummary: string;
  relationToLocal: "corroborates" | "conflicts" | "new_candidate" | "low_quality";
  applicability: "direct" | "partial" | "indirect";
  limitations: string[];
  status: "unreviewed_external";
}
```

### 15.4 联网结果的权威提升流程

```text
External search result
  → source-quality classification
  → claim extraction + citation metadata
  → compare with local evidence/unknowns
  → unreviewed KnowledgeCandidate
  → human/curation review
  → new versioned KnowledgePack/CitationRegistry
  → if executable behavior changes: separate RulePack revision + replay tests
  → app knowledge update
```

禁止从搜索结果直接跳到 RulePack。即使是新论文，也只能先帮助 Agent 解释“存在另一种方案”；只有经过审核、规则建模和 fixture replay 后，才能改变自动计划行为。

### 15.5 联网查询时的用户体验

Agent 应明确区分：

- `本地已审核依据`：当前计划实际使用；
- `联网找到的其他方案`：可讨论、比较，但尚未成为自动规则；
- `证据冲突/未知`：展示双方来源和为什么暂不切换；
- `地区实时信息`：餐馆、外卖、菜价或产品库存具有时效性，每次使用都显示时间与来源。

如果用户要求尝试一个本地未注册但低风险的新方案，Agent 可以生成“实验性 Proposal”：必须列出与当前策略的差异、未知、停止条件和短观察窗；数值仍受本地 guardrails 限制，且不能用于医疗、极端饮食或伤病康复。

### 15.6 Provider 与依赖注入

知识能力通过可替换接口组合，不能把具体搜索引擎、云服务或向量库写入领域层：

```ts
interface KnowledgeRepository {
  search(query: KnowledgeQuery): Promise<KnowledgeHit[]>;
  getStrategy(id: string, version?: string): Promise<PhaseStrategyDefinition | undefined>;
  getEvidence(ids: string[]): Promise<EvidenceCitation[]>;
}

interface ExternalResearchProvider {
  search(request: { query: string; domains?: string[]; recencyDays?: number }): Promise<ExternalResearchResult[]>;
}

interface KnowledgeCandidateStore {
  save(candidate: ExternalResearchResult): Promise<void>;
  listPending(): Promise<ExternalResearchResult[]>;
}
```

默认组合：`BundledSQLiteKnowledgeRepository + DisabledExternalResearchProvider` 可完全离线工作；用户允许联网后注入可替换的 Research Provider。远程 LLM 可以阅读查询返回的完整 task-relevant 内容并生成解释，但 Citation Registry、RulePack、事实提交和计划修改仍由本地 Application 控制。

### 15.7 搜索隐私与内容边界

- 不把姓名、联系方式、地址、账号 ID 或精确位置拼进公开搜索词；地区推荐使用用户授权的城市/商圈级约束。
- 身体数据和历史经历可以进入远程 LLM 的任务上下文，但普通 Web 搜索 query 应抽象成研究问题，例如“长期减重后保守增肌 碳水周期 证据”，而不是上传完整个人档案。
- 本地只保存结构化 claim、引用元数据、短摘要和必要摘录，不镜像受版权保护的完整论文正文。
- 在线来源失效不会破坏当前计划；计划使用的 Citation snapshot 与 RulePack version 已随 Proposal/Action Log 冻结。

## 16. 来源范围

本研究优先使用正式组织立场/共识、系统综述与 Meta、随机对照试验、受控喂养研究和关键原始人体研究。没有把健身博主、厂商营销或论坛内容作为事实来源。主要来源包括：

### 正式立场与共识

1. Aragon AA, et al. **ISSN position stand: diets and body composition.** 2017. <https://doi.org/10.1186/s12970-017-0174-y>
2. Leaf A, et al. **ISSN position stand: ketogenic diets.** 2024. <https://pubmed.ncbi.nlm.nih.gov/38934469/>
3. Jäger R, et al. **ISSN position stand: protein and exercise.** 2017. <https://doi.org/10.1186/s12970-017-0177-8>
4. Thomas DT, Erdman KA, Burke LM. **Nutrition and Athletic Performance.** Academy/DC/ACSM joint position. 2016. <https://doi.org/10.1249/MSS.0000000000000852>
5. Mountjoy M, et al. **2023 IOC consensus statement on REDs.** <https://pubmed.ncbi.nlm.nih.gov/37752011/>
6. Currier BS, et al. **ACSM Position Stand: Resistance Training Prescription for Healthy Adults.** 2026. <https://pubmed.ncbi.nlm.nih.gov/41843416/>

### 系统综述与 Meta 分析

7. Murphy C, Koehler K. **Energy deficiency impairs resistance training gains in lean mass but not strength.** 2022. <https://pubmed.ncbi.nlm.nih.gov/34623696/>
8. Binmahfoz A, et al. **Resistance exercise during dietary weight loss.** 2025. <https://pubmed.ncbi.nlm.nih.gov/40909191/>
9. Lopez P, et al. **Resistance training and body composition in overweight/obesity.** 2022. <https://pubmed.ncbi.nlm.nih.gov/35191588/>
10. Henselmans M, et al. **Carbohydrate intake and strength/resistance performance.** 2022. <https://pubmed.ncbi.nlm.nih.gov/35215506/>
11. Whittaker J, Harris M. **Low-carbohydrate diets and men's cortisol/testosterone.** 2022. <https://pubmed.ncbi.nlm.nih.gov/35254136/>
12. Lundberg TR, et al. **Concurrent aerobic and strength training and muscle fiber hypertrophy.** 2022. <https://pubmed.ncbi.nlm.nih.gov/35476184/>
13. Petré H, et al. **Maximal strength during concurrent training by training status.** 2021. <https://pubmed.ncbi.nlm.nih.gov/33751469/>
14. Nunes CL, et al. **Does adaptive thermogenesis occur after weight loss in adults?** 2022. <https://doi.org/10.1017/S0007114521001094>
15. Oliver CJ, et al. **Validity of BIA compared with a four-compartment model.** 2026. <https://pubmed.ncbi.nlm.nih.gov/41718193/>

### 随机试验、受控试验与关键原始研究

16. Gardner CD, et al. **DIETFITS healthy low-fat vs healthy low-carbohydrate trial.** 2018. <https://pubmed.ncbi.nlm.nih.gov/29466592/>
17. Hall KD, et al. **Calorie-for-calorie fat vs carbohydrate restriction in a metabolic ward.** 2015. <https://pubmed.ncbi.nlm.nih.gov/26278052/>
18. Longland TM, et al. **Higher protein during marked deficit plus intense exercise.** 2016. <https://pubmed.ncbi.nlm.nih.gov/26817506/>
19. Garthe I, et al. **Two weight-loss rates in athletes.** 2011. <https://pubmed.ncbi.nlm.nih.gov/21558571/>
20. Helms ER, et al. **Small and large energy surpluses in resistance-trained individuals.** 2023. <https://doi.org/10.1186/s40798-023-00651-y>
21. Peos JJ, et al. **ICECAP continuous vs intermittent dieting.** 2021. <https://pubmed.ncbi.nlm.nih.gov/33587549/>
22. Campbell BI, et al. **Two-day carbohydrate refeed RCT.** 2020. <https://pubmed.ncbi.nlm.nih.gov/33467235/>
23. Siedler MR, et al. **Diet breaks in resistance-trained females.** 2023. <https://pubmed.ncbi.nlm.nih.gov/37181269/>
24. Thomas DM, et al. **Dietary adherence and body-weight plateau model.** 2014. <https://pubmed.ncbi.nlm.nih.gov/25080458/>
25. Hill EE, et al. **Exercise and cortisol intensity threshold.** 2008. <https://pubmed.ncbi.nlm.nih.gov/18787373/>
26. Djurhuus CB, et al. **Acute glucocorticoid effects on fuel metabolism.** 2017. <https://pubmed.ncbi.nlm.nih.gov/28177189/>
27. Wang Z, et al. **Specific metabolic rates of major organs and tissues across adulthood.** 2010. <https://pubmed.ncbi.nlm.nih.gov/20962155/>
28. Aristizabal JC, et al. **Resistance training, resting metabolic rate and DXA metabolic map.** 2015. <https://pubmed.ncbi.nlm.nih.gov/25293431/>

## 17. 更新建议

- 每 12 个月复审；IOC、ACSM、ISSN、WHO 或重要系统综述发布后提前复审。
- 新研究只新增 evidence entry，不直接覆盖产品阈值；规则变更单独升级 rule-pack 版本。
- 对 `ProductPolicy` 做离线 replay：检验是否出现连续砍热量、同时叠加训练压力、单日噪声改写长期目标或缺失数据被当成负面事实。
- 在真实产品中先以 Proposal/影子模式验证接受率、修改率、撤销率、计划完成率、趋势命中率和错误安全触发；不能直接以“减脂更快”作为唯一指标。
