# Web Pose Landmarker: field-capture failure diagnosis and repair plan

**Scope.** This note investigates recurring pose and repetition-recognition failures in
normal gym recordings. It is based on the current Web implementation and primary
MediaPipe documentation/source code; it does **not** claim a root cause for a
particular set until that set's canonical-keypoint JSON is available.

## What the current implementation actually does

- It uses MediaPipe Pose Landmarker in `VIDEO` mode, one pose maximum, Heavy
  model by default, and all three confidence thresholds at `0.5`.
- It calls `detectForVideo()` from every `requestAnimationFrame`, then forces the
  timestamp to increase by at least 1 ms. This means the same decoded video frame
  can be inferred more than once while being presented to the tracker as later
  time.
- It applies a downstream fusion/prediction pass, but it intentionally stops
  predicting after 150 ms. That is good safety behaviour: a missing arm after a
  longer occlusion remains unknown rather than being fabricated.
- A training-window filter currently removes only extreme lateral travel and
  scale changes before rep segmentation. It cannot undo upstream no-pose frames,
  and it is not an action-start detector.

The first two points are the highest-value suspects because MediaPipe's Web
example deliberately runs a video inference only when `video.currentTime`
changes. The app currently does not make that check.

## Source-backed facts

1. `VIDEO` mode is the correct mode for decoded frames from either a video or
   camera feed. `detectForVideo()` accepts a frame timestamp in milliseconds.
   The official Web example guards the call with
   `video.currentTime !== lastVideoTime` before scheduling the next animation
   frame. [Web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)

2. In `VIDEO` mode, MediaPipe enables stream mode. The actual pose graph carries
   pose rectangles from the prior frame and skips the person detector while it
   believes it can track the prior pose; loss of tracking causes detection again.
   `minTrackingConfidence` is used as the rectangle-association similarity
   threshold. A bad or discontinuous frame sequence can therefore produce a
   gap even if the person is still physically visible.
   [VisionTaskRunner source](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/core/vision_task_runner.ts),
   [PoseLandmarker graph source](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/cc/vision/pose_landmarker/pose_landmarker_graph.cc)

3. MediaPipe has three separate acceptance thresholds: person detection,
   pose-landmark presence, and tracking. They are not an image-quality score and
   should not be reduced blindly: a lower threshold may turn a clean no-result
   into an incorrect skeleton. The Web defaults are `0.5`; the app presently
   uses those defaults. [Pose Landmarker Web configuration](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)

4. The result contains 33 image landmarks and 33 world landmarks. Per-landmark
   `visibility` is only the likelihood that the landmark is visible in the
   image—not a guarantee that a low-visibility joint can be repaired from
   surrounding joints. The world coordinate origin is the midpoint of the hips.
   [Output contract](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)

5. The bundled system is a body detector followed by a 33-landmark model. It is
   a single-person task at the configured `numPoses: 1`; a passer-by, reflection,
   or partial foreground body can cause target ambiguity. The current JS task
   explicitly disallows an ROI input, so a simple `detectForVideo(..., ROI)`
   change is not available. [Task overview](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/index),
   [JS task source](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/pose_landmarker/pose_landmarker.ts),
   [Vision task ROI check](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/core/vision_task_runner.ts)

6. The Web APIs are synchronous and block the UI thread for each inference. If
   an inference loop competes with rendering/recording, frames can be delayed or
   dropped; the official guidance is to move detection into a Web Worker when
   this harms responsiveness. [Web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)

## Prioritized remediation

### P0 — consume each decoded frame once

Replace the rAF-driven unconditional inference with frame-driven processing:

- Prefer `HTMLVideoElement.requestVideoFrameCallback()` where available and use
  `metadata.mediaTime * 1000` as the recording timestamp.
- Fallback to rAF only when `video.currentTime` has changed. Use that media time
  as the timestamp and do not manufacture time advancement for duplicate pixels.
- Keep a separate monotonically increasing MediaPipe feed timestamp only if a
  browser requires it; never let it replace the stored source/media timestamp.
  Store both values in diagnostics.

