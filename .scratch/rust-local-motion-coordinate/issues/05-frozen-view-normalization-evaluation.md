# 05 — 建立冻结的视角归一化评估链路

**What to build:** 提供一套不泄露人工时间线的单次因果评估：候选和现行 Profile 对同一客户端格式视频流各运行一次并冻结输出，然后才加载人工真值。报告同时覆盖几何不变性、已有 touched benchmark、同步正面—斜方验证和最差分桶，使用户能判断局部坐标是否真的改善斜视角轨迹，而不是只看页面效果。

**Blocked by:** 04 — 建立可选择的规范轨迹卧推 Profile。

**Status:** code-complete

- [x] Inference pack 在冻结前不包含人工 Rep timestamps、人工 turnaround、review decisions、same-video endpoint templates 或目标 source 派生阈值。
- [x] 每段视频只按时间顺序提交一次；评估不会 rewind、重复理解、读取未来帧或用完整视频平滑早期输出。
- [x] 冻结产物含 profile/version、coordinate version、source lineage、run kind、input hash 和 immutable prediction hash，之后加载 truth 不会修改 prediction bytes。
- [x] 报告分别标记 `touched_benchmark`、`untouched_model_acceptance` 和 `synchronized_cross_view_validation`，并阻止 touched/source-derived run 声称 acceptance eligible。
- [x] 合成 rotation/translation/uniform-scale suite 同时比较 raw screen signal 与 normalized signal，报告离散 Rep/phase 一致性和规范轨迹数值误差。
- [x] 现有个人卧推只作为 touched regression，报告 precision、recall、exact-set、start/turnaround/end error、full-endpoint alignment、coverage、abstention 和 rejection，不称为泛化准确率。
- [x] 评估输入契约支持同一 set 的同步 front 与任意 front-oblique 流；候选只读取 oblique，front 与人工端点在预测冻结后作为对照。
- [x] Cross-view 报告配对相同物理 Rep，比较 turnaround timing、normalized ROM、cross-path、endpoint residual、coverage 和 abstention，并同时给出 raw screen-`y` baseline。
- [x] 报告按 front、left-front oblique、right-front oblique、mirror、bar occlusion、wrist/forearm occlusion、competing reflection/person 和 confidence 分桶，并突出最差分桶。
- [x] 所有 rejected/abstained candidates 保留在适用指标分母或单独覆盖率分母中，不允许通过过滤困难样本提高准确率。
- [x] Promotion evidence 必须在揭示 truth 前冻结候选、阈值、容差和报告代码；truth reveal 后修改任何一个都产生新的 touched run，而不是覆盖原结果。
