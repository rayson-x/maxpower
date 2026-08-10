# 16 — 客户端提供可选媒体资料库入口

**What to build:** 让用户从本地训练与营养资料中主动选择上传、查看状态和删除云端媒体。

**Blocked by:** 13 — 客户端强制在线登录与账号命名空间

**Status:** completed

- [x] 视频、canonical packet、关键点和营养照片均为显式 opt-in。
- [x] 上传支持进度、重试、完成校验和取消。
- [x] 用户可以查看云资产状态并删除原件与派生物。
- [x] 未选择上传的本地媒体绝不产生云 asset。

**Verified:** `CloudMediaLibrary` public-interface tests cover zero-request opt-out, all four reviewed kinds, presigned headers/progress, cancellation, transfer retry, expired-target reissue, completion, cursor listing, status, and recursive deletion. The default injectable `XhrMediaByteTransferPort` is covered for byte progress, Expo `File`/native UploadTask React Native URI transfers, Web Blob/File bodies, and AbortSignal cancellation. `cloudMediaLibrary.test.ts` also locks the authenticated runtime → `ProductShell` → Progress media-library composition and its four explicit upload/delete controls; no selection still produces zero API or byte-transfer calls.
