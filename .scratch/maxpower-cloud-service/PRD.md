Status: blocked — implementation complete; final staging Provider and signed-device release acceptance remain external

# MaxPower Cloud Service — Authentication, Authoritative Product Data, Media Library and LLM Gateway

## Problem Statement

MaxPower 当前是本地优先客户端：身份固定为本地用户，结构化事实、计划、WorkoutSession、结果、Coach 对话和 Agent 运行记录都保存在单个本地 Ledger snapshot 中；LLM 则可由客户端直接配置并访问真实 Provider。这个结构适合验证本地 Coach，但无法提供真实账号登录、跨设备数据恢复、云端权威数据、可控的 LLM 成本或服务端统一模型路由。客户端中存在 Provider endpoint/API key 配置入口也不适合正式分发。

产品现在需要面向中国大陆以外市场提供一个必须联网的云服务。用户必须完成手机号、邮箱、Google 或 Apple 登录后才能进入产品和使用 Agent。用户档案、计划、训练 session 和结构化结果必须以云端为权威；Coach 对话 session、消息和 Agent 内部运行记录继续留在本机，不做云同步。训练视频、逐帧 canonical packet、关键点与营养照片只有在用户主动选择后才进入个人资料库。

Agent 仍在客户端拥有上下文编排、工具 schema、确定性规则、HITL 和事实提议能力，但不能再直接访问 LLM Provider。所有文本和视觉 LLM 请求必须走 MaxPower 暴露的 OpenAI-compatible Gateway，由服务端验证身份、检查账户与额度、路由真实 Provider，并核算 token 与实际成本。用户只看到 MaxPower 云端 AI 能力和额度状态，不看到真实 Provider、物理模型、token 数或成本明细。

本项目首先需要一套独立、可测试、稳定的服务端接口，然后才迁移客户端。生产数据库、对象存储、Better Auth 和真实 LLM Provider 都必须作为可替换 Adapter 接在稳定服务端 Interface 后面，避免服务端基础设施选择反向污染客户端和 Coach 领域模型。

## Solution

交付一个独立的 MaxPower Cloud Service，按“服务端契约 → 生产 Adapter → 客户端迁移”的顺序上线。

服务端公开一套版本化 HTTPS JSON/SSE API，并由四个深模块实现：

1. **Identity：** MaxPower 自定义注册/登录产品流程，内部使用 Better Auth 处理手机号/邮箱 OTP、密码、Google/Apple、session、撤销、凭据摘要和密钥轮换；业务服务只验证 access token 并取得规范 account identity。
2. **ProductData：** 保存用户档案、计划及不可变版本、WorkoutSession 和结构化结果；云端成功 ACK 才代表规范写入完成，普通 REST 资源取代通用 replica push/pull 协议。
3. **MediaLibrary：** 保存用户主动上传的训练视频、canonical packet、关键点和营养照片的私有对象与权威 metadata；原件、派生物、关联和删除由同一生命周期管理。
4. **LlmGateway：** 暴露兼容现有 Agent adapter 的 Chat Completions JSON/SSE 接口，只接受固定产品能力 alias；每次请求验证用户、账户状态、同意与额度，原子预留并结算消费，内部选择真实 Provider/model。

客户端 AgentRuntime、工具执行、Policy/HITL、Planner 和本地 Coach 对话继续保留。客户端把本地对话中用户已经确认的计划、WorkoutSession 或结果通过 ProductData API 保存为云端规范资源；服务端不会从原始 LLM 文本自动生成业务事实。

用户首次安装或已退出登录时必须联网并完成登录，断网不能进入产品。后续版本如果要支持离线记录，必须另立规格；当前版本没有匿名身份、离线 LLM、离线产品入口或本地 Provider fallback。

## User Stories

### 账号与登录

