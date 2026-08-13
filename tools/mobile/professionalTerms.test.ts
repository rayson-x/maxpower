import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  PROFESSIONAL_TERM_CATALOG_VERSION,
  annotateProfessionalTerms,
  readProfessionalTerm,
} from "../../src/mobile/ui-kit/professionalTerms";

test("RIR 与 RPE 有版本化、面向用户且方向明确的解释", () => {
  assert.equal(PROFESSIONAL_TERM_CATALOG_VERSION, "professional-terms/v1");

  const rir = readProfessionalTerm("rir");
  assert.equal(rir.label, "RIR");
  assert.match(rir.plainMeaning, /还能.*完成.*次/);
  assert.match(rir.example, /RIR 2.*2 次/);
  assert.match(rir.scaleDirection, /越低.*越接近力竭/);

  const rpe = readProfessionalTerm("rpe");
  assert.equal(rpe.label, "RPE");
  assert.match(rpe.plainMeaning, /主观.*用力/);
  assert.match(rpe.example, /RPE 8/);
  assert.match(rpe.boundary, /不能.*机械换算/);
});

test("用户可见文本只标注完整专业名词并保留原文", () => {
  assert.deepEqual(annotateProfessionalTerms("目标 RIR 2，有氧 RPE 6。"), [
    { kind: "text", text: "目标 " },
    { kind: "term", text: "RIR", termId: "rir" },
    { kind: "text", text: " 2，有氧 " },
    { kind: "term", text: "RPE", termId: "rpe" },
    { kind: "text", text: " 6。" },
  ]);
  assert.deepEqual(annotateProfessionalTerms("stripe 与 grip 不是术语，rpe 才是。"), [
    { kind: "text", text: "stripe 与 grip 不是术语，" },
    { kind: "term", text: "rpe", termId: "rpe" },
    { kind: "text", text: " 才是。" },
  ]);
  assert.deepEqual(annotateProfessionalTerms("e1RM 是估算，不是 1RM；TDEE 包含 TEF。"), [
    { kind: "term", text: "e1RM", termId: "estimated_one_rm" },
    { kind: "text", text: " 是估算，不是 " },
    { kind: "term", text: "1RM", termId: "one_rm" },
    { kind: "text", text: "；" },
    { kind: "term", text: "TDEE", termId: "tdee" },
    { kind: "text", text: " 包含 " },
    { kind: "term", text: "TEF", termId: "tef" },
    { kind: "text", text: "。" },
  ]);
});

test("没有专业名词的普通教练表达保持单一文本片段", () => {
  assert.deepEqual(annotateProfessionalTerms("今天先看恢复状态，再决定练什么。"), [
    { kind: "text", text: "今天先看恢复状态，再决定练什么。" },
  ]);
});

test("同一术语组件接入 Agent 对话、建档强度选择与日常记录字段", async () => {
  const [drawer, onboarding, recordCapture] = await Promise.all([
    readFile(path.resolve(process.cwd(), "src/coach/ui/CoachDrawer.tsx"), "utf8"),
    readFile(path.resolve(process.cwd(), "src/mobile/ui/DynamicOnboardingFormCard.tsx"), "utf8"),
    readFile(path.resolve(process.cwd(), "src/mobile/ui-kit/RecordCapture.tsx"), "utf8"),
  ]);
  assert.match(drawer, /ProfessionalTermText text=\{message\.content\}/);
  assert.match(onboarding, /ProfessionalTermText text=\{metric\.toUpperCase\(\)\}/);
  assert.match(recordCapture, /ProfessionalTermText text=\{label\}/);
});
