import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { MOBILE_UI_COPY } from "../../src/i18n";

test("manual records stay in one drawer over the current product route", async () => {
  const [recordFocus, shell] = await Promise.all([
    readFile(path.resolve(process.cwd(), "src/mobile/ui/RecordFocus.tsx"), "utf8"),
    readFile(path.resolve(process.cwd(), "src/mobile/ui/ProductShell.tsx"), "utf8"),
  ]);

  assert.match(recordFocus, /<BottomDrawer/);
  assert.doesNotMatch(recordFocus, /<FocusSurface/);
  assert.doesNotMatch(recordFocus, /RecordCaptureComposer/);
  assert.doesNotMatch(recordFocus, /RecordIntentGrid/);
  for (const mode of ["training", "activity", "nutrition", "sleep", "recovery", "body"]) {
    assert.match(recordFocus, new RegExp(`id: "${mode}"`));
  }
  assert.match(shell, /setActivityLogInitialMode\("picker"\)/);
  assert.doesNotMatch(shell, /anchor=\{recordAnchor\}/);
});

test("record drawer copy is owned by i18n and avoids assistant-like filler", () => {
  const keys = [
    "mobile.record.drawer.title",
    "mobile.record.drawer.subtitle",
    "mobile.record.drawer.mode.strength",
    "mobile.record.drawer.mode.cardio",
    "mobile.record.drawer.mode.nutrition",
    "mobile.record.drawer.mode.sleep",
    "mobile.record.drawer.mode.recovery",
    "mobile.record.drawer.mode.body",
  ];
  const copy = keys.map((key) => {
    const entry = MOBILE_UI_COPY[key];
    assert.ok(entry, `${key} missing`);
    assert.ok(entry.en.trim());
    assert.ok(entry.zh.trim());
    return entry.zh;
  }).join("\n");
  assert.doesNotMatch(copy, /我来|一起|这就够|稳住|按自己的节奏|正在为你/);
});
