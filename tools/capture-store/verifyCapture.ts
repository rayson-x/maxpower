import { readFileSync } from "node:fs";

import { decodeMotionPacket } from "../../src/motion/motionPacket";

/**
 * 真机落盘产物验证：读取从设备 adb pull 回来的 captures/*.json，
 * 逐帧 decode canonical packet，输出会话摘要与计数结果。
 * 证明"录制文件可被既有 TS 链路消费"。
 *
 * 用法：tsc 编译后 node verifyCapture.js <capture.json>
 */

interface CaptureFile {
  version: string;
  session: {
    exerciseId: string;
    capturePosition: string;
    lensFacing: string;
    model: string;
    startedAtMs: number;
  };
  frames: Array<{ timestampMs: number; packetBase64: string }>;
  summary: { frames: number; durationMs: number };
}

function main() {
  const path = process.argv[2];
  if (!path) throw new Error("usage: verifyCapture <capture.json>");
  const capture = JSON.parse(readFileSync(path, "utf8")) as CaptureFile;

  let decoded = 0;
  let failed = 0;
  const confirmedReps = new Set<string>();
  let lastLifecycle = "unknown";
  for (const frame of capture.frames) {
    try {
      const packet = decodeMotionPacket(Buffer.from(frame.packetBase64, "base64"));
      decoded += 1;
      lastLifecycle = packet.setState.lifecycle;
      for (const rep of packet.completedReps) {
        if (rep.disposition === "confirmed") {
          confirmedReps.add(`${packet.subjectEpoch}:${rep.repId}:${rep.revision}`);
        }
      }
    } catch {
      failed += 1;
    }
  }

  console.log(`文件: ${path}`);
  console.log(`动作: ${capture.session.exerciseId} @ ${capture.session.capturePosition} (${capture.session.lensFacing})`);
  console.log(`帧数: ${capture.frames.length}（解码成功 ${decoded} / 失败 ${failed}）`);
  console.log(`时长: ${(capture.summary.durationMs / 1000).toFixed(1)}s`);
  console.log(`确认 reps: ${confirmedReps.size}`);
  console.log(`最终生命周期: ${lastLifecycle}`);
  if (failed > 0) process.exitCode = 1;
}

main();
