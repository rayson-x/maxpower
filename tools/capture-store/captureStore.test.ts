import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPTURE_FILE_VERSION,
  InMemoryCaptureStore,
  buildCaptureDocument,
  formatCaptureFileName,
  type CaptureFrame,
  type CaptureSessionMeta,
} from "../../src/motion/captureStore";

/**
 * 只覆盖 InMemoryCaptureStore 与纯函数（文件名生成、JSON 组装、summary）。
 * FileSystemCaptureStore 依赖原生模块，只能在真机上验证。
 */

const SESSION: CaptureSessionMeta = {
  exerciseId: "pull_up",
  capturePosition: "front-left-45",
  lensFacing: "front",
  model: "lite",
  startedAtMs: Date.UTC(2026, 7, 7, 12, 30, 45),
};

const FRAME_1: CaptureFrame = {
  timestampMs: 1000,
  packetBase64: "UEFDS0VULTE=",
};
const FRAME_2: CaptureFrame = { timestampMs: 1100, packetBase64: "UEFDS0VULTI=" };
const FRAME_3: CaptureFrame = { timestampMs: 1300, packetBase64: "UEFDS0VULTM=" };

test("文件名生成：yyyymmdd_hhmmss_<exerciseId>.json（本机时区）", () => {
  const fileName = formatCaptureFileName(SESSION);
  assert.match(fileName, /^\d{8}_\d{6}_pull_up\.json$/);

  // 用同一套 Date 取数规则拼出期望值，避免测试里写死时区。
  const date = new Date(SESSION.startedAtMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  const expected =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}` +
    `_pull_up.json`;
  assert.equal(fileName, expected);
});

test("文件名生成：exerciseId 非法字符替换为 -，全非法时退化为 unknown", () => {
  const at = SESSION.startedAtMs;
  assert.ok(formatCaptureFileName({ exerciseId: "side step!", startedAtMs: at }).endsWith("_side-step-.json"));
  assert.ok(formatCaptureFileName({ exerciseId: "深蹲", startedAtMs: at }).endsWith("_unknown.json"));
});

test("JSON 组装：version/session/frames 原样保留，summary 统计帧数与首末帧时长", () => {
  const frames = [FRAME_1, FRAME_2, FRAME_3];
  const document = buildCaptureDocument(SESSION, frames);

  assert.equal(document.version, CAPTURE_FILE_VERSION);
  assert.deepEqual(document.session, SESSION);
  assert.deepEqual(document.frames, frames);
  assert.deepEqual(document.summary, { frames: 3, durationMs: 300 });
});

test("JSON 组装：不足两帧时 durationMs 为 0", () => {
  assert.equal(buildCaptureDocument(SESSION, []).summary.durationMs, 0);
  assert.equal(buildCaptureDocument(SESSION, [FRAME_1]).summary.durationMs, 0);
  assert.equal(buildCaptureDocument(SESSION, []).summary.frames, 0);
});

test("InMemoryCaptureStore：记录完整写入序列，finalize 返回内存 uri 与 summary", async () => {
  const store = new InMemoryCaptureStore();
  store.begin(SESSION);
  store.append(FRAME_1);
  store.append(FRAME_2);
  const ref = await store.finalize();

  assert.deepEqual(
    store.calls.map((call) => call.type),
    ["begin", "append", "append", "finalize"],
  );
  const beginCall = store.calls[0];
  assert.equal(beginCall.type, "begin");
  assert.deepEqual(beginCall.type === "begin" && beginCall.session, SESSION);

  const expectedName = formatCaptureFileName(SESSION);
  assert.equal(ref.fileName, expectedName);
  assert.equal(ref.uri, `memory://captures/${expectedName}`);
  assert.equal(ref.path, `captures/${expectedName}`);
  assert.deepEqual(ref.summary, { frames: 2, durationMs: 100 });

  const finalizeCall = store.calls[3];
  assert.equal(finalizeCall.type, "finalize");
  if (finalizeCall.type === "finalize") {
    assert.equal(finalizeCall.document.version, CAPTURE_FILE_VERSION);
    assert.deepEqual(finalizeCall.document.frames, [FRAME_1, FRAME_2]);
    assert.deepEqual(finalizeCall.document.summary, ref.summary);
  }
});

test("InMemoryCaptureStore：只持久化 canonical packet，不创建第二份骨架字段", async () => {
  const store = new InMemoryCaptureStore();
  store.begin(SESSION);
  store.append(FRAME_2);
  await store.finalize();

  const finalizeCall = store.calls.find((call) => call.type === "finalize");
  assert.ok(finalizeCall && finalizeCall.type === "finalize");
  assert.equal("landmarks" in finalizeCall.document.frames[0], false);
});

test("InMemoryCaptureStore：abort 放弃会话且不产生文件，可重新开始", async () => {
  const store = new InMemoryCaptureStore();
  store.begin(SESSION);
  store.append(FRAME_1);
  store.abort();

  assert.deepEqual(
    store.calls.map((call) => call.type),
    ["begin", "append", "abort"],
  );
  assert.throws(() => store.append(FRAME_2), /没有录制会话/);

  // abort 后可以重新 begin。
  store.begin(SESSION);
  store.append(FRAME_2);
  const ref = await store.finalize();
  assert.deepEqual(ref.summary, { frames: 1, durationMs: 0 });
});

test("InMemoryCaptureStore：状态机约束——未 begin 不能 append/finalize，录制中不能重复 begin", async () => {
  const store = new InMemoryCaptureStore();
  assert.throws(() => store.append(FRAME_1), /没有录制会话/);
  await assert.rejects(() => store.finalize(), /没有录制会话/);

  store.begin(SESSION);
  assert.throws(() => store.begin(SESSION), /已有进行中的录制会话/);

  await store.finalize();
  // finalize 后状态清空，再次 finalize 抛错。
  await assert.rejects(() => store.finalize(), /没有录制会话/);
});
