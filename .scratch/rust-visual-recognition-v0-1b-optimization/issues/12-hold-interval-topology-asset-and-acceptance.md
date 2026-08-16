# 12 — 交付 hold interval 动作资产与执行验收

**What to build:** 当动作目录首次加入静态保持动作时，以真实 `ActionMotionDefinition` 驱动 `hold_interval/v1`：定义进入目标带、保持开始、允许的有界中断、保持结束、持续时间与一次计数单位。

**Blocked by:** 当前 248 个安装动作没有任何动作选择 hold topology，也没有保持动作的 identity relation、目标带、最小持续时长或最小合格观测样例。缺的是动作语义/样例，不是客户端或现有 cycle executor。

**Status:** blocked-by-input — 不把循环动作伪装成保持动作，也不预设通用 hold 阈值。

## Acceptance

- [ ] 至少一个版本化 hold 动作与 exact view 资产声明可观察主关系、目标带、开始/结束和计次单位。
- [ ] Rust 只按 `RepTopologyProfile` 选择 hold executor，不新增 action-name 分支。
- [ ] 合同测试覆盖完成保持、过短保持、有界丢帧、离开目标带、set closure 和正式训练量。
- [ ] 冻结人工区间 truth 验证开始/结束误差、误触发与持续时间误差。

## Dependency decision

没有动作资产时实现状态机会把产品决定藏在代码默认值里，违反 `ActionMotionDefinition` 是唯一语义权威。本票据只能在新增真实保持动作资产时继续，不阻塞当前 248 个动作的 cycle 识别。
