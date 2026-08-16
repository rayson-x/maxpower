# 普通健身教练知识库：公开资料语料审计

> 核验日期：2026-08-13  
> 范围：健康成年人；增肌、减脂、体型改善、训练计划、基础营养、恢复、行为改变，以及最小必要的安全筛查与转介。  
> 排除：康复治疗、疾病运动处方、伤病诊断、药物或临床营养决策。

## 结论先行

并不是只有书籍。公开资料足以搭建一版质量很高的教练知识库，而且有些资料比教材更适合作为“持续更新层”：新共识、立场声明、系统综述、政府指南和结构化数据库可以持续补充教材中已经过时的部分。

但“网页上能免费读”不等于“可以交给 `book-to-skill` 改写并用于商业知识库”。本次核验后，资料应分成三层：

1. **可立即导入**：CC0、CC BY 或明确属于公共领域，且没有额外的 AI ingestion 禁令；可以下载 PDF/HTML/XML/JSON，保留许可证和引用后进行蒸馏。
2. **需许可审核**：虽然免费阅读，但含 NC、ND、SA、禁止 AI ingestion、禁止修改或没有明确开放许可；只能先做索引或人工提炼事实，不能把全文直接批量转换。
3. **只作索引**：提供题录、摘要、DOI、开放状态或统计数据入口，不授予底层论文全文的再利用权。

首版不需要抓取“所有健身论文”。最稳妥的组合是：

- 以 **2026 ACSM 抗阻训练立场声明、IUSCA 增肌立场声明、ISSN/JISSN 营养立场声明**建立训练与营养主线；
- 以 **HHS/ODPHP、WHO、中国营养学会/国家卫健委**建立公共健康和本地化边界；
- 以 **USDA FoodData Central**建立食物营养数据层；
- 以 **PMC Open Access Subset / Europe PMC**获得有明确许可证的论文原文；
- 以 **Crossref、OpenAlex、DOAJ**做发现、版本和引用追踪，而不是把其元数据误当成论文全文。

`book-to-skill` 解决的是结构提取和蒸馏，不解决版权。每份来源都必须先经过许可证闸门。

## 判定标准

### “免费阅读”和“开放许可”

- **免费阅读（free to read）**：用户可以浏览或下载，但版权人可能仍保留全部权利。
- **开放许可（openly licensed）**：许可证明确允许复制、再分发，部分许可证还允许修改和商业使用。
- **适合自动蒸馏**：至少需要允许制作改编内容；最稳妥的是 CC0、CC BY 或明确公共领域。
- **不宜自动蒸馏**：CC BY-ND、CC BY-NC-ND、只允许原样复制、明确禁止 AI ingestion，或许可不明。

即使来源允许改编，也要单独检查图表、照片、量表、问卷和附件是否标注为第三方材料。

## 第一层：可立即导入的公开语料

### 1. 增肌与抗阻训练