1. As a 新用户, I want 使用手机号验证码开始注册, so that 我可以不依赖 Google 或 Apple 创建账号。
2. As a 新用户, I want 使用邮箱验证码开始注册, so that 我可以在没有可用手机号时创建账号。
3. As a 已注册用户, I want 在注册入口验证已有手机号或邮箱后直接登录, so that 重复操作不会创建第二个账号。
4. As a 未注册用户, I want 验证码通过后必须填写昵称、密码并接受条款, so that 账号在资料完整前不会进入产品。
5. As a 已注册用户, I want 使用手机号或邮箱验证码登录, so that 我忘记密码时仍可登录。
6. As a 已注册用户, I want 使用手机号或邮箱加密码登录, so that 我不必每次等待验证码。
7. As a 用户, I want 使用 Google 登录, so that 我可以复用可信社交身份。
8. As a iOS 用户, I want 使用 Apple 登录, so that 我可以使用平台原生身份。
9. As a 用户, I want 注册与登录是不同操作, so that 输入未知账号登录时不会被静默注册。
10. As a 用户, I want 相同邮箱的不同身份不会仅凭字符串被静默合并, so that 别人不能借邮箱碰撞接管我的账号。
11. As a 已登录用户, I want 在重新证明当前身份后显式链接新的登录方式, so that 一个规范账号可以安全拥有多个身份。
12. As a 用户, I want 退出当前 session 后它立即失效, so that 旧 token 不能继续访问我的数据或消耗 LLM 额度。
13. As a 用户, I want 账号被限制或进入删除状态后 LLM 和数据写入立即停止, so that服务端状态优先于客户端缓存。
14. As a 用户, I want 未登录时只能看到登录、条款、隐私和服务状态, so that 个人数据不会在无归属状态下产生。
15. As a 用户, I want 没有网络时不能进入产品, so that 产品不会展示无法读取云端权威数据的失真状态。
16. As a 运营人员, I want 登录接口对账号是否存在采用一致的外部错误语义, so that 攻击者难以批量枚举用户。
17. As a 安全维护者, I want OTP、密码、session 和 Provider secret 由成熟认证/Secret 管理能力处理, so that 业务代码不自行实现密码学原语。

### 云端权威产品数据

18. As a 用户, I want 登录后读取我的云端档案, so that 换设备后仍能恢复基本资料。
19. As a 用户, I want 修改档案后获得新的 revision, so that 多个请求不会无声覆盖较新的修改。
20. As a 用户, I want 创建训练计划并把它保存到云端, so that 计划不是只存在单台设备。
21. As a 用户, I want 每次实质计划修改产生不可变版本, so that 已完成训练仍能解释当时使用的处方。
22. As a 用户, I want 发布一个明确的当前计划版本, so that 客户端知道哪个版本可以执行。
23. As a 用户, I want 查看自己的计划列表和单个计划, so that 客户端可以从云端重建产品 projection。
24. As a 用户, I want 删除计划时不会破坏历史 WorkoutSession 的冻结快照, so that 历史结果仍可解释。
25. As a 用户, I want 开始一个云端 WorkoutSession, so that 本次训练拥有规范身份和开始时间。
26. As a 用户, I want 更新未完成 WorkoutSession 的结构化记录, so that 训练过程可以持续保存。
27. As a 用户, I want 完成 WorkoutSession 并保存总结, so that Progress 和后续计划可以使用确认结果。
28. As a 用户, I want 保存动作分析、训练总结或其他版本化结构化结果, so that Agent 产出的已确认事实可以跨设备恢复。
29. As a 用户, I want 修改或删除自己的结构化结果, so that 更正可以进入云端权威状态。
30. As a 用户, I want 永远不能通过 request body 选择另一个 userId, so that 资源所有权只来自已验证 token。
31. As a 用户, I want 重试创建或命令请求不会生成重复资源, so that 移动网络重试是安全的。
32. As a 用户, I want 过期 revision 的更新收到明确冲突和当前版本, so that 客户端能提示或重取而不是丢数据。
33. As a 用户, I want 云端 ACK 成功后才把写入视为完成, so that 本地缓存不会冒充权威服务器。
34. As a 用户, I want Coach 对话 session、消息和 Agent run 继续只留本机, so that 云端不建立不需要的对话档案。
35. As a 用户, I want 本地 Coach 中已确认的计划或结果可以单独保存到云端, so that 对话隐私和业务数据恢复可以同时成立。

