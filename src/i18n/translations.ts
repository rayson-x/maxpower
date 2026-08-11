import type { TranslationTable } from "./core";

/**
 * 文案资源表（客户端唯一文案来源）。
 *
 * 键名约定：`域.范围.名称`（点分层）。
 * 英文为权威源，中文为翻译。新增语言加字段、更新类型、注册表。
 *
 * 初始覆盖：planner 用户可见文案（目标时间线 / 人群分层 / 饮食耦合 / 进食编排）。
 * 后续逐步把 src/mobile、src/coach 里散落的中文迁到这里。
 */

/** 规划（planner 产出的结构化 code 在这里翻译成文案）。 */
export const PLANNING_COPY: TranslationTable = {
  // 目标时间线 — 速度档
  "timeline.pace.aggressive": {
    en: "Fastest path: max safe daily deficit; requires strict load retention, high protein and a circuit-breaker",
    zh: "最快路径：每天顶到安全赤字上限，需严格保负荷+高蛋白+熔断机制",
  },
  "timeline.pace.standard": {
    en: "Balanced path: moderate deficit, better lean-mass protection and adherence",
    zh: "平衡路径：赤字适中，瘦体重保护更好，依从性更高",
  },
  "timeline.pace.gentle": {
    en: "Gentle path: smallest deficit, minimal impact on training performance",
    zh: "稳健路径：赤字最小，几乎不影响训练表现",
  },
  // 目标时间线 — 兜底说明
  "timeline.fallback.honest": {
    en: "I won't invent a precise timeline without body-fat data. For your build, a reasonable rate is {minPercent}-{maxPercent}% of body weight per week{kgPart}. Set your goal by a state you can see yourself, and we track progress with real weekly weight trends — how far and how fast depends on execution, and we calibrate as we go.",
    zh: "没有体脂率数据，我不给你编一个精确周数。按你的体型，合理的速度是每周掉体重的 {minPercent}-{maxPercent}%{kgPart}。目标用你能自己看到的状态来定，每周用真实体重趋势看进展——能持续多久、到什么程度，取决于执行，我们边走边校准。",
  },
  "timeline.fallback.kgPart": {
    en: " (about {minKg}-{maxKg} kg)",
    zh: "（约 {minKg}-{maxKg} kg）",
  },
  "timeline.upgrade.bodyFat": {
    en: "current + target body-fat %",
    zh: "当前体脂率 + 目标体脂率",
  },

  // 人群分层 — recomp 说明
  "tiering.recomp.leanBeginner": {
    en: "You're lean and new to training — this is the fastest-progress window, so we use a small surplus rather than a deficit; no need to cut yet.",
    zh: "你偏瘦且刚开始系统训练，正处于增肌的新手窗口期——这个阶段进步最快，所以用小幅热量盈余而非赤字，不用急着减脂。",
  },
  "tiering.recomp.noviceHighMass": {
    en: "At your training stage and build, you can lose fat and build muscle at the same time — diet + resistance training + enough protein is the combination.",
    zh: "以你的训练阶段和体型，这个阶段完全可以一边减脂一边增肌——饮食 + 抗阻 + 足量蛋白就是组合。",
  },
  "tiering.recomp.preserveFocus": {
    en: "At your training age, the goal during a cut is to keep muscle and strength — gaining will be slow, so we focus on preservation.",
    zh: "以你的训练年限，减脂期的目标是保住肌肉与力量，增肌会很慢——我们把重点放在保。",
  },
  "tiering.recomp.postBulkCut": {
    en: "You just finished a gaining phase — start with a small deficit and keep training load; avoid adding lots of cardio while slashing carbs at the same time.",
    zh: "你刚结束增肌期——起步用小赤字、保住训练负荷，不同时加大量有氧又猛降碳。",
  },
  "tiering.recomp.possible": {
    en: "For your situation, muscle gain and body-composition maintenance can go together.",
    zh: "以你的情况，增肌与维持体成分可以并行。",
  },
  "tiering.physique.dualTrack": {
    en: "A physique goal (broad shoulders, narrow waist) needs both tracks: enough shoulder/back size and low enough body fat — so load and protein can't be skimped.",
    zh: "形态目标（宽肩窄腰）需要两条腿一起走：肩背维度要够，体脂要够低。所以力量刺激和蛋白都不能省。",
  },

  // 进食编排 — 空腹说明（通用）
  "fueling.fasted.notMoreFatLoss": {
    en: "Fasted cardio does not burn more fat overall — its value is convenience and adherence, not a metabolic advantage.",
    zh: "空腹本身不会让你多减脂——它的价值在方便与好坚持，不是代谢杠杆。",
  },
} as const;

/**
 * 动作识别与拍摄（相机页 / 回放页 / 组后报告 / 入框校验）。
 *
 * 只陈述证据，不打分；无 finding 就是"未见异常"。
 */
