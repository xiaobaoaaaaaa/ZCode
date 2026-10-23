import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  assertPreviewHost,
  previewRequiredFiles,
  verifyPreviewFiles,
} from "../personal-windows-preview.mjs";
import { smokeEnvironment } from "../personal-windows-smoke.mjs";
import YAML from "yaml";

test("smoke refuses local computers and non-Windows/arm runners", () => {
  const cloud = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted" };
  assert.doesNotThrow(() => assertPreviewHost(cloud, "win32", "x64"));
  for (const [env, os, arch] of [
    [{}, "win32", "x64"],
    [cloud, "linux", "x64"],
    [cloud, "win32", "arm64"],
    [{ ...cloud, RUNNER_ENVIRONMENT: "self-hosted" }, "win32", "x64"],
  ])
    assert.throws(() => assertPreviewHost(env, os, arch));
});

test("source-only and incomplete/native-empty packages cannot pass completeness", async () => {
  const root = await mkdtemp(join(tmpdir(), "preview-fixture-"));
  try {
    await assert.rejects(verifyPreviewFiles(root));
    for (const file of previewRequiredFiles) {
      const path = join(root, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "synthetic fixture");
    }
    const manifest = await verifyPreviewFiles(root);
    assert.equal(manifest.length, previewRequiredFiles.length);
    assert.ok(manifest.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));
    await writeFile(join(root, previewRequiredFiles[5]), "");
    await assert.rejects(verifyPreviewFiles(root), /Empty preview runtime/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("smoke child gets isolated product paths and no CI/auth credentials", () => {
  const env = smokeEnvironment(
    {
      Path: "system-path",
      SystemRoot: "Windows",
      GITHUB_TOKEN: "secret",
      ACTIONS_RUNTIME_TOKEN: "secret",
      HOME: "real-home",
      ZCODE_DATA_BASE_DIR: "real-profile",
    },
    "temporary-profile",
  );
  assert.equal(env.Path, "system-path");
  assert.equal(env.ZCODE_DATA_BASE_DIR, "temporary-profile");
  assert.equal(env.ZCODE_DESKTOP_HOME_DIR, "temporary-profile");
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.ACTIONS_RUNTIME_TOKEN, undefined);
  assert.equal(env.HOME, undefined);
});

test("manual workflow proposal preserves successful checks and uploads candidate only on success", async () => {
  const root = new URL("../../", import.meta.url);
  const current = YAML.parse(
    await readFile(new URL(".github/workflows/personal-validation.yml", root), "utf8"),
  );
  const proposal = YAML.parse(
    await readFile(new URL("docs/personal/windows-preview.workflow.txt", root), "utf8"),
  );
  assert.deepEqual(proposal.on, current.on);
  assert.deepEqual(proposal.permissions, { contents: "read" });
  const steps = proposal.jobs["windows-source-build"].steps;
  assert.deepEqual(
    steps.slice(0, current.jobs["windows-source-build"].steps.length),
    current.jobs["windows-source-build"].steps,
  );
  const smoke = steps.findIndex((step) => step.run === "node scripts/personal-windows-smoke.mjs");
  const upload = steps.findIndex((step) => step.with?.name === "personal-windows-x64-preview");
  assert.ok(smoke >= 0 && upload > smoke);
  assert.equal(steps[upload].if, undefined);
  assert.equal(steps.at(-1).if, "always()");
});
