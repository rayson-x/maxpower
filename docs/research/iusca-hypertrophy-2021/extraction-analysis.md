# IUSCA 2021 增肌立场声明采集与提取审计

审计日期：2026-08-13  
来源：[IUSCA 期刊文章页](https://journal.iusca.org/index.php/Journal/article/view/81)  
DOI：`10.47206/ijsc.v1i1.81`  
许可：CC BY 4.0

## 来源身份与快照

| 制品 | 官方入口 | SHA-256 | 用途 |
|---|---|---|---|
| 文章 HTML | 期刊 article/view/81 | `f1843621a471ce65d5068ad6bdb95b8aa0311a7ec6d98cffe1f944746e7228fd` | 作者、DOI、摘要、发布日期与许可核对 |
| 官方 PDF | 期刊 article/download/81/140/5323 | `363c70e11d63ca6eb77c2282c1998356a318d0d715f77d3d5ecacd3a43769d4e` | 正文、表格、数值和 locator 的规范输入 |

原始 HTML/PDF 保存在本研究目录，不提交到 Wiki Git 仓库。Wiki 只保存来源身份、许可、哈希、定位、复述和允许保留内容的边界。

## book-to-skill Analyze Only

文档按“技术资料”处理。机器提取仅承担 Collector，输出身份是 `machine_draft`，没有取得 Evidence Review 或产品批准权限。

| 比较项 | HTML | PDF |
|---|---:|---:|
| 提取方法 | stdlib HTML parser fallback | pypdf fallback |
| 提取规模 | 1,049 词，约 1.4K tokens | 30 页，25,573 词，约 34K tokens |
| 正文完整性 | 只有元数据、摘要、许可和导航 | 负荷至周期化各章节、Table 1、COI 与参考文献均存在 |
| 表格保真度 | 无正文表格 | Table 1 的行列视觉布局被压平，但各变量、数字和项目符号文本保留 |
| 引用保留 | 只有文章级引用 | 正文编号引用与末尾至 248 的参考文献保留，超链接语义未保留 |
| 适合作为 Claim 核验输入 | 否 | 是，仍须逐条回看页码与版面 |

Docling 在本机不可用，因此没有把 pypdf 的纯文本结果当作表格权威。所有进入 Claim 的数字同时对照 PDF 对应章节与第 22–23 页 Table 1。

## 数值与定位复核

| 内容 | 章节定位 | 人工复核结果 |
|---|---|---|
| 约 10 组/肌群/周 | Volume 共识，PDF p. 9；Table 1 p. 22 | 一致；原文同时说明部分个体较低周量也有显著反应 |
| 单次约 10 组/肌群 | Frequency 共识，PDF p. 10；Table 1 p. 22 | 一致；是高周量分配的一般建议，不是硬上限 |
| 四周增量约不超过先前周量 20% | Volume 共识，PDF p. 9；Table 1 p. 22 | 一致；原文用审慎语气且明确经验性证据不足 |
| 多关节至少约 2 分钟 | Rest interval 共识，PDF p. 11；Table 1 p. 22 | 一致 |
| 单关节/部分器械 60–90 秒 | Rest interval 共识，PDF p. 11；Table 1 p. 22 | 一致 |
| 较低至中等周量可每肌群每周一次 | Frequency 共识，PDF p. 10；Table 1 p. 22 | 一致；只在周量匹配和相应剂量范围内成立 |
| 新手不必非常接近力竭 | Set End Point 共识，PDF pp. 13–15；Table 1 pp. 22–23 | 一致 |
| 高度训练者力竭建议 | Set End Point 共识，PDF p. 15；Table 1 pp. 22–23 | 保留 `may benefit`、保守使用、最后一组与单关节/器械限定 |

## 许可、资金与利益冲突

- 期刊文章页和 PDF 首页都声明 CC BY 4.0；可复制和改编，但必须署名、链接许可并说明改动。
- 文章未见独立的 funding statement；这不能被解释成“确认无资助”。
- COI 章节披露 Brad J. Schoenfeld 任 Tonal Corporation 科学顾问；Stuart M. Phillips 披露 National Dairy Council、Enhanced Recovery 和 Exerkine 专利相关关系；其他作者报告无感知到的利益冲突。

## Review 结论

本轮发布 1 个 `source_verified` SourceRecord、10 个 `reviewed` ClaimRecord 和 3 个 `reviewed` TopicRecord。Reviewed 仅表示 locator、适用范围和限制经过证据审核；没有任何记录被标记为 `approved_for_product`，也没有生成 Rule、Action、Fixture、DecisionRecord、Corpus Release 或 Agent Knowledge Release。

动作幅度（ROM）方面，来源支持“在适用时选择长肌长训练动作”，但没有建立跨动作通用的完整 ROM 数值处方；该边界保留为 Topic knowledge gap，而不是由模型补齐。
