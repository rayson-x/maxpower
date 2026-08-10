# 08 — 行为改变对话准则注入

**What to build:** 01 定稿的行为改变准则与领域边界话术进入 system prompt 构造点，文本版本化；准则版本号钉入每个 run 的 context manifest，任何一次对话可追溯当时生效的准则版本。

**Blocked by:** 01. 行为改变知识内容与准则文本定稿

**Status:** ready-for-agent

- [ ] 准则文本出现在 system prompt 且带版本号
- [ ] run 的 context manifest 记录准则版本
- [ ] 准则变更后新 run 用新版本、旧 run 记录不变
- [ ] ScriptedLLMProvider 场景：前意向阶段用户收到 evoking 式回应而非处方式回应
