import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import ts from "typescript";

const projectRoot = resolve(process.cwd());
const outputRoot = resolve(projectRoot, "public/client-harness/runtime");
const publicRoot = resolve(projectRoot, "public/client-harness");
const entry = resolve(projectRoot, "tools/client-realtime-agent/browserHarness.ts");
const htmlEntry = resolve(projectRoot, "tools/client-realtime-agent/client-realtime-agent.html");
const built = new Set();

await rm(outputRoot, { recursive: true, force: true });
await build(entry);
await mkdir(publicRoot, { recursive: true });
await writeFile(resolve(publicRoot, "index.html"), await readFile(htmlEntry, "utf8"), "utf8");
process.stdout.write(`${outputRoot}\n`);

async function build(sourcePath) {
  sourcePath = await resolveSource(sourcePath);
  if (built.has(sourcePath)) return;
  built.add(sourcePath);
  const source = await readFile(sourcePath, "utf8");
  const outputPath = outputFor(sourcePath);
  const result = ts.transpileModule(source, {
    fileName: sourcePath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      sourceMap: false,
    },
  });
  let javascript = result.outputText;
  const dependencies = emittedRelativeSpecifiers(javascript);
  for (const specifier of dependencies) {
    const dependency = await resolveSource(resolve(dirname(sourcePath), specifier));
    await build(dependency);
    const rewritten = browserRelative(outputPath, outputFor(dependency));
    javascript = replaceSpecifier(javascript, specifier, rewritten);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, javascript, "utf8");
}

async function resolveSource(candidate) {
  const candidates = extname(candidate)
    ? [candidate]
    : [`${candidate}.ts`, `${candidate}.tsx`, resolve(candidate, "index.ts")];
  for (const path of candidates) {
    try {
      await readFile(path, "utf8");
      return resolve(path);
    } catch {
      // Try the next source form.
    }
  }
  throw new Error(`browser harness dependency not found: ${candidate}`);
}

function outputFor(sourcePath) {
  const projectRelative = relative(projectRoot, sourcePath);
  if (projectRelative.startsWith(`..${sep}`) || projectRelative === "..") {
    throw new Error(`browser harness dependency escaped project: ${sourcePath}`);
  }
  return resolve(outputRoot, projectRelative.replace(/\.tsx?$/, ".js"));
}

function emittedRelativeSpecifiers(javascript) {
  const output = new Set();
  const pattern = /(?:from\s*|import\s*)["'](\.[^"']+)["']/g;
  for (const match of javascript.matchAll(pattern)) output.add(match[1]);
  return [...output];
}

function browserRelative(fromPath, toPath) {
  let value = relative(dirname(fromPath), toPath).split(sep).join("/");
  if (!value.startsWith(".")) value = `./${value}`;
  return value;
}

function replaceSpecifier(javascript, original, replacement) {
  return javascript
    .replaceAll(`"${original}"`, `"${replacement}"`)
    .replaceAll(`'${original}'`, `'${replacement}'`);
}
