# 健身教练知识库书目：数字版与 book-to-skill 可转换性审计

核验日期：2026-08-13

范围：审计《fitness-book-primary-sources-agent.md》中的书目是否存在合法 PDF、EPUB、网页全文或受限电子版，以及它们能否作为 `book-to-skill` 的输入。没有搜索、下载或推荐盗版资源。

> 重要区分：**文件格式可读取，不等于获得了把整本书用于生成式 AI 或商业知识库的权利。** 本报告判断技术可行性，不构成法律意见。商业知识库应另行核对购买许可、出版社条款和必要的文本与数据挖掘/再利用权限。

## 结论

当前书目中，最适合先做合法格式测试的只有两个完整书来源：

1. *Motivational Interviewing in Nutrition and Fitness*, 2nd ed.：Guilford 官方销售无 DRM PDF，购买后会得到普通 `.pdf` 文件；格式上可直接交给 `book-to-skill`。
2. *Concurrent Aerobic and Strength Training*：Springer Nature 官方销售可下载 PDF 和 EPUB；购买或获得机构授权后，格式上可直接转换。

另有两个“条件可行”来源：

- 《中国居民膳食指南（2022）》和《中国居民膳食营养素参考摄入量（2023版）》有官方网页、图表或演示资料，可构建**公开网页资料子集**，但不是两本书的完整电子版。
- *How to Read a Paper*, 7th ed. 在 Wiley Online Library 的机构/订阅版本可能提供整书或逐章 PDF 下载；Wiley 零售电子书本身则不能下载成 PDF/EPUB。

其余大多数书由 Human Kinetics、Wolters Kluwer/LWW、Elsevier、Routledge 或 Cengage 通过 VitalSource、HKPropel 或自有阅读平台交付。它们可以在线或在阅读器中离线阅读，但不会提供可独立交给 `book-to-skill` 的普通 PDF/EPUB。

## 状态定义

| 级别 | 含义 | book-to-skill 路径 |
|---|---|---|
| A | 合法渠道可取得普通 PDF/EPUB，或有可保存的官方 HTML | 技术上可直接转换；使用前仍需核对授权 |
| B | 机构订阅或特定购买渠道可能提供可下载文件 | 取得文件并确认许可后转换 |
| C | 电子版被 VitalSource/HKPropel/平台 DRM 锁定 | 不绕过 DRM；改用人工章节笔记、出版社授权文件或公开论文 |
| D | 当前未发现完整合法数字版，或尚未正式发行 | 等待、购买纸书后人工整理，或寻找公开替代证据 |

## 逐书审计

### 主干与重点书目

| 书目 | 官方数字形态 | 状态 | 建议 |
|---|---|---:|---|
| *NSCA's Essentials of Personal Training*, 3rd | Human Kinetics / VitalSource | C | 购买用于人工阅读；每章由人写结构化笔记后再转换 |
| *Science and Development of Muscle Hypertrophy*, 2nd | Human Kinetics / VitalSource | C | 若不急，等待 2026-10-23 发布的第 3 版；仍需确认交付方式 |
| *The Science of Long-Term Weight Loss* | Human Kinetics / VitalSource | C | 人工笔记；快变结论再用近期综述核验 |
| *ACSM's Body Composition Assessment* | Human Kinetics / VitalSource | C | 人工提取测量流程、误差与解释规则 |
| *Sport Nutrition*, 4th | Human Kinetics / VitalSource | C | 作为人工阅读主干，不尝试导出整书 |
| 《中国居民膳食指南（2022）》 | 完整书未发现官方 PDF/EPUB；有官方专题 HTML、八准则和图示 | A（部分）/D（整书） | 可转换官方 HTML 的核心准则；图示有明确非商业限制，产品内使用需授权 |
| 《中国居民膳食营养素参考摄入量（2023版）》 | 完整书未发现官方 PDF/EPUB；成人等人群表格可在线查看 | A（部分）/D（整书） | 把成人表格人工录入为结构化数据，双人校验；不要把图片 OCR 结果直接作为真值 |
| *Physiology of Sport and Exercise*, 9th | Human Kinetics / VitalSource | C | 人工章节笔记，或以公开综述补齐可引用证据 |
| *NSCA's Guide to Program Design*, 2nd | Human Kinetics / VitalSource | C | 人工提取“输入—决策—复盘信号”而非复制原文 |
| *Biomechanics of Sport and Exercise*, 4th | Human Kinetics / VitalSource | C | 图表较多；人工整理时保留术语和公式出处，不复制插图 |
| *Advanced Fitness Assessment and Exercise Prescription*, 9th | Human Kinetics / VitalSource / HKPropel | C | 平台内容不能直接作为文件输入；人工整理测试协议 |
| *Concurrent Aerobic and Strength Training* | Springer Nature：PDF、EPUB，购买后即时下载 | A | 最适合做首个技术型 PDF/EPUB 转换试验 |
| *Recovery and Well-being in Sport and Exercise* | Routledge / VitalSource Bookshelf，加密 | C | 人工笔记；睡眠和恢复结论再用近期共识核验 |
| *Motivational Interviewing in Nutrition and Fitness*, 2nd | Guilford：无 DRM PDF，普通文件下载 | A | 最适合做首个文本型 PDF 转换试验；商业再利用前确认权限 |
| *ACSM's Guidelines for Exercise Testing and Prescription*, 12th | LWW / VitalSource 或 Lippincott 平台 | C | 作为安全边界权威人工维护；不可绕过平台保护 |

