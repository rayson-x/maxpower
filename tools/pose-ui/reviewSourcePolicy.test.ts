import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("capture review accepts new-video as its only input source", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "components", "CaptureApprovalPanel.web.tsx"),
    "utf8",
  );

  assert.match(source, /loadAnnotationInbox\(\)/);
  assert.doesNotMatch(source, /archives\/confirmed-captures/);
  assert.doesNotMatch(source, /showDirectoryPicker|capture-review-files/);
  assert.doesNotMatch(source, /导入 Downloads 采集包|手动选择文件/);
  assert.doesNotMatch(source, /ImportedLabels|ImportedCaptureMetadata|buildApprovedLatPulldownTrajectorySample/);
});

test("capture review navigates the complete inbox instead of only parsed captures", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "components", "CaptureApprovalPanel.web.tsx"),
    "utf8",
  );

  assert.match(source, /adjacentReviewItem\(inboxItemsRef\.current, selected\?\.inboxItem\.id/);
  assert.match(source, /void processInboxItem\(nextItem\)/);
});

test("capture review opens raw videos for manual labeling without pose extraction", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "components", "CaptureApprovalPanel.web.tsx"),
    "utf8",
  );

  assert.doesNotMatch(source, /extractInboxVideoPoseFixture|正在识别骨架|生成 canonical 骨架/);
  assert.match(source, /buildManualReviewFixture\(item\.filename\)/);
  assert.match(source, /manualReviewValidationError/);
});
