# 器械—骨架融合研究独立审查

日期：2026-08-12  
审查对象：[`docs/research/2026-08-12-equipment-skeleton-biomechanics-fusion.md`](../research/2026-08-12-equipment-skeleton-biomechanics-fusion.md)  
审查方式：ACPX Claude 科学审查 + 独立 subagent 工程审查 + 主代理原始来源/代码复核。

## 结论

**有条件通过。** 生物力学边界、器械与骨架联合建模、禁止循环证据、动作合同和 `cannot_judge` 原则准确且可行；原稿对当前运行时成熟度表述不够精确，已经修正。

准确的当前能力是：

- 已有因果逐帧杠轴识别与追踪：LSD 横向杠轴候选、因果背景、alpha-beta path、overlay/sidecar；不读未来帧或 rep 标签。
- 已有 Rust 器械 observation、主体关联、稳定 track id、卧推杠铃 phase/rep 实验状态图和 Native/WASM 输入 ABI。
- 页面看到的杠铃追踪是真实算法结果，但页面消费预生成逐帧 sidecar；它不是手机摄像头当场运行 YOLOX 器械类别。
- Android 真实摄像头当前只发送 YOLOX person + RTMPose Halpe-26，器械数组仍为空。
- 当前没有训练好的 YOLOX 杠铃/哑铃类别，也没有已验收的双哑铃独立轨迹。
- 当前 Rust 杠铃 phase 是器械边界主导 + pose 对照，不是目标中的联合 latent-phase 融合。

## 通过的科学结论

1. 运动学不等于动力学；单目视频不能直接输出真实关节力矩、肌肉激活、左右受力或刺激百分比。
2. 接触关系是几何约束而不是接触力测量。
3. 器械轨迹是负重动作阶段与外部路径的核心证据；骨架解释人体运动策略，两者都不是 fallback。
4. 杠铃共享对象拓扑与两只哑铃独立对象拓扑必须分开。
5. 地面硬拉、推举、划船和弯举不能被强制套入统一“离心→向心”相序。
6. equipment-conditioned pose 不得再次作为独立 pose 证据确认同一器械事件。
7. 引用的 PMID、作者修正和主要研究范围整体准确。

## 采纳并修正的问题

### P0：当前客户端视觉生产端描述过度

原稿的 “YOLOX person/equipment” 容易让人以为客户端已有器械类别模型。代码显示 Android `PoseCameraView.kt` 调用 Native 时没有传入器械数组；当前 HumanArt YOLOX 是人物检测。原稿已改为：已有因果 LSD 杠轴原型，待移植为客户端生产端或另行训练器械检测模型。

### P1：当前 Rust 不是联合后验融合

`barbell_phase.rs` 当前以杠轴位置和速度反转建立边界，pose extreme 只做对照，不能移动器械边界。目标联合 likelihood/posterior 现在仍是设计，不是现有能力；原稿已明确区分。

### P1：provenance 去重尚未实现

Rust 当前有 source/status，但没有 `EvidenceRoot` DAG、correlation group 或根证据去重。添加 equipment-conditioned pose 前必须先建立紧凑 provenance；热路径建议使用 root bitset/correlation id，完整 DAG 只在 sealed rep/full diagnostics 输出。

### P1：器械拓扑还不完整

当前 `EquipmentObservation` 主要是 bbox/中心/类别/分数；尚未把杠轴端点、方向、可观察形变和双哑铃左右身份完整纳入 Rust canonical contract。原稿已补充杠体形变和哑铃 orientation 边界。

### P2：冲突、缺失与维度级拒判只实现了一部分

Rust 已有帧级 missing/timestamp/reflection/static 等状态，但方向冲突、刚体几何冲突、identity switch、有限 missing TTL 以及分维度 `cannot_judge` 尚未闭环。

### P2：标注与 E1–E7 是计划，不是现有测试能力

当前 MM-Fit dumbbell 队列仍是 set-count 粒度、`repBounds` 为空、腕 ROI 非真值，并明确没有训练好的 dumbbell detector。原稿已标注该边界。

### 科学表述细化

- Ray3D 支持单目绝对 3D 的病态性和相机参数敏感性；“所有产品度量保存机位/尺度/校准”属于受论文支持的工程推论，不是论文原句。
- 重载下杠体可能出现弹性形变/振动，因此杠端高度差不能一律归因于人体双侧不对称。
- 卧推绝对杠行程受胸廓、凳面和拱背策略影响，不能直接等同肩关节 ROM。
- 双哑铃具有独立 orientation/rotation；看不清时必须拒判。
- Pearson et al. 的范围已明确为 12 名有力量训练经验的精英男性帆船运动员、10–100% 1RM，不能无条件外推。

## 未采纳的审查意见

### “Stastny et al. 没有运动学数据”——不成立

PMID 25968228 的摘要和全文明确说明测量了髋、膝峰值角度和 ROM，同时测量 EMG。原稿“运动学/EMG”并未越界；现进一步写明“髋膝 ROM 与 EMG”。

### “Pearson et al. 是 n=24、40–100% 1RM”——不成立

PMID 19891202 的记录是 12 名精英男性帆船运动员，负荷 10–100% 1RM。Claude 的这项限制说明数据有误，未采纳。

### “项目没有实现杠铃识别”——不成立

项目已有因果 LSD 杠轴检测、alpha-beta 追踪、连续叠图/sidecar，以及 Rust 设备输入和杠铃 phase 实验。真正缺少的是客户端摄像头实时生产端和联合融合，不是所有杠铃识别能力。

### “同步 contract 完全不存在”——表述过重

Native/WASM 调用已经允许 pose/equipment 在同一调用、同一 source timestamp 下进入 Rust。当前问题是客户端未产生器械数组，以及未来若两模型异步执行，需要明确 frame id、最大 skew、迟到/丢帧策略；不是完全没有同步边界。

## 可行性结论与最小实现顺序

1. 冻结同帧 observation envelope：source frame id/timestamp、raw pose、raw equipment、模型版本、topology 和紧凑 provenance roots。
2. 复用现有 LSD 因果杠轴算法，先移植/重写成客户端可运行生产端，并与训练器械检测器作为独立基线比较。
3. 从 Android 首先接通真实 Y-plane/frame → bar observation → existing Native ABI → Rust；记录 FPS、延迟、丢帧和热状态。
4. 扩展 Rust bar geometry；随后再做双哑铃独立身份，不把两只哑铃平均成虚拟杠。
5. 实现有界缺失、冲突事件和维度级 `cannot_judge`。
6. 实现 raw-root 去重后，再允许 equipment-conditioned pose。
7. 把当前器械主导 phase 升级成动作合同约束的双通道 evidence filter；先做可校准 score/state filter，再决定是否需要完整概率后验。
8. 先完成独立器械像素/identity 真值和 E3/E4/E7，再做 held-out E1 融合收益测试。

## 仍需实验证明

- 双通道融合是否在独立视频上优于最佳单通道，而不是只提高表面置信度。
- 现有 LSD 杠轴算法移植到 Android/iOS/Web 后的速度、热量和镜面鲁棒性。
- 训练后的器械检测器是否优于 LSD baseline，尤其是哑铃、倾斜杠和遮挡。
- 设备条件化腕点是否降低像素误差，而不只是让轨迹更平滑。
- 正面/侧面/45° 的维度可观测范围和透视误差。
- 人工换向确认在停顿、反弹和慢速力竭 rep 中的审核一致性。
