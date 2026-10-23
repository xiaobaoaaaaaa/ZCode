import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repo = resolve(import.meta.dirname, "../..");
const seed = resolve(repo, "scripts/personal-mock-renderer-seed.mjs");
test("synthetic renderer profile uses validated BYOK settings and never seeds official credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "personal-mock-seed-test-"));
  try {
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", seed, root, "http://127.0.0.1:12345", join(root, "workspace")],
      { cwd: repo, encoding: "utf8" },
    );
    assert.equal(child.status, 0, child.stderr);
    const settings = JSON.parse(
      await readFile(join(root, ".zcode-personal/v2/setting.json"), "utf8"),
    );
    assert.equal(settings.locale, "en-US");
    assert.equal(settings.memoryEnabled, false);
    assert.deepEqual(settings.lastWorkspaceSession, [
      { kind: "local", workspacePath: join(root, "workspace"), workspacePurpose: "project" },
    ]);
    const provider = JSON.parse(
      await readFile(join(root, ".zcode-personal/v2/provider_config.json"), "utf8"),
    );
    assert.deepEqual(provider.config.defaultModelSelection, {
      providerId: "personal-mock",
      modelId: "mock-main",
      options: { reasoningLevel: "disabled" },
    });
    assert.ok(JSON.stringify(provider).includes("http://127.0.0.1:12345"));
    assert.ok(!JSON.stringify(provider).includes("account:"));
    await assert.rejects(readFile(join(root, ".zcode-personal/v2/credentials.json")), {
      code: "ENOENT",
    });
    const memory = JSON.parse(
      await readFile(join(root, ".zcode-personal/cli/memories/global/config.json"), "utf8"),
    );
    assert.equal(memory.enabled, false);
    assert.equal(memory.extractionEnabled, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("renderer seed rejects non-loopback and credential-bearing endpoint configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "personal-mock-seed-reject-"));
  try {
    for (const url of [
      "https://example.com",
      "http://localhost:12345",
      "http://token@127.0.0.1:12345",
      "http://127.0.0.1:12345?token=x",
    ]) {
      const child = spawnSync(
        process.execPath,
        ["--import", "tsx", seed, root, url, join(root, "workspace")],
        { cwd: repo, encoding: "utf8" },
      );
      assert.notEqual(child.status, 0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
