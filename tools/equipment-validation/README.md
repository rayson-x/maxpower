# Bar-axis equipment validation prototype

This is throwaway validation code for one question: **is the moving bar axis in
the six labelled bench-press videos observable enough to support independent
rep counting before a learned mobile equipment detector is trained?**

It requires `ffmpeg`, Python 3, and NumPy. It does not modify captures or labels.

```bash
python3 tools/equipment-validation/validate_bar_axis.py \
  --output data/workflows/equipment-validation/bar-axis-v1/legacy-evaluation.json
```

The method estimates the fixed-camera background and selects the strongest
moving horizontal paired edge. It is intentionally not production recognition
code. The generated report separates:

- phase-checkpoint observability, which uses labels only for evaluation;
- independent hysteresis counting, which never reads rep boundaries while
  producing cycles;
- false cycles and per-video exact-set results.

To materialize a local, reviewable pseudo-label pack after validation:

```bash
python3 tools/equipment-validation/prepare_bar_axis_dataset.py \
  --validation data/workflows/equipment-validation/bar-axis-v1/legacy-evaluation.json \
  --output data/equipment-validation/bar-axis-v1
```

The dataset is deliberately written under ignored `data/`. Every overlay is
marked `unreviewed`, and the manifest sets `promotionAllowed: false`; these
pseudo labels cannot become product training truth without review.

To compare this prototype with the source-isolated RTMPose Halpe-26 timeline:

```bash
npm run report:bench-pose-equipment-diagnostic
npm run test:bench-pose-equipment-diagnostic
```

The comparison keeps observability, accuracy, and generalization separate. In
particular, RTMPose scores are not human keypoint truth, and the static-edge bar
prototype is not a trained detector. Its purpose is to test whether a second
motion source can recover pose misses and to expose how much timeline error
still remains before a YOLO/RTMDet equipment model is worth promoting.

## Human equipment truth workflow

Freeze a capture-disjoint review queue from the pseudo-label pack:

```bash
npm run build:equipment-review-queue
```

The current queue contains 554 frames from six bench captures: 155 train, 69
validation, and 330 frozen test frames. Splits are assigned at source-capture
level; frames from one video never cross splits. Geometry proposals remain
`humanTruth: false`.

Open the review surface and choose **进入器械轨迹标定台**:

```bash
npm run review:recognition
```

The page supports a draggable shaft axis and explicit labels for a visible
barbell, no target equipment, reflection-only equipment, static rack-only
equipment, and ambiguous evidence. Reviews are append-only and retain queue,
manifest, video, image, capture, split, frame, and timestamp lineage.

Build the research dataset and run its safety gate:

```bash
npm run build:equipment-training-dataset
npm run gate:equipment-training-dataset
```

The gate intentionally exits 2 while human labels or source diversity are
insufficient. A successful dataset build never implies production promotion;
detector/track/path and fused motion acceptance remain separate gates.

## YOLOX detector corpus and frozen evaluation

Once submitted human reviews exist, build the deterministic detector corpus:

```bash
npm run build:equipment-detector-corpus
npm run gate:equipment-detector-corpus
```

`EquipmentDetectorCorpus` is the Module seam. It validates every image hash,
rejects source or image leakage across splits, converts the reviewed shaft axis
  to a COCO bbox plus two endpoint truth points, and retains image-level no-target,
reflection-only and static-rack-only hard negatives. Ambiguous frames are
excluded rather than guessed.

The output lives under
`data/equipment-validation/bar-axis-v1/detector-corpus-v1/`:

- `annotations/train.coco.json` and `annotations/validation.coco.json` are the
  only trainer-readable label files;
- `evaluation/test-input.coco.json` contains no labels;
- `evaluation/test-truth.coco.json` is explicitly forbidden to the trainer and
  is read only after frozen predictions exist;
- `training-plan.json` pins YOLOX-Nano, 416×416 input, seed, class list and ONNX
  output contract. Standard YOLOX produces class + bbox + score only; endpoint
  truth calibrates/evaluates line fitting inside the detected box. A fallback
  long-side centerline is marked `derived_geometry`, never detector-measured;
- `manifest.json` hashes every document and keeps `productionPromotion: false`.

Evaluate a frozen prediction document only after inference on test input:

