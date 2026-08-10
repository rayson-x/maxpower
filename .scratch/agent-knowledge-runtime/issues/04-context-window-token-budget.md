# 04 — 对话窗口与 token 预算

**What to build:** ContextAssembler 的对话历史改为滑动窗口（最近 N 条原文）+ 更早消息按 run 分组摘要（复用 timeline 的 fact_ref_hierarchical 压缩模式）；实现 token 估算与预算（按 provider 上限留安全余量）；超预算时按固定顺序降级——对话历史 → working memory → 早期 timeline → 当前计划详情；系统准则、安全约束、近期事实永远不裁。压缩方式与裁剪计数记入 context manifest。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] 构造 500+ 条消息会话：上下文大小有界，manifest 记录压缩方式与裁剪计数
- [x] 降级顺序测试：预算紧张时先裁对话历史，安全约束/系统准则保留
- [x] 短会话行为不变的回归测试（现有 provider 测试保持绿色）

## Comments

- 2026-08-10 完成：ContextAssembler 增加对话窗口（40→10→0）、timeline 窗口（200→50→20）、非置顶记忆裁剪、计划详情裁剪的固定降级序列；token 估算 chars/4（产品近似值，默认预算 24000）；`contextBudget` 记入 context manifest。测试 `tools/coach-runtime/contextBudget.test.ts` 4 例，全量 649 通过。