**Why first:** it fixes a deterministic mismatch between the app and the
official playback loop and makes velocity, the 150 ms continuity limit, and rep
segmentation refer to actual video time.

**Acceptance signal:** replay a saved set twice and obtain the same number of
input frames, detection gaps, extrema, and rep count. The frame count must be
near the decoded-frame count, not the display refresh rate.

### P0 — make data quality observable, not inferred from the final count

For every saved recording, persist a compact per-frame diagnostic stream:

- `mediaTimeMs`, MediaPipe feed timestamp, decoded-frame index (if available),
  inference duration, `hasPose`, and 33 landmark visibility values;
- required-joint usable mask for the selected exercise;
- continuity source (`measured`, `fused`, `predicted`, `unknown`), largest
  no-pose gap, largest required-arm gap, and target-anchor displacement;
- a record of every training-window exclusion and every rejected rep cycle.

Classify a set as **unjudgeable** when its required-joint coverage or longest
gap fails a declared rule; do not quietly report zero repetitions. This respects
the current deliberate 150 ms prediction limit and separates model absence from
rep-counter error.

### P1 — separate recording context from exercise context

Keep the camera on continuously if desired, but reset the canonical session,
tracker state, pose buffer, and rep state exactly when the user presses “start
set.” The walk from the camera to the bar must remain preview-only. For imported
legacy video, offer an explicit start/end trim marker or a detected stable-set
candidate that the user can confirm.

The existing lateral/scale filter is a useful fallback, but it is not sufficient
as the primary boundary: walking can be smooth and some valid pull-up motion can
change apparent torso scale. Do not tune it based on a single recording.

### P1 — distinguish detector gaps, weak joints, and wrong-person tracking

Apply different handling after instrumentation:

| Observation | Likely layer | Correct response |
| --- | --- | --- |
| `hasPose=false` for a contiguous interval | detector/tracker lost target | mark a detection gap; reacquire target; do not smooth it into a rep |
| pose exists but elbow/wrist visibility fails | landmark/occlusion | use short, bounded continuity repair; score the rep only if required-joint coverage recovers |
| abrupt torso-anchor/scale jump or another body appears | single-person target switch | reject the affected run; require a stable target before re-entry |
| good usable-joint coverage but incorrect count | segmentation / exercise signal | debug extrema thresholds and phase rules independently of pose repair |

### P1 — tune thresholds by replay, not by instinct

Run the *same recorded sets* offline using a small preset matrix, for example
current `0.5/0.5/0.5`, a stricter detection/presence configuration, and a
slightly more permissive tracking configuration. Measure:

- pose-frame coverage and longest gap;
- required-arm coverage during labelled reps;
- target switches / topology rejections;
- absolute rep-count error versus the athlete's declared count;
- false positive reps during the approach/exit period.

Choose the preset only if it improves rep error without worsening target-switch
or false-positive metrics. This is necessary because the three MediaPipe
thresholds govern different graph stages.

### P2 — isolate inference from UI work

If per-frame diagnostics show inference times competing with render/recording,
move Pose Landmarker to a Web Worker as the official guide recommends. Send
frames with transferable primitives where supported, return only landmark data,
and keep canonicalization/rendering on one clearly defined timestamp contract.

## Minimum replay investigation for each failed set

1. Confirm the visible action and its expected count, then select only the
   user-marked set range.
2. Plot `hasPose`, required-arm visibility, canonical source, and the actual
   rep signal on one shared media-time axis.
3. Compare the 7 intended repetition intervals against that plot. Each missed
   rep can then be labelled as: absent pose, insufficient required-joint
   evidence, selected-window omission, or phase/threshold error.
4. Keep this labelled recording as a regression fixture before changing a
   filter or threshold.

## Current conclusion

The overall architecture—continuous preview, explicit set start, canonical
data shared by rendering and analysis, conservative short-gap repair, and local
replay—is viable. The current failure rate cannot be solved safely by adding
more smoothing alone. First fix duplicated-frame timing and preserve diagnostic
evidence; then use the saved field sets to locate the failing layer. Long arm
occlusions should remain a visible data-quality failure, not be visually
invented as valid motion.
