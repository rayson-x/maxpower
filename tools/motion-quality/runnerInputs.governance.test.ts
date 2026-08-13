import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { loadInputCatalog, pinInputBytes, sha256 } from "./runnerInputs.js";

const LOCAL_CATALOG_PATH = "tools/motion-quality/data-governance-inputs.json";
const AUTHORITY_CATALOG_PATH = "../maxpower-training-data-governance/catalog/assets.json";

test("all motion-quality roles inherit their authority fields from assets.json", async () => {
  const loaded = await loadInputCatalog(LOCAL_CATALOG_PATH);
  assert.equal(loaded.value.schemaVersion, "maxpower-motion-quality-input-catalog/v2");
  assert.equal(loaded.value.authorityCatalog.catalogId, "maxpower-motion-training-data-v1");
  assert.equal(loaded.pin.assetId, "motion-quality-runner-input-catalog");
  assert.equal(loaded.pin.catalogSha256, loaded.pin.sha256);

  for (const binding of Object.values(loaded.value.assets)) {
    assert.match(binding.definitionSha256, /^[a-f0-9]{64}$/u);
    assert.ok(binding.admission.length > 0);
    assert.ok(binding.authority.length > 0);
    assert.ok(binding.groupKey.length > 0);
    assert.ok(binding.location.path.length > 0);
  }

  const datasetPath = resolve("data/training/personal-golden-segmentation-v2.json");
  const datasetBytes = await readFile(datasetPath);
  const pin = pinInputBytes(loaded.value, "humanRanges", datasetPath, datasetBytes);
  assert.equal(pin.catalogSha256, pin.sha256);
  assert.equal(pin.location.path, "data/training/personal-golden-segmentation-v2.json");
  assert.throws(
    () => pinInputBytes(
      loaded.value,
      "humanRanges",
      datasetPath,
      Buffer.concat([datasetBytes, Buffer.from("drift")]),
    ),
    /authoritative SHA-256 mismatch/u,
  );
  assert.throws(
    () => pinInputBytes(loaded.value, "rustWasm", datasetPath, datasetBytes),
    /outside authoritative asset location/u,
  );
});

test("missing authority assets fail closed", async () => {
  const localPath = await writeAuthorityFixture([]);
  await assert.rejects(
    loadInputCatalog(localPath),
    /authoritative asset personal-human-rep-ranges-v2 is missing/u,
  );
});

test("authority field drift and local-catalog hash drift fail closed", async () => {
  const authority = JSON.parse(await readFile(AUTHORITY_CATALOG_PATH, "utf8")) as {
    assets: Array<Record<string, unknown>>;
  };
  const humanRanges = authority.assets.find((asset) => asset.id === "personal-human-rep-ranges-v2");
  assert.ok(humanRanges);
  const localPath = await writeAuthorityFixture([{ ...humanRanges, authority: "drifted_authority" }]);
  await assert.rejects(
    loadInputCatalog(localPath),
    /authoritative asset definition drifted/u,
  );

  const selfOnlyPath = await writeAuthorityFixture([]);
  await writeFile(selfOnlyPath, `${await readFile(selfOnlyPath, "utf8")}\n`, "utf8");
  await assert.rejects(
    loadInputCatalog(selfOnlyPath),
    /authoritative SHA-256 mismatch/u,
  );
});

async function writeAuthorityFixture(extraAssets: Array<Record<string, unknown>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "maxpower-governance-gate-"));
  const localPath = join(root, "maxpower/tools/motion-quality/data-governance-inputs.json");
  const authorityPath = join(root, "maxpower-training-data-governance/catalog/assets.json");
  await Promise.all([mkdir(dirname(localPath), { recursive: true }), mkdir(dirname(authorityPath), { recursive: true })]);

  const local = JSON.parse(await readFile(LOCAL_CATALOG_PATH, "utf8")) as Record<string, unknown>;
  await writeFile(localPath, `${JSON.stringify(local, null, 2)}\n`, "utf8");
  const localBytes = await readFile(localPath);
  const realAuthority = JSON.parse(await readFile(AUTHORITY_CATALOG_PATH, "utf8")) as {
    schemaVersion: string;
    catalogId: string;
    assets: Array<Record<string, unknown>>;
  };
  const self = realAuthority.assets.find((asset) => asset.id === "motion-quality-runner-input-catalog");
  assert.ok(self);
  const selfLocation = self.location as Record<string, unknown>;
  const fixture = {
    schemaVersion: realAuthority.schemaVersion,
    catalogId: realAuthority.catalogId,
    defaultRoots: { maxpower_source: "../maxpower", power_workspace: ".." },
    assets: [{
      ...self,
      location: {
        ...selfLocation,
        sha256: sha256(localBytes),
      },
    }, ...extraAssets],
  };
  await writeFile(authorityPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  return localPath;
}
