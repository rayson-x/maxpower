# 07 — 实现卧推 Profile 的证据门控 promotion

**What to build:** 把 normalized bench Profile 的启用变成一个版本化、可审计的证据决策。只有冻结的视角评估与三端一致性/性能都满足门槛时，resolver 才能将其声明为可启用候选；否则它继续 shadow 并输出具体阻塞原因，不能因一次页面演示准确而进入正式识别。

**Blocked by:** 05 — 建立冻结的视角归一化评估链路；06 — 验证三端 Rust 输出一致性和实时性能。

**Status:** code-complete

- [x] Promotion manifest 引用 immutable candidate Profile、coordinate contract、evaluation hashes、runtime parity evidence、数据分桶和预注册 gate，不复制或重算评估结果。
- [x] Untouched acceptance gate 要求 Rep precision ≥95%、Rep recall ≥95%，且 `start + primary_turnaround + end_return` 在 ±250 ms 内全部对齐的比例 ≥95%。
- [x] Candidate 在 aggregate、left-front oblique 和 right-front oblique 分桶均不低于当前 Profile 的 Rep/phase 表现；最差分桶失败会阻止 promotion。
- [x] Normalized trajectory 在预注册 aggregate 和最差 oblique bucket 中都必须比 raw screen-`y` baseline 严格降低 cross-view disagreement；没有改善则保持 shadow。
- [x] Mirror、occlusion、competing subject/reflection、低置信和 abstention/rejection coverage 作为 promotion evidence 明确展示，不能从测试集删除。
- [x] 只有 `untouched_model_acceptance` run 可以满足准确率 gate；现有六条卧推、same-source 派生 Profile 或人工看过结果的数据只能提供 regression evidence。
- [x] Web/WASM 和 mobile native parity 未通过，或实时性能状态为 platform-gated 时，不允许声明三端可用。
- [x] Resolver 根据 versioned capability/promotion manifest 选择 Profile；不存在合格 manifest 时返回当前稳定 Profile 或明确 data-gated，而不是自动选择最新版本。
- [x] Promotion 不修改历史 CanonicalMotionOutput、训练数据、人工审核或旧 Profile；回滚通过选择前一版本完成。
- [x] 自动化测试覆盖 pass、每个单独 gate fail、缺失证据、touched evidence 冒充 untouched、最差分桶失败及回滚行为。
