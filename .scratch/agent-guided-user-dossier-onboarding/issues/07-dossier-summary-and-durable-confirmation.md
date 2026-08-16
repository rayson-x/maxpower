# 07 — 组合档案摘要、修正与持久确认

**What to build:** Agent 在信息足以建立档案时展示一份按领域和可信状态组织的 User dossier 草稿；用户能够通过对话或卡片修正，并在确认最新版本后得到真正持久的正式产品资源。

**Blocked by:** 05 — Training background 与 Coaching level assessment；06 — Readiness state 与安全能力门控

**Status:** wontfix

- [ ] 摘要分别展示用户事实、Goal Contract、Training background、Coaching level assessment、Readiness、授权/权限、安全限制、unknown 及受限行动，推断不伪装成事实。
- [ ] 用户可从摘要继续对话修正或打开对应字段控件修改；修改回到同一草稿事件流并更新摘要版本。
- [ ] User dossier 保持组合投影：稳定事实、目标、授权、权限、安全限制、Timeline measurements 和非权威 Working Memory 分别写入正确所有者。
- [ ] 当前体重、体脂和围度由 Timeline 拥有，Profile/Goal 只引用或投影，不产生第二份冲突权威值。
- [ ] 最终确认绑定不可变 draft revision 和 fact frontier；确认期间发生更改时旧确认变 stale，并显示需要重新确认的差异。
- [ ] 正式写入只能经 CoachApplication 的事务、权限、来源、冲突和幂等校验；LLM 和 UI 都不能直接创建正式资源。
- [ ] 只有 ProductData 返回有效 revision/idempotency acknowledgement 后 completion projection 才变为 `completed`；网络或服务失败保留草稿并显示可恢复状态。
- [ ] 重试相同确认不会产生重复 Profile、Goal、Timeline baseline 或授权资源，账号切换不能读取其他账号草稿。