### 动作、运动学习、解剖和教练沟通

| 书目 | 官方数字形态 | 状态 | 建议 |
|---|---|---:|---|
| *Exercise Technique Manual for Resistance Training*, 4th | Human Kinetics / VitalSource + 在线视频 | C | 人工整理动作清单和常见错误；不得复制图片和视频 |
| *Motor Learning and Performance*, 7th | Human Kinetics / VitalSource + HKPropel | C | 人工整理反馈、练习安排、保持与迁移规则 |
| *Science and Practice of Strength Training*, 3rd | Human Kinetics / VitalSource | C | 人工整理高阶力量理论，普通用户场景需重新限定 |
| *Neumann's Kinesiology of the Musculoskeletal System*, 4th | Elsevier eBook / VitalSource | C | 只整理正常运动学；不进入诊断、治疗或康复规则 |
| *The Science and Physiology of Flexibility and Stretching*, 2nd | Routledge / VitalSource，加密 | C | 人工笔记或联系出版社取得研究/企业授权文件 |
| *The Language of Coaching* | Human Kinetics / VitalSource | C | 人工提炼提示语选择框架，不复制书内图片和成套示例 |
| *Foundations of Sport and Exercise Psychology*, 8th | Human Kinetics / VitalSource + HKPropel | C | 只整理依从性、动机和一般沟通边界 |
| *Kinetic Anatomy*, 5th | Human Kinetics；©2027 版本待确认实际供应 | C/D | 等正式供应；不要为了格式便利购买旧版重复内容 |

### 营养、测量和知识治理

| 书目 | 官方数字形态 | 状态 | 建议 |
|---|---|---:|---|
| *Advanced Nutrition and Human Metabolism*, 9th | Cengage eTextbook/阅读平台 | C | 用于人工机制核验，不作为教练处方来源 |
| *Research Methods in Physical Activity*, 8th | Human Kinetics / VitalSource | C | 人工整理研究设计、效度和证据等级 |
| *Evidence-Based Practice in Exercise Science* | 商品名虽含“PDF”，当前官方页明确由 VitalSource 交付 | C | “PDF”是版式名称，不是可下载普通 PDF |
| *Measurement and Evaluation in Human Performance*, 6th | Human Kinetics / VitalSource/HKPropel | C | 人工提取信度、效度、测量误差和最小可检测变化 |
| *How to Read a Paper*, 7th | Wiley 零售版为 Wiley Reader/VitalSource；Wiley Online Library 机构版可能下载 PDF | B/C | 先检查机构权限；若能合法下载整书/章节 PDF，再转换为知识维护技能 |
| *Statistics in Kinesiology*, 6th | 预计 2026-09-15 发布 | D | 等新版本；它是维护团队资料，不是教练运行时知识 |

### 重复或未来专项书目

| 书目 | 官方数字形态 | 状态 | 建议 |
|---|---|---:|---|
| *Essentials of Strength Training and Conditioning*, 5th | Human Kinetics / VitalSource，©2027，供应状态需确认 | C/D | 等正式供货后再决定 |
| *ACSM's Resources for the Personal Trainer*, 7th | LWW / VitalSource | C | 与 NSCA PT 主干二选一，暂不重复转换 |
| *ACSM's Nutrition for Exercise Science*, 2nd | ACSM/LWW 电子平台 | C | 与 *Sport Nutrition* 重复，作为查缺补漏即可 |
| *NSCA's Guide to Sport and Exercise Nutrition*, 2nd | Human Kinetics / VitalSource | C | 不作为第三条营养主干 |
| *Advanced Sports Nutrition*, 3rd | Human Kinetics / VitalSource | C | 有具体专题需求时人工整理 |
| *Designing Resistance Training Programs*, 4th | Human Kinetics / VitalSource；商品名可能标 PDF/EPUB | C | 2014 年内容较旧，不值得优先处理 |
| *High-Performance Training for Sports*, 2nd | Human Kinetics / VitalSource | C | 超出普通增肌、减脂、塑形主范围 |
| *NSCA's Essentials of Sport Science* | Human Kinetics / VitalSource | C | 等建设传感器/负荷监控模块时再处理 |
| *Exercise and Physical Activity for Older Adults* | Human Kinetics / VitalSource | C | 等设计健康老年人专项产品后再处理 |

