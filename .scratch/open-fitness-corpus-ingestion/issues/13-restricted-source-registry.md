# 13 — 受限来源索引与禁止摄入清单

**What to build:** 为 ACSM、WHO、NIH ODS、OpenStax、NSCA 和其他免费可读但许可受限的来源发布只读 Source Pages、许可证登记和禁止摄入策略。Wiki 可以保存来源身份、哈希、获取方式、精确定位和人工审核意见，但未经授权不得保存或改编受限全文。

**Blocked by:** 01. IUSCA 增肌来源端到端试点

**Status:** completed

- [x] 每个来源发布只读 Source Page，记录入口、版本、许可证、商业使用、改编、署名、相同方式共享、AI 摄入限制和内容哈希
- [x] ACSM、WHO、ODS、OpenStax、NSCA 分别具有明确的允许保存内容、只读用途、需授权行为和禁止行为
- [x] 自动流程遇到不明许可、禁止改编、禁止商业使用或禁止 AI 摄入时确定性拒绝生成正文 Draft
- [x] 第三方图片、量表、问卷和转载材料默认排除，除非单独证明许可
- [x] 高权重受限来源只生成引用定位、许可说明和人工核验意见，不生成 Claim，除非审核者确认允许使用的事实表达
- [x] 至少 8 个许可 fixture 覆盖可导入、只存元数据、需人工复核和禁止导入；Wiki 验证通过

## Comments

- 2026-08-13 完成：ACSM、WHO、ODS、OpenStax、NSCA 五项只读登记与确定性摄入策略落盘，许可 fixture 13/13 通过（含再分发禁止、字段缺失和非法枚举 fail-closed），未从受限正文生成健身 Claim。
