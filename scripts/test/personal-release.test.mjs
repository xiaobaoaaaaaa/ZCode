import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectRelease, expectedFiles, stageTarget, targets } from "../personal-release.mjs";

const version = "3.16.2-personal.1";
const commit = "a".repeat(40);

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "zcode-release-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [target, config] of Object.entries(targets)) {
    const source = join(root, "source", target);
    await mkdir(source, { recursive: true });
    for (const name of expectedFiles(version, target)) {
      const bytes = Buffer.alloc(1024);
      const header = name.endsWith(".exe")
        ? "4d5a"
        : name.endsWith(".zip")
          ? "504b0304"
          : name.endsWith(".rpm")
            ? "edabeedb"
            : name.endsWith(".deb")
              ? "213c617263683e0a"
              : name.endsWith(".zst")
                ? "28b52ffd"
                : "7f454c46";
      Buffer.from(header, "hex").copy(bytes);
      if (name.endsWith(".dmg")) bytes.write("koly", bytes.length - 512);
      await writeFile(join(source, name), bytes);
    }
    const smokeFile = join(source, "smoke.json");
    await writeFile(
      smokeFile,
      JSON.stringify({
        ok: true,
        welcomeReady: true,
        version,
        platform: config.platform,
        arch: config.arch,
        homeIsolated: true,
        userDataIsolated: true,
      }),
    );
    await stageTarget(source, join(root, "input", `packages-${target}`), {
      version,
      commit,
      target,
      smokeFile,
    });
  }
  return root;
}

test("complete native matrix produces 13 packages and checksums", async (t) => {
  const root = await fixture(t);
  const result = await collectRelease(join(root, "input"), join(root, "ready"), {
    version,
    commit,
  });
  assert.equal(result.assets.length, 13);
  assert.equal(result.builds.length, 5);
  const sums = await readFile(join(root, "ready", "SHA256SUMS"), "utf8");
  assert.equal(sums.trim().split("\n").length, 14);
  assert.match(sums, /release-manifest\.json/u);
});

test("incomplete matrix cannot be published", async (t) => {
  const root = await fixture(t);
  await rm(join(root, "input", "packages-win-x64"), { recursive: true });
  await assert.rejects(
    collectRelease(join(root, "input"), join(root, "ready"), { version, commit }),
    /ENOENT/u,
  );
});

test("initialization-only screenshot cannot satisfy the startup gate", async (t) => {
  const root = await fixture(t);
  const file = join(root, "input", "packages-linux-arm64", "build.json");
  const build = JSON.parse(await readFile(file, "utf8"));
  build.smoke.welcomeReady = false;
  await writeFile(file, JSON.stringify(build));
  await assert.rejects(
    collectRelease(join(root, "input"), join(root, "ready"), { version, commit }),
    /welcome/u,
  );
});

test("modified package and mismatched source commit are rejected", async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    collectRelease(join(root, "input"), join(root, "wrong"), { version, commit: "b".repeat(40) }),
    /provenance/u,
  );
  const name = expectedFiles(version, "win-x64")[0];
  await writeFile(join(root, "input", "packages-win-x64", name), Buffer.from("MZchanged"));
  await assert.rejects(
    collectRelease(join(root, "input"), join(root, "ready"), { version, commit }),
    /digest/u,
  );
});

test("unsupported versions and targets fail closed", () => {
  assert.throws(() => expectedFiles("../../escape", "linux-x64"), /version/u);
  assert.throws(() => expectedFiles(version, "linux-ia32"), /target/u);
});

test("Linux package names match native electron-builder architecture aliases", () => {
  assert.deepEqual(expectedFiles(version, "linux-x64"), [
    `ZCode-${version}-linux-x86_64.AppImage`,
    `ZCode-${version}-linux-amd64.deb`,
    `ZCode-${version}-linux-x86_64.rpm`,
    `ZCode-${version}-linux-x64.pkg.tar.zst`,
  ]);
  assert.deepEqual(expectedFiles(version, "linux-arm64"), [
    `ZCode-${version}-linux-arm64.AppImage`,
    `ZCode-${version}-linux-arm64.deb`,
    `ZCode-${version}-linux-aarch64.rpm`,
    `ZCode-${version}-linux-aarch64.pkg.tar.zst`,
  ]);
});
