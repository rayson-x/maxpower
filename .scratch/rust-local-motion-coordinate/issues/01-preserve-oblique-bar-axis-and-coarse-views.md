# 01 — 无损传递真实杠铃轴与粗机位

**What to build:** 让一条正斜方杠铃观测从 Rust 器械追踪进入 CanonicalMotionOutput、客户端解码和审核页面后，仍保留有序的真实轴端点、斜率、来源和置信度，并按粗机位与正确的解剖侧显示。旧的器械框消费者暂时继续工作，使这次扩展保持兼容且可以独立演示。

**Blocked by:** None — can start immediately.

**Status:** code-complete

- [x] Rust 输出保留 subject-associated barbell shaft 的有序 `x1/y1/x2/y2`、中心、投影长度、图像角度、置信度、不确定性、track identity 和 measured/predicted provenance。
- [x] CanonicalMotionOutput 的扩展是 additive；旧 packet fixture 和旧解码器兼容行为不改变，未知或畸形的新字段会被确定性拒绝或安全跳过。
- [x] Web/WASM 与 native 解码得到相同的轴端点、顺序、来源和置信度语义，不再依赖水平 axis-aligned bbox 重建杠铃。
- [x] 审核页面按真实端点绘制正斜方杠铃，页面中的水平辅助线不得替代或覆盖原始杠轴。
- [x] 动作上下文支持 `front`、`front_oblique_left` 和 `front_oblique_right`；旧 `frontLeft45`、`frontRight45` 作为兼容别名解析，并保留 handedness。
- [x] Screen-left/screen-right 不会在缺少 view、mirror 和 subject mapping 时被直接标成 anatomical left/right；缺少映射时输出明确未知状态。
- [x] 自动化测试用一条明显倾斜的杠铃 fixture 完整穿过 Rust、packet decoder 和页面投影，验证其斜率与端点没有被压平。
- [x] 当前 Rep、phase、equipment bbox 和 quality 输出在未消费新轴字段时保持现有行为，无回归测试失败。
