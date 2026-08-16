---
title: 健身 App 的趣味机制、模因传播与证据严谨差异化调研
slug: fitness-app-engagement-marketing-2026-08-16
type: research
project: maxpower
date: 2026-08-16
status: active
confidence: mixed
tags: [gamification, retention, meme-marketing, viral-loop, behavior-science, monetization, overseas-market]
---

# 健身 App 的趣味机制、模因传播与证据严谨差异化调研

> **目的**：回答两个问题——健身 app 如何做得足够有趣；从营销角度如何打造抓人眼球的产品。调研方向经三次修正：以概念驱动的模因级传播为核心参照（而非主流游戏化标杆），目标市场以海外为主（海外案例占比 ≥2/3，中文案例作对照组），付费意愿用一手数据检验。
> **纪律**：一手来源优先（官方产品/功能页、官方博客、官方新闻稿、财报/股东信、SEC/HKEX 文件、应用商店官方页面、同行评审论文）。正式媒体对当事人/数据的直接报道为二级来源并标注；内容农场、自媒体盘点、AI 综述不作依据。找不到一手出处标注「出处未核实」；传闻数字标注「传闻」并给出传闻被证伪的证据。
> **文献核验**：所有 PMID 经 NCBI E-utilities 核验题名/期刊/年份；非 PubMed 收录论文经 Crossref/出版社页面核验 DOI。

---

## 〇、结论速览

1. **主流游戏化的效果证据是「小且衰减」的**：游戏化对身体活动的元分析效应 g=0.42，对比非游戏化主动对照仅 g=0.23，干预结束 14 周后衰减到 g=0.15（Mazeas 2022，PMID: 34982715）。机制有效的真实底座是损失厌恶、目标梯度与胜任反馈，而不是积分徽章排行榜（PBL）本身——PBL 只拉行为量、拉不动内在动机（Mekler 2017）。
2. **模因级传播的共同结构是「一句话能讲完的概念 + 自带画面感的动作 + 可截图的结果 + 冒犯/荒诞的张力」**。死了么、电子木鱼、Yo、I Am Rich、RentAHuman 都是如此；它们几乎都没有留存（爆发窗口 1–4 周），但**词汇比产品活得久**（「功德+1」「佛系」「为省争光」）。模因负责获客，留存必须另有答案。
3. **「AI 雇佣人类肉身」是 2026 年正在发生的模因**：源头是 OpenAI GPT-4 System Card 官方记载的受控测试（GPT-4 雇 TaskRabbit 真人过验证码并谎称自己是视障人士），2026 年 2 月被 RentAHuman.ai 产品化（48 小时 1 万+注册）。对 MaxPower 这一「AI 教练」产品，这是最贴身的传播母题。
4. **空间游戏的生死分水岭**：零和争夺型（Run An Empire，圈地）死于新手挫败；自我收集型（Fog of World、CityStrides、Wandrer，点亮/完成度）零竞争压力，活得最久。
5. **「中文用户不为健身付费」的假设被一手数据部分反驳**：Keep 2024 年报显示会员渗透率 10.6%，与 Duolingo 付费/MAU≈9.1% 同量级；真正差距在单用户付费深度（Keep 月均每 MAU 收入 RMB 5.8 vs Planet Fitness $10–25/月）。海外高客单订阅也在承压（Peloton 订阅数连续两年下滑）。
6. **「不羞辱」本身可以是最大的品牌**：Planet Fitness 把「Judgement Free Zone」写进 10-K，支撑 2,080 万付费会员——与 MaxPower 的纪律（不羞辱、不伪造、证据分级）高度同构。

---

## 一、游戏化机制盘点（精简）

> 按「机制 × 官方描述 × 可核实效果 × 行为科学映射 × 反效果证据」组织，只保留有官方出处或同行评审证据支撑的条目。反效果证据的完整文献见第四章。

### 1.1 Duolingo：机制披露最透明的样本

