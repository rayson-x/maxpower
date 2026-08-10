# 03 — 接入 Google、Apple 与显式身份链接

**What to build:** 让用户使用 Google 或 Apple 登录，并在重新认证后把新身份显式链接到同一规范账号。

**Blocked by:** 02 — 贯通手机号与邮箱认证

**Status:** completed

- [x] Google 与 Apple OAuth 使用稳定 issuer + subject 身份。
- [x] 相同 email 不会独自触发静默合并。
- [x] 已登录用户可以显式链接新身份；冲突得到稳定错误。
- [x] OAuth state、nonce、redirect allowlist 与测试覆盖完整。