export const MOTION_COPY: TranslationTable = {
  // rep 相位（Rust packet 词汇 → 展示标签）
  "phase.ready": { en: "Ready", zh: "准备" },
  "phase.effort": { en: "Drive", zh: "发力" },
  "phase.peak": { en: "Peak", zh: "极点" },
  "phase.return": { en: "Return", zh: "回放" },
  "phase.frozen": { en: "Hold", zh: "保持" },

  // 组生命周期
  "lifecycle.idle": { en: "Idle", zh: "待机" },
  "lifecycle.arming": { en: "Getting set", zh: "就位中" },
  "lifecycle.active": { en: "Tracking", zh: "识别中" },
  "lifecycle.paused": { en: "Paused", zh: "已暂停" },
  "lifecycle.finished": { en: "Finished", zh: "已结束" },

  // rep 处置
  "disposition.confirmed": { en: "Confirmed", zh: "已确认" },
  "disposition.needsReview": { en: "Needs review", zh: "待复核" },
  "disposition.rejected": { en: "Discarded", zh: "已剔除" },

  // 观察证据（finding）
  "finding.primaryRangeBelow.title": {
    en: "Range short for this set",
    zh: "动作幅度相对本组不足",
  },
  "finding.primaryRangeBelow.detail": {
    en: "The main joint travelled less than the median for this set — usually fatigue or too much load",
    zh: "主要关节行程低于本组中位水平，常见原因是疲劳或负重偏大",
  },
  "finding.secondaryRangeBelow.title": {
    en: "Supporting joint range is short",
    zh: "次要关节行程不足",
  },
  "finding.secondaryRangeBelow.detail": {
    en: "The assisting joints moved through a small range, so the rep may be incomplete",
    zh: "辅助关节的活动幅度偏小，动作可能不完整",
  },
  "finding.cycleFaster.title": { en: "Tempo is fast", zh: "节奏偏快" },
  "finding.cycleFaster.detail": {
    en: "This rep finished faster than expected — control the lowering phase",
    zh: "单次的完成节奏快于预期，离心阶段注意控制",
  },

  // 实时便签一行文案
  "live.steady": { en: "Tempo and path are steady — keep going", zh: "节奏与轨迹稳定 — 保持" },
  "live.waitingForMotion": { en: "Waiting for the first rep", zh: "等待动作开始" },
  "live.waitingForVideo": { en: "Waiting for the video to start", zh: "等待视频开始" },
  "live.recordOnly": {
    en: "This set is saved as a local training video only — no rep or form conclusions",
    zh: "本组会保存为本机训练视频，不生成动作识别结论",
  },

  // 入框校验提示
  "framing.hint.lowConfidence": {
    en: "Too many keypoints lost: improve the lighting, clear obstructions, then step back into frame",
    zh: "关键点大面积丢失：改善光线、减少遮挡后重新入镜",
  },
  "framing.hint.raiseCamera": {
    en: "Feet out of frame: move the phone back or raise it slightly",
    zh: "脚部未入镜：手机后退或略抬高",
  },
  "framing.hint.lowerCamera": {
    en: "Head out of frame: move the phone back or lower it slightly",
    zh: "头部未入镜：手机后退或略放低",
  },
  "framing.hint.moveFarther": {
    en: "Not all of your body is in frame: move the phone farther back",
    zh: "全身未完整入镜：手机再往后挪",
  },
  "framing.hint.centerBody": {
    en: "You are drifting out of frame: step toward the middle",
    zh: "身体偏出画面：往画面中央站一点",
  },
  "framing.hint.adjustCamera": { en: "Adjust your camera position", zh: "请调整机位" },
  "framing.status.inFrame": { en: "Whole body in frame", zh: "全身入框" },
  "framing.status.counting": { en: "counting", zh: "正在计数" },
  "framing.status.ready": { en: "ready", zh: "准备就绪" },
  "framing.status.lensSwitching": {
    en: "Switching camera · set progress kept",
    zh: "镜头切换中 · 保留本组进度",
  },
  "framing.status.recordOnly": {
    en: "Local recording · this camera angle produces no form conclusions",
    zh: "本机录像 · 当前机位不输出动作结论",
  },

  // 组后报告 — 教练便签
  "setReport.note.nothingConfirmed": {
    en: "No complete reps could be confirmed for this set. Check your camera angle and framing, then try again.",
    zh: "本组没有可确认的完整动作。检查机位与入框状态后再试一次。",
  },
  "setReport.note.allConfirmed": {
    en: "All {confirmed} reps in this set were confirmed.",
    zh: "本组 {confirmed} 次全部确认。",
  },
  "setReport.note.mixed": {
    en: "{confirmed} reps confirmed in this set{review}{rejected}.",
    zh: "本组确认 {confirmed} 次{review}{rejected}。",
  },
  "setReport.note.reviewPart": { en: ", {count} to review", zh: "，{count} 次待复核" },
  "setReport.note.rejectedPart": { en: ", {count} discarded", zh: "，{count} 次被剔除" },
  "setReport.note.repOrdinal": { en: "rep {index}", zh: "第 {index} 次" },
  "setReport.note.lowAmplitude": {
    en: "{reps} came up slightly short of the set median — watch fatigue in the back half.",
    zh: "{reps}幅度略低于组内中位，后半程注意疲劳管理。",
  },
  "setReport.note.findingSentence": { en: "{title}.", zh: "{title}。" },
  "setReport.note.steady": {
    en: "Tempo and path were steady; no unusual evidence.",
    zh: "节奏与轨迹稳定，未见异常证据。",
  },

  // 组后报告 — 抽屉
  "setReport.title": { en: "Set report", zh: "本组报告" },
  "setReport.stat.confirmedReps": { en: "Confirmed reps", zh: "确认次数" },
  "setReport.stat.validFrames": { en: "Valid frames", zh: "有效帧率" },
  "setReport.stat.decisionFps": { en: "Decision FPS", zh: "判定帧率" },
  "setReport.recordedOnly.title": { en: "Saved as local footage", zh: "本组已作为本机素材保存" },
  "setReport.recordedOnly.detail": {
    en: "You can replay it under Progress → Local video library. No rep count or form conclusions were produced.",
    zh: "可在「进展 → 本机视频库」中再次播放；当前未生成次数或动作质量结论。",
  },
  "setReport.coachNote.title": { en: "Coach note", zh: "教练便签" },
  "setReport.coachNote.local": { en: "On-device engine · zero upload", zh: "本地引擎 · 零上传" },
  "setReport.coachNote.noProfile": {
    en: "There is no runnable recognition profile for this exercise and camera angle; the footage was still saved.",
    zh: "当前动作与机位没有可执行识别 profile；本组素材仍已保存。",
  },
  "setReport.reps.normalized": { en: "REP 1–{count} · normalized range", zh: "REP 1–{count} · 幅度归一" },
  "setReport.reps.orangeLegend": { en: "Orange = relatively short", zh: "橙 = 相对不足" },
  "setReport.video.saved": { en: "Training video saved on this device · {duration}", zh: "训练视频已存到本机 · {duration}" },
  "setReport.video.failed": {
    en: "The training video could not be saved; you can still log this set by hand",
    zh: "训练视频未能保存；本组手工记录仍可继续",
  },
  "setReport.video.saving": { en: "Saving the training video to this device…", zh: "正在将训练视频保存到本机…" },
  "setReport.video.savedDetail": {
    en: "Stored on this device only — never auto-uploaded or synced",
    zh: "仅保存在这台设备，不会自动上传或同步",
  },
  "setReport.video.skeletonStored": {
    en: "Skeleton recording stored — available for local review",
    zh: "骨架记录已存储，可用于本地复盘",
  },
  "setReport.video.skeletonSealing": { en: "Sealing the skeleton recording…", zh: "正在封存骨架记录…" },
  "setReport.video.reusable": { en: "Reusable in your training videos", zh: "可在训练视频中复用" },
  "setReport.video.reusableWithDuration": {
    en: "{seconds}s · reusable in your training videos",
    zh: "{seconds} 秒 · 可在训练视频中复用",
  },
  "setReport.action.sealing": { en: "Sealing…", zh: "正在封存…" },
  "setReport.action.again": { en: "Another set", zh: "再来一组" },
  "setReport.action.replay": { en: "Watch replay", zh: "查看回放" },
  "setReport.action.saving": { en: "Saving", zh: "保存中" },
  "setReport.action.done": { en: "Done", zh: "完成" },

  // 相机页
  "capture.permission.required": {
    en: "Camera access is required for on-device pose tracking",
    zh: "需要相机权限进行离线姿态识别",
  },
  "capture.permission.grant": { en: "Allow camera", zh: "授权相机" },
  "capture.permission.denied": {
    en: "Enable camera access in system settings",
    zh: "请在系统设置中开启相机权限",
  },
  "capture.lens.front": { en: "Front", zh: "前置" },
  "capture.lens.back": { en: "Back", zh: "后置" },
  "capture.lens.switchToFront": { en: "Switch to the front camera", zh: "切换为前置摄像头" },
  "capture.lens.switchToBack": { en: "Switch to the back camera", zh: "切换为后置摄像头" },
  "capture.lens.switchingToFront": {
    en: "Switching to the front camera; tracking resumes once you are back in frame",
    zh: "正在切换到前置镜头，识别会在重新入框后继续",
  },
  "capture.lens.switchingToBack": {
    en: "Switching to the back camera; tracking resumes once you are back in frame",
    zh: "正在切换到后置镜头，识别会在重新入框后继续",
  },
  "capture.set.start": { en: "Start set", zh: "开始本组" },
  "capture.set.finish": { en: "Finish set", zh: "结束本组" },
  "capture.exit": { en: "Exit the camera", zh: "退出相机" },
  "capture.exitWhileActive": { en: "Stop and exit the camera", zh: "停止并退出相机" },
  "capture.error.skeletonNotSaved": { en: "Could not save the skeleton recording", zh: "骨架记录未能保存" },
  "capture.error.videoNotSaved": { en: "Could not save the training video", zh: "训练视频未能保存" },
  "capture.error.videoNotOpened": {
    en: "Could not open the saved training video",
    zh: "无法打开已保存的训练视频",
  },

  // 相机页 — Coach 交互
  "capture.coach.emptyStream": { en: "You can ask Coach anything mid-workout", zh: "训练中可以随时问 Coach" },
  "capture.coach.notConnected": {
    en: "This workout entry point is not connected to Coach yet — go back to the home screen to keep talking",
    zh: "当前训练入口尚未连接 Coach，请返回产品主页继续对话",
  },
  "capture.coach.readingContext": { en: "Coach is reading your current workout context", zh: "Coach 正在读取当前训练上下文" },
  "capture.coach.didNotFinish": {
    en: "Coach did not finish this time; the camera and rep count are unaffected",
    zh: "Coach 暂时没有完成，相机与计数不受影响",
  },
  "capture.coach.submitting": {
    en: "Submitting your confirmation; you will see a receipt once it is written",
    zh: "正在提交确认，写入完成后会显示回执",
  },
  "capture.coach.submitted": {
    en: "Submitted — waiting for Coach to return an undoable receipt",
    zh: "已提交，等待 Coach 返回可撤销回执",
  },
  "capture.coach.submitFailed": { en: "The confirmation could not be submitted", zh: "确认暂时未能提交" },
  "capture.coach.receiptHint": { en: "{title} · review it in Coach", zh: "{title} · 可在 Coach 中复核" },
  "capture.coach.voiceUnavailable": { en: "Voice input is not wired up yet", zh: "语音输入尚未接入" },
  "capture.coach.voiceReserved": {
    en: "The STT/TTS hooks are reserved; this build uses text input with streaming captions",
    zh: "STT / TTS 接口已预留，本版先使用文字输入与流式字幕",
  },
  "capture.coach.micButton": { en: "Voice", zh: "麦" },
  "capture.coach.composerLabel": { en: "Message Coach during your workout", zh: "训练中发送给 Coach 的消息" },
  "capture.coach.composerPlaceholder": {
    en: "Tell Coach how it feels, or ask a question…",
    zh: "告诉 Coach 你的体感或问题…",
  },
  "capture.coach.send": { en: "Send to Coach", zh: "发送给 Coach" },
  "capture.coach.openComposer": { en: "Open the Coach composer", zh: "打开 Coach 输入" },
  "capture.coach.composerOpenGlyph": { en: "Keys", zh: "键" },
  "capture.coach.composerClosedGlyph": { en: "Chat", zh: "问" },

  // 相机监控不可用（平台兜底）
  "capture.unsupported.title": { en: "Camera monitoring is not available on this device", zh: "此设备暂不支持相机监控" },
  "capture.unsupported.body": {
    en: "Nothing is lost from your log. Back in logging mode you can still confirm what you actually did for this set.",
    zh: "训练记录不会丢失。回到记录模式后，可以继续确认这一组的实际完成内容。",
  },
  "capture.unsupported.action": { en: "Keep logging", zh: "继续记录" },

  // 回放页
  "replay.noProfileForAngle": { en: "No recognition profile for this angle", zh: "当前机位暂无识别 profile" },
  "replay.localPlayback": { en: "Local playback", zh: "本机回放" },
  "replay.chip.analyzing": { en: "Replay analysis", zh: "回放识别" },
  "replay.chip.localOnly": { en: "Local video", zh: "本机视频" },
  "replay.playbackOnly": { en: "Playback only · no conclusions", zh: "仅播放 · 无识别结论" },
  "replay.resume": { en: "Resume", zh: "继续" },
  "replay.pause": { en: "Pause", zh: "暂停" },
} as const;

