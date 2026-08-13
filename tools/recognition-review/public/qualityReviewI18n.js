(function attachQualityReviewI18n(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.QualityReviewI18n = api;
})(typeof globalThis === "object" ? globalThis : this, function createQualityReviewI18n() {
  "use strict";

  const CONCLUSION_ZH = Object.freeze({
    "A complete start–turnaround–return cycle was confirmed.": "已确认完成一次“起始—主换向—返回”的完整动作周期。",
    "The visible excursion reached the recognizer's cycle gate.": "可见动作幅度已达到当前识别器的计次阈值。",
    "Cannot judge from the available visual evidence.": "现有视觉证据不足，无法判断。",
    "A continuous canonical pose trajectory produced the sealed cycle.": "连续的规范化骨架轨迹形成了这次已封存动作周期。",
    "The cycle satisfied the current evidence gate.": "该动作周期满足当前证据门槛。",
    "The visible excursion was below the active recognition profile expectation.": "可见动作幅度低于当前识别 Profile 的预期。",
    "The phase boundary and path came from the subject-associated equipment track.": "阶段边界与轨迹来自与前景主体关联的器械追踪。",
    "The candidate did not establish a reviewable completed task.": "该候选片段未形成可审核的完整动作任务。",
    "The observation was insufficient for a Rep claim.": "当前观测不足以确认一次 Rep。",
    "Pose and equipment disagreed on the observed turnaround.": "骨架与器械对主换向点的判断不一致。",
    "A complete cycle candidate was preserved for review.": "已保留一个完整周期候选，等待人工审核。",
    "The cycle is usable but requires human review.": "该动作周期可用于审核，但仍需人工确认。",
  });

  const REASON_ZH = Object.freeze({
    "The sealed Rep does not yet carry the required trunk/support trajectory features.": "已封存 Rep 尚未包含判断躯干或支撑稳定所需的轨迹特征。",
    "This view/Rep lacks validated side-specific persistent evidence; screen-space slope is not physical imbalance.": "当前机位或 Rep 缺少经过验证、按侧区分且持续存在的证据；画面中的斜率不等于真实身体左右不平衡。",
    "No exact reviewed standard-variant corridor is attached to this proposal.": "该提案尚未绑定经过人工审核的精确标准变式轨迹走廊。",
    "This is profile-relative visible motion, not a universal standard-ROM verdict.": "这只表示相对于当前识别 Profile 的可见运动幅度，不是通用的标准动作行程结论。",
    "The sealed candidate does not contain three strictly ordered start, turnaround and return timestamps.": "已封存候选未包含严格按起始、主换向和返回排序的三个时间点。",
    "The Rust rep disposition rejected this candidate, so no positive observation-confidence claim is available.": "Rust 已拒绝该候选，因此不能给出正向的观测可信度结论。",
    "The Rust rep disposition rejected this candidate.": "Rust 已拒绝该候选动作。",
    "This exact action/view/side context is observation-only; Rust will not claim Rep or phase semantics.": "当前动作、机位和侧别仅支持观测；Rust 不会声明 Rep 或阶段语义。",
    "Recognition evidence did not satisfy the confirmed-volume gate.": "识别证据未达到计入确认训练量的门槛。",
    "ShortContinuityRecovery": "短时连续性恢复。",
    "The complete cycle was faster than the active recognition profile expectation; this is not a force or effort claim.": "完整周期速度快于当前识别 Profile 的预期；这不表示力量或主观用力程度。",
  });

  const STATE_LABELS = Object.freeze({
    observed_acceptable: Object.freeze({ zh: "观测范围内可接受", en: "Observed acceptable" }),
    observed_deviation: Object.freeze({ zh: "观测到偏差", en: "Observed deviation" }),
    cannot_judge: Object.freeze({ zh: "无法判断", en: "Cannot judge" }),
    not_applicable: Object.freeze({ zh: "不适用", en: "Not applicable" }),
  });

  const PHASE_ZH = Object.freeze({
    concentric: "向心",
    eccentric: "离心",
  });

  function localized(zh, en, translated = true) {
    return Object.freeze({ zh, en, translated });
  }

  function localizeConclusionText(value) {
    const en = String(value ?? "").trim();
    const exact = CONCLUSION_ZH[en];
    if (exact) return localized(exact, en);
    const phase = /^Observed (concentric|eccentric) for (\d+)ms, then (concentric|eccentric) for (\d+)ms\.$/u.exec(en);
    if (phase) {
      return localized(
        `观察到${PHASE_ZH[phase[1]]}阶段持续 ${phase[2]} ms，随后${PHASE_ZH[phase[3]]}阶段持续 ${phase[4]} ms。`,
        en,
      );
    }
    return localized("中文翻译待补充", en, false);
  }

  function localizeConclusionReason(value) {
    const en = String(value ?? "").trim();
    if (!en) return localized("", "");
    const zh = REASON_ZH[en];
    return zh ? localized(zh, en) : localized("原因的中文翻译待补充", en, false);
  }

  function localizeConclusionState(value) {
    const state = String(value ?? "").trim();
    const label = STATE_LABELS[state];
    if (label) return localized(label.zh, label.en);
    return localized("状态的中文翻译待补充", state.replaceAll("_", " "), false);
  }

  return Object.freeze({
    localizeConclusionReason,
    localizeConclusionState,
    localizeConclusionText,
  });
});
