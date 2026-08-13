# 11 — FoodData Central 营养数据切片

**What to build:** 通过 FoodData Central 官方接口建立一个小而完整、可更新、可追溯的 Wiki 数据集切片，发布数据来源页、Dataset Page、必要的事实 Claim 和相关 Topic 更新。此任务走结构化数据采集，不使用 book-to-skill，也不直接接入 Planner 数据运行时。

**Blocked by:** 01. IUSCA 增肌来源端到端试点

**Status:** completed

- [x] 发布 API 与数据集 Source Page，登记接口版本、CC0 状态、获取时间、发布日期和内容或响应哈希
- [x] 发布 Dataset Page，说明覆盖范围、字段、选择标准、更新频率、已知偏差和不适用情境
- [x] 选择覆盖常见蛋白质、主食、蔬果、乳制品和脂肪来源的代表性食物，并保留标识、数据类型、营养素、数值、单位和份量
- [x] 明确区分实验测定、推算数据和品牌标签数据；必要的数值 Claim 必须引用具体数据版本
- [x] 更新“食物营养估计”和“外食估计误差”Topic Pages，并明确该数据不能冒充中国食物成分表
- [x] 缺失值、单位、重复项和更新测试通过；Wiki 验证、链接检查和索引构建通过

## Comments

- 2026-08-13 完成：固定 7 个 SR Legacy 食物、28 行营养数据；保留 FDC ID、版本、单位、份量和来源类型，数据质量 fixture 6/6 通过。
