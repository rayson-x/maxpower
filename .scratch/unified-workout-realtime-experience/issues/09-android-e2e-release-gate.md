# 09 — Android 真机交互与回归验收

**What to build:** 在 Android 真机上证明统一训练执行体验完整可用，覆盖手动基线、Realtime 增强、现场调整、持久化恢复、无障碍与既有功能回归。

**Blocked by:** 08 — 训练结束、确认写入与 Timeline 闭环。

**Status:** needs-device-validation

- [ ] 真机从 Today 一次点击进入训练，完成手动 set、Set Review、休息、动作路线调整和训练结束确认。
- [ ] 至少一个 validated-analysis exact profile 动作跑通 Realtime canonical 路径，另一个 unsupported 动作证明无损手动降级。
- [ ] 真机验证卡片翻转历史、无阴影组件一致性、点击/滑动切换、重选、左滑移除、撤销和长按排序动画。
- [ ] 真机验证轻微手指抖动、纵向滚动、长按与横滑不会误触破坏性动作；按钮区域不触发卡片切换。
- [ ] 在 Realtime 前、Realtime 中断、Set Review、Rest 和部分完成阶段重启应用，均恢复同一会话且不复制事实。
- [ ] 屏幕阅读标签、关键触控面积、动态文字、减少动态效果、高对比、横竖屏和安全区域通过验收。
- [ ] 保存关键路径截图或录屏，并运行 Workout、Motion canonical、Report/Replay、Timeline、云端 product-resource 与客户端高层回归集。

## Comments

- 2026-08-14：本轮未执行 Android 真机、录屏、TalkBack、旋转/安全区、减少动态效果和手势冲突验收；不得视为 release gate 已通过。
