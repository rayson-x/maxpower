# 08 — Android 真机全流程录屏验收

**What to build:** 在物理 Android 设备上从清空本地产品数据开始完成完整可审阅流程：打开 Coach → Baseline card → Agent 自由追问 → Goal 或 Record-only → 首计划确认 → 多日执行记录 → Signal → 渐进调整 → stop/steer → 关闭应用 → 重启 → 历史恢复与确认 receipt。保留可审阅录屏、构建/安装证据和关联的本地 trace short code。

**Blocked by:** 07 — 唯一正式组合与 Android 全流程验收（除真机部分外已完成）; 需要一台可安装的物理 Android 设备与录屏环境（本轮开发会话不具备，用户已确认本轮以 Web E2E 作为客户端验收证据）。

**Status:** ready-for-human

- [ ] 真机构建与安装证据（`npm run release:client` 产物 + 安装记录）。
- [ ] 完整流程录屏：新用户建档 → 目标/仅记录 → 首计划确认 → 多日记录 → Signal → 渐进调整 → stop/steer → 杀进程重启 → 历史恢复。
- [ ] 录屏中每个关键动作关联本地 trace short code（`maxpower/traces/<account>`）。
- [ ] 真机回归通过后回到 07 的拆分说明处销项。
