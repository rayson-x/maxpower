import assert from "node:assert/strict";
import test from "node:test";

import { setMobileUiLocale } from "../../src/i18n";
import { userFacingError } from "../../src/mobile/userFacingError";
import {
  coachingModeLabel,
} from "../../src/mobile/ui/productCopy";

setMobileUiLocale("zh-CN");

test("userFacingError translates known internal errors", () => {
  assert.equal(
    userFacingError(new Error("provider_service_consent_required"), "发送失败。"),
    "需要先允许 Coach 使用联网服务，再发送消息。",
  );
});

test("userFacingError preserves readable Chinese and hides technical messages", () => {
  assert.equal(userFacingError(new Error("这条记录已经更新。"), "保存失败。"), "这条记录已经更新。");
  assert.equal(userFacingError(new Error("canonical_packet_revision_conflict"), "保存失败。"), "保存失败。");
  assert.equal(userFacingError(new Error("Service unavailable"), "暂时无法连接。"), "暂时无法连接。");
});

test("profile labels never expose enum tokens", () => {
  assert.equal(coachingModeLabel("collaborative"), "共同决定");
});
