# 02 — 知识包数据化与加载器

**What to build:** 知识包从代码内嵌改为版本化 JSON 数据资源。加载器实现：内置资源兜底 → 本地安装的数据包覆盖；加载前校验 contentHash、reviewed_digest 签名与 schema 版本兼容性，任一失败拒绝加载并回退内置包、记录拒绝原因。KnowledgePackRegistry 对外接口不变，引擎无感。数据包本轮经本地文件路径安装。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 现有知识包内容（动作族目录、替代权重、规则包清单、wiki 引用）完整抽取为 JSON 资源且内容哈希可复现
- [ ] 加载器：无数据包时用内置包；数据包签名/hash/schema 任一不符时回退内置包并记录拒绝原因
- [ ] 本地路径安装数据包后，registry 读取到新版本内容
- [ ] 包加载器接缝测试覆盖：内置兜底、覆盖、三类失败回退（参照既有 KnowledgePackRegistry 校验测试）
- [ ] 既有引擎与 planner 测试全部保持绿色（接口无感）
