# 12 — 中国营养数值本地化

**What to build:** 将中国居民膳食指南八项准则和公开的健康成年人膳食营养素参考摄入量整理为 Source Pages、Claim Pages 和本地化 Topic 更新。仅保存许可允许、公开可核验的字段与定位，不抓取整本受版权保护资料，不复制长段原文或图片。

**Blocked by:** 01. IUSCA 增肌来源端到端试点

**Status:** ready-for-human

- [x] 为指南和参考摄入量分别发布 Source Page，登记机构、版本、公开入口、使用条件、适用范围和内容哈希
- [ ] 将八项准则拆为可审核 Claim，并保留原始定位、适用人群和 cannot support
- [ ] 将许可允许公开保存的成年人参考摄入数值字段化为 Claim，记录单位、年龄、性别和条件
- [ ] 所有人工录入数值经过第二次独立核验并保留差异处理记录；无法合法保存的内容只登记定位与哈希
- [ ] 更新“中国营养基线”和相关营养 Topic Pages；与国际来源不一致时登记冲突与本地适用理由
- [x] 登记中国食物成分数据缺口，不以 FoodData Central 伪装填补；Wiki 全量验证通过

## Comments

- 2026-08-13 等待人工授权：2 个 metadata-only Sources、1 个 draft Topic 和权限/数据缺口页已完成。官方页面未提供开放商业改编或 AI 摄入许可，因此没有复制八准则正文、DRIs 图片或数值；需取得书面许可或可复用的官方开放数据后继续 Claim 与本地冲突审查。
- 2026-08-13 有限公开证据候选：冻结 release 已 pin 上述 2 个 Source 和 `topic.nutrition.china-baseline`，因此未原位修改。新增 3 个 ticket 专属 draft Source、5 个 `claim_extracted` Claim、1 个 draft Topic 和 1 个 open applicability Conflict；所有 Claim 均为 `pending_review` 且编译资格全部 `excluded`。
- 八项准则仍未完成：国家/地方卫健机构与中国疾控网页可公开核验八项标题，但未发现覆盖商业改编与 AI 摄入的复用许可；继续 metadata-only，不复制或改写为 Claim。
- 成人 DRI 字段仍未完成审核：CC BY 4.0 的中国营养学会相关会议报告只支持其明确报道的版本范围、成人钠 2,000 mg/d 上限措辞和成人脂肪 20%–30% 总能量；CC BY 4.0 中国团队论文只支持其明确报道的成人胆碱 AI（男性 450 mg/d、非孕女性 380 mg/d）。这些许可不覆盖 DRIs 2023 专著或完整表格；钠值的 DRI 指标代码、成人年龄范围及所有数值仍需独立 Evidence Review。
- 中文本土化 Topic/冲突/边界已形成 draft 候选，但未达到 reviewed：EFSA 2016 对欧洲所有成年人给出胆碱 AI 400 mg/d，与中国报道的性别分层值登记为 applicability Conflict；差异不得合并成单一全球默认值，中国用户应保留地区与性别口径。八准则授权、完整 DRI 表、中国食物成分数据许可仍为结构化 gap。
