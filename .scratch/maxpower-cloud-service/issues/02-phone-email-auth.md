# 02 — 贯通手机号与邮箱认证

**What to build:** 让海外用户可以用手机号或邮箱完成 OTP 注册、OTP 登录、密码登录与安全注销，并让业务 API 只信服务端验证后的身份。

**Blocked by:** 01 — 锁定云端权威契约与 Server Harness

**Status:** completed

- [x] Better Auth 生产 Adapter 支持手机号/邮箱 OTP 与密码。
- [x] 未知 identifier 的登录 OTP 不会自动注册。
- [x] 新注册必须完成昵称、密码和条款，已有账号验证后直接登录。
- [x] service JWT、JWKS、session 撤销及 Adapter conformance tests 完整通过。