/**
 * 计划报告（planner 产出的 token / code → 用户可读文案）。
 *
 * planner 只给结构化 token（objective / progression / tradeoff / strategy id…），
 * 这里是客户端唯一的渲染处。
 */
export const PLAN_REPORT_COPY: TranslationTable = {
  // 目标与策略目标（objective token）
  "objective.leanMassSmallSurplus": {
    en: "Build muscle on a small, observable surplus — no single variable gets pushed too far at once",
    zh: "用小幅、可观察的热量盈余支持增肌，避免一次把变量拉得太大",
  },
  "objective.retainLeanMassInCut": {
    en: "Protect strength and lean mass through a bounded cut",
    zh: "在有限减脂周期中优先保留力量表现与瘦体重",
  },
  "objective.reduceFatKeepExposure": {
    en: "Lower body fat gradually while keeping the key training stimulus",
    zh: "在保留关键训练刺激的同时逐步降低体脂",
  },
  "objective.stableEnergyFloor": {
    en: "Stabilize energy and recovery first, then improve composition and performance slowly",
    zh: "先稳定能量与恢复，再缓慢改善体成分和训练表现",
  },
  "objective.restoreRecovery": {
    en: "Recovery comes first, while keeping the essential movements and stimulus",
    zh: "优先恢复，同时保留必要的动作与训练刺激",
  },
  "objective.progressWithRecoveryBudget": {
    en: "Progress against your recovery budget — never borrow from the next session",
    zh: "以恢复能力为预算推进训练，不透支下一次训练",
  },
  "objective.retainPrimaryStrength": {
    en: "Protect your key strength numbers and the effective training stimulus",
    zh: "优先保留关键力量表现与有效训练刺激",
  },
  "objective.supportSmallSurplusNoGuessing": {
    en: "Build a baseline from your food log, then support muscle gain with a small surplus — we never guess your maintenance calories",
    zh: "从饮食记录建立基线，再用小幅盈余支持增肌；不会猜测维持热量",
  },
  "objective.observeRealIntakeFirst": {
    en: "Observe what you actually eat first, then adjust on the trend — unlogged days are not treated as zero",
    zh: "先观察真实饮食，再根据趋势调整，不把未记录当作零摄入",
  },
  "objective.dailyVariationBoundary": {
    en: "Use sleep, fatigue and soreness checks to keep daily swings inside what your next session can absorb",
    zh: "用睡眠、疲劳和酸痛检查，把每日波动控制在下一次训练可承受的范围内",
  },

  // 进阶与恢复规则
  "progression.compareVariantHistory": {
    en: "Build up comparable history on the same movement before deciding to progress",
    zh: "积累同一动作的可比记录后，再判断是否进阶",
  },
  "progression.oneVariableAtATime": {
    en: "Change only one of load, reps or volume at a time",
    zh: "每次只调整重量、次数或训练量中的一类变量",
  },
  "recovery.cutOptionalVolumeFirst": {
    en: "When recovery declines, cut optional volume first and protect the main stimulus",
    zh: "恢复变差时先减少可选训练量，尽量保留主要刺激",
  },

  // 证据（explanation.userEvidence / missing facts）
  "evidence.goalConfirmed": { en: "Goal direction confirmed", zh: "目标方向已确认" },
  "evidence.scheduleAndSafetyConfirmed": {
    en: "Training times and safety limits confirmed",
    zh: "训练时间与安全边界已确认",
  },
  "evidence.weeklyReviewWindow": {
    en: "Complete one comparable weekly review window",
    zh: "完成一个可比较的周复核窗口",
  },
  "evidence.outcomeAndRecoveryReviewed": {
    en: "Both training outcomes and recovery have been reviewed",
    zh: "训练结果与恢复状态均已复核",
  },
  "evidence.timelineHistory": {
    en: "Recent training records, used to calibrate your real starting point",
    zh: "近期训练记录，用于校准真实起点",
  },
  "evidence.variantLoadHistory": {
    en: "Load, reps and reps-in-reserve for the same movement",
    zh: "同一动作的重量、次数与余力记录",
  },
  "evidence.recentRecoveryTrend": {
    en: "Recent sleep, fatigue and soreness trends",
    zh: "近期睡眠、疲劳与酸痛趋势",
  },
  "evidence.nutritionBaseline": {
    en: "A real food baseline and a nutrition strategy you can actually run",
    zh: "真实饮食基线与可执行的营养策略",
  },
  "evidence.maintenanceEnergy": { en: "Your personal maintenance calories", zh: "个人维持热量" },
  "missing.strengthBaselineRepsRir": {
    en: "Strength reference read; still need reps and reps-in-reserve from a recent working set before prescribing exact loads",
    zh: "已读取力量参考；还需要最近工作组的次数与余力，才能安排具体重量",
  },

  // 边界与守卫
  "guard.unloggedIntakeNotZero": {
    en: "An unlogged meal is not the same as zero intake",
    zh: "未记录饮食不等于零摄入",
  },
  "guard.singleDayCannotSwitchCycle": {
    en: "A single day's swing never flips the whole cycle",
    zh: "单日波动不会触发整周期换向",
  },
  "guard.painPausesPlanning": {
    en: "Pain or a red flag pauses progression until it is confirmed again",
    zh: "出现疼痛或危险信号时暂停推进并重新确认",
  },
  "guard.professionalClearance": {
    en: "Where there is a clear restriction, the boundary is confirmed with a professional first",
    zh: "存在明确限制时，需先按专业建议确认边界",
  },
  "guard.phaseSwitchNeedsEvidence": {
    en: "The training phase only switches after a review window closes with comparable data",
    zh: "只有完成复核窗口并获得可比数据，才会切换训练阶段",
  },

  // 不确定性
  "uncertainty.loadRirMaintenanceUnknown": {
    en: "Real working loads, reps-in-reserve and maintenance calories are still missing; week one calibrates conservatively",
    zh: "当前缺少真实动作负荷、余力与维持热量；首周会保守校准",
  },
  "uncertainty.missingStaysUnknown": {
    en: "Missing measurements stay unknown — no averages are filled in",
    zh: "缺失数据保持未知，不用平均值代填",
  },
  "uncertainty.noProfessionalHistory": {
    en: "No strength baseline or long-term training history added yet",
    zh: "尚未补充力量基线或长期训练历史",
  },

  // 执行要求
  "requirement.highAdherence": {
    en: "Fairly high training and logging completion",
    zh: "较高的训练与记录完成度",
  },
  "requirement.weeklyRecoveryReview": { en: "A recovery review completed every week", zh: "每周完成恢复复核" },
  "requirement.noNewSafetySignal": { en: "No new safety signals", zh: "没有新的安全信号" },
  "requirement.recordComparableTrends": {
    en: "Keep recording comparable training and body trends",
    zh: "持续记录可比较的训练与身体趋势",
  },
  "requirement.completeWeeklyReview": { en: "Finish a short weekly review", zh: "完成每周简短复盘" },

  // 取舍
  "tradeoff.lessMarginForMissedSessions": {
    en: "Less room to absorb missed sessions",
    zh: "漏练后的调整空间更小",
  },
  "tradeoff.higherRecoveryDemand": { en: "Higher demand on sleep and recovery", zh: "对睡眠与恢复要求更高" },
  "tradeoff.moderatePace": { en: "Pace and recovery margin stay fairly balanced", zh: "进度与恢复余量较均衡" },
  "tradeoff.requiresConsistentLogging": { en: "Needs reasonably consistent short logs", zh: "需要较稳定的简短记录" },
  "tradeoff.slowerProgress": { en: "Slower progress toward the goal", zh: "目标推进更慢" },
  "tradeoff.moreScheduleFlexibility": { en: "More flexibility in your schedule", zh: "日程弹性更高" },

  // 能量方向与恢复信号
  "energy.smallSurplus": { en: "Small surplus", zh: "小幅盈余" },
  "energy.smallDeficit": { en: "Small deficit", zh: "小幅缺口" },
  "energy.maintenance": { en: "Maintenance range", zh: "维持区间" },
  "energy.observeThenAdjust": { en: "Observe first, then adjust", zh: "先观察，再调整" },
  "signal.sleep": { en: "Sleep", zh: "睡眠" },
  "signal.fatigue": { en: "Fatigue", zh: "疲劳" },
  "signal.soreness": { en: "Soreness", zh: "酸痛" },
  "signal.perceivedRecovery": { en: "Perceived recovery", zh: "主观恢复" },
  "signal.availableTime": { en: "Available training time", zh: "可用训练时间" },
  "population.generalFitness": { en: "General fitness population", zh: "一般健身训练人群" },

  // 带前缀的 token
  "phrase.goalIs": { en: "Your goal is {goal}", zh: "你的目标是{goal}" },
  "phrase.strategyMatched": {
    en: "The rule library matched the “{strategy}” strategy",
    zh: "规则库匹配到「{strategy}」策略",
  },
  "phrase.triggerInitialPlan": {
    en: "This is the starting plan generated from your first intake",
    zh: "这是根据首次建档生成的起始计划",
  },
  "phrase.triggerFactChange": { en: "A change in the facts triggered a plan review", zh: "事实变化触发了计划复核" },
  "phrase.constraintPriority": {
    en: "Safety, recovery and time constraints are satisfied first, then volume is allocated",
    zh: "先满足安全、恢复与时间约束，再分配训练量",
  },
  "phrase.nearTermMaterialization": {
    en: "Only this week and next are locked in; anything further out stays adjustable",
    zh: "只锁定当前周与下一周，远期安排保留调整空间",
  },
  "phrase.fallback": { en: "Versioned training rules applied", zh: "已应用版本化训练规则" },

  // 策略名
  "strategy.fatLossRecomposition": { en: "Fat-loss recomposition", zh: "减脂重组" },
  "strategy.preserveLeanMassCut": { en: "Muscle-sparing cut", zh: "保肌减脂" },
  "strategy.finalCut": { en: "Final cut", zh: "收尾减脂" },
  "strategy.maintenanceRecomposition": { en: "Maintenance recomposition", zh: "维持重组" },
  "strategy.recoveryMaintenance": { en: "Recovery maintenance", zh: "恢复维持" },
  "strategy.conservativeGain": { en: "Conservative gain", zh: "保守增肌" },
  "strategy.stableStrengthGain": { en: "Steady strength gain", zh: "稳定增力" },
  "strategy.returnToTraining": { en: "Return to training", zh: "停训回归" },
  "strategy.advancedSpecializationMaintenance": { en: "Specialization maintenance", zh: "专项维持" },
  "strategy.postLossConsolidationGain": { en: "Post-cut consolidation", zh: "减重后巩固" },
  "strategy.dietBreak": { en: "Diet break", zh: "饮食休整" },
  "strategy.deloadOverlay": { en: "Deload overlay", zh: "减量恢复" },
  "strategy.personalized": { en: "Personalized training", zh: "个性化训练" },

  // 目标类型（用在「你的目标是…」句子里）
  "goalType.hypertrophy": { en: "muscle gain", zh: "增肌" },
  "goalType.fatLoss": { en: "fat loss while keeping muscle", zh: "减脂保肌" },
  "goalType.strength": { en: "getting stronger", zh: "提升力量" },
  "goalType.maintain": { en: "maintenance and recomposition", zh: "维持与重组" },
  "goalType.returnToTraining": { en: "returning to training safely", zh: "安全恢复训练" },
  "goalType.improvePerformance": { en: "improving performance", zh: "改善训练表现" },

  // 推进路径
  "forecast.name.faster": { en: "Faster progress", zh: "更快推进" },
  "forecast.name.balanced": { en: "Balanced progress", zh: "平衡推进" },
  "forecast.name.flexible": { en: "Flexible progress", zh: "灵活推进" },
  "forecast.eligibility.available": { en: "Available now", zh: "当前可选" },
  "forecast.eligibility.degraded": { en: "Conditions not met — proceed with care", zh: "条件不足，建议谨慎" },
  "forecast.eligibility.notRecommended": { en: "Not recommended right now", zh: "当前不建议" },

  // 报告摘要
  "summary.phaseDuration.weeks": { en: "{min}–{max} weeks", zh: "{min}–{max} 周" },
  "summary.phaseDuration.weekly": { en: "Reviewed weekly", zh: "按周复核" },
  "session.detail.training": {
    en: "{exercises} exercises · {sets} sets{duration}",
    zh: "{exercises} 个动作 · {sets} 个训练组{duration}",
  },
  "session.detail.estimatedMinutes": { en: " · about {minutes} min", zh: " · 预计 {minutes} 分钟" },
  "session.detail.maxMinutes": { en: " · up to {minutes} min", zh: " · 最多 {minutes} 分钟" },
  "session.detail.rest": {
    en: "Recovery, a walk, or catch up on how today felt",
    zh: "恢复、散步或补记当天状态",
  },
  "sessionTitle.hypertrophy": { en: "hypertrophy", zh: "增肌" },
  "sessionTitle.strength": { en: "strength", zh: "力量" },
  "sessionTitle.fatLossPreserveLeanMass": { en: "fat loss, keep lean mass", zh: "减脂保肌" },

  // 日期
  "weekday.0": { en: "Sunday", zh: "周日" },
  "weekday.1": { en: "Monday", zh: "周一" },
  "weekday.2": { en: "Tuesday", zh: "周二" },
  "weekday.3": { en: "Wednesday", zh: "周三" },
  "weekday.4": { en: "Thursday", zh: "周四" },
  "weekday.5": { en: "Friday", zh: "周五" },
  "weekday.6": { en: "Saturday", zh: "周六" },
  "weekday.fallback": { en: "That day", zh: "当天" },
  /** 月/日 紧凑格式（报告里的周区间 chip）。 */
  "date.short": { en: "{month}/{day}", zh: "{month}月{day}日" },

  // 计划周期区间（日历页顶部）
  "cycleRange.none": { en: "No long-term cycle yet", zh: "尚未建立长期计划周期" },
  "cycleRange.beforeStart": {
    en: "{untilStart} days to start · {untilEnd} days to finish",
    zh: "距计划开始 {untilStart} 天 · 距结束 {untilEnd} 天",
  },
  "cycleRange.finished": { en: "Cycle finished {daysAgo} days ago", zh: "计划已结束 {daysAgo} 天" },
  "cycleRange.inProgress": {
    en: "Day {dayNumber} · {untilEnd} days to finish",
    zh: "已开始 {dayNumber} 天 · 距结束 {untilEnd} 天",
  },
} as const;

