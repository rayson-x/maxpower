# 06 — 知识检索双工具（默认禁用）

**What to build:** 工具目录新增两个只读工具：knowledge.lookup_exercise（按动作族/变式查询目录条目，返回肌群关联、器械、处方模式与免责声明全文）与 knowledge.explain_rule（按 ruleId 返回当前版本数值、证据锚点与"不能推出什么"）。两者 accessClass: read、offlineAvailable: true；查无结果返回 typed unknown。工具默认禁用，由 10 的 eval 门槛翻转。

**Blocked by:** 02. 知识包数据化与加载器

**Status:** ready-for-agent

- [ ] 两工具经工具目录注册，schema/权限声明与既有 13 个工具同构
- [ ] 查询命中返回知识包当前版本内容（数据包覆盖后返回新内容）
- [ ] 查无结果返回 typed unknown，不返回空字符串
- [ ] 禁用 flag 存在且默认关闭；禁用时工具不出现在 provider manifest
