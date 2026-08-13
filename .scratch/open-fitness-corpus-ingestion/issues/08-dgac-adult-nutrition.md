# 08 — DGAC 成年人营养证据包

**What to build:** 从最新膳食指南科学咨询报告中选择性蒸馏健康成年人能量摄入、食物模式、份量、进餐频率及体重管理章节，发布 Source Page 与 Claim Pages，并增量更新营养 Topic Pages。Wiki 保留科学咨询报告与正式指南的身份差异。

**Blocked by:** 01. IUSCA 增肌来源端到端试点

**Status:** ready-for-human

- [x] 发布通过验证的 Source Page，登记报告版本、章节范围、政府作品状态、第三方材料例外和内容哈希
- [x] 在提取前登记纳入与排除章节，证明无关附件没有进入自动蒸馏输入
- [x] 发布成年人能量、食物模式、份量、进餐频率和体重管理相关 Claim Pages，保留精确章节定位
- [x] Claim 明确区分科学咨询报告、正式指南和产品实践决定，后两者不得由采集代理自动生成
- [ ] 更新“饮食依从性”“外食估计误差”“能量平衡与体成分”等 Topic Pages；与 ISSN 存在差异时登记冲突
- [ ] 自动蒸馏内容经人工复核后再标 reviewed；Wiki 验证、链接检查和索引构建通过

## Comments

- 2026-08-13 等待人工处理：官方报告身份、完整 PDF URL、Part D 第 2/6/7 章范围和许可边界已登记；4 次受控正文获取均超时或返回 0 bytes，因此保持 `metadata_only`、0 Claims，未把搜索摘要伪装成正文证据。需人工提供可读取的官方 PDF 后继续。
- 2026-08-13 Collector 安全收敛：官方直连仍因 HTTP/2 错误或 HTTP/1.1 有界超时返回 0 bytes；随后通过文本传输中介读取 3 个精确官方 PDF URL，核对 Chapter 2（29 页）、Chapter 6（13 页）、Chapter 7（12 页）的结论段与报告页码。新增独立 SourceRecord、6 个 `claim_extracted` / `pending_review` ClaimRecords 和 3 个 draft 补充 TopicRecords；未保存代理正文，仅登记官方 URL、报告 locator、转写载荷哈希、释义证据和 `cannotSupport`。所有 eligibility 均为 `excluded`，未改冻结 Source/Topics/Corpus Release，也未生成正式指南、产品政策或 Agent Knowledge。14/14 契约 fixtures 与 Wiki lint 通过；全量 contract 仍只有既存 Agent Knowledge Release 的 72 个无关错误，新 DGAC records 无 schema、hash、pin 或引用错误。下一步仍需独立 Reviewer 直接核对官方 PDF 与许可/AI ingestion 边界，并审查与 ISSN 的差异后，才能决定是否标 `reviewed`、登记 Conflict 或更新新的 Corpus Release。
