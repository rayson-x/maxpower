# 01 — 账号档案门控与建档恢复

**What to build:** 登录或注册完成后，产品根据当前账号的 User dossier completion projection，把用户可靠地送入主页、全新建档或未完成建档恢复；建档使用公共 Agent Soul 和独立的 Onboarding scenario，而不是固定表单入口或另一个可见人格。

**Blocked by:** None — can start immediately.

**Status:** wontfix

- [ ] 没有已完成 User dossier 的账号进入建档场景，已有已完成档案的账号直接进入主页，账号之间的状态严格隔离。
- [ ] `not_started`、`in_progress`、`ready_for_confirmation`、`commit_pending` 和 `safety_hold` 均恢复到对应的用户可见状态，不会错误进入主页。
- [ ] 退出、杀进程或重新登录后可恢复同一建档会话、草稿版本和最近可继续位置，不创建重复草稿。
- [ ] 建档与主页使用同一版本化 Agent Soul；trace 能区分场景版本，但不存在第二个长期 Agent 身份。
- [ ] 最高层产品测试覆盖新账号、已有档案、未完成草稿、账号切换和恢复失败，且不依赖页面内部实现细节。
