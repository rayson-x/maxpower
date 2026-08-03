use form_coach_motion_sdk::{InferenceRequest, InferenceScheduler, TargetState};

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
