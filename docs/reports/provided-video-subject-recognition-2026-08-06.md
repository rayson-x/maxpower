# Provided-video subject-recognition replay — 2026-08-06

## Result

The PC Web training page recognized a visible workout subject in all 30 videos currently exposed by the confirmed-capture library. Every video also selected its expected explicit action context.

| Action context | Videos checked | Subject lock | Action context |
| --- | ---: | ---: | ---: |
| `pull_up` | 2 | 2/2 | 2/2 |
| `barbell_row` | 7 | 7/7 | 7/7 |
| `lat_pulldown` | 3 | 3/3 | 3/3 |
| `seated_row` | 2 | 2/2 | 2/2 |
| `straight_arm_pulldown` | 3 | 3/3 | 3/3 |
| `seated_shoulder_press` | 6 | 6/6 | 6/6 |
| `lateral_raise` | 7 | 7/7 | 7/7 |
| **Total** | **30** | **30/30** | **30/30** |

## Method

- Exported the PC Web build and served the static output locally.
- Selected every entry in the training-page video library in three batches.
- Counted a subject pass only after the Rust target state reached `LOCKED` and the canonical packet contained non-zero renderable landmarks.
- Checked the action selector after each library selection. The automated contract test now freezes the expected action for each of the 30 video IDs instead of accepting any registered action ID.
- Replayed the historical failure `field-capture-2026-08-02T18-30-30-478Z` again after the final review fixes. It reached `TARGET LOCKED · 1`, `31/33` renderable landmarks, and action context `barbell_row`.

## Boundary

This verifies subject acquisition, canonical pose availability, and explicit action context for the supplied clips. It does not claim that every action/view combination has a calibrated formal repetition-counting or form-correction profile. Unsupported combinations remain explicitly unsupported rather than borrowing a different profile.
