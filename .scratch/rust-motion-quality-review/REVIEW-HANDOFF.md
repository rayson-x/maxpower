# Rust 动作质量审核交接

Status: implementation-in-progress

> 本文件中的旧冻结数字已失效：独立检查发现同源衍生数据泄漏与器械未进入 Rust 因果流。正式审核尚未开始；只有重新生成全部产物并通过第二轮独立检查后，本文件才会更新为可审核状态。

## 审核入口

- URL: `http://127.0.0.1:4318/quality-review.html`
- 冻结 release: `personal-motion-quality-review-v1`
- 页面默认只在内存保存审核选择；只有用户点击“导出审核 JSON”才产生文件。
- 每个 Rust movement candidate 分别审核三个端点和八个质量结论。原提案、证据和哈希保持不可变；`incorrect + corrected_value=null` 是合法审核结果。

## 冻结范围

- 50 个唯一个人视频。
- 54 个精确 action × view × side/window 上下文。
- 464 个人工 start/end 区间；原 expected count 合计 465，差异未被自动修正。
- 12 个已有动作类别均有显式 Rust action contract 与 capability。
- Full-data proposal 含 526 个 Rust 首轮提案；这是人工审核队列，不是准确率。
- 6 个卧推上下文带独立的杠铃轨迹证据；其余缺少专用器械 producer 的动作明确标为未观测或不适用。

## Blind evaluation（与 full-data proposal 严格分开）

- 所有 54 个上下文都留在评分分母中。
- 当前可找到合法 source-excluded Profile 的只有 8 个单侧绳索侧平举上下文；另外 46 个上下文被泄漏门禁标为 unsupported，而不是偷用同源模板。
- 全范围：precision 1.0000，recall 0.1379，exact-set 0.0926，start MAE 283.08 ms，end MAE 229.61 ms。
- 合法 phase-supported 子集：68 个真值、64 个预测、64 个匹配；precision 1.0000，recall 0.9412，exact-set 0.6250。
- 因此当前结果不能声称整体达到 95%，也不能声称对新用户、新场地或新机位具备泛化能力。

## 可声称与不可声称

可以声称：客户端可部署 Halpe-26 canonical observation 可按一次时序流进入 Rust；Rust 冻结 Rep/candidate、三端点、器械/骨架证据和八维度审核提案；Web/Native host 只投影 QLT1，不建立第二套动作理解。

不能声称：526 个 full-data 提案是 526 个正确 Rep；同数据提案等于盲测准确率；二维视频测得力量、力矩、肌肉激活或伤病风险；当前单用户语料证明跨用户泛化。

## 验证记录

- Rust 全量测试：全部通过。
- MotionPacket 1.8/QLT1 TypeScript：9/9 通过。
- Native host QLT1 投影：4/4 通过。
- 12 动作契约与融合策略：11/11 通过。
- Blind evaluator：5/5 通过。
- Full personal release：7/7 通过。
- Rust full-data/review release runner：5/5 通过。
- Recognition review 既有回归：32/32 通过。
- 新审核 document/app：7/7 通过；只读/range video server：2/2 通过。
- Codex in-app browser 已验证页面加载、视频可播放、时间轴定位、骨架/器械 overlay 和逐项控件。

## 后续审核结果的用途

本轮只启动人工审核，不自动训练。导出的审核 JSON 才是下一轮离线校准输入；任何 Profile/RulePack 更新、再次盲测或生产 promotion 都必须是之后的显式版本化步骤。
