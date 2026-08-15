# 06 — 物化 30 个动作族与 248 个叶级动作

**What to build:** 将已审核的 30 个动作族合同和 248 个细粒度叶级动作身份物化为受治理资产。每个叶级动作完整定义应动、应稳、人体/器械轨迹、Rep 边界、代偿、有限结论和 exact identity；宽泛父动作仅用于目录组织，不能成为 executable fallback。

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] 30 个动作族合同与 248 个无重复叶级动作拥有稳定 ID、结构化 identity、版本、内容哈希和可追溯来源。
- [ ] 每个叶级动作完整物化 required motion、coordinated motion、stability relation、substitution relation、primary/corroborating tracks、Rep boundary、phase semantics 与 limited claims。
- [ ] definition-completeness gate 枚举全部 248 个叶级动作；任何缺失、不一致或只继承宽泛父动作的定义都使构建失败，不能转成 `PlanRefusal`。
- [ ] 所有宽泛父动作均标记为 non-executable parent；运行时不进行字段笛卡尔积组合，也不从相似名称、器械或姿态回退到父动作。
- [ ] 每个完整定义先经过器械范围解析：支持拓扑或无需器械主轨迹的动作进入 operator resolution；不支持拓扑且器械为必要主运动时停留在明确的 `UnsupportedEquipmentTopology` catalog-only 状态，独立人体主运动充分时进入 pose-supported limited resolution，不能获得器械能力。
- [ ] 自由杠铃、史密斯、哑铃、绳索、固定器械、地雷管与自重等改变计算方式的拓扑，以及坐姿、站姿、俯卧、仰卧、胸托、单双侧与关键 setup 差异，均体现为受审核叶级身份；只有自由杠铃、史密斯杠、哑铃和固定器械用户接触把手获得本轮 equipment executable eligibility。
- [ ] 资产物化不增加按 action ID/name 编写的 Rust 分支；动作族模板只复用声明结构，不拥有可执行父动作语义。
- [ ] 248 个定义可以按受审核动作族 wave 物化，每个进入 admission 的 wave 自身必须完整；Ticket 06 的最终完成仍要求全部 248 个，但目录广度不得阻塞 Ticket 05 对当前 24 contexts 的准确率 checkpoint，也不得让未校准定义自动获得 executable/quality maturity。
