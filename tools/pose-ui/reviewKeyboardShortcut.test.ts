import assert from "node:assert/strict";
import test from "node:test";

import { reviewKeyboardShortcut } from "../../src/pose/reviewKeyboardShortcut";

test("annotation console maps macOS undo and delete keys", () => {
  assert.equal(reviewKeyboardShortcut({ key: "z", metaKey: true }), "undo");
  assert.equal(reviewKeyboardShortcut({ key: "Z", metaKey: true }), "undo");
  assert.equal(reviewKeyboardShortcut({ key: "Backspace" }), "delete-selected");
  assert.equal(reviewKeyboardShortcut({ key: "Delete" }), "delete-selected");
});

test("annotation shortcuts preserve native editing and unsupported modifiers", () => {
  assert.equal(reviewKeyboardShortcut({ key: "z", metaKey: true, targetTagName: "INPUT" }), null);
  assert.equal(reviewKeyboardShortcut({ key: "Backspace", targetTagName: "TEXTAREA" }), null);
  assert.equal(reviewKeyboardShortcut({ key: "Delete", targetTagName: "SELECT" }), null);
  assert.equal(reviewKeyboardShortcut({ key: "z", metaKey: true, targetContentEditable: true }), null);
  assert.equal(reviewKeyboardShortcut({ key: "z", ctrlKey: true }), null);
  assert.equal(reviewKeyboardShortcut({ key: "z", metaKey: true, shiftKey: true }), null);
  assert.equal(reviewKeyboardShortcut({ key: "Backspace", altKey: true }), null);
});
