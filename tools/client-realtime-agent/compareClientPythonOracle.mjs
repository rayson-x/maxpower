import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const predictionPath = resolve(process.argv[2] ?? "data/workflows/client-realtime-agent/client-single-pass-v1/client-prediction-before-truth.json");
const sidecarRoot = resolve(process.argv[3] ?? "data/workflows/action-trajectory-database/halpe26-v1/personal-observations");
const outputPath = resolve(process.argv[4] ?? "data/workflows/client-realtime-agent/client-single-pass-v1/client-python-oracle-parity.json");
const prediction = JSON.parse(await readFile(predictionPath, "utf8"));
const rows = [];
for (const clientCase of prediction.cases) {
  const sidecarPath = resolve(sidecarRoot, `${clientCase.captureId}.halpe26.json.gz`);
  const oracle = JSON.parse(gunzipSync(await readFile(sidecarPath)).toString("utf8"));
  const comparisons = [];
  for (const clientFrame of clientCase.frames) {
    if (!clientFrame.selectedBbox || clientFrame.selectedLandmarks?.length !== 26) continue;
    const oracleFrame = nearestFrame(oracle.frames, clientFrame.timestampMs, 55);
    if (!oracleFrame || !oracleFrame.selectedBbox || oracleFrame.landmarks?.length !== 26) continue;
    const jointDistances = clientFrame.selectedLandmarks.map((point, index) => {
      const expected = oracleFrame.landmarks[index];
      return Math.hypot(point.x - expected.x, point.y - expected.y);
    });
    const confidenceDifferences = clientFrame.selectedLandmarks.map((point, index) =>
      Math.abs(point.visibility - oracleFrame.landmarks[index].visibility));
    comparisons.push({
      timestampOffsetMs: clientFrame.timestampMs - oracleFrame.timestampMs,
      bboxIou: bboxIou(clientFrame.selectedBbox, oracleFrame.selectedBbox),
      jointDistances,
      confidenceDifferences,
    });
  }
  const distances = comparisons.flatMap((item) => item.jointDistances);
  const confidence = comparisons.flatMap((item) => item.confidenceDifferences);
  const bboxIous = comparisons.map((item) => item.bboxIou);
  const perJoint = Array.from({ length: 26 }, (_, index) => {
    const values = comparisons.map((item) => item.jointDistances[index]);
    return { index, medianNormalizedDistance: percentile(values, 0.5), p90NormalizedDistance: percentile(values, 0.9) };
  });
  rows.push({
    captureId: clientCase.captureId,
    pairedFrameCount: comparisons.length,
    clientObservedFrameCount: clientCase.frames.filter((frame) => frame.selectedLandmarks?.length === 26).length,
    pythonObservedFrameCount: oracle.frames.filter((frame) => frame.landmarks?.length === 26).length,
    medianBboxIou: percentile(bboxIous, 0.5),
    p10BboxIou: percentile(bboxIous, 0.1),
    medianJointNormalizedDistance: percentile(distances, 0.5),
    p90JointNormalizedDistance: percentile(distances, 0.9),
    medianConfidenceAbsoluteDifference: percentile(confidence, 0.5),
    p90ConfidenceAbsoluteDifference: percentile(confidence, 0.9),
    perJoint,
  });
}
const report = {
  schemaVersion: "maxpower-client-python-pose-oracle-parity/v1",
  generatedAt: new Date().toISOString(),
  roleOfPython: "offline_oracle_only_not_runtime_not_acceptance",
  clientPredictionSha256: createHash("sha256").update(await readFile(predictionPath)).digest("hex"),
  rows,
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${outputPath}\n${JSON.stringify(rows.map((row) => ({
  captureId: row.captureId,
  pairedFrameCount: row.pairedFrameCount,
  medianBboxIou: row.medianBboxIou,
  p10BboxIou: row.p10BboxIou,
  medianJointNormalizedDistance: row.medianJointNormalizedDistance,
  p90JointNormalizedDistance: row.p90JointNormalizedDistance,
  medianConfidenceAbsoluteDifference: row.medianConfidenceAbsoluteDifference,
})), null, 2)}\n`);

function nearestFrame(frames, timestampMs, maximumDistanceMs) {
  let best = null;
  let distance = Infinity;
  for (const frame of frames) {
    const candidate = Math.abs(frame.timestampMs - timestampMs);
    if (candidate < distance) { best = frame; distance = candidate; }
  }
  return distance <= maximumDistanceMs ? best : null;
}

function bboxIou(left, right) {
  const leftRight = left.x + left.width;
  const leftBottom = left.y + left.height;
  const rightRight = right.x + right.width;
  const rightBottom = right.y + right.height;
  const intersection = Math.max(0, Math.min(leftRight, rightRight) - Math.max(left.x, right.x))
    * Math.max(0, Math.min(leftBottom, rightBottom) - Math.max(left.y, right.y));
  const union = left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * quantile))];
}