| 来源 | 能解决的问题 | 获取与格式 | 权利状态 | 导入建议 | 更新节奏 |
|---|---|---|---|---|---|
| [IUSCA：Resistance Training Recommendations to Maximize Muscle Hypertrophy](https://journal.iusca.org/index.php/Journal/article/view/81) | 训练量、频率、负荷、组间休息、动作选择、动作幅度、接近力竭、周期安排 | HTML、PDF | 文章明确为 **CC BY 4.0** | 可直接进入首批 `book-to-skill`；保存 DOI `10.47206/ijsc.v1i1.81` 和许可快照 | 无固定周期；建议每半年检查新版或勘误 |
| [JISSN：ISSN Position Stand—Protein and Exercise](https://jissn.biomedcentral.com/articles/10.1186/s12970-017-0177-8) | 蛋白质总量、单次剂量、分配、来源、训练人群适用范围 | HTML、PDF；PMC 通常还有 JATS XML | 文章级开放许可，页面底部给出 CC 条款 | 首批导入；把剂量结论标成“2017 立场”，后续用新综述复核 | 有新版时更新；至少每年检查 |
| [JISSN：ISSN Position Stand—Diets and Body Composition](https://jissn.biomedcentral.com/articles/10.1186/s12970-017-0174-y) | 能量平衡、不同饮食模式、减脂、增肌与体成分变化 | HTML、PDF、可经 PMC/Europe PMC 获得 XML | 开放获取；应读取文章中的具体 CC 许可 | 首批导入；非常适合“减脂不是某个神奇饮食法”的规则层 | 至少每年做更新审查 |
| [JISSN：ISSN Position Stand—Nutrient Timing](https://jissn.biomedcentral.com/articles/10.1186/s12970-017-0189-4) | 训练前后进食、蛋白质和碳水时机、恢复 | HTML、PDF、可能有 XML | 开放获取，文章级 CC 许可 | 第二批导入；结论必须带适用场景，避免把运动员赛时策略用于普通用户 | 每年检查 |
| [JISSN：ISSN Position Stand—Creatine](https://jissn.biomedcentral.com/articles/10.1186/s12970-017-0173-z) | 肌酸有效性、安全性、使用场景 | PDF、HTML、可能有 XML | 开放获取，文章级 CC 许可 | 可作为补剂模块的主来源之一，但同时连接 NIH ODS 安全资料 | 每年检查是否出现更新版 |
| [JISSN：ISSN Position Stand—Caffeine and Exercise Performance](https://jissn.biomedcentral.com/articles/10.1186/s12970-020-00383-4) | 咖啡因剂量、时间、个体差异和副作用 | HTML、PDF、XML | **CC BY 4.0**，文章数据通常另有 CC0 声明 | 可导入，但运行时必须经过睡眠、焦虑、心血管症状和用药等安全边界 | 每年检查 |

这些 JISSN 文章适合做“营养与补剂基线”，但不能因为它们来自同一个专业组织就跳过利益冲突字段。蒸馏时应保留资助、作者披露、发表年份和证据级别。JISSN 的当前出版入口已经迁移，后续新版可从 [ISSN Position Stands 官方合集](https://www.tandfonline.com/journals/rssn20/collections/issn-position-stands)发现；真正取全文时仍优先走 PMC OA 官方接口并逐篇读取许可证，不能把期刊“开放获取”标签当成统一的商业改编授权。

### 2. 训练与营养的政府公共资料

| 来源 | 覆盖 | 获取与格式 | 权利状态 | 导入建议 | 更新节奏 |
|---|---|---|---|---|---|
| [Physical Activity Guidelines for Americans, 2nd ed.](https://odphp.health.gov/our-work/nutrition-physical-activity/physical-activity-guidelines/current-guidelines) 与 [2018 Scientific Report](https://odphp.health.gov/our-work/nutrition-physical-activity/physical-activity-guidelines/current-guidelines/scientific-report) | 普通成年人有氧、抗阻、久坐和健康收益的公共健康底线 | HTML、整本及分章 PDF、PPT | [ODPHP 明确说明其网站信息属于公共领域](https://odphp.health.gov/copyright-policy)；第三方图片除外 | 可导入文本与政府数据表；不要默认导入所有照片和外部插图 | 指南非年度更新；每半年检查官方更新进程 |
| [Dietary Guidelines for Americans, 2025–2030](https://odphp.health.gov/our-work/nutrition-physical-activity/dietary-guidelines/current-dietary-guidelines) | 健康饮食模式、食物选择与人群营养基线 | HTML、PDF | 美国联邦政府内容通常属公共领域；仍需排除第三方素材 | 作为国际参照，不覆盖中国 DRIs；导入时分离“科学证据”和“美国政策语境” | 法定约每 5 年更新一次 |
| [2025 Dietary Guidelines Advisory Committee Scientific Report](https://www.dietaryguidelines.gov/2025-advisory-committee-report) | 饮食模式、饮料、饱和脂肪、进餐频率、份量、体重管理及证据方法 | 整本和分章 PDF、补充材料 | 报告明确写明内容可无需许可使用和重印，不能暗示 HHS 背书 | 非常适合做营养证据底稿；建议按章节导入，不必一次处理整本 | 每 5 年一轮，期间关注勘误 |
| [USDA FoodData Central API](https://fdc.nal.usda.gov/api-guide/) 与 [下载页](https://fdc.nal.usda.gov/download-datasets/) | 食品宏量和微量营养素、份量、品牌食品标签 | REST JSON API、OpenAPI JSON/YAML、批量 JSON/CSV | 数据明确为**公共领域并以 CC0 1.0 发布** | 可直接建立结构化营养数据层；不要用 `book-to-skill` 处理，应该走数据库/API 导入 | Foundation Foods 每年 4/10 月；Branded API 每月；FNDDS 约每两年 |

FoodData Central 是美国食物数据库，不应直接替代中国食物成分表。它适合通用食材和国际品牌食品；中国本地食材需要另建来源和数据质量标记。

### 2.1 NIH/NIDDK 体重管理资料

[NIDDK Weight Management](https://www.niddk.nih.gov/health-information/weight-management) 覆盖能量平衡、健康减重、习惯改变、份量和需要医疗帮助的边界。[NIDDK 版权说明](https://www.niddk.nih.gov/copyright)说明多数站内内容不受版权限制，可以下载和再现；联合私营机构制作的文件、部分图形、照片和标志可能例外。

它适合进入“健康减重与转介边界”模块，但不应让普通健身 agent 生成肥胖症诊断、药物建议或治疗方案。导入时仅保留 NIDDK 自有文本，删除标志和第三方图形，生成的知识条目标注为独立摘要，不能暗示 NIH/NIDDK 为产品背书。页面以 `Last Reviewed` 为版本信号，建议每半年检查一次。

### 3. 行为改变与教练沟通

| 来源 | 覆盖 | 获取与格式 | 权利状态 | 导入建议 | 更新节奏 |
|---|---|---|---|---|---|
| [The Behaviour Change Wheel / COM-B 原始论文](https://implementationscience.biomedcentral.com/articles/10.1186/1748-5908-6-42) | 用能力、机会、动机诊断执行障碍；选择干预功能 | HTML、PDF、PMC XML | 原论文为开放获取 CC 许可 | 可导入理论和论文中的定义；不要把后续商业书籍或付费工具误当成同一许可 | 理论稳定；每 2–3 年查应用综述 |
| [Self-Determination Theory 与健康行为、动机访谈的互补性](https://doi.org/10.1186/1479-5868-9-18) | 自主支持、胜任感、关系感、非控制式沟通 | HTML、PDF | 开放获取，文章级 CC 许可 | 适合蒸馏为教练对话原则，不要改造成心理治疗脚本 | 理论稳定；每 2–3 年查综述 |
| [Exercise, Physical Activity, and Self-Determination Theory: Systematic Review](https://doi.org/10.1186/1479-5868-9-78) | 动机类型与运动坚持的证据 | HTML、PDF、可能有 XML | 开放获取，文章级 CC 许可 | 用于给行为规则附证据强度和不确定性 | 每 2 年查更新综述 |

行为改变资料应生成“询问—倾听—共同选择—小步行动—复盘”的对话规则，而不是诊断人格或精神健康问题。

### 4. 开放论文全文基础设施

| 来源 | 提供什么 | 格式 | 权利与风险 | 本地用途 | 更新节奏 |
|---|---|---|---|---|---|
| [PMC Open Access Subset](https://pmc.ncbi.nlm.nih.gov/tools/openftlist/) | 数百万篇许可允许再利用的生物医学论文 | JATS XML、纯文本、PDF、附件；OAI-PMH、FTP、Cloud、E-utilities、BioC | **不是所有 PMC 文章都可再利用**。应只选 `CC0` 或 `CC BY`；PMC 还区分允许商业使用、仅非商业和 Other | 最佳论文语料入口；按主题和许可白名单取小批量，不要抓主站 | 持续更新；建议每月增量 |
| [PMC OAI-PMH API](https://pmc.ncbi.nlm.nih.gov/tools/oai/) | OA 子集的元数据和全文 XML | JATS XML、Dublin Core | 官方允许的自动化获取通道；有速率要求 | 建议作为首选采集接口，优于解析网页/PDF | 持续更新 |
| [Europe PMC Open Access Subset](https://europepmc.org/downloads/openaccess) | PMC/Europe PMC 的 OA 全文和补充材料 | REST/SOAP、OAI、FTP；XML、PDF | 每篇许可不同；只用明确允许改编和目标用途的许可证 | 作为 PMC 的检索和访问补充；XML 比 PDF 更适合蒸馏 | XML 目录通常每周，PDF 目录通常每月 |

推荐许可白名单：`CC0`、`CC BY`。`CC BY-SA` 需要评估知识库输出是否必须以相同许可证分享；`CC BY-NC` 与商业产品冲突；`CC BY-ND` 不适合自动改写；`Other` 默认拒绝。

## 第二层：免费可读，但需许可或用途审核

### ACSM 2026 抗阻训练立场声明

[American College of Sports Medicine Position Stand: Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults](https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823/) 是当前最重要的普通成年人抗阻训练总纲之一，2026 年发表，纳入 137 个系统综述和超过 30,000 名参与者。它覆盖力量、增肌、功率、肌耐力和身体功能。

但全文采用 **CC BY-NC-ND 4.0**：可以非商业下载和分享，必须署名，不能制作改编版本，也不能商业使用。因此：

- 可以免费阅读、链接、保存未经修改的许可副本；
- 不建议直接用 `book-to-skill` 自动改写全文；
- 商业知识库应把它作为“高权重索引来源”，人工提取不受版权保护的事实、数值和结论，并以自己的表述记录，同时保留精确引用；
- 若要系统性改编或复用其图表，应向期刊/ACSM 申请许可。

[ACSM 官方立场声明目录](https://acsm.org/education-resources/pronouncements-scientific-communications/position-stands/) 说明当前立场声明都对公众免费，但“免费”本身不是开放改编许可。每篇仍应检查文章页许可证。
ACSM 的网站条款还限制未经许可的抓取、存储、复制和派生使用，因此自动化应只访问明确允许的 PMC OA 接口，不批量爬取 ACSM 网站或幻灯片资源。

### WHO 指南

[WHO Guidelines on Physical Activity and Sedentary Behaviour](https://www.who.int/publications/i/item/9789240015128) 有完整 PDF 和证据附录，许可证为 **CC BY-NC-SA 3.0 IGO**。

- 对非商业、同许可分享的知识库，可以在满足署名和相同许可的前提下改编；
- 对商业教练产品，不应直接蒸馏并发布；需要 WHO 许可；
- 第三方图表和图片可能不在许可证范围内；
- 最安全做法是把它作为政策边界和引用来源，核心运动规则优先使用公共领域 HHS 资料及可商业改编的开放论文。

### NIH ODS 膳食补充剂事实表

[Dietary Supplements for Exercise and Athletic Performance](https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/)、[Dietary Supplements for Weight Loss](https://ods.od.nih.gov/factsheets/WeightLoss-HealthProfessional/) 和 [ODS XML API](https://ods.od.nih.gov/api/) 很适合作为补剂安全与无效宣称核验层，支持 HTML、PDF 和 XML。

[ODS 使用政策](https://ods.od.nih.gov/About/Site_Policies/) 说明多数内容属于公共领域，可下载和复制，但要求内容不被改变或修改；站内链接的论文可能仍受版权保护。因此本项目应：

- 保留 ODS 原始快照作为只读证据；
- 在自己的知识库里重新表达事实并链接原页，而不是把 ODS 原文改写后冒充官方内容；
- 不复用可能来自第三方的图像；
- 页面更新没有统一固定周期，建议每月检查 `updated` 日期或 API 变化。

### OpenStax 开放教材

[OpenStax Anatomy and Physiology 2e](https://openstax.org/books/anatomy-and-physiology-2e/pages/preface) 可以免费在线阅读和下载 PDF，标注为 CC BY-NC-SA 4.0。它看起来像理想的开放教材，但其当前页面又明确写明：**未经 OpenStax 许可，不得用于训练大型语言模型，也不得以其他方式被摄入大型语言模型或生成式 AI 产品。**

因此，在获得书面许可前，不应交给 `book-to-skill`。CC 许可与页面上的额外 AI 条款存在需要法律审核的张力；本项目没有必要拿它做首批试验。

### NSCA 公开立场声明

[NSCA Position Statements](https://www.nsca.com/about-us/position-statements/) 提供多份免费网页或 PDF，适合核验职业标准、重返训练、老年抗阻训练等。但页面没有给所有文件统一的开放改编许可。

本项目仅需要其中的职业边界和安全参考。全文先做索引，不直接自动蒸馏；如某篇单独标出开放许可证，再移动到第一层。

### 2024 Adult Compendium of Physical Activities

[Compendium 官方下载页](https://pacompendium.com/adult-compendium/) 提供 PDF，适合活动 MET 值和能量消耗估算。论文许可为 **CC BY-NC-ND**，因此可以作为只读查表来源，但不适合商业知识库自动改编。更重要的是，MET 是人群平均估计，不应被包装成个人精确热量消耗。

## 第三层：只作发现、题录和版本索引

| 来源 | 可安全使用的部分 | 不能误用的部分 | 格式与更新 |
|---|---|---|---|
| [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) | DOI、题名、作者、期刊、发表时间、勘误/撤稿、许可链接等题录；多数元数据属于事实，Crossref 生成数据为 CC0 | 摘要版权通常归出版社或作者，不能因为 API 返回摘要就批量拿去蒸馏全文 | JSON；持续更新 |
| [OpenAlex](https://developers.openalex.org/) | 作品、作者、机构、主题、引用关系等数据；核心数据 **CC0** | OpenAlex 提供的 PDF 仍保留原始版权；必须检查 `best_oa_location.license` | REST API、JSONL 快照；公共快照季度更新，API 更频繁 |
| [DOAJ](https://doaj.org/terms/) | 期刊和文章元数据以 **CC0** 提供，可用来筛选真正开放期刊和许可证 | DOAJ 元数据的 CC0 不会改变论文全文版权 | API、OAI-PMH、CSV/数据转储；公共转储通常月度，部分服务更频繁 |
| [Europe PMC](https://europepmc.org/help) | 题录、开放状态、PMID/PMCID/DOI 映射；OA 子集按文章许可获取全文 | “有免费全文链接”不等于可再利用；非 OA 全文不能批量下载 | REST/SOAP/OAI/FTP；持续更新 |
| [PubMed/PMC](https://pmc.ncbi.nlm.nih.gov/about/copyright/) | 检索、题录、摘要和 OA 许可过滤 | PMC 中大量内容仅免费阅读；主站禁止系统批量下载；作者手稿可能只有 fair-use 范围 | E-utilities、OA API、XML |

这些服务非常适合做“证据雷达”：每月搜索新增综述、立场声明、勘误和撤稿，然后只把通过许可证和质量审核的全文送入蒸馏层。

## 中国本地公开资料

### 可作为权威基线，但默认不自动全文改编

| 来源 | 用途 | 公开形式 | 权利判断与建议 |
|---|---|---|---|
| [《中国居民膳食指南（2022）》八准则和核心推荐](https://www.cnsoc.org/bookpublica/0522202019.html) | 中国成年人食物选择、饮水、活动、盐油糖酒等本地化基线 | HTML；完整书籍另行出版 | 网页可读不等于开放许可。人工录入事实、数值和引用；不要复制长段原文 |
| [中国居民膳食指南图示与工具](https://dg.cnsoc.org/imgnewslist_0602_1.htm) | 膳食宝塔、餐盘等公众沟通 | 图片、HTML | 页面明确：图示仅限公益传播，禁止商业用途和篡改。商业知识库不得导入图片 |
| [DRIs（2023版）公开表格](https://www.cnsoc.org/drpostand/) | 中国人群能量、宏量和微量营养素参考摄入量 | HTML/表格图片 | 可用于人工核对和事实表；没有发现覆盖整部专著的开放许可证。保留来源和年龄/性别分组，不抓取整书 |
| [国家卫健委《成人肥胖食养指南（2024年版）》及问答](https://www.nhc.gov.cn/sps/c100088/202402/9ba512ba8e314a47a181db11d2fa188d/files/1743476135429_97340.pdf) | 中国成人体重管理与膳食语境 | PDF | 政府公开不等于明确开放改编。且内容涉及肥胖临床/食养，应仅用于转介边界和一般健康信息，不生成疾病处方 |
| [国家体育总局《全民健身指南》发布与应用说明](https://www.sport.gov.cn/n315/n9041/n9042/n9068/n9078/c867029/content.html) | 中国居民科学健身背景、强度监控和公共服务框架 | HTML；正式指南由出版社发行 | 官方网页可作索引；出版物不是开放教材，不直接转换 |
| [GB/T 34285-2017《健身运动安全指南》目录页](https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=7D6379A2F2D8A15BF8707C0A84C1D1D5) | 安全框架和标准编号 | 标准目录/可能的在线阅读 | 国家标准文本有专门权利和访问规则；先作索引，不自动蒸馏全文 |

中国层当前最大的缺口不是“没有公开内容”，而是缺少同时具备权威性、机器可读格式和明确开放再利用许可的完整语料。解决办法是人工构建一份**中国适用数值表**，每个字段只保存事实、单位、适用人群、版本和官方链接，不复制图示或大段表述。

## 可用于研究和质量校准的开放数据

### NHANES

[NHANES 数据与文档](https://wwwn.cdc.gov/nchs/nhanes/default.aspx) 提供人口学、膳食、身体测量、问卷和实验室数据，常见格式包括 XPT、SAS 文档和网页代码本。它可用于验证人群分布、测量误差和现实基线，但不应用来直接生成个人处方。

[NCHS Data User Agreement](https://www.cdc.gov/nchs/policy/data-user-agreement.html) 要求公共使用数据只能用于统计分析或报告，禁止尝试重新识别或与可识别数据链接。它不是普通“无条件开放数据”，应该放在分析环境，不进入教练运行时知识库。

### FoodData Central

FoodData Central 则更适合直接进入产品数据层。建议保存：`fdc_id`、食物描述、数据类型、营养素 ID、数值、单位、份量、数据来源、发布日期和更新时间。品牌标签值与实验测定值应分别标记，避免把标签数据当成实验室真值。

## 推荐首批语料包

首批控制在 12 个来源以内，可以覆盖教练知识库的主要决策，同时避免许可复杂度过高。

| 顺序 | 来源 | 目标模块 | 处理方式 |
|---:|---|---|---|
| 1 | IUSCA 增肌立场声明 | 增肌训练计划 | PDF/HTML → `book-to-skill`，保留 CC BY 4.0 |
| 2 | ISSN 蛋白质立场声明 | 蛋白质总量和分配 | HTML/XML 优先 → `book-to-skill` |
| 3 | ISSN 饮食与体成分立场声明 | 减脂、增肌与饮食模式 | HTML/XML → `book-to-skill` |
| 4 | ISSN 营养时机立场声明 | 训练前后进食和恢复 | HTML/XML → `book-to-skill` |
| 5 | ISSN 肌酸立场声明 | 补剂有效性 | HTML/XML → `book-to-skill` |
| 6 | ISSN 咖啡因立场声明 | 补剂和安全 | HTML/XML → `book-to-skill`，运行时加安全闸门 |
| 7 | HHS Physical Activity Guidelines 2e | 有氧、抗阻、久坐基线 | 分章 PDF → `book-to-skill` |
| 8 | 2025 DGAC Scientific Report 中与成年人、份量、进餐频率相关章节 | 营养证据底稿 | 仅导入相关章节，不处理全套附件 |
| 9 | COM-B 原始论文 | 执行障碍诊断 | HTML/XML → `book-to-skill` |
| 10 | SDT + Motivational Interviewing 互补性论文 | 教练沟通 | HTML/XML → `book-to-skill` |
| 11 | USDA FoodData Central Foundation Foods | 营养数据 | JSON/API → 结构化数据库，不走 `book-to-skill` |
| 12 | 中国膳食指南八准则 + 成人 DRIs 公开表 | 中国本地化数值 | 人工字段化并双人核验，不抓图、不长段复制 |

ACSM 2026 抗阻训练立场声明应同时进入“高权重只读参考”，但不列入自动改编包；人工将其关键结论与 IUSCA 结果对照，可作为首批知识条目的质量验收。

## 推荐的知识库结构

不要把公开资料直接堆成向量库。建议每条知识记录至少包含：

```yaml
claim_id: stable-id
domain: hypertrophy | fat_loss | nutrition | recovery | behavior | safety
claim: 用自己的语言表达的单一可检验陈述
population: 健康成年人；训练经验；性别/年龄限制
outcome: 肌肥大 | 力量 | 体脂 | 坚持率等
recommendation: 可执行建议
conditions: 适用条件
contraindications: 不适用/需要转介的条件
evidence_type: position_stand | systematic_review | guideline | database
source_title: ...
source_url: ...
doi_or_id: ...
publication_date: ...
source_version: ...
license: CC-BY-4.0 | CC0 | public-domain | index-only | review-required
license_url: ...
retrieved_at: 2026-08-13
last_reviewed_at: ...
supersedes: ...
conflict_of_interest: ...
confidence: high | moderate | low
```

每个运行时答案应引用“知识条目”，而不是直接拼接长段原文。剂量、阈值、次数等数字必须能够追溯到具体版本和段落。

## 导入规则和风险控制

### 许可证闸门

在下载或转换前保存一份 manifest：

- 来源 URL、DOI/PMCID、发布时间、抓取时间；
- 许可证名称和许可证 URL；
- 商业使用是否允许；
- 改编是否允许；
- 是否要求 ShareAlike；
- 是否含额外 AI ingestion 条款；
- 图片、量表和附件是否另有权利人。

没有明确许可证时，默认 `index-only`，不因“能下载 PDF”而升级权限。

### 证据质量闸门

- 专业组织立场声明不是永久真理，也要记录发布日期、检索截止日和利益冲突。
- 单个随机试验不能直接生成普适处方；优先系统综述、立场声明和指南。
- 补剂条目必须同时记录有效性、效应大小、风险、禁忌、质量控制和监管差异。
- 中国用户的营养数值优先中国 DRIs；美国/WHO 数值只作对照。
- “塑形”不是独立生理机制，应拆成增肌、减脂、体态呈现和用户审美目标，禁止局部减脂承诺。

### 安全与转介闸门

运行时只处理健康成年人。出现胸痛、晕厥、无法解释的呼吸困难、急性损伤、持续或加重疼痛、明显神经症状、疑似进食障碍、妊娠、严重慢病或药物相互作用问题时，停止个性化训练/营养建议并建议医疗专业人员评估。

安全问卷和筛查表通常有独立版权；例如 PAR-Q+ 等工具必须使用官方链接和条款，不能把表格文字直接复制进产品后声称是官方问卷。

## 更新机制

建议建立三种自动任务：

1. **每月**：查询 Crossref/OpenAlex/Europe PMC，寻找既有主题的新系统综述、立场声明、勘误与撤稿；同步 FoodData Central 品牌数据时要保留版本。
2. **每半年**：复查 ACSM、NSCA、IUSCA、ISSN、WHO、中国营养学会和国家卫健委的最新版页面；检查知识条目是否被新版本取代。
3. **每年**：人工审查所有含精确剂量、训练量阈值、补剂或安全规则的条目，记录继续有效、修改或废弃。

版本冲突时，不要简单让“最新日期”自动胜出。先比较目标人群、证据检索截止日、方法质量、效应大小和利益冲突，再由人工批准。

## 最小试验

在批量建设前，可以用一个小实验验证整个流程：

- **单一变量**：源格式，比较同一篇 IUSCA 文章的 PDF 与 HTML/XML 输入。
- **固定任务**：分别生成训练量、频率、负荷、力竭和休息间隔五类知识条目。
- **成功信号**：章节完整；所有数值能回链原文；没有遗漏适用人群和不确定性；没有大段复制；许可证元数据完整。
- **失败信号**：表格错位、数字脱离条件、把专家建议写成硬规则、引用无法定位、输出包含受限图表。
- **后续数据**：抽取准确率、人工修订时间、重复/冲突条目数、每条知识的来源覆盖数。

通过后再扩展到 ISSN 和政府指南。开放文献发现层不应在第一阶段批量下载百万级论文；先用 20–50 篇高权重文献验证质量和维护成本。

## 尚需确认的共同未知

1. 最终知识库是否用于收费产品或仅限内部教练使用；这会直接决定 NC/SA 资料能否进入。
2. `book-to-skill` 的产物是否会被公开分发，还是只在私有环境中作为检索材料；这会影响 ShareAlike 和再分发义务。
3. OpenStax 等来源的额外 AI 条款如何与其 CC 许可共同解释；在没有法律意见或书面许可前，应维持禁用。
4. 中国本地食物成分数据库的合法、机器可读来源仍需另行专项审计；不能用 USDA 数据假装覆盖中国食品。

## 官方来源索引

- [PMC Open Access Subset 与许可分组](https://pmc.ncbi.nlm.nih.gov/tools/openftlist/)
- [PMC Copyright Notice](https://pmc.ncbi.nlm.nih.gov/about/copyright/)
- [Europe PMC Open Access Subset](https://europepmc.org/downloads/openaccess)
- [Crossref 元数据许可说明](https://www.crossref.org/documentation/retrieve-metadata/)
- [OpenAlex 数据与 API](https://developers.openalex.org/)
- [OpenAlex PDF 原始版权提示](https://developers.openalex.org/download/full-text-pdfs)
- [DOAJ 元数据 CC0 条款](https://doaj.org/terms/)
- [USDA FoodData Central API 与 CC0](https://fdc.nal.usda.gov/api-guide/)
- [ODPHP 公共领域政策](https://odphp.health.gov/copyright-policy)
- [WHO 指南许可页](https://www.who.int/publications/i/item/9789240015128)
- [ODS 网站使用政策](https://ods.od.nih.gov/About/Site_Policies/)
- [OpenStax A&P 2e 许可与 AI 限制](https://openstax.org/books/anatomy-and-physiology-2e/pages/preface)
- [中国居民膳食指南图示使用限制](https://dg.cnsoc.org/imgnewslist_0602_1.htm)
