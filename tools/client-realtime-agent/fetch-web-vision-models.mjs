#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultProjectRoot = resolve(dirname(scriptPath), "../..");
const remediationCommand =
  "node tools/client-realtime-agent/fetch-web-vision-models.mjs --execute";

function parseArguments(argv) {
  let mode = "verify";
  let projectRoot = defaultProjectRoot;
  let manifestPath;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--verify") {
      mode = "verify";
    } else if (argument === "--execute") {
      mode = "execute";
    } else if (argument === "--project-root") {
      projectRoot = resolve(argv[++index] ?? "");
    } else if (argument === "--manifest") {
      manifestPath = resolve(argv[++index] ?? "");
    } else {
      throw new Error(
        `unknown argument: ${argument}\nusage: ${remediationCommand.replace(" --execute", " [--verify|--execute] [--project-root path] [--manifest path]")}`,
      );
    }
  }

  return {
    mode,
    projectRoot,
    manifestPath:
      manifestPath ??
      resolve(projectRoot, "tools/client-realtime-agent/web-vision-models.json"),
  };
}

function resolveDestination(projectRoot, destination) {
  if (typeof destination !== "string" || isAbsolute(destination)) {
    throw new Error(`model destination must be project-relative: ${destination}`);
  }
  const absolute = resolve(projectRoot, destination);
  const relation = relative(projectRoot, absolute);
  if (relation === "" || relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error(`model destination escapes project root: ${destination}`);
  }
  return absolute;
}

async function sha256(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

async function inspectModel(projectRoot, model) {
  if (
    typeof model?.id !== "string" ||
    typeof model?.destination !== "string" ||
    !Number.isSafeInteger(model?.bytes) ||
    model.bytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(model?.sha256 ?? "")
  ) {
    throw new Error(`invalid pinned model manifest entry: ${JSON.stringify(model)}`);
  }

  const path = resolveDestination(projectRoot, model.destination);
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) {
      return { status: "missing", model, path };
    }
    const actualSha256 = await sha256(path);
    if (metadata.size !== model.bytes || actualSha256 !== model.sha256) {
      return {
        status: "invalid",
        model,
        path,
        actualBytes: metadata.size,
        actualSha256,
      };
    }
    return { status: "verified", model, path };
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "missing", model, path };
    throw error;
  }
}

async function loadManifest(path) {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(manifest.models) || manifest.models.length === 0) {
    throw new Error(`model manifest has no models: ${path}`);
  }
  return manifest;
}

function reportFailure(result) {
  const location = result.model.destination;
  if (result.status === "missing") {
    console.error(`missing pinned ONNX model: ${result.model.id} (${location})`);
  } else {
    console.error(
      `invalid pinned ONNX model: ${result.model.id} (${location}); ` +
        `expected ${result.model.bytes} bytes sha256:${result.model.sha256}, ` +
        `received ${result.actualBytes} bytes sha256:${result.actualSha256}`,
    );
  }
}

async function downloadArchive(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`download failed (${response.status}) for ${url}`);
  }
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function installModel(projectRoot, model) {
  if (
    typeof model.sourceArchive !== "string" ||
    !model.sourceArchive.startsWith("https://download.openmmlab.com/") ||
    typeof model.archiveMemberSuffix !== "string"
  ) {
    throw new Error(`model ${model.id} has no approved archive source`);
  }

  const temporaryRoot = await mkdtemp(joinPath(tmpdir(), "maxpower-vision-model-"));
  try {
    const archivePath = joinPath(temporaryRoot, "model.zip");
    await downloadArchive(model.sourceArchive, archivePath);
    const listing = spawnSync("unzip", ["-Z1", archivePath], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    if (listing.status !== 0) {
      throw new Error(`cannot inspect ${basename(model.sourceArchive)}: ${listing.stderr}`);
    }
    const member = listing.stdout
      .split(/\r?\n/)
      .find((candidate) => candidate.endsWith(model.archiveMemberSuffix));
    if (!member) {
      throw new Error(
        `${model.archiveMemberSuffix} is missing from ${model.sourceArchive}`,
      );
    }
    const extracted = spawnSync("unzip", ["-p", archivePath, member], {
      encoding: null,
      maxBuffer: 128 * 1024 * 1024,
    });
    if (extracted.status !== 0) {
      throw new Error(`cannot extract ${member}: ${String(extracted.stderr)}`);
    }

    const candidatePath = joinPath(temporaryRoot, "candidate.onnx");
    await writeFile(candidatePath, extracted.stdout);
    const candidate = await inspectModel(temporaryRoot, {
      ...model,
      destination: "candidate.onnx",
    });
    if (candidate.status !== "verified") {
      reportFailure(candidate);
      throw new Error(`downloaded bytes do not match the pin for ${model.id}`);
    }

    const destination = resolveDestination(projectRoot, model.destination);
    await mkdir(dirname(destination), { recursive: true });
    const staged = `${destination}.tmp-${process.pid}`;
    await copyFile(candidatePath, staged);
    await rename(staged, destination);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

// Kept as a small wrapper so path construction stays visibly platform-neutral.
function joinPath(...parts) {
  return resolve(parts[0], ...parts.slice(1));
}

export async function verifyPinnedVisionModels({ projectRoot, manifestPath }) {
  const manifest = await loadManifest(manifestPath);
  const results = [];
  for (const model of manifest.models) {
    results.push(await inspectModel(projectRoot, model));
  }
  return { manifest, results };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  let { manifest, results } = await verifyPinnedVisionModels(options);

  if (options.mode === "execute") {
    for (const result of results) {
      if (result.status !== "verified") {
        await installModel(options.projectRoot, result.model);
      }
    }
    ({ manifest, results } = await verifyPinnedVisionModels(options));
  }

  const failures = results.filter((result) => result.status !== "verified");
  if (failures.length > 0) {
    failures.forEach(reportFailure);
    console.error(`Run: ${remediationCommand}`);
    return 1;
  }

  for (const result of results) {
    console.log(`verified ${result.model.id} sha256:${result.model.sha256}`);
  }
  return manifest.models.length > 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main()
    .then((status) => {
      process.exitCode = status;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      if (process.argv.includes("--execute")) {
        console.error(`Retry: ${remediationCommand}`);
      }
      process.exitCode = 1;
    });
}
