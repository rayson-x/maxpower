# MaxPower — Agent 统一入口

> 本文件是仓库的唯一 agent 入口，也是产品与工程共识的 canonical 摘要。
> 术语以 `CONTEXT.md` 为准；细节见文末「文档地图」。修改本文件 = 修改产品共识，需用户确认。

## 1. 背景与使命

作者健身约 3 年（高强度训练者，2026-08 减脂冲刺期），身边很多人向他咨询训练——**MaxPower 的 agent 是他教练经验的产品化分身**。

**使命：可解释的实时 AI 健身教练。** 识别用户完成了什么动作，判断可见执行策略是否符合当前训练目的，发现持续且可纠正的偏差，并在证据充分时给出一条及时、具体的提示。

成功标准：
- 同一套 Rust canonical evidence 支撑骨架、阶段、次数、轨迹与教练判断，不产生第二套事实
- 实时界面一次只给一条最高优先级提示，并说明它基于哪些可见证据
- 证据不足时拒答（`cannot_judge` / capability refusal），而不是输出虚假确定性

## 2. 产品理念（2026-08-16 与作者定稿）

### 双线自助
- **老手线（效率）**：快速规划、快速记录、观察进步。承诺：省脑子、判断准、进步有证据。「简单」= 少操作。
- **新手线（养成）**：跟随 agent 教学，养成健身与饮食习惯。承诺：有人带、不羞耻、不放弃。「简单」= 少思考。
- 两线功能分岐时先问"这服务哪条线的承诺"；老手线由作者每日 dogfood，新手线需朋友实测验证。

### 需求驱动，不是人群分类
不把用户切成固定人群模板。需求以自由语言进入 → 协商成 Goal contract → 判断规则按维度组合（目标 × 约束 × 习惯）。agent 对标"有经验教练的通用判断力"。

### 诊断先于处方，最小杠杆
先搞清现状（习惯、饮食构成、训练史），找出真正的卡点，只动一个最小杠杆，观察反馈再迭代。方案是分析产出，不是流程模板。

### 身材是生活方式的反应
- 不一上来给最高效方案；**减少坏习惯、增加好习惯**，渐进修正；长期靠生活方式维持，不靠冲刺期意志力。
- **执行率是习惯建立的唯一标准**：执行不了就降强度（不是催更紧）。代码层兜底：`AdaptivePlanning` 固定校验强制低执行先降摩擦、恢复受限先降负担。
- **双模式**：需求带硬期限 + 极端目标（比赛/婚礼）→ 从需求分析直接推断为项目模式，直接给高强度计划 + 代价披露 + circuit breaker + **退出坡道**（结束后回到生活方式轨道）。
- **饮食精度 = max(计划强度要求, 个人状态基线)**：档位为行为级 → 量级级 → 精确级；接近生理极限者基线恒为精确级；所需精度与可执行精度冲突时由用户拍板。
- 完整计划照给，但**起点强度跟用户确认**（fastest/balanced/gentle 选项 + 取舍），宁可从能坚持的强度开局。

### 以执行者为准（Executor Sovereignty）
所有训练规则（恢复窗口、负荷阈值、频率建议）都是**软建议，永不阻断用户意图**；用户要求修改时 agent 说明一次取舍，然后按用户意愿执行。例外仅剩 agent 自身行为的安全边界（医疗诊断声称、伪造观测数据），那些约束的是 agent 而非用户。适用所有 agent 功能设计。

### 判据体系
- **核心指标（推给用户）**：围度（腰围为主）+ 训练表现 + 同条件照片对比
- **趋势信号（弱化呈现）**：体重周均趋势，绝不绑定单日读数（2 周自然波动 SD=1.2kg，短期变化 84% 是水/糖原）
- **谨慎指标**：体脂率只用趋势/区间，禁用单次读数下结论
- **主观状态信号（一等公民）**：爬楼不喘、精力/睡眠变好、久坐腰不酸等自述反馈是合法进展证据，经对话进 Timeline，复盘时必须回放
- 平台判定走多信号；为围度/表现变化庆祝，把体重波动重新定性为噪声

## 3. 目标用户与市场

**种子三人组**：① 作者本人（进阶/减脂冲刺——ground truth：热量缺口护栏、保肌、关键动作表现保护、诚实周复盘）② 朋友 A（瘦，增肌）③ 朋友 B（胖，减重）。三人组是需求样本，不是人群代表。新手路径：record-first + baseline intake（仅年龄/身高/体重）+ 无术语设计，不为新手简化掉进阶深度。

