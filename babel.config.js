// Expo SDK 57 — https://docs.expo.dev/versions/v57.0.0/config/babel/

/**
 * Metro 的依赖收集器(collectDependencies.processImportCall)对 `import()` 是
 * **无条件**要求字面量 specifier 的:拿不到静态字符串就直接抛
 * "Invalid call at line N: import(specifier)",而且不受 transformer.dynamicDepsInPackages 控制
 * ——那个开关只作用于 require(),不作用于 import()。
 *
 * 若干依赖(@mariozechner/pi-ai 的 codex provider、@mistralai/mistralai 的 telemetry 等)
 * 都用 `const dynamicImport = (s) => import(s)` 这种写法在 Node 下懒加载 node: 内置模块。
 * 这些分支在浏览器里永远走不到,但足以让整个 web bundle 编译失败。
 *
 * 这里把**非字面量**的 `import(x)` 整体替换成一个 rejected Promise:
 * - 字面量 `import("./foo.js")` 不受影响,Metro 照常做代码分割;
 * - 真在运行时走到这些分支,会得到一个明确的错误而不是静默失败;
 * - 本项目自己的代码没有非字面量 import()(shims 里用的是 `new Function` 绕过静态分析)。
 */
function stripNonLiteralDynamicImport({ types: t }) {
  const MESSAGE =
    "Dynamic import with a non-literal specifier is not supported in the Metro bundle " +
    "(stripped by babel.config.js).";

  return {
    name: "strip-non-literal-dynamic-import",
    visitor: {
      CallExpression(path) {
        if (path.node.callee.type !== "Import") return;
        const [arg] = path.node.arguments;
        if (!arg || arg.type === "StringLiteral") return;
        path.replaceWith(
          t.callExpression(
            t.memberExpression(t.identifier("Promise"), t.identifier("reject")),
            [t.newExpression(t.identifier("Error"), [t.stringLiteral(MESSAGE)])],
          ),
        );
        path.skip();
      },
    },
  };
}

// babel-preset-expo 只装在 expo 的嵌套 node_modules 里(不是本项目的直接依赖),
// 项目根解析不到,必须从 expo 的位置解析,否则 Metro 会因为找不到 preset 而整个挂掉。
const babelPresetExpo = require.resolve("babel-preset-expo", {
  paths: [require.resolve("expo/package.json")],
});

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [babelPresetExpo],
    plugins: [stripNonLiteralDynamicImport],
  };
};
