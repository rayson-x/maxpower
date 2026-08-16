import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

import { MOBILE_UI_COPY, TRANSLATIONS, mobileT, setMobileUiLocale } from "../../src/i18n";

const CJK = /\p{Script=Han}/u;
const COPY_ATTRIBUTES = new Set([
  "accessibilityLabel",
  "description",
  "detail",
  "emptyLabel",
  "eyebrow",
  "hint",
  "label",
  "placeholder",
  "subtitle",
  "title",
]);
const REVIEWED_COPY_KEYS = [
  "mobile.ui.productshell.0066498cc1",
  "mobile.ui.productshell.010826f04f",
  "mobile.ui.productshell.021d6ca577",
  "mobile.ui.productshell.02599b3712",
  "mobile.ui.productshell.03e9fdc03a",
  "mobile.ui.productshell.0617573f0d",
  "mobile.ui.productshell.0a9b0c6d48",
  "mobile.ui.productshell.0d66b08d45",
  "mobile.ui.productshell.0f76a2a1d0",
  "mobile.ui.productshell.14c0b43542",
  "mobile.ui.productshell.155f1234ea",
  "mobile.ui.productshell.26b67e0767",
  "mobile.ui.productshell.2c6cdd6fdc",
  "mobile.ui.productshell.fd2ae92498",
] as const;

test("移动端可见文案只从 i18n 资源读取", async () => {
  const root = path.resolve(process.cwd(), "src/mobile");
  const files = await sourceFiles(root);
  const violations: string[] = [];

  for (const file of files) {
    const sourceText = await readFile(file, "utf8");
    const source = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const report = (node: ts.Node, text: string) => {
      if (!CJK.test(text)) return;
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      violations.push(`${path.relative(process.cwd(), file)}:${line + 1} ${text}`);
    };
    const inspectExpression = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) report(node, node.text);
      ts.forEachChild(node, inspectExpression);
    };
    const visit = (node: ts.Node): void => {
      if (ts.isJsxText(node)) report(node, node.text.trim());
      if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && COPY_ATTRIBUTES.has(node.name.text)) {
        const initializer = node.initializer;
        if (initializer && ts.isStringLiteral(initializer)) report(initializer, initializer.text);
        if (initializer && ts.isJsxExpression(initializer) && initializer.expression) inspectExpression(initializer.expression);
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(source);
        if (callee.endsWith("setError") || callee.endsWith("userFacingError")) {
          node.arguments.forEach(inspectExpression);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  assert.deepEqual(violations, []);
});

test("移动端 i18n 域已注册且每条资源包含中英文", () => {
  assert.equal(TRANSLATIONS.mobileUi, MOBILE_UI_COPY);
  assert.ok(Object.keys(MOBILE_UI_COPY).length > 1_000);
  for (const [key, entry] of Object.entries(MOBILE_UI_COPY)) {
    assert.ok(entry.en.trim(), `${key} 缺少英文`);
    assert.ok(entry.zh.trim(), `${key} 缺少中文`);
  }
});

test("重写后的核心文案提供独立中英文并跟随档案语言", () => {
  for (const key of REVIEWED_COPY_KEYS) {
    const entry = MOBILE_UI_COPY[key];
    assert.ok(entry, `${key} 不存在`);
    assert.doesNotMatch(entry.en, CJK, `${key} 的英文仍包含中文`);
    assert.notEqual(entry.en, entry.zh, `${key} 的中英文不应相同`);
  }

  setMobileUiLocale("en-US");
  assert.equal(mobileT("mobile.ui.productshell.fd2ae92498"), "No workout is scheduled for today");
  setMobileUiLocale("zh-CN");
  assert.equal(mobileT("mobile.ui.productshell.fd2ae92498"), "今天还没有训练安排");
});

test("核心移动端文案不暴露模型实现或表演式口号", () => {
  const reviewedCopy = REVIEWED_COPY_KEYS.map((key) => MOBILE_UI_COPY[key].zh).join("\n");
  assert.doesNotMatch(
    reviewedCopy,
    /LLM|Provider|证据边界|假任务|模型猜测|我在整理|我还需要|一起查看|按自己的节奏|稳住节奏|训练节奏|继续变强|目标、节奏与趋势|安全生成路线|产品运行时/,
  );
});

async function sourceFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const resolved = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(resolved));
    else if (/\.tsx?$/.test(entry.name)) result.push(resolved);
  }
  return result;
}