### 个人媒体资料库

36. As a 用户, I want 自己决定是否上传训练视频, so that 原始影像不是使用产品的强制条件。
37. As a 用户, I want 自己决定是否上传逐帧 canonical packet, so that 动作证据可以按需进入个人资料库。
38. As a 用户, I want 自己决定是否上传关键点数据, so that 结构化动作资料与视频可以分别管理。
39. As a 用户, I want 自己决定是否上传营养照片, so that 饮食图片不会默认永久保存。
40. As a 用户, I want 看到自己的媒体资料库和每个资产的上传状态, so that 我知道哪些内容确实存在云端。
41. As a 用户, I want 大文件使用直接对象存储上传而不经过业务进程, so that 视频上传可以可靠扩展。
42. As a 用户, I want 所有对象默认私有且下载链接短期有效, so that 猜测 URL 不能访问我的媒体。
43. As a 用户, I want 删除一个原始媒体时同时删除缩略图、转码、packet 和关键点派生物, so that 删除不会遗留隐藏副本。
44. As a 用户, I want 删除证据媒体后仍可保留已经确认的结构化结果并标明证据已删除, so that 我的历史训练不会因清理视频而消失。
45. As a 用户, I want 删除账号时媒体、派生物和业务数据一起进入删除工作流, so that 不会留下孤儿数据。

### 云端 LLM Gateway

46. As a 已登录用户, I want Agent 自动调用 MaxPower 云端 LLM, so that 我无需配置 endpoint、模型或 API key。
47. As a 未登录用户, I want LLM 请求被拒绝, so that 云端成本只服务有效账号。
48. As a 被限制用户, I want LLM 请求立即停止, so that 账户策略能实时生效。
49. As a 用户, I want Coach 文字流继续以低延迟 SSE 返回, so that 现有对话体验不因 Gateway 迁移退化。
50. As a 用户, I want 工具调用继续兼容现有 Agent tool-call loop, so that 客户端仍能执行 Policy、HITL 和 typed tools。
51. As a 用户, I want 营养照片观察走同一个受控 Gateway, so that 视觉请求不会绕过身份、额度与成本统计。
52. As a 用户, I want 断流后在五分钟内从已收到事件之后恢复, so that 短暂网络切换不会立即重复计费。
53. As a 用户, I want 五分钟缓冲过期后得到明确 stream_expired, so that 客户端不会误认为仍可恢复。
54. As a 用户, I want 重试相同幂等请求时复用原 invocation, so that Provider 不会被重复调用和计费。
55. As a 用户, I want 用同一幂等键发送不同请求时收到冲突, so that 请求混淆不会产生错误回复。
56. As a 用户, I want 额度不足时立即看到额度已用完, so that Agent 不会无限等待或静默失败。
57. As a 平台运营者, I want 额度不足时 Provider 根本不被调用, so that hard stop 真正控制成本。
58. As a 平台运营者, I want 调用前预留最大消费并在完成后按实际 usage 结算, so that 并发请求不能透支账户。
59. As a 平台运营者, I want 记录输入、输出、缓存、图片 token 与真实成本, so that 可以核算免费额度、后台赠送和未来订阅。
60. As a 平台运营者, I want pricing 与 route config 版本化, so that 历史成本可以按当时价格复算。
61. As a 平台运营者, I want 在 Provider 失败时释放未消费的用户预留, so that 平台故障不会错误扣减用户额度。
62. As a 产品维护者, I want 客户端只发送固定产品能力 alias, so that Provider 和物理模型可以在服务端切换。
63. As a 用户, I want 响应中只看到 MaxPower 公共模型名, so that 内部 Provider、物理模型和上游 request ID 不会泄漏。
64. As a 用户, I want 我的 prompt、response、图片、tool 参数和本地 conversation ID 不进入持久化 usage 记录, so that成本审计不变成对话存档。
65. As a 平台维护者, I want access log、APM 和错误上报不采集 Authorization、body 或 SSE 内容, so that 运维链路不会旁路保存用户内容。
66. As a 平台维护者, I want Provider key 只存在服务端 Secret Manager, so that客户端 bundle、仓库和业务数据库都没有真实凭据。
67. As a 用户, I want 客户端没有自定义 Provider 配置入口或本地 LLM fallback, so that所有 Agent 请求都服从同一服务策略。

