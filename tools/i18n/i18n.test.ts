import assert from "node:assert/strict";
import test from "node:test";

import { createTranslator, resolveLocale, translate, PLANNING_COPY, TRANSLATIONS } from "../../src/i18n";

/** i18n 基建验收（客户端专用；服务端不出文案）。 */

test("locale 解析：中文 zh，其余默认英文（海外优先）", () => {
  assert.equal(resolveLocale("zh-CN"), "zh");
  assert.equal(resolveLocale("zh"), "zh");
  assert.equal(resolveLocale("en-US"), "en");
  assert.equal(resolveLocale(undefined), "en");
  assert.equal(resolveLocale("fr-FR"), "en", "未支持语言回退英文");
});

test("翻译：按键取对应语言", () => {
  assert.equal(translate(PLANNING_COPY, "timeline.pace.aggressive", "zh"), "最快路径：每天顶到安全赤字上限，需严格保负荷+高蛋白+熔断机制");
  assert.equal(translate(PLANNING_COPY, "timeline.pace.aggressive", "en"), "Fastest path: max safe daily deficit; requires strict load retention, high protein and a circuit-breaker");
});

test("插值：变量替换；未提供的变量保留占位可见", () => {
  const t = createTranslator(PLANNING_COPY, "en");
  const out = t("timeline.fallback.kgPart", { minKg: 0.2, maxKg: 0.5 });
  assert.equal(out, " (about 0.2-0.5 kg)");
  const missing = t("timeline.fallback.kgPart", { minKg: 0.2 });
  assert.ok(missing.includes("{maxKg}"));
});

test("缺失键返回带 key 的占位（便于发现漏翻，不静默空串）", () => {
  assert.equal(translate(PLANNING_COPY, "does.not.exist", "en"), "[does.not.exist]");
});

test("资源表完整性：每条必须 en + zh 双语言，且英文非空是真英文", () => {
  for (const [domain, table] of Object.entries(TRANSLATIONS)) {
    for (const [key, entry] of Object.entries(table)) {
      assert.ok(entry.en.length > 3, `${domain}.${key} 缺英文`);
      assert.ok(entry.zh.length > 0, `${domain}.${key} 缺中文`);
      assert.ok(/[A-Za-z]{4,}/.test(entry.en), `${domain}.${key} 英文不是英文`);
      assert.ok(!/[一-鿿]/.test(entry.en), `${domain}.${key} 英文里混了中文`);
    }
  }
});

test("createTranslator 绑定资源表后复用", () => {
  const t = createTranslator(PLANNING_COPY, "zh");
  assert.ok(t("tiering.recomp.leanBeginner").includes("新手窗口期"));
});
