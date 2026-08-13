# 06 — 验证三端 Rust 输出一致性和实时性能

**What to build:** 让同一组客户端格式的 YOLOX + RTMPose Halpe-26 + barbell observations 分别进入 Web/WASM 与 Android/iOS 使用的 native Rust 构建，并验证局部坐标、Rep、端点、来源和弃权语义一致；同时在单次实时调度下输出性能证据，确认算法不是依靠反复视频回放才成立。

**Blocked by:** 04 — 建立可选择的规范轨迹卧推 Profile。

**Status:** code-complete

**Acceptance evidence still required:** Android/iOS physical-device runs must supply latest-frame submitted/processed/dropped/backlog metadata, coordinate-freeze and Rep-confirmation latency, and one active front-oblique golden stream. Until those artifacts exist, the implemented gate deliberately reports `platform-gated`; Web/host/iOS-simulator evidence does not substitute for mobile acceptance.

- [x] Web/WASM 和 native Rust 使用相同 Profile envelope、set lifecycle commands、observation order、timestamps 和 packet contract。
- [x] 相同输入下，coordinate state、axis orientation/sign、scale source、Rep disposition、phase、endpoint timestamps、provenance、agreement/conflict 和 reason codes 语义一致。
- [x] Normalized floating-point fields 使用一个公开、固定的序列化容差；离散值和 timestamps 必须精确一致。
- [x] TypeScript、Kotlin 和 Swift adapter 不重算 local axes、trajectory normalization、landmark repair、anatomical side、Rep 或 endpoint。
- [x] Begin/pause/resume/finish/reset 在各 runtime 都不会泄露上一组 coordinate state、旧 frame 或旧 Profile。
- [ ] Latest-frame/backpressure 场景下，跳帧和 dropped-frame metadata 可见，Rep 的 occurred/confirmed timestamps 仍使用真实输入时间而不是处理循环时间。
- [ ] 性能报告包含 processed FPS、submitted/dropped frames、maximum backlog、coordinate freeze latency、每帧 Rust coordinate cost、Rep confirmation latency 和 finish-set cost。
- [x] 性能测试不得 rewind 或多遍回放；检测/姿态观测以客户端可运行格式一次进入 Rust，Python 不参与 accepted recognition chain。
- [ ] 至少一条 front 和一条 front-oblique bench fixture 通过跨 runtime golden test，包括斜杠轴、低置信腕点和正常 turnaround。
- [x] 任何 runtime 无法满足相同语义或实时调度时，结果标记为 platform-gated，不用 Web 结果代替 mobile acceptance。