### 删除、市场与运营边界

68. As a 用户, I want 删除账号时立即撤销 session 并停止 LLM 与写入, so that删除请求不会继续产生新数据或费用。
69. As a 用户, I want 账号删除工作流覆盖身份、档案、计划、WorkoutSession、结果和媒体, so that数据归属完整结束。
70. As a 海外 Android 用户, I want 通过 APK 安装后使用手机号或邮箱登录, so that产品不依赖应用商店分发。
71. As a 无 Google 服务设备用户, I want 手机号和邮箱始终作为保底登录方式, so thatGoogle 登录不可用时仍可访问产品。
72. As a 产品运营者, I want Google 按运行环境可用性显示, so that不可用设备不会展示死入口。
73. As a 产品运营者, I want 当前服务明确不承诺中国大陆网络、短信、邮件或 LLM 可用性, so that侧载能力不会被误解为大陆服务部署。
74. As a 后台运营者, I want 给用户发放月度免费额度或人工 grant, so thatV1 可以在无用户账单页面时运营。
75. As a 用户, I want 只看到可用或已耗尽的产品额度状态, so thatProvider token 与内部成本不会造成困惑。

## Implementation Decisions

- 交付顺序固定为服务端接口与契约测试、生产 Adapter、部署与观测、客户端接入；在服务端合同稳定前不修改客户端 composition root。
- 最高测试 Seam 是版本化 HTTP API。模块级测试仅用于快速验证同一外部行为；生产 Adapter 必须通过与内存 Adapter 相同的 Interface conformance tests。
- 服务端使用独立 TypeScript/Hono 运行单元，不导入 Expo 客户端，也不修改客户端依赖。HTTP JSON/SSE 是跨端边界。
- Identity、ProductData、MediaLibrary 和 LlmGateway 是四个深模块。repository、SQL、对象存储 SDK、Provider SDK 与 Better Auth 细节不进入公开 Interface。
- Identity 对外表达 MaxPower 产品流程，内部生产 Adapter 使用 Better Auth。业务模块只消费规范 Principal，不处理密码、OTP、OAuth code、session secret 或 Provider key。
- 注册 OTP 验证已有 identity 时可以直接登录；未知 identity 返回 registration-required ticket，完成昵称、密码和条款后才创建 active account。登录 OTP 不得自动注册未知账号。
- 手机号使用 E.164 规范化；邮箱使用保守规范化。Google/Apple 的稳定键是 issuer + subject；相同 email 本身不触发静默合并。
- Better Auth session 是登录会话；面向 ProductData/Media/LLM 的 access token 是短期 service JWT。JWT payload 只包含 subject、session、scope、realm、issuer、audience、expiry 和最小账户状态，不包含 email、姓名、套餐、余额、Provider 或物理模型。
- ProductData 云端是 Profile、Plan、PlanVersion、WorkoutSession 和 Result 的权威来源。所有资源由 token subject 定位账户，客户端 body/query 中的 userId 不可信。
- PlanVersion 是不可变快照。WorkoutSession 保存其实际执行版本的最小冻结快照，计划后续修改或删除不改写历史。
- 普通 REST command/query API 取代通用 replica event 同步。创建/命令使用 Idempotency-Key；修改/删除使用 revision/If-Match；列表使用 cursor pagination；云端 ACK 才算提交。
- CoachSession、Message、AgentRun、ToolCall、Working Memory 和本地 stream event 不建云表。客户端只上传用户确认后的规范业务资源。
- MediaLibrary metadata 是资料库索引权威；媒体字节放在私有对象存储。上传使用短期、限定 content type/size/hash 的直接上传凭证；完成后服务端验证对象 metadata。
- MediaAssetRelation 表达原件与派生物。删除通过异步工作流递归删除对象、派生关系与缓存；结果只保留 evidence-deleted 标记。
- LlmGateway 保留现有 OpenAI Chat Completions JSON/SSE 和 streamed tool_calls 兼容性；客户端 AgentRuntime、工具执行与事实提交不迁到服务器。
- Gateway 只允许 `maxpower/coach-v1` 与 `maxpower/nutrition-vision-v1` 等产品 alias，响应统一使用 `maxpower-cloud`。真实 route、Provider、model 和 upstream ID 只存在内部 metadata。
- 每次 LLM 调用先校验短期 JWT，再实时检查 account/entitlement，随后原子预留额度。完成、取消和 Provider 错误分别结算、部分结算或释放。
- HTTP/SSE 连接断开只停止该连接的消费，不等同于取消 invocation；客户端主动取消必须调用已认证的幂等取消命令，服务端持久化该意图、跨节点中止 Provider，并按权威 usage 或保守上界结算。
- 额度使用整数 credits，真实成本使用整数 micros。entitlement ledger append-only，支持 free-monthly、admin grant 和未来 subscription grant。
- 持久化 invocation/usage 只包含 owner、alias、状态、时间、标准化 token/图片/cache usage、成本、route/pricing version 和错误分类。内容派生 fingerprint 只能是带服务端 secret 的 HMAC。
- SSE 内容只进入五分钟内存/Redis volatile buffer；生产 Redis 禁用持久化与备份。终态或 TTL 后不可恢复。
- 不做应用层端到端加密或客户端自持数据密钥。仍必须使用 HTTPS/TLS、密码/OTP/token 不可逆摘要、Secret Manager、托管存储默认静态加密和日志脱敏，这些属于基础安全而不是产品加密功能。
- 账户删除由服务端工作流编排：先撤销 session、停止 LLM/写入，再删除业务数据和媒体，最后删除身份记录。删除失败必须可重试和审计。
- 当前市场域为中国大陆以外的 global realm。APK 侧载不改变服务区域承诺；手机号/邮箱是所有设备的保底登录方式。
- 现有“本地 Coach 拥有决策与事实”的 ADR 需要新增记录澄清：客户端 Coach 仍拥有 reasoning、Policy、工具与事实提议；云端 ProductData API 成为用户确认后规范业务资源的持久化权威。服务端不得把原始 LLM 文本直接提交为事实。

