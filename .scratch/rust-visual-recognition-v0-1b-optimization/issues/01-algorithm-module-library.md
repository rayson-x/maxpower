# 01 — 建立可复用识别算法模块库

**What to build:** Rust 先拥有一套不绑定动作名称的识别算法与模型合同目录。动作资产随后只能选择其中兼容的模块，不能临时拼出第二种关节、器械、Rep 或质量真相。

**Blocked by:** None — can start immediately.

**Status:** complete — re-accepted after the compiled module policy became an
executable pre-Rep gate and the full 01–03 contract suite passed.

## Audit context and non-negotiable constraints

- The starting point is a semantic/lifecycle framework, not demonstrated recognition coverage: 1,984 action×view plans compiling does not prove those contexts can recognize Rep.
- The frozen known-video diagnostic has 455 human Rep, 194 sealed raw candidates, 31 admitted predictions and 16 matched predictions. No module-registry change may be reported as an accuracy improvement without the later frozen replay.
- `ActionMotionDefinition` remains the sole movement-semantic authority. The module library supplies reusable algorithms; it must not move action semantics into action-name conditionals or into a second profile/rule truth.
- The SDK must not acquire reviewed/unreviewed, validated/unvalidated, open/closed or accuracy-maturity action states. Structural asset failure is distinct from an individual runtime evidence failure.

- [x] 每个算法模块声明稳定 identity、版本、类别、输入/输出事实、provenance、最大因果年龄、缺失和冲突行为、参数 schema、性能预算与允许结论。
- [x] 模块目录覆盖 pose relation、局部坐标、Rep topology、candidate、admission、边界、器械 observation、fusion、post-seal feature 与质量事实等现有和 v0.1b 所需能力。
- [x] 编译器拒绝未注册模块、类型不闭合、无事实生产者、多个无显式合并规则生产者、循环依赖或不兼容的模型/Provider 合同。
- [x] 每一个 required fact 都保留可追溯的 source、时钟、age、coverage、confidence 与 uncertainty，不能因数值存在而自动成为 judgeable fact。
- [x] 合同测试证明同一模块可被不同动作资产复用，且模块目录不通过 action ID/name 选择语义。

## Completion evidence

`AlgorithmModuleRegistry` is action-ID-free and compiles the exact
`algorithmModuleIds` chosen by every `RepTopologyProfile`. The graph rejects
missing/duplicate modules, no-producer facts, incompatible topology and cyclic
dependencies. Equipment-primary graphs additionally require the independently
produced `subject_equipment_association` fact before `rep_topology` can run.
Runtime invocation tests prove required input type, age, missing and conflict
policies change execution disposition; these fields are no longer trace-only
metadata.
