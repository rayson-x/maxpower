# 09 — 交付非流式 LLM Gateway

**What to build:** 让已登录且有额度的用户通过固定产品能力调用云端 LLM，并让后台准确核算 usage 与成本。

**Blocked by:** 08 — 建立额度账本与后台 Grant

**Status:** completed

- [x] Gateway 只接受 allowlisted product alias 并隐藏 Provider/model。
- [x] 调用前预留额度，完成后按标准化 usage 和 pricing version 结算。
- [x] quota_exceeded 不调用 Provider；失败时正确释放预留。
- [x] invocation metadata 不保存 prompt、response、图片、工具参数或 conversation ID。
