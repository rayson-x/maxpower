# 07 — 交付可选私有媒体资料库

**What to build:** 让用户主动上传并管理训练视频、canonical packet、关键点和营养照片，而不让媒体成为产品前置条件。

**Blocked by:** 02 — 贯通手机号与邮箱认证；06 — 保存 WorkoutSession 与结构化结果

**Status:** completed

- [x] 私有对象存储支持受限的直接上传与完成校验。
- [x] 媒体 metadata 和派生关系持久化；WorkoutSession/Result 使用资源 ID 关联。
- [x] 下载 URL 短期有效且只能由 owner 获取。
- [x] 删除原件递归删除所有派生对象；结构化结果可保留 evidence-deleted provenance。

**Verified:** PostgreSQL 17 + versioned S3 seam tests cover upload expiry/reissue, checksum mismatch cleanup, the 5-GiB single-PUT cap, live-URL waiting, and recursive version/delete-marker removal.