/** Coach 流式字幕与状态（相机页 overlay / Coach 抽屉共用）。 */
export const COACH_STREAM_COPY: TranslationTable = {
  "caption.label.user": { en: "USER", zh: "你" },
  "caption.label.userListening": { en: "USER · LISTENING", zh: "你 · 正在听" },
  "caption.label.streamError": { en: "COACH · CONNECTION ERROR", zh: "COACH · 连接异常" },
  "action.confirmPrompt": { en: "Coach continues once you confirm", zh: "确认后 Coach 才会继续" },
  "status.toolIncomplete": { en: "Coach did not finish", zh: "Coach 暂时未完成" },
  "status.toolRunning": { en: "Coach is reading and organizing", zh: "Coach 正在读取与整理" },
  "status.replying": { en: "Coach is replying", zh: "Coach 正在回复" },
  "status.connectionError": {
    en: "Coach connection error — the camera and rep count are unaffected",
    zh: "Coach 连接异常，相机与计数不受影响",
  },
} as const;

/** 饮食记录（餐食估算草稿披露 + 确认表单）。 */
export const NUTRITION_COPY: TranslationTable = {
  // 草稿披露（隐私边界）
  "draft.mediaPolicy.localPhotos": {
    en: "Photos stay on this device and are never uploaded; add a description or switch to manual logging before confirming.",
    zh: "照片仅留在本机，不会上传；补充文字或改用手动记录后再确认。",
  },
  "draft.mediaPolicy.localOnly": {
    en: "This entry is organized on this device only and is never sent to an outside service.",
    zh: "这条记录只在本机整理，不会发送给外部服务。",
  },
  "draft.sentInput.mealText": { en: "meal description", zh: "餐食文字" },
  "draft.sentInput.photos": { en: "{count} food photos", zh: "{count} 张食物照片" },
  "draft.mediaPolicy.remotePhotos": {
    en: "Your originals are untouched; the uploaded copy has safely removable metadata stripped first, and originals stay out of cloud sync by default.",
    zh: "本机原图保持不变；上传副本会先移除可安全删除的元数据，原图默认不会进入云端同步。",
  },
  "draft.mediaPolicy.remoteTextOnly": {
    en: "Only the text you provided this time is processed; your photo library and past meals are never read.",
    zh: "只处理本次提供的文字；不会读取你的相册或历史餐食。",
  },
  "draft.privacyNotice.photos": {
    en: "Images can contain faces, addresses or order details — only pick the photos needed for this estimate.",
    zh: "图片可能包含人脸、地址或订单信息；请只选择需要用于本次估算的图片。",
  },

  // 确认表单
  "sheet.eyebrow": { en: "Food log", zh: "饮食记录" },
  "sheet.title": { en: "Confirm this estimate", zh: "确认这份估算" },
  "sheet.close": { en: "Close", zh: "关闭" },
  "sheet.closeA11y": { en: "Close the meal estimate", zh: "关闭餐食估算" },
  "sheet.notice.generatedBy": { en: "Generated by {provider}", zh: "已由 {provider} 生成" },
  "sheet.notice.localOnly": { en: "Kept on this device only", zh: "只在本机保留" },
  "sheet.notice.processed": { en: "Processed this time: {inputs}", zh: "本次处理：{inputs}" },
  "sheet.boundary": {
    en: "This is an estimate you can log, not a measurement or a nutrition label. Confirming keeps the original ranges and your edit history.",
    zh: "这是可用于记录的估算，不是实测或营养标签数据。确认后仍会保留原始范围与修改痕迹。",
  },
  "sheet.field.description": { en: "Meal description", zh: "餐食描述" },
  "sheet.field.descriptionPlaceholder": { en: "e.g. chicken breast with rice and broccoli", zh: "例如：鸡胸肉饭和西兰花" },
  "sheet.section.foods": { en: "Foods and portions", zh: "食物与份量" },
  "sheet.section.foodsSub": {
    en: "Values stay as ranges; leave uncertain oils and sauces in the assumptions.",
    zh: "数值保持范围；不确定的油脂、酱汁请留在假设里。",
  },
  "sheet.action.add": { en: "Add food", zh: "添加" },
  "sheet.empty": { en: "Nothing to confirm yet. Add one food and describe the portion.", zh: "还没有可确认的食物。请添加一项并说明份量。" },
  "sheet.missing.title": { en: "Still worth noting", zh: "还需要注意" },
  "sheet.action.reject": { en: "Discard", zh: "不记录" },
  "sheet.action.saving": { en: "Saving", zh: "正在保存" },
  "sheet.action.confirm": { en: "Confirm entry", zh: "确认记录" },
  "sheet.food.ordinal": { en: "Food {index}", zh: "食物 {index}" },
  "sheet.food.remove": { en: "Remove", zh: "移除" },
  "sheet.field.foodName": { en: "Food", zh: "食物" },
  "sheet.field.foodNamePlaceholder": { en: "e.g. chicken breast with rice", zh: "例如：鸡胸肉饭" },
  "sheet.field.portion": { en: "Portion assumption", zh: "份量假设" },
  "sheet.field.portionPlaceholder": { en: "e.g. one serving of rice and 120 g chicken breast", zh: "例如：一份米饭和 120 g 鸡胸肉" },
  "sheet.field.energy": { en: "Energy (kcal)", zh: "能量（kcal）" },
  "sheet.field.protein": { en: "Protein (g)", zh: "蛋白质（g）" },
  "sheet.field.fat": { en: "Fats (g)", zh: "脂肪（g）" },
  "sheet.field.carbohydrate": { en: "Carbs (g)", zh: "碳水（g）" },
  "sheet.field.assumptions": { en: "Assumptions / unknowns", zh: "假设 / 不确定项" },
  "sheet.field.assumptionsPlaceholder": { en: "e.g. sauce and cooking oil unknown", zh: "例如：酱汁和用油未知" },
  "sheet.field.confidence": { en: "Confidence", zh: "可信度" },
  "sheet.confidence.low": { en: "Rough", zh: "低" },
  "sheet.confidence.medium": { en: "Fair", zh: "中" },
  "sheet.confidence.high": { en: "Solid", zh: "高" },
  "sheet.range.minA11y": { en: "{label} minimum", zh: "{label} 最低值" },
  "sheet.range.maxA11y": { en: "{label} maximum", zh: "{label} 最高值" },
  "sheet.range.min": { en: "Lower", zh: "最低" },
  "sheet.range.max": { en: "Upper", zh: "最高" },

  // 校验错误
  "sheet.error.needsEdit": { en: "Add or correct the meal contents before confirming.", zh: "请补充或修正餐食内容后再确认。" },
  "sheet.error.checkValues": { en: "Check the foods, portions and ranges.", zh: "请检查食物、份量与范围。" },
  "sheet.error.needDescriptionOrFood": {
    en: "Add at least a meal description or one food.",
    zh: "请至少补充餐食描述或一项食物。",
  },
  "sheet.error.incompleteFood": {
    en: "Complete the food, portion and unknowns.",
    zh: "请补全食物、份量和不确定项。",
  },
  "sheet.error.needOneRange": {
    en: "Keep at least one energy or macro range.",
    zh: "请至少保留一组能量或营养范围。",
  },
  "sheet.error.invalidRange": {
    en: "A range must be non-negative and go from low to high.",
    zh: "范围需要是非负且由小到大的数值。",
  },
} as const;

/** 汇总（新域注册到这里）。 */
export const TRANSLATIONS: Readonly<Record<string, TranslationTable>> = {
  planning: PLANNING_COPY,
  motion: MOTION_COPY,
  planReport: PLAN_REPORT_COPY,
  coachStream: COACH_STREAM_COPY,
  nutrition: NUTRITION_COPY,
} as const;
