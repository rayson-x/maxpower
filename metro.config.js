// Expo SDK 57 — https://docs.expo.dev/versions/v57.0.0/config/metro/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

/**
 * pi-ai 会把它支持的**所有** provider 都拉进依赖图(register-builtins.js 里逐个
 * `import("./providers/xxx.js")`)。本项目只用 openai-completions(智谱 GLM),
 * 但 mistral 等 provider 会顺带把各自的可选依赖也带进来 —— 这些依赖没装,
 * Metro 解析不到就整个 bundle 失败。
 *
 * 这里显式列出「可选、且我们永远走不到」的模块,统一指到空模块。
 * 注意:这是白名单而不是"解析失败就吞掉",避免掩盖真正的依赖缺失。
 * 如果将来真要启用某个 provider,先把它从这张表里删掉。
 */
const STUBBED_OPTIONAL_MODULES = new Set([
  "@opentelemetry/api", // @mistralai/mistralai 的可选遥测依赖
]);

const EMPTY_MODULE = path.resolve(__dirname, "src/shims/emptyModule.ts");

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && STUBBED_OPTIONAL_MODULES.has(moduleName)) {
    return { type: "sourceFile", filePath: EMPTY_MODULE };
  }
  // context.resolveRequest 在自定义 resolver 内指向默认实现,不会递归
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
