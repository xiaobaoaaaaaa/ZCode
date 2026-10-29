import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const targets = Object.freeze({
  "win-x64": { platform: "win32", arch: "x64", extensions: ["exe"] },
  "mac-x64": { platform: "darwin", arch: "x64", extensions: ["dmg", "zip"] },
  "mac-arm64": { platform: "darwin", arch: "arm64", extensions: ["dmg", "zip"] },
  "linux-x64": {
    platform: "linux",
    arch: "x64",
    extensions: ["AppImage", "deb", "rpm", "pkg.tar.zst"],
    artifactArchitectures: {
      AppImage: "x86_64",
      deb: "amd64",
      rpm: "x86_64",
      "pkg.tar.zst": "x64",
    },
  },
  "linux-arm64": {
    platform: "linux",
    arch: "arm64",
    extensions: ["AppImage", "deb", "rpm", "pkg.tar.zst"],
    artifactArchitectures: {
      AppImage: "arm64",
      deb: "arm64",
      rpm: "aarch64",
      "pkg.tar.zst": "aarch64",
    },
  },
});

export function expectedFiles(version, target) {
  assert.match(version, /^\d+\.\d+\.\d+-personal\.[1-9]\d*$/u, "invalid personal version");
  assert.ok(Object.hasOwn(targets, target), `unsupported target: ${target}`);
  const config = targets[target];
  // Electron Builder 按包格式转换架构名称，必须收集真实产物名，不能统一假定为 runner 的 arch。
  return config.extensions.map((extension) => {
    const arch = config.artifactArchitectures?.[extension] ?? config.arch;
    return `ZCode-${version}-${target.split("-")[0]}-${arch}.${extension}`;
  });
}

async function digest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function inspectPackage(path, name) {
  const info = await stat(path);
  assert.ok(
    info.isFile() && info.size > 0 && info.size <= 500 * 1024 * 1024,
    `invalid package size: ${name}`,
  );
  const file = await open(path, "r");
  try {
    const header = Buffer.alloc(8);
    await file.read(header, 0, 8, 0);
    const expected = name.endsWith(".exe")
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
    if (name.endsWith(".dmg")) {
      assert.ok(info.size >= 512, `invalid DMG: ${name}`);
      const trailer = Buffer.alloc(4);
      await file.read(trailer, 0, 4, info.size - 512);
      assert.equal(trailer.toString(), "koly", `invalid DMG trailer: ${name}`);
    } else {
      assert.ok(header.toString("hex").startsWith(expected), `invalid package header: ${name}`);
    }
  } finally {
    await file.close();
  }
  return { name, size: info.size, sha256: await digest(path) };
}

function validateSmoke(smoke, version, target) {
  assert.equal(smoke.ok, true, "missing successful startup check");
  assert.equal(smoke.version, version, "startup version mismatch");
  assert.equal(smoke.platform, targets[target].platform, "startup platform mismatch");
  assert.equal(smoke.arch, targets[target].arch, "startup architecture mismatch");
  assert.equal(smoke.homeIsolated, true, "startup home must be isolated");
  assert.equal(smoke.userDataIsolated, true, "startup userData must be isolated");
}

export async function stageTarget(source, destination, { version, target, commit, smokeFile }) {
  const names = expectedFiles(version, target);
  assert.match(commit, /^[a-f0-9]{40}$/u, "invalid source commit");
  const smoke = JSON.parse(await readFile(smokeFile, "utf8"));
  validateSmoke(smoke, version, target);
  await mkdir(destination, { recursive: true });
  const files = [];
  for (const name of names) {
    files.push(await inspectPackage(join(source, name), name));
    await copyFile(join(source, name), join(destination, name));
  }
  await writeFile(
    join(destination, "build.json"),
    `${JSON.stringify({ version, commit, target, smoke, files }, null, 2)}\n`,
  );
}

export async function collectRelease(source, destination, { version, commit }) {
  const result = { version, commit, builds: [], assets: [] };
  await mkdir(destination, { recursive: true });
  for (const target of Object.keys(targets)) {
    const expected = expectedFiles(version, target);
    const directory = join(source, `packages-${target}`);
    const build = JSON.parse(await readFile(join(directory, "build.json"), "utf8"));
    assert.ok(
      build.commit === commit && build.version === version && build.target === target,
      `invalid build provenance: ${target}`,
    );
    assert.deepEqual(
      build.files.map((file) => file.name).sort(),
      [...expected].sort(),
      `incomplete target: ${target}`,
    );
    validateSmoke(build.smoke, version, target);
    for (const name of expected) {
      const record = await inspectPackage(join(directory, name), name);
      assert.deepEqual(
        record,
        build.files.find((file) => file.name === name),
        `package digest mismatch: ${name}`,
      );
      await copyFile(join(directory, name), join(destination, name));
      result.assets.push(record);
    }
    result.builds.push({ target, smoke: build.smoke });
  }
  const manifest = "release-manifest.json";
  await writeFile(join(destination, manifest), `${JSON.stringify(result, null, 2)}\n`);
  const checksums = [
    ...result.assets.map((file) => `${file.sha256}  ${file.name}`),
    `${await digest(join(destination, manifest))}  ${manifest}`,
  ];
  await writeFile(join(destination, "SHA256SUMS"), `${checksums.join("\n")}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, source, destination, target, smokeFile] = process.argv.slice(2);
  const { version } = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const commit = process.env.GITHUB_SHA;
  if (command === "stage")
    await stageTarget(source, destination, { version, commit, target, smokeFile });
  else if (command === "collect") await collectRelease(source, destination, { version, commit });
  else
    throw new Error(
      "Usage: personal-release.mjs stage <source> <destination> <target> <smoke.json> | collect <source> <destination>",
    );
}