## Testing Decisions

- 好测试只断言公开 HTTP 或模块 Interface 的外部行为：状态码、错误 code、资源归属、revision、幂等、不可变版本、额度变化和 SSE 语义；不断言 SQL 语句、Map 布局、Better Auth 内部表或 Provider SDK 调用细节。
- HTTP contract tests 是最高 Seam，覆盖未登录拒绝、完整注册/登录、受保护资源读写、跨账户隔离、配额硬停、流式响应与统一错误 envelope。
- Identity conformance tests 对内存 Adapter 与 Better Auth Adapter 运行同一用例：注册 OTP、已有账号路径、未知账号登录不注册、密码登录、token expiry/revoke、scope 与账户状态。
- ProductData conformance tests覆盖 Profile、Plan/immutable versions、WorkoutSession 和 Result 的 CRUD、account isolation、Idempotency-Key 重放/冲突和 If-Match 冲突。
- MediaLibrary conformance tests覆盖四种媒体、直接上传生命周期、对象 metadata 校验、跨账户禁止访问、派生关系递归删除和证据删除标记。
- LlmGateway tests 使用 fake Provider 与 fake entitlement ledger，验证未登录/受限/scope 拒绝、alias allowlist、请求不落内容、预留/结算/释放、hard quota 不调用 Provider、同键重放与不同请求冲突。
- SSE tests覆盖 OpenAI chunk、streamed tool_calls、`[DONE]`、五分钟内按 Last-Event-ID 恢复、owner-only、过期与 Provider 中途错误。
- 取消测试必须区分普通断网与用户主动取消，并覆盖跨 API 节点中止、流式/非流式部分成本、499 终态和断网后的原 invocation 恢复。
- Privacy tests扫描结构化日志、usage Adapter、APM hooks 和错误响应，确保没有 Authorization、Provider key、prompt、response、图片 data URL、tool args 或本地 conversation/session ID。
- Postgres integration tests在真实事务中验证 reservation 并发、唯一 idempotency、revision 更新、软删除和删除 job 可重试性；不能只用 mock repository 证明原子性。
- 对象存储 integration tests验证私有 ACL、上传约束、完成校验、短期下载 URL 和派生对象清理；metadata-only 内存 Adapter 不代表字节上传已经完成。
- Provider contract tests对真实 staging Provider验证 Chat Completions JSON/SSE、tool calls、usage 归一化、timeout、取消和 fallback；测试日志中使用合成内容。
- 客户端迁移最后运行 A/B 账号隔离测试：A 登录产生本地对话并保存云计划，切 B 后不能看到 A 的本地或云数据，切回 A 可恢复各自命名空间。
- 客户端发布前扫描 bundle、SQLite、SecureStore 和日志：不能存在真实 Provider key、可编辑 Provider endpoint/model、service JWT 持久副本或另一账号的缓存。
- 既有 CoachApplication、AgentRuntime、Planner、Policy、HITL、Motion 和产品 projection 测试仍须保持通过；服务器接入不能创造第二套 Agent 决策引擎。

