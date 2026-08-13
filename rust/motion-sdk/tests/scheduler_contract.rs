use maxpower_motion_sdk::{
    InferenceRequest, InferenceScheduler, TargetState, safe_degradation_policy,
};

#[test]
fn scheduler_bounds_inflight_and_refreshes_candidates_by_real_time() {
    let mut scheduler = InferenceScheduler::new(500, 100);
    assert_eq!(
        scheduler.decide(0, None, false),
        InferenceRequest::AcquireMulti
    );
    assert_eq!(
        scheduler.decide(20, None, true),
        InferenceRequest::SkipFrame
    );
    assert_eq!(
        scheduler.decide(50, Some(TargetState::Acquiring), false),
        InferenceRequest::SkipFrame,
    );
    assert_eq!(
        scheduler.decide(100, Some(TargetState::Acquiring), false),
        InferenceRequest::AcquireMulti,
    );
    assert_eq!(
        scheduler.decide(200, Some(TargetState::Locked), false),
        InferenceRequest::TrackTarget,
    );
    assert_eq!(
        scheduler.decide(600, Some(TargetState::Locked), false),
        InferenceRequest::RefreshCandidates,
    );
}

#[test]
fn web_without_roi_capability_never_pretends_to_track_a_single_target() {
    let mut scheduler = InferenceScheduler::new(500, 100);
    assert_eq!(
        scheduler.decide_with_roi_capability(0, None, false, false),
        InferenceRequest::AcquireMulti,
    );
    assert_eq!(
        scheduler.decide_with_roi_capability(20, Some(TargetState::Locked), false, false),
        InferenceRequest::RefreshCandidates,
    );
    scheduler.apply_safe_degradation(2);
    assert_eq!(
        scheduler.decide_with_roi_capability(50, Some(TargetState::Locked), false, false),
        InferenceRequest::SkipFrame,
    );
}

#[test]
fn over_budget_degradation_only_reduces_candidate_refresh_work() {
    let mut scheduler = InferenceScheduler::new(500, 100);
    let policy = scheduler.apply_safe_degradation(2);
    assert_eq!(policy, safe_degradation_policy(2));
    assert_eq!(policy.candidate_refresh_interval_ms, 1_500);
    assert_eq!(policy.suggested_input_scale_percent, 100);
    assert_eq!(policy.suggested_model_tier_step, 0);

    assert_eq!(
        scheduler.decide(0, None, false),
        InferenceRequest::AcquireMulti
    );
    assert_eq!(
        scheduler.decide(1_000, Some(TargetState::Locked), false),
        InferenceRequest::TrackTarget
    );
    assert_eq!(
        scheduler.decide(1_500, Some(TargetState::Locked), false),
        InferenceRequest::RefreshCandidates
    );
    // Backpressure and uncertainty refusal are invariant under degradation.
    assert_eq!(
        scheduler.decide(1_600, Some(TargetState::Lost), true),
        InferenceRequest::SkipFrame
    );
}