```bash
npm run evaluate:equipment-detector -- \
  --predictions /absolute/path/to/frozen-predictions.json \
  --require-passing
```

The detector gate reports class F1, positive-frame track coverage, shaft
endpoint PCK, hard-negative frame false-positive rate and identity switches.
Passing this detector gate still does not authorize promotion: Rust fusion,
full rep/timeline acceptance and Web/Android/iOS runtime parity remain required.

## MM-Fit train-only dumbbell review queue

MM-Fit contains 147 dumbbell-action clips across the ten downloaded official
train subjects. Build a deterministic annotation plan without extracting
images:

```bash
npm run build:mmfit-dumbbell-review-queue
npm run test:mmfit-dumbbell-review-queue
```

Materialize the 640-pixel review JPEGs only after the plan is accepted:

```bash
npm run materialize:mmfit-dumbbell-review-queue
```

The internal equipment split is whole-subject isolated: w01/w02/w03/w04/w06/
w07 train, w08/w16 validation, and w17/w18 frozen test. All ten sessions remain
MM-Fit's official **train** split; official validation/test/unseen data is not
read or downloaded. OpenPose wrist ROIs are only annotation suggestions with
`humanTruth: false`. MM-Fit's set count is retained as set-level context and is
never expanded into invented per-rep boundaries or dumbbell boxes.

After materialization, start the review server and open the dumbbell truth lab:

```bash
npm run review:recognition
open http://127.0.0.1:4318/dumbbell.html
```

The current frozen queue contains 1,036 frames: 602 inner-train, 220
inner-validation, and 214 sealed inner-test frames. Reviewers can draw, move,
resize and delete one to four dumbbell instances, record image side, occlusion,
truncation, mirror-only/static-rack hard negatives, or ambiguity. Reviews are
append-only in `mmfit-dumbbell-review-events-v1.jsonl`; the page never upgrades
the cyan wrist ROI proposals to human truth automatically. Test labels remain
unavailable to training and threshold selection.

There is currently no trained barbell/dumbbell detector weight in the
repository. The only YOLOX model is the HumanArt person detector. Training and
reporting equipment accuracy must remain blocked until submitted human labels
exist in every internal split and frozen test predictions are evaluated.

## Causal barbell + pose alignment prototype

When frame-by-frame shaft annotation is unavailable, run the isolated research
prototype against the six personal bench videos and their frozen RTMPose
Halpe-26 sidecars:

```bash
.scratch/rtmpose-runtime/bin/python \
  tools/equipment-validation/prototype_barbell_pose_alignment.py
```

The prototype detects a horizontal shaft group on every sampled video frame,
uses a causal background and prior path only, and then compares the detected
axis with the two wrist observations. Wrist Y is never used to select bar Y;
wrist X only helps reject line groups that do not span the hands. Rep labels are
revealed after inference solely for direction checkpoints.

实验输出统一写入
`data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/`；
当前能力只从 `docs/reports/current-barbell-bench-recognition.md` 读取。
Generated fused wrists are diagnostic projections only. The command never
updates source sidecars, captures, labels, Rust profiles, or production assets.

## Label-after-inference bench recognition audit

After the causal bar-axis observations have been generated, run the bench
execution audit in three separate stages so that repetition truth is unavailable
while predictions are written:

```bash
.scratch/rtmpose-runtime/bin/python \
  tools/equipment-validation/evaluate_blind_bench_recognition.py --stage prepare
.scratch/rtmpose-runtime/bin/python \
  tools/equipment-validation/evaluate_blind_bench_recognition.py --stage infer
.scratch/rtmpose-runtime/bin/python \
  tools/equipment-validation/evaluate_blind_bench_recognition.py --stage evaluate
```

`prepare` whitelists only timestamps and detected bar-axis observations and
randomizes source order. `infer` writes predictions without exercise labels,
expected counts, or rep ranges. Only `evaluate` opens the personal golden
labels. 揭盲评测保存在同一个 `data/workflows/` run 目录；当前能力只更新
`docs/reports/current-barbell-bench-recognition.md`。

This follows the product contract: the user selects the bench profile and uses
the configured camera view before recognition. Automatic exercise
classification is not required. The six source scenes were already observed while developing
the research detector, and Rust EQP1 does not yet drive the RepEngine, so the
result is not unseen-scene evidence or a production SDK promotion gate.