## 出版平台层面的证据

- [Human Kinetics eBook FAQ](https://us.humankinetics.com/pages/ebook-faqs)：当前电子书通过 VitalSource 交付；“离线下载”指下载到 Bookshelf 应用。
- [VitalSource：Download PDF Copy](https://support.vitalsource.com/hc/en-us/articles/28275378380951-Download-PDF-Copy)：所有数字材料采用 DRM；条款禁止用第三方工具导出 PDF 或其他文件。
- [Routledge eBooks](https://www.routledge.com/our-products/ebooks)：其 PDF/EPUB 均加密并只能在 VitalSource Bookshelf 内访问。
- [Wiley eBooks](https://www.wiley.com/en-us/shop/wiley-ebooks/)：零售电子书不能下载为 PDF 或 EPUB。
- [Wiley Online Library 下载说明](https://www.wiley.com/content/dam/wiley-com/en/pdfs/solutions---partnerships/how-download-online-book-chapters-full-books-in-pdf.pdf)：有权限的在线图书可能提供逐章或整书 PDF。
- [Elsevier VitalSource](https://shop.elsevier.com/books/flexible-ebook-solutions/vitalsource)：部分教材通过受保护的 Bookshelf 交付。
- [Guilford eBooks](https://www.guilford.com/e-books)：官网直购电子书无 DRM，提供可下载 PDF/EPUB（以单书页面列出的格式为准）。
- [Springer Nature eBook formats](https://support.springernature.com/en/support/solutions/articles/6000229374-ebook-formats)：购买后可下载 PDF，部分书同时提供 EPUB。
- [中国居民膳食指南官方专题](https://dg.cnsoc.org/)和[DRIs 2023 官方表格](https://www.cnsoc.org/drpostand/)：有可阅读网页资料，但不是完整开放许可电子书。

## 当前本地转换环境

已运行 `book-to-skill` 自带的环境检查：

| 输入类型 | 当前状态 | 影响 |
|---|---|---|
| 文字型 PDF | 可用（`pypdf`） | 可以立即处理可复制文本的普通 PDF |
| 技术型 PDF | Docling 未安装 | 表格、公式和复杂版式可能丢失；处理健身教材前应安装 Docling |
| EPUB | 有基础回退解析器 | 可试跑；安装 `ebooklib` 和 `beautifulsoup4` 后质量更稳 |
| HTML | 有基础回退解析器 | 可处理保存后的官方网页 |
| MOBI/AZW | Calibre 未安装 | 当前不能处理；本书目暂无必须使用该格式的理由 |

工作区中没有发现上述书籍的现成 PDF/EPUB 文件，因此现在还不能执行正式转换。

## 推荐的最小试验

### 试验 1：文本型书籍

- 单一变量：以 Guilford 的无 DRM PDF 为输入，只做“分析模式”，不生成最终 Skill。
- 来源：*Motivational Interviewing in Nutrition and Fitness*, 2nd ed.
- 成功信号：章节识别率接近完整目录；对话框架、反模式和术语能保留；没有长段原文复现。
- 失败信号：章节错位、表格/对话混乱、输出像泛化摘要或包含大段原文。

### 试验 2：技术型书籍

- 单一变量：安装 Docling 后，以 Springer 的合法 PDF 为输入做分析模式。
- 来源：*Concurrent Aerobic and Strength Training*。
- 成功信号：目录、表格、图注、章节边界和参考文献能被稳定识别。
- 失败信号：表格列错位、公式丢失、图注被当正文、引用无法追溯。

### 试验 3：中国官方网页资料

- 单一变量：只转换健康成年人相关 DRIs 官方网页和膳食指南八准则，不混入书本或第三方文章。
- 成功信号：数值保留人群、性别、年龄、单位和 EAR/RNI/AI/UL 类型；随机抽查与官网一致。
- 失败信号：OCR/抓取导致小数点、单位、上下限或人群标签错误。

## 推荐执行顺序

1. 先向 Guilford 和 Springer 确认私有/商业知识库的文本与数据挖掘或衍生使用权限。
2. 合法取得两本书的普通 PDF/EPUB 文件。
3. 安装 Docling，再运行 `book-to-skill --check`。
4. 两本书都先使用“Analyze Only”，审核框架和引用质量，不直接生成运行时技能。
5. 将经人工确认的跨书共识写入统一知识库；单书 Skill 只作为证据层，不直接成为教练的最终规则。

