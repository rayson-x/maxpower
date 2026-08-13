# External exercise datasets

This directory records reproducible acquisition metadata. Actual datasets belong under the git-ignored `data/external/` tree and must never be committed.

Run a dry run first:

```sh
tools/external-datasets/fetch.sh --dataset mm-fit-pose-labels
```

Then explicitly execute it:

```sh
tools/external-datasets/fetch.sh --dataset mm-fit-pose-labels --execute
```

The downloader resumes partial files, checks the published byte length, writes local SHA-256 sums, and extracts only MM-Fit's supplied 2D/3D poses and activity labels. It deliberately excludes the 39.11 GB RGB collection.

MM-Fit's official RGB collection is split into 21 session MP4 files on Zenodo
and can be downloaded incrementally with byte-length and MD5 verification:

```sh
tools/external-datasets/fetch-mmfit-rgb.sh --split train
tools/external-datasets/fetch-mmfit-rgb.sh --split train --execute
```

Available splits match the subject-isolated training protocol: `train`,
`validation`, `test`, and `unseen_test`. Keep at least 8 GiB free; do not use
`--split all` on a disk that only barely fits the 39.11 GB collection.

The 2026-08-09 acquisition validated all 21 sessions: 63 extracted files, 1,074,852,017 uncompressed bytes, and 6,160 set-level labeled repetitions across ten actions. The source archive was deleted after verification and selective extraction; it is recoverable through the resumable script. See `mm-fit-validation-summary.json` for the shape contracts and per-action counts.

RepCount-pose is a single 9.52 GB Google Drive archive. It is blocked by default and should not be fetched on the current machine. The source-code repositories use MIT licenses, but that does not grant the same rights to their datasets. See `datasets.json` for the conservative local usage policy.

The official README, action mapping, and repository metadata were saved locally for review; no video or pose archive was downloaded. See `repcount-pose-validation-summary.json`.

## Adapter boundary

External samples are observations, not acceptable-form references. The adapter in
`tools/external-fitness-data/` produces separate research fixtures with source
dataset, original action label, subject/session split, frame timestamps,
supplied skeleton schema and annotation granularity. It deliberately cannot
write a `LabeledSetFixture` or `recognition-profiles.json`; profile promotion
still requires a held-out MaxPower-format evaluation.

```sh
npm run prepare:mmfit
npm run analyze:mmfit-orientation
npm run train:mmfit-profiles
npm run benchmark:mmfit:candidates
npm run report:recognition-corpus
npm run test:external-fitness-data
```

`body-orientation-analysis.json` is a research-only estimate of how the person
faces the image. It is not a physical camera identity and cannot be converted
to a MaxPower capture position. `npm run benchmark:mmfit:periodicity` is an
offline whole-set observability probe; its per-clip PCA sees future samples and
must never be loaded as a runtime counter or used to synthesize missing reps.
