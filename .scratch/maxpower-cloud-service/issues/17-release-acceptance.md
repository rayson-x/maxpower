# 17 — 完成跨账号与发布闭环验收

**What to build:** 验证正式客户端与服务端共同满足在线身份、云数据、媒体、LLM、额度、删除和账户隔离的发布标准。

**Blocked by:** 11 — 编排账号与媒体删除；14 — 客户端接入云端规范数据；15 — 客户端统一切换云端 LLM；16 — 客户端提供可选媒体资料库入口

**Status:** blocked

- [ ] A/B 账号切换不会泄漏本地或云端资源。
- [x] 无网、token 过期、quota exhausted、Provider outage 和 revision conflict 有明确行为。
- [x] 账号删除停止所有服务并完成可验证清理。
- [ ] 服务端全量测试、客户端全量测试、typecheck、bundle secret scan 和 release smoke 全部通过。

**Verified locally:** 客户端全量测试（624 pass / 2 expected skip）、A→B→A namespace contract、新设备把云端 Profile/Plan/Workout/Result（含 profile-only、历史/已删除计划和独立动作分析结果）恢复进主 ProductShell 与 Coach 投影、服务端真实 PostgreSQL 17 全量测试（134/134）、010→050 首次全应用与重复全跳过、typecheck、production build、privacy suite（40/40）、Android Hermes bundle scan、Compose config 与无 secret 的 release artifact scan 均通过。删除、LLM 额度、显式跨节点取消/保守结算、断流恢复、Provider 故障和 revision conflict 均有稳定错误语义。release smoke harness 现会验证 JSON/SSE、usage 归一化、确定性 tool call、显式持久取消、timeout 与 outage/no-local-fallback；缺少场景 Provider 配置时会以 `staging_scenario_probe_unset` 阻断，而不是把普通 completion 冒充完整验收。

**External blocker:** 最终勾选仍需要两项本机无法伪造的发布证据：① 在签名真机包上检查 A→B→A 的实际 SQLite、SecureStore 与设备日志；② 部署真实 staging 与独立的确定性场景 Provider，提供两组短期 access token 及仅可读取 content-free usage 列的数据库审计角色后运行完整 release smoke。当前没有这些凭据，smoke 明确返回 `staging_credentials_unset`，不计为通过。本轮最终容器重建还被本机 Docker credential helper 卡在基础镜像 metadata 读取；Dockerfile/Compose 静态验收及稍早同 Dockerfile 的非 root 镜像已通过，但不能冒充当前源码的新镜像证据。