**海外优先**：付费差距在 ARPPU（Keep 月均 RMB 5.8/MAU vs 海外 $10–25/月），不是付费意愿（Keep 渗透率 10.6% ≈ Duolingo 9.1%）。文案与 agent 话术优先英文语境与欧美健身梗文化（leg day、PR 文化），渠道以 TikTok/IG/X/Reddit 为主；中文支持保留但非主战场。

## 4. 能力范围（红线）

做：动作识别与 rep 确认、可见执行策略描述、教练级概率性推断（须带证据/备选解释/置信度/拒绝态）、规划与复盘、营养策略协同。

不做：
- 医疗诊断、疼痛归因、损伤风险判定、康复处方
- 单目视频声称测得肌肉激活、力量、关节负荷、真实 3D 关节角
- 用不可解释的总分替代分维度证据
- 机位/遮挡/证据不足时输出确定性结论（必须 `cannot_judge`）
- 2D 能做：相位对齐、相对关节角/高度/双侧时序/路径连续性/节奏的投影证据比较

## 5. 项目架构

Monorepo（单 git 仓，remote: `git@github.com:rayson-x/maxpower.git`，private）：

```
maxpower/
├── App.tsx / src/ / modules/ / android/ / ios/   # 客户端（Expo RN 57）
├── rust/      # Motion SDK — canonical packet 唯一事实源
├── server/    # 云端服务（独立 package.json / migrations / Dockerfile）
├── public/    # 模型与 WASM 产物（大文件部分 gitignore）
├── CONTEXT.md # 领域术语 canonical + 不可协商不变量 + 实现现状详录
└── docs/      # adr / design / agents / research / reports
```

- **运动数据流**：`Client CameraInputStream → Rust Motion SDK → CanonicalMotionOutput → client projection/Coach tools`。任何端不得拥有第二套骨架/计数/相位事实。
- **决策权分层**：本地 Coach 拥有决策与事实（ADR-0001）；云端拥有已确认产品资源（ADR-0002）。LLM 文本/提案不经 mandate 授权不成事实。
- **wiki 是独立本地仓**（`../wiki`，位置不可移动，外部引用依赖路径）：概念/证据/决策史。市场类调研不进 wiki，留在 `docs/research/`。
- **当前实现（2026-08）**：Android 实时识别已走 canonical 边界（front 识别 / back 观察双机位）；iOS 完整客户端待做；server 侧 media library / entitlements 进行中；当前开发分支 `agent-knowledge-runtime`。

## 6. 协作规则

- **Expo 57 已变更**：写代码前读 https://docs.expo.dev/versions/v57.0.0/ 对应版本文档
- **Ticket/需求流程**：GitHub Issues（rayson-x/maxpower）；`.scratch/` 已废弃并移出版本控制（仅本地保留）
- **wiki 审核权已委托 Claude**：学科知识类调研复盘通过后可推进状态（draft→reviewed），collector/reviewer 身份分开、`workflowTransitions` 留痕；`approved_for_product` 只在产品实际采用时授予
- **Rust motion 变更前**必读 `docs/agents/rust-motion-trace-explainer-product-contract.md`（顶层产品合约）
- **私有数据纪律**：训练录像、capture、标注、含单次结果报告永不入库（已在 .gitignore）；`.env*.local` 不入库
- 提交信息遵循 conventional commits；push 走 SSH（个人号 rayson-x），gh API 用仓库根 `.env.local` 里的 token

## 7. 文档地图

| 位置 | 内容 |
|---|---|
| `CONTEXT.md` | 领域术语表、7 条不可协商不变量、目标数据流、实现现状详录 |
| `docs/adr/` | 架构决策（本地 Coach 主权 / 云端资源主权） |
| `docs/design/` | 设计合约（含 `exercises-dataset-integration-v1.md` 数据地基/三线并行决策） |
| `docs/agents/` | agent 协作细则（domain、issue-tracker、triage-labels、rust-motion 合约） |
| `docs/research/` | 调研报告（学科类可进 wiki，市场/策略类只留这里） |
| `docs/reports/` | 验收与评估报告 |
| `lessons/` / `learning-records/` | 复盘课程与学习者水平记录（教学线） |
| `../wiki/` | 独立知识库仓：knowledge/concepts/decision-history/schemas |
