import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { runCommand } from "./spawn-command.mjs";

export const previewRequiredFiles = [
  "ZCode Personal.exe",
  "resources/app.asar",
  "resources/glm/zcode.cjs",
  "resources/tools/ripgrep/rg.exe",
  "resources/tools/ugrep/ugrep.exe",
  "resources/app.asar.unpacked/node_modules/node-pty/prebuilds/win32-x64/pty.node",
  "resources/config/default.json",
  "resources/config/provider/zcode-builtin.json",
  "resources/THIRD-PARTY-NOTICES.md",
  "resources/licenses/electron/LICENSE",
  "resources/licenses/electron/LICENSES.chromium.html",
];

export function assertPreviewHost(
  env = process.env,
  platform = process.platform,
  arch = process.arch,
) {
  if (
    platform !== "win32" ||
    arch !== "x64" ||
    env.GITHUB_ACTIONS !== "true" ||
    env.RUNNER_ENVIRONMENT !== "github-hosted"
  ) {
    throw new Error("Preview execution requires an authorized GitHub-hosted Windows x64 runner");
  }
}

export async function verifyPreviewFiles(directory) {
  const entries = [];
  for (const file of previewRequiredFiles) {
    const path = resolve(directory, file);
    await access(path);
    const bytes = await readFile(path);
    if (!bytes.length) throw new Error(`Empty preview runtime asset: ${file}`);
    entries.push({
      file,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return entries;
}

export async function buildPreview() {
  assertPreviewHost();
  const root = resolve(import.meta.dirname, "..");
  const desktop = resolve(root, "packages/desktop");
  const output = resolve(desktop, "dist-personal-preview");
  const env = {
    ...process.env,
    ZCODE_ENV: "production",
    ZCODE_PREVIEW_IDENTITY: "0",
    ZCODE_TARGET_OS: "win32",
    ZCODE_TARGET_ARCH: "x64",
    ZCODE_DESKTOP_DIST_DIR: output,
    ZCODE_ENABLE_WINDOWS_SIGN: "0",
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
    PNPM_MAX_WORKERS: "1",
  };
  // 复用上游资产/afterPack 校验，不以 source-only 输出冒充可运行包，也不启用发布或安装器。
  runCommand("pnpm", ["prepare:runtime-assets"], { cwd: desktop, env });
  runCommand("pnpm", ["build:no-runtime-assets"], { cwd: desktop, env });
  runCommand(
    "pnpm",
    [
      "exec",
      "electron-builder",
      "--config",
      "electron-builder.config.js",
      "--win",
      "--x64",
      "--dir",
      "--publish",
      "never",
      "-c.electronDownload.mirror=https://github.com/electron/electron/releases/download/",
    ],
    { cwd: desktop, env },
  );
  const unpacked = resolve(output, "win-unpacked");
  const files = await verifyPreviewFiles(unpacked);
  for (const file of ["LICENSE", "NOTICE.md", "THIRD-PARTY-NOTICES.md"])
    await copyFile(resolve(root, file), resolve(unpacked, file));
  await mkdir(resolve(unpacked, "source-provenance"), { recursive: true });
  for (const file of ["inventory.json", "native-search/sources.json", "runtime/sources.json"]) {
    await copyFile(
      resolve(root, "third-party", file),
      resolve(unpacked, "source-provenance", file.replaceAll("/", "-")),
    );
  }
  await writeFile(
    resolve(unpacked, "PREVIEW-README.txt"),
    "Unofficial ZCode Personal Windows x64 preview candidate.\nExtract the whole directory; launch ZCode Personal.exe. Unsigned; no installer or formal release.\nUses personal data/protocol identity, not the official profile. No automatic official data import.\nComputer Use is unavailable in the open-source build. OAuth, remote runtime and full native acceptance are unverified.\nSee source-provenance/inventory.json for unresolved upstream notice/provenance review items.\n",
  );
  await writeFile(
    resolve(output, "preview-manifest.json"),
    JSON.stringify(
      {
        commit: process.env.GITHUB_SHA,
        electron: "41.0.3",
        signed: false,
        installer: false,
        computerUse: false,
        files,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildPreview();
