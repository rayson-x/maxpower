# exercises-dataset 整合设计决策

> 定稿：2026-08-16 grilling 会话产出。用于 exercises-dataset 整合与训练规划功能开发。

## 数据地基

数据集走 pack 构建旁路 + evidenceStatus 分级（不进 wiki claim 管线）；首批只审与现有 33 concepts/65 identities 匹配的记录；中文说明文本不进包；肌群映射与 identity 匹配都是 LLM 起草 + 人工裁定 + 版本化文件 + 构建期 fail-on-unmapped；新 variant 继承 concept 级刺激合约；每批审校 bump pack minor 版本。快照在 `maxpower/data/external/exercises-dataset/`（commit 7455efae，媒体因 Gym visual 许可永不接入）。wiki 登记：`source.exercise.exercises-dataset-hasaneyldrm`（source_verified）。

## 三线并行

1. **训练复盘**：`assessMuscleWeek` 深模块，单一结构化报告，UI 先行；RIR 缺失按 0.85 折算 + 显式缺失比例 + 补录入口
2. **恢复感知规划**：agent 原子工具 `plan.estimate_muscle_load` + `plan.forecast_recovery`，纯确定性封装 muscleFatigue.ts；恢复窗按肌群使用程度分级，数值等文献调研校准
3. **替代推荐**：专门页面与 agent 换动作共用 KnowledgePackRegistry 同一排序器；plannerEligible/recordable 在 registry 入口强制执行（此前声明了但无 enforcement）

## 根原则

[agent-executor-sovereignty-v1.md](agent-executor-sovereignty-v1.md)——所有规则软建议，用户最终拍板；计划写入沿用既有 mandate 机制（auto_apply_eligible / confirmation_required），无新机制。

## 待办

- 恢复学文献调研（产出落 docs/research/ 后走 wiki draft 收录）
- 正式方案文档放 docs/specs/