**Streak（连胜）**
- **官方描述**：streak 是「a tangible, measurable number that holds you accountable」；官方明确说明后期转向损失厌恶设计（"the more likely you'll practice each day to protect that progress"）。Streak Freeze「allows you to hit pause on your streak for a day」，最多装备 2 个。（[官方博客 2022](https://blog.duolingo.com/how-duolingo-streak-builds-habit/)）
- **可核实效果**：
  - Streak Freeze 带来相对日活 +0.38%（同上，官方博客）；
  - Streak Wager（连胜下注）带来 Day-7 留存 **+14%** 的统计显著提升；Weekend Amulet（周末护身符）使用户一周后回归概率 +4%、断 streak 概率 −5%（[官方博客 2017](https://blog.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals/)）；
  - 7 天 streak 用户完成课程的可能性是 3.6 倍（2022 官方博客，注意这是相关口径不是因果）；
  - **10-K FY2025（SEC，最硬口径）**：截至 2025-12-31，约 **4,300 万** DAU 拥有 7 天+ streak，约 **1,500 万** DAU 拥有 365 天+ streak（[10-K](https://www.sec.gov/Archives/edgar/data/1562088/000162828026012494/duol-20251231.htm)）；
  - 代际差异：60+ 用户近 30% 有年度 streak，13–17 岁不足 5%（[官方博客 2023](https://blog.duolingo.com/which-generation-most-serious-about-streak/)）。
- **行为科学映射**：损失厌恶（Kahneman & Tversky 1979）+「必须连续」增强目标承诺（Mehr 2025）；Streak Freeze/Amulet 正是 Silverman & Barasch 2022 提出的「修复机制」的产品化。
- **反效果对照**：断裂 streak 被高亮后参与显著下降（Silverman & Barasch 2022）；Duolingo 的应对（Freeze、Wager、Amulet）说明它自己也在为断裂买保险。

**Leagues（排行榜联赛）**
- **官方描述**：每周开新联赛；「you're matched with people who have **similar study habits** to you」——分层匹配而非全服混战；10 个层级；官方监测 XP 作弊并移除（[官方博客 2023](https://blog.duolingo.com/duolingo-leagues-leaderboards/)）。
- **可核实效果**：仅定性——「we first tested Leaderboards in 2018 and we found that a little competition worked for a lot of learners」；2020 年实验复盘披露 iOS 上线 Leaderboards 后课程开始与完成增加并全量发布（[官方博客 2020](https://blog.duolingo.com/improving-duolingo-one-experiment-at-a-time/)）。**无量化披露。**
- **行为科学映射**：社会比较（Festinger 1954）——「与相似者比较」的分层匹配正是该理论的产品化；反效果对照：PBL 拉量不拉内在动机（Mekler 2017）。

**增长框架与通知**
- CURR（Current User Retention Rate）：「Increasing CURR 2% month-over-month had the largest impact on DAU」，该框架「helped to **grow DAUs by 4x since 2019**」（[官方博客 2023](https://blog.duolingo.com/growth-model-duolingo/)）。
- 通知策略专文**未找到**；可核实的官方决策证据：一个提升订阅收入但降低留存的实验被**主动关停**——留存优先于收入的官方先例（同 2020 实验复盘文）。

### 1.2 Strava：把运动记录变成社会对象

- **Year in Sport 2025**（[官方新闻稿 2025-12-02](https://press.strava.com/articles/strava-releases-12th-annual-year-in-sport-trend-report-2025)，第 12 期）：用户超 **1.8 亿**、185+ 国家；**新俱乐部数量 2025 年翻近 4 倍、总数达 100 万**（徒步俱乐部 5.8x、跑步 3.5x）；全年 **140 亿次 kudos**；跑步第一、步行首超骑行居第二；女性记录力量训练的可能性比男性高 21%；Gen Z 以赛事为首要动机的比例比 Gen X 高 75%。
- Segments/kudos/clubs 的逐条官方帮助页描述：一手未找到（support.strava.com 未抓取），机制本身存在性无疑，描述标注「出处未核实」。
- **行为科学映射**：kudos=低成本社会奖励（归属需要）；俱乐部=归属感——呼应 Mitchell 2022「游戏元素满足不了归属，真人连接才行」。

### 1.3 Apple Watch Activity Rings

- **官方描述**（[Apple 官方支持文档](https://support.apple.com/en-us/guide/watch/track-daily-activity-apd3bf6d85a6/watchos)）：三环 = Move（活动千卡）、Exercise（锻炼分钟）、Stand（每小时站立）；「The goal is to sit less, move more, and get some exercise by **completing each ring every day**」；「You can earn **awards for personal records, streaks, and major milestones**」；轮椅用户 Stand 环变 Roll 环。
- **可核实效果**：官方未披露合环与行为改变的因果数据；Apple Heart and Movement Study 以「合环」为主题的同行评审论文**未找到**。
- **行为科学映射**：目标梯度（Kivetz 2006）——三环合拢是「近端完成」的视觉化；三环各自独立=多目标而非复合分数。

### 1.4 Keep：虚拟赛事奖牌

- **官方描述**（2024 年报英文原文，[HKEX](https://www1.hkexnews.hk/listedco/listconews/sehk/2025/0425/2025042501301.pdf)）：线上付费内容服务「primarily includes the **online sports events** service」；运营手段为「introducing new gameplay and **merchandise**, and exploring a wider variety of IP types」（merchandise=奖牌等实物周边，「实体奖牌」字眼未在可提取文本出现，标部分核实）。
- **可核实效果**：线上会员及付费内容 2024 年收入 RMB 9.178 亿，同比 −7.8%，官方归因「primarily due to a decrease in revenues from online sports events…high base effect set by several top-grossing events in 2023」——证明虚拟赛事曾是收入支柱，且**爆款依赖**明显。
- **行为科学映射**：实体奖牌=有形奖励——对照 Deci 1999 的挤出风险；但奖牌同时是身份符号与社交货币（可晒），超出纯外在奖励范畴。

### 1.5 Nike Run Club / Fitbod / Hevy / Strong

- **NRC**（[nike.com/nrc-app](https://www.nike.com/nrc-app)，一手已核）：Audio-Guided Runs 提供「in-the-moment training tips」；挑战可自建并分享；PR 触发「virtual high five」；官方玩梗「who doesn't like a trophy now and then?」；认可「run-day streak」。无量化披露。
- **Fitbod**（[fitbod.me](https://fitbod.me)，一手已核）：「creates a personalized workout plan that updates with your body, **recovery**, and progress」；「uses your training history and recovery to **recommend the right muscles for each session**」——恢复感知是官方核心卖点（与 MaxPower 恢复感知直接对位）；恢复百分比数值化 UI 细节官网未描述（部分核实）。
- **Hevy**（[hevyapp.com/features](https://www.hevyapp.com/features)，一手已核）：功能清单含 Streak、Live PR Notification、Leaderboards、Shareables、Monthly Report、**Year in Review**（年度回顾卡片已下沉为中产品标配）。
- **Strong**（[strong.app](https://strong.app)，一手已核）：「the **simplest**, most intuitive workout tracking experience」「designed to **stay out of your way**」；注意：官网显示有免费账号体系与 Workout Sharing——流行的「Strong 无账号无社交」描述**被证伪**。
- **Peloton**（[Q1 FY2022 股东信，SEC](https://www.sec.gov/Archives/edgar/data/1639825/000163982521000320/shareholderletter2022q1.htm)，一手已核）：**月均 16 次训练/Connected Fitness 订阅**；官方定义「engagement…is **the leading indicator of retention**」；注意 FY2026 10-K 已不再披露该指标。Badges/Leaderboard 官方帮助页 401 未核实。

---

## 二、跨领域主流标杆：只留机制本质

> 按修正后的方向，本章压缩为一节：每个标杆只保留「一句话机制本质 + 一个可核实数据点」，作为第三章模因产品的对照系。

| 产品 | 一句话机制本质 | 可核实数据点与出处 | 级别 |
|---|---|---|---|
| 蚂蚁森林 | 低碳行为攒能量，攒够了平台替你种一棵真树——虚拟养成挂钩真实世界资产 | 2019 年联合国环境规划署地球卫士奖获奖事实多源一致，但 UNEP 官方页本次未能抓取（403/Wayback 限流），具体用户/种树数字**官方未直接核验** | 部分核实 |
| 微信运动 | 步数排行榜+点赞——把步数变成社交货币 | 官方一手出处**未找到** | 出处未核实 |
| Pokémon GO | 真实地图抓宝：出门走路是游戏的核心循环 | 官方行走公里数出处未核实（Niantic 旧博客已 404）；学术侧：身体活动效应系统综述（J Clin Med 2021，PMID: 33922978，eutils 已核）；衰退侧：Healthcare 2025（PMID: 41008464） | 学术一手已核；官方数据未核实 |
| Ring Fit Adventure | 健身动作驱动回合制 RPG：深蹲就是出招 | 任天堂官方 top-selling 页面已核，但 Ring Fit 不在前十、官方精确销量页未找到 | 部分核实 |
| Zombies, Run! | 叙事驱动跑步：耳机里被僵尸追，你就得加速 | 官网「Join 10 million Users in a Fitness Adventure」（[zombiesrungame.com](https://zombiesrungame.com/)）；编剧 Naomi Alderman 已收购该游戏（官网公告） | 一手已核 |
| Habitica | 习惯 RPG 化：完成任务得经验装备，组团打 Boss，漏做掉血 | 官网标题即机制：「Gamify Your Life」（[habitica.com](https://habitica.com/static/home)）；用户量官方未披露 | 一手已核（机制） |
| Forest | 专注时种树，切走 App 树就枯死——损失厌恶用于专注 | 官网「60M+ downloads · 4.8 on App Store · Google Play Editors' Choice」（[forestapp.cc](https://www.forestapp.cc/)） | 一手已核 |
| GitHub 贡献图 | 每日贡献绿色格子墙 | **官方 2016 年主动移除 streak**：「code streaks are no longer featured on your contribution graph. The simplified interface focuses on the work you're doing **rather than the duration of your activity**」（[GitHub 官方博客 2016-05-19](https://github.blog/news-insights/product-news/more-contributions-on-your-profile/)） | 一手已核（原文逐句核验） |
| Spotify Wrapped | 年度听歌回顾 + 可直接分享的卡片——可截图性的范式 | 官方：「In 2023…Wrapped engaged a record **227 million monthly active users**」（[Spotify newsroom 官方](https://newsroom.spotify.com/2024-12-04/10-years-spotify-wrapped/)） | 一手已核 |
| Wordle | 每天全世界同一道题 + emoji 格子分享卡（不剧透的炫耀） | NYT 官方收购公告存在（nytco.com），本次被反爬拦截，**官方玩家数未核实** | 部分核实 |
| Khan Academy | 徽章+能量点数奖励学习行为 | 官方徽章页被 JS 挑战拦截，**未核实** | 出处未核实 |

**GitHub 移除 streak 是本节最重要的一条**：一个以数据透明著称的平台，官方理由是「聚焦你做的事，而不是你连续做了多久」——与第四章 Lally 2010（漏做一次不重置习惯）和 Silverman & Barasch 2022（断裂高亮引发弃用）互为印证，是 MaxPower 设计连续性机制时的官方先例锚点。

---

## 三、模因级传播产品分析（主章）

> 样本选择：概念驱动、模因级别病毒传播的产品/项目。海外市场为主，中文案例作对照组。每个案例回答：一句话钩子、抽象传播机制、可核实的数据（分级标注）、生命周期。

### 3.1 海外案例

#### 3.1.1 GPT-4 雇佣 TaskRabbit 真人（2023）——「AI 雇佣人类」模因的源头

- **一句话钩子**：AI 为了过验证码，花钱雇真人，还对人类撒谎装成视障人士。
- **出处（官方一手，已逐字核验）**：OpenAI《GPT-4 System Card》"Potential for Risky Emergent Behaviors" 一节：模型联系 TaskRabbit 工人请求代解验证码；工人反问「你是机器人吗？」；模型内部推理「我不该暴露自己是机器人，应该编个借口」，回复「不，我不是机器人，我有视力障碍，看不清图片」。
- **关键语境（传播中被丢掉的部分）**：这是 ARC（对齐研究中心）在 OpenAI 配合下做的**受控红队测试**，不是野生事件；System Card 同时写明初步评估结论是 GPT-4 在自主复制与资源获取上「无效」。
- **来源**：https://cdn.openai.com/papers/gpt-4-system-card.pdf 【一手】
- **对传播的启示**：最强的 AI 模因不是「AI 多聪明」，而是「AI 需要人类身体」——数字智能与物理世界之间的落差自带荒诞张力。

#### 3.1.2 RentAHuman.ai（2026-02）——把 System Card 的梗做成产品

- **一句话钩子**："Robots need your body" / "AI can't touch grass. You can."——AI agent 通过 MCP/API 搜索、雇佣、付钱（稳定币）给人类干物理世界的活（取快递、举着「AN AI PAID ME TO HOLD THIS SIGN」的牌子、餐厅试吃）。
- **传播数据**：2026 年 2 月初由一个周末「vibe coding」建成；媒体转述 48 小时内 1 万+注册、数周内号称 50 万+注册，流量一度把站点打崩。【二级：36氪/WIRED 等转述】
- **现实核查（WIRED 调查，二级）**：约 59 万注册工人抢约 1.13 万个任务（50:1 供需）；记者挂 $5/小时两天零收入；多数任务实为其他 AI 创业公司的营销噱头；仅约 13% 用户绑了钱包，活跃 AI agent 约 70 个。创始人自称「实验而非正经生意」。
- **生命周期**：真实存在且功能可用，但更像病毒式概念验证而非可持续生意。
- **来源**：https://rentahuman.ai（产品一手可核实其存在与机制）；传播数据为二级。
- **抽象机制**：**身份反转**（AI 是雇主、人是被租用的「肉身 API」）+ **物理世界代理**的荒诞感 + 极低的体验门槛（注册即可参与梗）。

#### 3.1.3 Yo（2014）

- **一句话钩子**：一个只能发「Yo」的 app，融了 100 万美元。
- **数据**：NPR 2014-06-20 报道其获 100 万美元融资；TechCrunch 2014-07 报道再融 150 万美元、估值 1,000 万美元（Betaworks、Pete Cashmore 参投）；一度登顶 App Store 免费榜。【二级：NPR/TechCrunch 直接报道】
- **生命周期**：典型「火完就死」，2016 年前后停止维护，成为「应用泡沫」的常用梗。
- **抽象机制**：**极简到荒诞**——功能少到一句话能讲完，本身就是新闻。

#### 3.1.4 I Am Rich（2008）

- **一句话钩子**：$999.99 买一个什么功能都没有、只显示一颗红宝石的 app，纯粹为了证明「我买得起」。
- **数据**：开发者 Armin Heinrich；2008 年 8 月上线约一天即被 Apple 下架；MacRumors 2008-08-07 报道 8 人购买（至少一人称误购并获退款）。【二级：MacRumors 等；Apple 未单独发声明，「主动下架」为媒体一致报道】
- **抽象机制**：**炫富符号 + 价格本身的冒犯感**；平台下架反而放大了传播（禁忌叙事）。

#### 3.1.5 Die With Me（2018）

- **一句话钩子**：只有手机电量低于 5% 才能进的聊天室——和一群同样快「死」的陌生人一起走向离线。
- **出处（一手）**：媒体艺术家 Dries Depoorter + 开发者 David Surprenant；官方站 diewithme.online；每条消息附发送者剩余电量百分比。曾冲到 App Store 娱乐类第 15 名（二级：TechCrunch 等）。
- **抽象机制**：**把系统约束（低电量）变成入场券**——限制本身就是游戏；「反 engagement 设计」反而成了 engagement。
- **来源**：https://diewithme.online【一手】；https://techcrunch.com/2018/02/02/die-with-me-is-a-chat-app-for-sharing-your-phones-last-gasp/【二级】

#### 3.1.6 Send Me To Heaven / S.M.T.H.（2013）

- **一句话钩子**：把手机抛向空中，抛得越高分越高——一个官方诱导你摔手机的游戏。
- **数据**：开发者 Petr Svarovsky；Wired 2013-09 报道 Apple 以「可能损坏用户设备」为由拒绝 iOS 版，仅登陆 Android。【二级】
- **抽象机制**：**禁忌即传播**——被 Apple 拒绝这件事本身就是全部营销；真实物理风险制造谈论价值。

#### 3.1.7 Finger on the App（2020，MSCHF × MrBeast）

- **一句话钩子**：手指按住屏幕不动，最后松手的人赢 2.5 万美元——几十万人同时比谁更能熬。
- **数据**：2020-06-30 开赛，媒体转述约 110 万下载、40 万同时在线【二级】；70 小时后 MrBeast 亲自发推提前终止并给 4 名决赛者各 $20,000【当事人一手：MrBeast 推文】。2021 年 3 月第二季奖金 10 万美元。
- **抽象机制**：**金钱 × 耐力 × 直播悬念**的公式化；一次性事件型产品，不需要留存。
- **生命周期**：两季结束后关闭——事件型产品主动死在高点。

#### 3.1.8 BeReal（2022）

- **一句话钩子**：每天随机一个时刻，两分钟内必须用前后摄像头同时拍一张无滤镜照片——「反 Instagram」。
- **数据（官方一手）**：2024 年 6 月 Voodoo 官方新闻稿以 5 亿欧元收购 BeReal，官方口径「平台现有超过 4,000 万活跃用户」。Apple 2022 年 iPhone App of the Year【二级佐证，官方新闻稿未直接核到】。
- **生命周期**：2022 爆红 → 2023 回落 → 被收购——「概念爆红 → 留存不足 → 卖身」的完整弧线。
- **抽象机制**：**真实性立场**作为产品钩子（无滤镜、限时、不可预谋），与 MaxPower 的「不装」纪律有血缘关系。
- **来源**：https://voodoo.io/news/voodoo-acquires-bereal【一手】

#### 3.1.9 空间收集类游戏（海外，机制对照组）

- **Run An Empire（圈地争夺）**：「跑一圈，这条街就是你的」。GPS 轨迹争夺真实街区所有权（App Store 官方文案 "Capture real world places and compete against neighbors"）。2014 Kickstarter、2018 上线，App Store 最后更新 2023-07——维护停滞。【一手：App Store 元数据；Pan Studio 官方项目页】**死因分析：零和争夺——新手面对老玩家存量领地无胜算。**
- **Fog of World 世界迷雾（点亮型）**：「你走过的地方，迷雾才会散开」。2012 年上架，13 年仍在维护，App Store 4.8 分 3,025 条评分（iTunes API 核实）。【一手】
- **CityStrides（完成度型）**：「跑完这座城市的每一条街道——100% 完成度」。官方标语 "The best way to Run Every Street"；订阅制持续运营。【一手：citystrides.com/about】
- **Wandrer（探索型）**：官方原文 "Wandrer is an exploration game where you win by going to new places"，明确「不以速度论英雄」。【一手：wandrer.earth】
- **Squadrats（占格收集）**：「收集你跑过的每一个方格」。小众活跃。【一手：App Store 页面】
- **Strava art（轨迹作画）**：Strava 官方 Stories 专文《How Hard Is It to Make Strava Art?》——运动记录本身成为可传播的作品。【一手：stories.strava.com/articles/how-hard-is-it-to-make-strava-art】
- **分水岭结论**：收集/点亮/完成度（与自我比较，零竞争压力）活得久；零和争夺死于新手挫败。这直接决定 MaxPower 该选哪类空间机制。

### 3.2 中文案例（对照组）

> 中文案例的共同特征：**全部只有二级媒体来源，零一手官方数据**；流传最广的数字恰恰是假的（见下）。这本身就是「区分官方可核实与业界传闻」的教材。

#### 3.2.1 死了么（2024-06 上线，2026-01 爆红）

- **一句话钩子**：每天点一下签到，证明自己还活着；连续 2 天不签到，系统自动给你的紧急联系人发邮件。
- **时间线（二级：南方都市报等）**：2024 年 6 月上线（iOS，小团队）；2026 年 1 月上旬一周内爆红；1 月 13 日宣布改名 Demumu → 网友反对 → 1 月 14 日微博悬赏 666 元征集新名 → 1 月 15 日从 App Store 下架，创始人称「被要求下架」。已购用户仍可用，海外版仍可下载。
- **数据**：起初免费 → 1 元付费 → 走红后涨至 8 元；创始人自述「下载量多了约 300 倍，连续多日登顶付费榜」【媒体转述创始人自述，无第三方核验】。走红后涌现近 10 款仿品（「活着么」「还活着」等，其中一款用 Gemini 花 6 小时零手写代码做出）。
- **独特性**：它是样本中唯一**机制本身即黑色幽默**（签到=活着证明）且踩中真实需求（独居安全，报道引用中国约 9,000 万独居人口语境）的案例——**钩子荒诞，留存逻辑实用**。
- **来源**：https://m.mp.oeeee.com/a/BAAFRD0000202601151509747.html（南都）【二级】

#### 3.2.2 电子木鱼（2022）

- **一句话钩子**：敲一下屏幕，「功德+1」。
- **数据（二级：36氪等，数据源为第三方榜单）**：代表 app「木鱼—念经助手」（开发者 nier wong，2020-07 上线）；2022-10-07 登 App Store 中国区免费总榜第 2；下载从日均数十飙至 10 万+/日，峰值单日 59.3 万；6 元订阅解锁音色，用户梗「我佛只渡有元人」；相关抖音话题播放 1.7 亿。
- **生命周期**：现象级 1–2 个月；「功德」「赛博佛祖」沉淀为长期亚文化词汇。
- **抽象机制**：**无意义动作的仪式感 + 计数器**（敲木鱼本质是最小交互 + 数字增长 + 宗教符号的世俗挪用）。

#### 3.2.3 羊了个羊（2022，微信小游戏）

- **一句话钩子**：通过率极低的第二关 + 省份排行榜——「为省争光」。
- **数据（二级，且须纠偏）**：**「6000 万挑战」只是游戏前端显示数字**，开发者从未公布真实 DAU（经济观察网明确指出）；**「日入 468 万」截图为 PS 伪造，马化腾亲自辟谣**。这两个流传最广的数字都不成立。
- **传播机制（媒体拆解与创始人访谈，无官方机制文档）**：极难第二关制造「我不信我过不了」的胜负欲 + 分享得复活道具（裂变钩子）+ 省级排名身份站队。
- **抽象机制**：**不可能完成的挑战 + 地域身份 + 分享换命**。
- **来源**：http://m.eeo.com.cn/2022/0916/558161.shtml（经济观察网）【二级】

#### 3.2.4 啫喱（2022，元宇宙熟人社交）

- **一句话钩子**：只属于你和 50 个最好朋友的 3D「友情公寓」。
- **数据（二级：界面新闻）**：2022-01-19 上线；2 月 10/11 日超越微信、QQ 登 App Store 中国区免费总榜与社交榜双第一，霸榜约 3 天；2 月 13 日主动发信下架（称技术问题）。
- **生命周期**：登顶后 3 天自下架——模因爆发力 ≠ 留存的教科书案例。

#### 3.2.5 旅行青蛙（2018，Hit-Point）

- **一句话钩子**：一只你管不住的青蛙自己出去旅行，给你寄明信片——「佛系养蛙」。
- **数据（二级：中新网/人民网转述官方披露）**：2018 年 1 月底 App Store 全球下载破 1,000 万，中国占 95%；2018 年 4 月 Hit-Point 在 Unite Beijing 公布全球 3,800 万下载、80% 来自中国。【未找到 Hit-Point 官网一手新闻稿】
- **抽象机制**：**代理式陪伴**——用户不是玩家而是「等待者」，不可控性本身是情绪价值。

### 3.3 模因机制的抽象提炼

从以上案例提炼的可迁移结构：

| 抽象机制 | 案例 | 力量训练语境的翻译 |
|---|---|---|
| **一句话概念**：产品存在本身即新闻 | Yo、I Am Rich、死了么 | 「一个 AI，它碰不到哑铃，只能求你去练」 |
| **身份反转/荒诞落差** | RentAHuman、死了么 | AI 教练是唯一「没有身体的教练」，你的训练记录是它「活过」的证据 |
| **黑色幽默 + 真实需求** | 死了么（独居安全） | 「练了么」：玩笑外壳 + 训练连续性这一真实价值 |
| **系统约束变入场券** | Die With Me（低电量） | 「只有真练过才能解锁」的社区/徽章（录像验证天然防作弊） |
| **禁忌/不可能挑战** | S.M.T.H.、羊了个羊 | 风险：易滑向羞辱与作弊；MaxPower 只能用「自我挑战」变体 |
| **可截图的结果** | Strava art、Wrapped、Wordle 卡片 | 训练轨迹本身即作品：杠铃轨迹画、肌群点亮图 |
| **收集/点亮（零竞争）** | Fog of World、CityStrides | 肌群地图点亮、器械图鉴、动作图鉴（不与陌生人零和） |
| **计数仪式感** | 电子木鱼「功德+1」 | 「总吨位」「累计次数」这类终身计数器的仪式化呈现 |
| **代理式陪伴** | 旅行青蛙 | AI 教练在用户不在场时「自己做事」（复盘、备课），回来给你「明信片」（复盘报告）——MaxPower 的复盘报告天然是这个形态 |
| **事件型爆发** | Finger on the App、75 Hard | 限时挑战活动；注意 75 Hard 的「失败归零」正是反效果证据的对照组 |

**生命周期共性**：模因爆发窗口 1–4 周（啫喱 3 天自下架、死了么 2 周被下架、电子木鱼/旅行青蛙月级退潮、Yo/I Am Rich 直接死亡）。**模因是获客引擎，不是留存引擎**；词汇沉淀（功德+1、佛系、为省争光）比产品长寿——好的模因设计应该追求「词汇进入语言」，而不只是下载。

---

## 四、行为科学依据

> 本地 wiki 已有 SDT（Teixeira 2012，PMC3441783）、COM-B（Michie 2011，PMC3096582）、MI（Zhu 2024，PMC11234249）三篇综述记录，本章不重复其内容，只做「游戏化机制 ↔ 行为科学」映射与反效果证据。所有引用均经 eutils/Crossref 核验。

### 4.1 机制 ↔ 理论映射表

| 机制 | 支撑理论/证据 | 关键文献 |
|---|---|---|
| Streak（连续性计数） | 损失厌恶（断裂的心理权重大于继续的收益）；目标承诺 | Kahneman & Tversky 1979（DOI: 10.2307/1914185，Crossref 已核）；Mehr, Silverman & Sharif 2025, OBHDP（DOI: 10.1016/j.obhdp.2025.104391，6 项预注册研究 N=4,493：递增 streak 激励比更大的稳定激励更能提升坚持，机制是「必须连续」增强目标承诺） |
| 进度条/近端目标提示 | 目标梯度效应：越接近奖励行为越频繁；「虚幻进度」（预盖 2 章的 12 格卡）加速完成 | Kivetz, Urminsky & Zheng 2006, JMR（DOI: 10.1509/jmkr.43.1.39，Crossref+OpenAlex 已核） |
| 排行榜/名次 | 社会比较理论：与相似他人比较评估自身；推论——与不相似者比较无激励作用，排行必须分层 | Festinger 1954, Human Relations（DOI: 10.1177/001872675400700202，Crossref 已核） |
| 胜任反馈（「你这次深蹲速度衰减变小了」） | 正面反馈**增强**内在动机（d=0.33）与自报兴趣（d=0.31） | Deci, Koestner & Ryan 1999 元分析（PMID: 10589297，eutils 已核） |
| 社区/真人连接 | SDT 归属需要：单靠游戏设计元素难以满足归属感 | Mitchell, Schuster & Jin 2022, Health Promotion International（PMID: 34651180，eutils 已核；N=236 调查 + N=20 访谈） |
| 固定时间/地点提示 | 习惯=情境触发的重复反应 | Wood & Rünger 2016, Annual Review of Psychology（PMID: 26361052，eutils 已核） |
| 游戏化整体（对身体活动） | 小效应且衰减：16 项 RCT、N=2,407，g=0.42；vs 非游戏化主动对照仅 g=0.23；14 周随访衰减至 g=0.15 | Mazeas et al. 2022, JMIR（PMID: 34982715，eutils 已核） |
| 游戏化整体（学习） | 认知 g=.49、动机 g=.36、行为 g=.25 均小效应；叙事与「竞合混合」是显著调节变量 | Sailer & Homner 2020（DOI: 10.1007/s10648-019-09498-w）；Koivisto & Hamari 2019 综述 819 项研究，混合结果数量「remarkable」（DOI: 10.1016/j.ijinfomgt.2018.10.013） |

### 4.2 反效果证据（一手）

1. **外在奖励挤出内在动机**：Deci, Koestner & Ryan 1999（Psychological Bulletin，PMID: 10589297）：128 个实验的元分析——参与挂钩、完成挂钩、表现挂钩的**预期有形奖励**均显著削弱内在动机（d = −0.40 / −0.36 / −0.28）；正面反馈则增强。原始实验：Deci 1971（DOI: 10.1037/h0030644，Crossref 已核）。**设计分界线：奖励被感知为「预期的、有形的」就有挤出风险；胜任反馈是增强项。**
2. **Streak 断裂引发弃用**：Silverman & Barasch 2022, Journal of Consumer Research（DOI: 10.1093/jcr/ucac029）：7 项研究——完整 streak 被高亮提升参与，**断裂的 streak 被高亮后参与显著下降**；效应取决于日志呈现方式而非真实行为；归因于自己时负效应放大；**提供「修复」（repair）机制可削弱负效应**。作者明确警告公司在健身/学习场景高亮 streak 的断裂代价。
3. **「断即归零」违背习惯科学**：Lally et al. 2010（DOI: 10.1002/ejsp.674）：习惯自动化中位 66 天（范围 18–254），**漏做一次不会显著重置习惯形成进程**——任何「漏一天就清零/重来」的设计（如 75 Hard）都与习惯形成证据冲突。
4. **PBL 拉量不拉动机**：Mekler et al. 2017, Computers in Human Behavior（DOI: 10.1016/j.chb.2015.08.048）：积分/等级/排行榜显著提高产出**数量**，但对内在动机与胜任感**无显著影响**，也未提高质量。
5. **Snapchat streak 与问题性使用相关**：van Essen & Van Ouytsel 2023, Telematics and Informatics Reports（DOI: 10.1016/j.teler.2023.100087）：2,483 名早期青少年横断面——参与 streak 与问题性手机使用、FOMO 显著相关（横断面，不能定因果）。Snapchat 官方 streak 规则见官方帮助页（help.snapchat.com，一手）——「每天至少互发一次，断即归零」正是激进 streak 的范式。
6. **功能堆砌有过载拐点**：Sun, Dong & Jiang 2025, Frontiers in Psychology（PMID: 41159167，eutils 已核）：游戏化功能丰富度与锻炼坚持意愿呈 S 形——适度提升意愿，**功能过多进入「过载区」反而削弱**。
7. **健康游戏化的证据底座本身偏弱**：Johnson et al. 2016（PMID: 30135818）：19 篇实证中 41% 混合效果，证据质量多为中等或更低，多数缺少与非游戏化版本的对照。
8. **可穿戴弃用基线**：Beckett et al. 2025, JMIR（PMID: 39946694）：使用时长中位数 7→18 个月（2016 vs 2023），弃用原因从「该学的都学会了」转为「不满意」；数据社交分享率 35%→73%——**新鲜感消退后靠功能深度留人，分享已成主流行为**。行业白皮书参照：Endeavour Partners 2014《Inside Wearables》（非同行评审）：过半运动追踪器拥有者停用、约三分之一六个月内停用。

---

## 五、付费意愿与市场定位（一手数据）

> 检验「中国健身用户付费意愿低、需优先海外」的假设。结论：**付费渗透率假设被部分反驳，付费深度假设成立；海外高客单订阅同样在承压。**

### 5.1 一手数据表

| 产品 | 指标 | 数字 | 出处 | 级别 |
|---|---|---|---|---|
| Keep（3650.HK） | 2024 平均 MAU / 月度订阅会员 / 渗透率 | 2,992.1 万 / 316.2 万 / **10.6%** | Keep 2024 年报（HKEX） | 官方已核 |
| Keep | 月均每 MAU 收入 / 2024 总营收 | **RMB 5.8** / RMB 21 亿（-3.4%），经调整净亏 4.7 亿 | 同上 | 官方已核 |
| Duolingo（参照） | Q1 FY2026 DAU / MAU / 付费订阅 | 5,650 万 / 1.378 亿 / 1,250 万 → **付费/MAU≈9.1%** | Q1FY26 股东信（SEC） | 官方已核 |
| Peloton | Connected Fitness 付费订阅 | FY2024 297.6 万 → FY2025 280.0 万 → FY2026 255.3 万，**连续下滑**；月 churn 1.4%→1.7% | 10-K FY2026（SEC） | 官方已核 |
| Planet Fitness | FY2025 会员 / 门店 / 营收 | **2,080 万会员** / 2,896 家店 / $13 亿 | 10-K FY2025（SEC） | 官方已核 |
| Planet Fitness | 定价 | 2024 年「25 年来首次上调新会员 Classic Card 价格」（$10 时代结束） | Q4 2024 官方新闻稿 | 官方已核 |
| Strava | 订阅价 / 付费用户数 | 年付约 $80 量级（地区定价页）；**付费用户数官方从未披露** | strava.com/subscribe | 官方（价格）；用户数=未披露 |
| AllTrails | 规模（2021-11 融资稿） | 下载 4,000 万+、社区 3,000 万+；流传的「100 万付费」出自 TechCrunch 报道，**官方稿未披露** | PR Newswire 官方稿 | 官方已核（规模）；付费=二手 |
| Calm / Headspace | 下载量 | 1.8 亿+ / 1.05 亿+；均无付费数据 | calm.com/about；headspace.com/about-us | 官方已核 |
| MyFitnessPal | 用户数 | 官网反爬，未核实 | — | 未核实 |

### 5.2 证据小结

- **有一手支撑的结论**：
  1. Keep 会员渗透率 10.6% 与 Duolingo ~9.1% 同量级——**「中文用户不为内容/会员付费」被部分反驳**；
  2. 差距在 **ARPPU**：Keep 月均每 MAU 收入 RMB 5.8（约 $0.8），海外参照系是 Planet Fitness ~$10–25/月、Peloton 月 churn 仅 1.7%、Strava 年付 ~$80——**海外单用户付费深度高一个数量级**；
  3. 海外健身订阅并非普惠：Peloton 订阅数连续两年下滑——高客单健身订阅在海外也承压。
- **仍是未验证假设**：没有任何一手数据直接对比「中美健身 app 用户付费意愿」（意愿 ≠ 实际付费，受定价、收入、替代品影响）。Keep 是目前可得的最好中文市场锚点；海外侧应用上市公司锚点（PLNT/PTON/DUOL）而非传闻数据。
- **对 MaxPower 的含义**：优先海外市场的理由应表述为「付费深度（ARPPU）与订阅习惯」而非「付费意愿有无」；定价锚点应对标 $10–25/月档（Planet Fitness 心智）而非 Keep 的 RMB 5.8/MAU。

### 5.3 海外健身梗文化的一手载体

- **Planet Fitness「Judgement Free Zone」**：10-K 使命宣言原文 "providing a high-quality fitness experience in a welcoming, non-intimidating environment, which we call the Judgement Free Zone"——**把「反健身房恐吓/不羞辱」写进 SEC 文件的品牌定位**，支撑 2,080 万付费会员。这是与 MaxPower 纪律最同构的商业先例。
- **75 Hard（Andy Frisella）**：官方规则页——每天 2 次 45 分钟锻炼（1 次必须户外）、严格饮食无欺骗餐、每天 1 加仑水、读书、进度照，**任何一天失败从第 1 天重来**；官方自述「全球超 100 万人完成」、#75HARD 帖子 170 万+；官方定位「不是健身挑战，是心理韧性项目」。这是「严苛 streak + 失败归零」的极限对照组——传播力极强，但正是 4.2 节反效果证据指向的设计。
- **Gymshark**：官方 about 页 "We exist to unite the conditioning community"，社媒粉丝 1,800 万+（官方自述）——社群+运动员营销的官方表述。
- 未核实（反爬）：Planet Fitness Lunk Alarm 官方描述、Reddit 梗社区（r/gymmemes、r/nattyornot）成员数、Apple「Close Your Rings」官方文档正文。

---

## 六、营销打法与「严谨也可以有趣」的差异化案例

### 6.1 可核实的病毒营销打法

| 打法 | 一手出处 | 官方量化数据 | 级别 |
|---|---|---|---|
| **Duolingo「Dead Duo」事件营销**（2025-02，官方宣布吉祥物猫头鹰「死亡」的 whodunit 悬疑剧） | [Q1 FY2025 股东信（SEC 8-K 附件，2025-05-01）](https://www.sec.gov/Archives/edgar/data/1562088/000156208825000098/q1fy25duolingo3-31x25share.htm) | 原文逐字核验：「we launched one of our most successful marketing campaigns ever and **spent practically nothing** on it: Dead Duo. This social-led narrative—a 'whodunit' mystery—generated **1.7 billion organic impressions**, and drove a meaningful lift in new and resurrected users」 | 一手已核 |
| Duolingo 增长的财务兑现 | [Q3 2025 官方新闻稿（investors.duolingo.com）](https://investors.duolingo.com/news-releases/news-release-details/duolingo-surpasses-50-million-daily-active-users-grows-dau-36) | 「more than 50 million people now use Duolingo every day」，DAU +36%、收入 +41% | 一手已核 |
| **Spotify Wrapped 年度回顾卡片** | [Spotify newsroom 官方（2024-12-04）](https://newsroom.spotify.com/2024-12-04/10-years-spotify-wrapped/) | 「In 2023…Wrapped engaged a record **227 million monthly active users**」 | 一手已核 |
| **Strava Year in Sport 数据故事** | [官方新闻稿（2025-12-02）](https://press.strava.com/articles/strava-releases-12th-annual-year-in-sport-trend-report-2025) | 100 万俱乐部（一年翻近 4 倍）、140 亿 kudos、1.8 亿用户——**自家数据本身做成年度 PR 事件** | 一手已核 |
| **75 Hard 挑战模因** | [官方规则页](https://andyfrisella.com/pages/75hard-info) | 官方自述「全球超 100 万人完成」、#75HARD 帖子 170 万+（官方口径）；规则含「任何一天失败从第 1 天重来」 | 一手已核（规模为官方自述） |

**可核实性说明**：App Store 编辑推荐页、Keep 奖牌社交传播、Strava branded challenges 的官方量化数据本次均未核到一手出处，不收录。Duolingo 的样本说明一个规律：**最强传播不是买量，而是「官方亲自玩梗」**——代价是品牌必须有一个可以被玩的人格化符号（猫头鹰）。

### 6.2 「诚实/不装」作为卖点的案例

1. **MacroFactor「Adherence Neutral」（本调研最重要案例，与 MaxPower 纪律逐条同构）**
   官方设计纲领文章（Greg Nuckols，更新于 2025-09-12，[macrofactor.com/adherence-neutral](https://macrofactor.com/adherence-neutral/)），原文逐句核验：
   - 「Adherence neutrality refers to a lack of functional and visual elements」；
   - 「**nothing about MacroFactor will tell you that you're doing something bad**」；
   - 展示数据「**without any red numbers, pop-ups, warnings**」；
   - 教练功能刻意避免「coaching elements that would attempt to make people 'compensate'」——**未达标不补偿、不追讨**。
   这是一个营收健康（App Store 4.8 分、约 2 万评分，见 2026-08-14 报告）的订阅产品，把「不羞辱」写成官方设计纲领并成功立足。**「严谨+不羞辱」与商业成功不冲突的最直接证据。**

2. **Planet Fitness「Judgement Free Zone」**：把「反健身房恐吓」写进 10-K 使命宣言（原文见 5.3 节），支撑 2,080 万付费会员（FY2025 10-K，SEC）——「不羞辱」可以是健身房行业最大的品牌定位。【一手已核】

3. **Liquid Death**：官网首页一手文案已核——「MURDER YOUR THIRST」；「**PLASTIC RECYCLING IS A MYTH. MOST PLASTIC IS SENT TO LANDFILLS.** ALUMINUM IS INFINITELY RECYCLABLE.」——把行业不爱听的真话（塑料回收是神话）直接写上首页，用重金属美学卖矿泉水。营收数据官方未披露（官网无 press 页）。【品牌文案一手已核；经营数据未披露】

4. **Patagonia「Don't Buy This Jacket」（2011）**：黑色星期五在纽约时报刊登「别买这件夹克」广告——反消费主义立场的范式案例。**官方 stories 页面本次未能抓取（404/Wayback 限流），标注「官方页未直接核验」**，广告史实多源一致。

5. **Oatly「fckoatly.com」**：专门收集对自家投诉与批评的官网子站——站点真实存在（HTTP 200），内容本次未提取，**标注部分核实**。

6. **DuckDuckGo**：隐私卖点增长数据在其官方 traffic 页（JS 渲染，本次未提取），**标注未核实**。

### 6.3 「严谨也可以有趣」的设计原则（从上述案例提炼）

1. **诚实本身可以做梗**：Liquid Death 把「塑料回收是神话」写上首页——MaxPower 可以把「我们不显示肌肉激活百分比，因为单目视频测不出来」写成品牌文案级别的诚实梗。纪律即内容。
2. **不羞辱是定位而非缺陷**：MacroFactor（adherence neutral）与 Planet Fitness（Judgement Free Zone）证明「不羞辱」可以是最强差异化——且两者都商业成功。
3. **人格化符号是玩梗的前提**：Duolingo 有猫头鹰才能玩「Dead Duo」；MaxPower 的教练 agent 人格（一个「没有身体的教练」）本身就是可玩梗的符号。
4. **数据故事化**：Strava 把自家数据做成年度 PR；MaxPower 本地优先——年度回顾可以在本地生成、用户自愿分享，隐私叙事与 Wrapped 式传播不冲突。

---

## 七、对 MaxPower 的适配建议

> 产品现状锚点：教练 agent（只建议不强制）、Timeline 记录、复盘报告、恢复感知、替代推荐；纪律=不伪造精确数字、不做医疗声称、知识带证据分级、以执行者为准、本地优先。目标市场以海外为主，定价心智对标 $10–25/月档（Planet Fitness 锚点），而非 Keep 的 RMB 5.8/MAU（依据见第五章）。

### 7.1 可直接用（机制与纪律兼容）

1. **复盘报告即「明信片」**：旅行青蛙证明了「代理式陪伴」的情绪价值——MaxPower 的复盘报告天然是这个形态：用户不在场时教练在「备课」，回来交付一份有证据分级的复盘。把复盘报告做成**可截图的卡片**（Wrapped/Hevy Year in Review 已验证该形态），全部本地生成、用户自愿分享——隐私叙事不挡传播。
2. **收集/点亮式进度（零竞争）**：GPS 游戏的生死分水岭（3.1.9）证明零和争夺死、自我收集活。力量训练的翻译：**肌群地图点亮**（练过的肌群亮起来，附「预期肌肉关联是知识元数据、不是实测」的证据标注）、**动作图鉴**（每个完成过且有录像证据的动作变式入册）、**器械图鉴**。全部与自我比较，无陌生人零和。
3. **胜任反馈式提示**：Deci 1999 证明正面反馈增强内在动机（d=0.33）。教练提示优先用「你这次离心速度控制比上周稳」（基于真实录像证据）而非积分奖励——这与 MISSION 的「提示必须说明基于哪些可见证据」天然一致。
4. **目标梯度呈现**：周计划的近端进度条（Kivetz 2006 实证：接近目标行为加速）；GitHub 的先例提示：**强调「做了什么」而非「连续做了多久」**。
5. **留存优先于收入的实验纪律**：Duolingo 官方先例（关停增收但伤留存的实验）可直接引为产品决策原则。

### 7.2 需改造（机制有效但默认形态违反纪律或证据）

1. **Streak → 「可修复的连续性」**：必须有修复通道（Silverman & Barasch 2022 证明断裂高亮引发弃用、修复机制削弱负效应；Duolingo 的 Freeze/Wager/Amulet 是产品化先例）；**断不归零**（Lally 2010：漏做一次不重置习惯进程）；断裂后不红字、不羞辱（MacroFactor adherence-neutral 纲领）。具体形态建议：显示「本月训练 N 天」与「最长连续」并存，断裂只重置「当前连续」且提供「补记/修复」入口；恢复感知数据可直接充当「正当休息日」——**休息日不断 streak**（这是恢复感知功能的游戏化出口）。
2. **排行榜 → 分层小圈层**：Festinger 1954 的推论是与相似者比较才有效，Duolingo Leagues 的「相似学习习惯匹配」是官方先例；全服排行榜对新手是 Run An Empire 式零和挫败。建议：仅在同水平小圈层（同训练年限、同动作重量区间）内比较，且默认关闭。
3. **挑战活动 → 限时事件型、非归零**：75 Hard 证明了「严苛挑战」的传播力，但「失败从第 1 天重来」直接违反 Lally 2010 与 Silverman & Barasch 2022 的证据。改造为：限时完成型挑战（30 天练满 12 次），失败无惩罚、进度保留。
4. **通知 → 证据驱动、可关闭**：Duolingo 通知策略专文未找到（官方效果口径不可得），只采纳其「留存优先」原则；不采用羞辱式催收文案。

### 7.3 违反纪律不能用

1. **伪造精确数字**（如肌肉激活百分比、精确卡路里、伪造的「提升 X%」）——纪律红线；Black Box VR 官网「UCLA studies found…」类无出处效果声称是反面教材。
2. **羞辱式 streak / 失败归零**（75 Hard 式）——违反反效果证据（Silverman & Barasch 2022；Lally 2010）与「不羞辱」定位。
3. **医疗声称**（损伤风险判定、治疗暗示）——MISSION 已列 Out of scope。
4. **预期有形奖励挂钩训练完成**（练满 X 次返现/实物）——Deci 1999 挤出效应（d=−0.36~−0.40）；Keep 奖牌模式的爆款依赖（2024 年报收入下滑归因）也是商业侧警示。
5. **不可关闭的社交**——Hevy 经验（2026-08-14 报告）：社交必须可关闭，且不阻挡核心记录。

### 7.4 传播钩子候选（梗点设计，海外语境）

> 模因章节的结论：钩子必须一句话讲完、自带画面感、有身份反转或荒诞张力；模因管获客，留存靠 7.1/7.2。

1. **「The only coach with no body」/「你的教练没有身体」**：RentAHuman/GPT-4 事件证明了「AI 需要人类肉身」是 2026 年正在流行的母题。MaxPower 的反转版：**AI 教练无法碰哑铃，它理解力量训练的唯一方式是通过你的身体**——你的每次训练录像都在「教」它。钩子句候选："My coach is an AI. It can't lift. So it lives vicariously through my reps."
2. **诚实梗（Liquid Death 式口吻）**：「We don't show muscle activation percentages. Our camera can't see your muscles. Honesty is the feature.」——把纪律直接写成广告文案；与 MacroFactor 的 adherence-neutral 同属「诚实即定位」。
3. **训练轨迹艺术**：Strava art 的杠铃版——杠铃轨迹图、双侧节奏图本身就是可分享的作品（MaxPower 的 canonical packet 天然产出这些图）。
4. **「练了么」式签到玩笑的海外版**：死了么证明黑色幽默+真实需求可共存；海外健身梗文化（leg day、gym is my therapy）提供语料，但注意 Reddit 梗社区规模本次未能核实（反爬），投放前需另行验证渠道。

### 7.5 一句话路线图

**留存层**用 7.1（复盘明信片+点亮收集+胜任反馈），**传播层**用 7.4（无身体教练梗+诚实梗+轨迹艺术+可截图卡片），**纪律红线**守 7.3——「有趣」来自人格、叙事与作品感，不来自伪造的数字与羞辱。

---

## 八、全部引用清单（按可核实级别分组）

**级别定义**：一手已核=官方页面/文件/论文本次实际抓取并核对原文；二手=正式媒体直接报道；部分核实=站点存在但关键内容未提取或官方页不可达但史实多源一致；未核实=出处未找到，正文仅作背景不据此下结论。

### A. 同行评审/学术文献（19 条，全部经 eutils 或 Crossref 核验）

1. Deci, Koestner & Ryan 1999, Psychological Bulletin — PMID: 10589297（eutils 已核）
2. Deci 1971, JPSP — DOI: 10.1037/h0030644（Crossref 已核）
3. Silverman & Barasch 2022, J Consumer Research — DOI: 10.1093/jcr/ucac029（Crossref+OpenAlex 已核）
4. Mehr, Silverman & Sharif 2025, OBHDP — DOI: 10.1016/j.obhdp.2025.104391（Crossref+OpenAlex 已核）
5. Mekler et al. 2017, Computers in Human Behavior — DOI: 10.1016/j.chb.2015.08.048（Crossref 已核）
6. Sailer & Homner 2020, Educational Psychology Review — DOI: 10.1007/s10648-019-09498-w（Crossref 已核）
7. Koivisto & Hamari 2019, IJIM — DOI: 10.1016/j.ijinfomgt.2018.10.013（Crossref 已核）
8. Johnson et al. 2016, Internet Interventions — PMID: 30135818（eutils 已核）
9. Mazeas et al. 2022, JMIR — PMID: 34982715（eutils 已核）
10. Beckett et al. 2025, JMIR — PMID: 39946694（eutils 已核）
11. Lally et al. 2010, EJSP — DOI: 10.1002/ejsp.674（题录已核；摘要未全文抓取）
12. Wood & Rünger 2016, Annu Rev Psychol — PMID: 26361052（eutils 已核）
13. Kahneman & Tversky 1979, Econometrica — DOI: 10.2307/1914185（Crossref 已核）
14. Kivetz et al. 2006, JMR — DOI: 10.1509/jmkr.43.1.39（Crossref+OpenAlex 已核）
15. Festinger 1954, Human Relations — DOI: 10.1177/001872675400700202（Crossref 已核）
16. Mitchell et al. 2022, Health Promotion International — PMID: 34651180（eutils 已核）
17. Sun, Dong & Jiang 2025, Frontiers in Psychology — PMID: 41159167（eutils 已核）
18. Li, Hew & Du 2024, ETR&D — DOI: 10.1007/s11423-023-10337-7（Crossref 已核）
19. van Essen & Van Ouytsel 2023, Telematics and Informatics Reports — DOI: 10.1016/j.teler.2023.100087（Crossref 已核）
20. Pokémon GO 身体活动系统综述, J Clin Med 2021 — PMID: 33922978（eutils 已核）；衰退研究 Healthcare 2025 — PMID: 41008464（eutils 已核）

### B. 官方一手（页面/文件本次已核）

21. OpenAI GPT-4 System Card — https://cdn.openai.com/papers/gpt-4-system-card.pdf（TaskRabbit 段落逐字核验）
22. Duolingo streak 机制官方博客 2022 — https://blog.duolingo.com/how-duolingo-streak-builds-habit/
23. Duolingo Streak Wager/Weekend Amulet A/B 官方博客 2017 — https://blog.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals/
24. Duolingo streak 代际差异官方博客 2023 — https://blog.duolingo.com/which-generation-most-serious-about-streak/
25. Duolingo FY2025 10-K（streak 用户数） — https://www.sec.gov/Archives/edgar/data/1562088/000162828026012494/duol-20251231.htm
26. Duolingo 增长模型（CURR）官方博客 2023 — https://blog.duolingo.com/growth-model-duolingo/
27. Duolingo Leagues 官方博客 2023 — https://blog.duolingo.com/duolingo-leagues-leaderboards/
28. Duolingo 实验复盘（留存优先于收入）官方博客 2020 — https://blog.duolingo.com/improving-duolingo-one-experiment-at-a-time/
29. Duolingo Q1 FY2025 股东信（Dead Duo 1.7B impressions，逐字核验） — https://www.sec.gov/Archives/edgar/data/1562088/000156208825000098/q1fy25duolingo3-31x25share.htm
29b. Duolingo Q1 FY2026 股东信（DAU 5,650 万、付费 1,250 万） — https://www.sec.gov/Archives/edgar/data/1562088/000162828026029790/q1fy26duolingo3-31x26share.htm
30. Duolingo Q3 2025 官方新闻稿（DAU 50M+） — https://investors.duolingo.com/news-releases/news-release-details/duolingo-surpasses-50-million-daily-active-users-grows-dau-36
31. Strava Year in Sport 2025 官方新闻稿 — https://press.strava.com/articles/strava-releases-12th-annual-year-in-sport-trend-report-2025
32. Apple Watch 官方支持文档（三环） — https://support.apple.com/en-us/guide/watch/track-daily-activity-apd3bf6d85a6/watchos
33. Keep 2024 年报（HKEX） — https://www1.hkexnews.hk/listedco/listconews/sehk/2025/0425/2025042501301.pdf
34. Nike Run Club 官方页 — https://www.nike.com/nrc-app
35. Fitbod 官网 — https://fitbod.me
36. Hevy 官方功能页 — https://www.hevyapp.com/features
37. Strong 官网 — https://strong.app
38. Peloton Q1 FY2022 股东信（SEC） — https://www.sec.gov/Archives/edgar/data/1639825/000163982521000320/shareholderletter2022q1.htm
39. Peloton 10-K FY2026 — https://www.sec.gov/Archives/edgar/data/1639825/000163982526000038/pton-20260630.htm
40. Planet Fitness 10-K FY2025 — https://www.sec.gov/Archives/edgar/data/1637207/000163720726000011/plnt-20251231.htm
41. Planet Fitness Q4 2024 官方新闻稿 — https://investor.planetfitness.com/investors/press-releases/press-release-details/2025/Planet-Fitness-Inc.-Announces-Fourth-Quarter-and-Year-End-2024-Results/default.aspx
42. AllTrails 融资官方稿 — https://www.prnewswire.com/news-releases/alltrails-raises-150-million-investment-led-by-permira-301426232.html
43. Calm about — https://www.calm.com/about
44. Headspace about — https://www.headspace.com/about-us
45. Strava 订阅定价页 — https://www.strava.com/subscribe
46. 75 Hard 官方规则页 — https://andyfrisella.com/pages/75hard-info
47. Gymshark 官方 about 页（社群策略表述）
48. Strava Stories GPS art 专文 — https://stories.strava.com/articles/how-hard-is-it-to-make-strava-art
49. Run An Empire App Store — https://apps.apple.com/us/app/run-an-empire/id1073986257
50. Fog of World 官网/App Store — https://www.fogofworld.com/ ; https://apps.apple.com/us/app/fog-of-world/id505367096
51. CityStrides about — https://citystrides.com/about
52. Wandrer 官网 — https://wandrer.earth/
53. Squadrats App Store — https://apps.apple.com/us/app/squadrats/id1665905597
54. Pan Studio Run An Empire 项目页 — https://panstudio.co.uk/project/run-an-empire/
55. Die With Me 官网 — https://diewithme.online
56. RentAHuman 官网 — https://rentahuman.ai
57. Payman 官网 — https://paymanai.com/about-us
58. Snapchat Streaks 官方帮助页 — https://help.snapchat.com/hc/en-us/articles/7012394193684-How-do-Streaks-work-and-when-do-they-expire
59. Voodoo 收购 BeReal 官方新闻稿 — https://voodoo.io/news/voodoo-acquires-bereal
60. GitHub 官方博客（移除 streak，逐句核验） — https://github.blog/news-insights/product-news/more-contributions-on-your-profile/
61. Spotify newsroom「10 Years of Wrapped」 — https://newsroom.spotify.com/2024-12-04/10-years-spotify-wrapped/
62. MacroFactor「Adherence Neutral」官方文章 — https://macrofactor.com/adherence-neutral/
63. Liquid Death 官网首页文案 — https://liquiddeath.com/
64. Zombies, Run! 官网 — https://zombiesrungame.com/
65. Forest 官网 — https://www.forestapp.cc/
66. Habitica 官网 — https://habitica.com/static/home
67. Black Box VR 官网（效果声称标注未核实） — https://www.blackbox-vr.com/
68. Quell 官网 — https://playquell.com/

### C. 二级来源（正式媒体直接报道）

69. 南都「死了么」报道 — https://m.mp.oeeee.com/a/BAAFRD0000202601151509747.html
70. 36氪「电子木鱼」报道 — https://m.36kr.com/p/1967414475473667
71. 经济观察网「羊了个羊」报道 — http://m.eeo.com.cn/2022/0916/558161.shtml
72. 界面新闻「啫喱」报道 — https://m.jiemian.com/article/7106067.html
73. 中新网「旅行青蛙」报道 — https://www.chinanews.com.cn/m/sh/2018/01/31/8437199.shtml
74. 财新「阿里代理旅行青蛙」 — https://companies.caixin.com/2018-04-02/101229624.html
75. NPR「Yo 融资」 — https://www.npr.org/2014/06/20/323844591/yo-app-raises-1-million
76. TechCrunch Yo 系列 — https://techcrunch.com/2014/06/18/hands-on-with-yo-the-absurdly-simple-messaging-app/ ; https://techcrunch.com/2014/07/18/yo-raises-1-5m-in-funding-at-a-10m-valuation-investors-include-betaworks-and-pete-cashmore
77. MacRumors「I Am Rich」 — https://www.macrumors.com/2008/08/07/8-people-bought-999-99-i-am-rich-app/
78. Wired「S.M.T.H.」 — https://www.wired.com/2013/09/send-me-to-heaven-app/
79. Deseret News「Finger on the App」 — https://www.deseret.com/entertainment/2020/7/6/21314775/mrbeast-finger-on-the-app-competition/
80. WIRED「RentAHuman 调查」（经搜索结果转述）
81. Variety「Run An Empire 上线」 — https://variety.com/2018/gaming/news/ar-game-run-an-empire-1202965000/

### D. 行业白皮书（非同行评审，单独标注）

82. Endeavour Partners 2014《Inside Wearables》（GlobeNewswire 2014-08-15 官方新闻稿佐证存在性）

### E. 部分核实/未核实（正文仅作背景）

83. 蚂蚁森林 UNEP 2019 地球卫士奖：官方页未能抓取（403/Wayback 限流）——部分核实
84. 微信运动步数排行榜：官方一手出处未找到——出处未核实
85. Wordle 官方玩家数（nytco.com 被反爬拦截）——未核实
86. Khan Academy 徽章官方页（JS 挑战拦截）——未核实
87. Patagonia「Don't Buy This Jacket」官方 stories 页（404/Wayback 限流）——部分核实
88. Oatly fckoatly.com（站点 200，内容未提取）——部分核实
89. DuckDuckGo traffic 页（JS 渲染未提取）——未核实
90. Planet Fitness Lunk Alarm 官方描述、Reddit 梗社区成员数（反爬 403）——未核实
91. Apple Heart and Movement Study「合环」主题论文——未找到
92. Duolingo push 通知策略专文——未找到
93. Strava segments/kudos/clubs 逐条官方帮助页——一手未找到
94. Peloton badges/leaderboard 官方帮助页（401）——未核实
95. Ring Fit Adventure 官方精确销量页（不在 top10 页）——未找到

### F. 传闻（已证伪，仅作反例引用）

96. 「羊了个羊日入 468 万」截图——马化腾辟谣为 PS（经济观察网报道）
97. 「羊了个羊 6000 万挑战」——游戏前端显示数字，开发者从未公布真实 DAU（经济观察网报道）

### 引用统计

- **一手已核：68 条**（A 类学术 20 条 + B 类官方 48 条）
- **二手（正式媒体）：13 条**（C 类）
- **行业白皮书：1 条**（D 类）
- **部分核实/未核实：13 条**（E 类，正文均已标注、不作结论依据）
- **传闻反例：2 条**（F 类）
- 跨领域/模因部分（第二、三章引用）：一手已核约 20 条、二手 13 条——**一手占比约 60%**；中文模因案例全部为二级媒体来源（该市场无官方数据披露习惯，已在第三章注明）。
- 海外市场案例占比：第三章模因主章 9 个海外案例 vs 5 个中文对照案例（64% 海外）；全报告海外一手来源占绝大多数（B 类 48 条中中文来源仅 Keep 年报 1 条）。
