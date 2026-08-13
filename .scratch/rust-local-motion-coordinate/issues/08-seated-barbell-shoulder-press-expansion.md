# 08 — 扩展坐姿杠铃推肩的局部坐标理解

**What to build:** 将已经通过卧推验证的局部动作坐标框架扩展到“坐姿杠铃推肩”这个精确动作上下文。动作契约根据用户选择的杠铃器械启用真实杠轴、独立骨架和规范轨迹，输出自己的 Rep/端点候选与评估结果；哑铃推肩继续走不同器械语义，不会被动作名称误选为杠铃。

**Blocked by:** 07 — 实现卧推 Profile 的证据门控 promotion。

**Status:** code-complete

**Acceptance evidence still required:** the code has causal synthetic barbell and negative dumbbell fixtures, but no frozen real seated-barbell-shoulder-press fixture or independently untouched acceptance run. The resolver and assessment contract therefore keep this exact context shadow/phase-supported and never borrow bench evidence.

- [x] `seated_shoulder_press × barbell` 与 `seated_shoulder_press × dumbbell` 解析为不同 exact action contexts；barbell context 自动启用 rigid shaft adapter，dumbbell context 不生成虚假杠轴。
- [x] 修正现有动作契约、built-in Profile identity、机位和 equipment capability 的不一致，使 resolver 只依据版本化 contract 而非硬编码动作名。
- [x] 坐姿杠铃推肩提供自己的 action-axis initialization prior、observability 和 Profile thresholds，不直接复用卧推阈值或卧推质量结论。
- [x] Front 和声明支持的 front-oblique coarse views 保留 handedness 与 legacy alias compatibility；未验证机位 fail closed。
- [x] 单次因果 Rust 流输出 coordinate status、equipment/pose trajectories、Rep、start/turnaround/end snapshots、conflict/abstention 和 lineage，并可在审核页与 raw evidence 对照。
- [ ] 一条真实或冻结坐姿杠铃推肩 fixture 证明器械识别已开启、斜杠轴未被压平、Profile 可运行；一条哑铃 fixture 证明不会误启杠铃。
- [ ] 坐姿推肩拥有独立的 touched regression 与 untouched acceptance 标记，不使用卧推 evidence 宣称准确率。
- [x] 未达到同等冻结 gate 前，坐姿推肩保持 shadow/phase-supported，不因卧推模块已经 promotion 自动升级为 quality-supported。
- [x] 卧推 front/front-oblique 的既有 promotion、packet semantics 和 runtime parity 保持无回归。