## Out of Scope

- 中国大陆境内部署、数据区、短信/邮件送达或 LLM 网络可用性承诺。
- 匿名/guest 身份、无网首次进入、离线产品模式、离线 LLM 或本地 Provider fallback。
- 云端保存 Coach 对话 session、消息、Agent run、tool call、Working Memory 或完整 prompt/response。
- 把 AgentRuntime、工具执行、Planner、Policy、HITL 或 Rust Motion recognition 迁到服务端。
- 用户自带 Provider key、客户端选择真实 Provider/model 或 OpenRouter 式任意模型市场。
- 向用户展示 token、Provider 成本、真实模型、内部路由或完整 usage ledger。
- V1 用户付费、订阅购买、发票或支付渠道；V1 只建立可扩展 entitlement ledger、免费额度和后台 grant。
- 应用层端到端加密、客户端自持密钥或可搜索加密。
- 默认上传训练视频、canonical packet、关键点或营养照片；所有媒体上传均为用户显式选择。
- 多区域业务数据复制、跨区迁移、灾备 SLA 与数据驻留产品承诺。
- 两个已经注册账号的自动或客服手工合并；只支持受控的 identity linking，正式账号 merge 另立规格。
- 在本规格中重做现有页面、Coach drawer、Planner、Motion SDK 或训练识别算法。

## Further Notes

- 当前代码库已经有一个可运行的 server contract prototype：独立安装、内存 Identity/ProductData/MediaLibrary/LlmGateway Adapter、模块行为测试、Hono HTTP route 骨架和 Better Auth JWKS verifier seam。它用于锁定 Interface，不代表生产认证、数据库、对象字节上传或真实 Provider 已完成。
- 现有客户端的 SQLite CoachLedger 每次提交读写整个 JSON snapshot，不能直接作为云数据库 schema。生产迁移应按规范资源建表，不上传整个 snapshot。
- 现有 ReplicaTransport 只传 DomainEvent，明确不包含 Coach runtime records 和媒体；它不满足本规格的云端权威资源模型，因此不作为主要同步协议。
- 当前客户端已有 OpenAI-compatible SSE parser 和本地 tool loop，这是 Gateway wire compatibility 的直接 prior art。迁移时应替换 endpoint/token source，而不是重写 Agent runtime。
- Web 产品 Ledger 当前为内存实现；服务端验收不能借用 Web 刷新后的本地状态来证明云持久化。
- iOS canonical motion capture 尚未与 Android 对齐，但它不阻塞本规格服务端接口；相关媒体只有在客户端真实生成且用户选择后才能上传。
