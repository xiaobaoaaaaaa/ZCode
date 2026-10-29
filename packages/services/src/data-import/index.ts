import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { appSettingsSchema } from "@zcode/shared";
import type {
  DataImportOptions,
  ZCodeDataImportRequest,
  ZCodeDataImportResult,
} from "./contract.js";
import { importedProfileFile } from "./profile.js";
import { copySnapshot, ImportFailure, snapshotTree } from "./snapshot.js";
import { prepareImportedCopy } from "./prepareCopy.js";

export { readImportedProfile, applyImportedProfileEnvironment } from "./profile.js";

function inside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
}

async function validateSourceStorage(source: string): Promise<void> {
  let config: { storage?: { dir?: unknown; sessionDbPath?: unknown } };
  try {
    config = JSON.parse(await readFile(join(source, "cli", "config.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new ImportFailure("invalid-source");
  }
  if (
    !config ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    (config.storage !== undefined &&
      (!config.storage || typeof config.storage !== "object" || Array.isArray(config.storage)))
  )
    throw new ImportFailure("invalid-source");
  const paths: [unknown, string][] = [
    [config.storage?.dir, source],
    [config.storage?.sessionDbPath, join(source, "cli", "db", "db.sqlite")],
  ];
  for (const [configured, expected] of paths) {
    if (configured === undefined) continue;
    if (typeof configured !== "string") throw new ImportFailure("invalid-source");
    const expanded =
      configured === "~/.zcode" || configured.startsWith("~/.zcode/")
        ? join(source, configured.slice("~/.zcode".length))
        : configured;
    if (!isAbsolute(expanded) || relative(resolve(expanded), expected) !== "")
      throw new ImportFailure("invalid-source");
  }
}

async function resolveSource(directory: string): Promise<string> {
  for (const candidate of [directory, join(directory, ".zcode")]) {
    try {
      const path = join(candidate, "v2", "setting.json");
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      if (!appSettingsSchema.safeParse(value).success) throw new ImportFailure("invalid-source");
      const source = await realpath(candidate);
      const configuredBase = (value as { dataBaseDir?: unknown }).dataBaseDir;
      if (
        typeof configuredBase === "string" &&
        configuredBase.trim() &&
        (await realpath(join(configuredBase.trim(), ".zcode"))) !== source
      )
        throw new ImportFailure("invalid-source");
      if (!(await stat(join(source, "v2"))).isDirectory()) continue;
      await validateSourceStorage(source);
      return source;
    } catch (error) {
      if (error instanceof ImportFailure) throw error;
    }
  }
  throw new ImportFailure("invalid-source");
}

export function createDataImporter(options: DataImportOptions) {
  let running = false;
  return {
    async importDirectory(request: ZCodeDataImportRequest): Promise<ZCodeDataImportResult> {
      if (running) return { ok: false, error: "busy" };
      running = true;
      let target: string | undefined;
      let pointerTemp: string | undefined;
      try {
        if (
          !request ||
          typeof request.sourceDirectory !== "string" ||
          typeof request.destinationParent !== "string" ||
          !isAbsolute(request.sourceDirectory) ||
          !isAbsolute(request.destinationParent)
        )
          throw new ImportFailure("unsafe-path");
        const source = await resolveSource(request.sourceDirectory);
        const parent = await realpath(request.destinationParent);
        const current = await realpath(options.currentDataRoot);
        if (
          inside(parent, source) ||
          inside(source, current) ||
          inside(current, source) ||
          inside(parent, current)
        )
          throw new ImportFailure("unsafe-path");
        const files = await snapshotTree(source);
        const bytes = files.reduce((sum, file) => sum + file.size, 0);
        const space = await statfs(parent);
        if (space.bavail * space.bsize < bytes + 32 * 1024 * 1024) throw new Error("space");
        target = await mkdtemp(join(parent, "zcode-import-"));
        await copySnapshot(source, join(target, ".zcode"), files);
        await prepareImportedCopy(source, target, files);
        const pointer = importedProfileFile(options.bootstrapHome);
        await mkdir(dirname(pointer), { recursive: true, mode: 0o700 });
        pointerTemp = pointer + "." + randomUUID() + ".tmp";
        await writeFile(pointerTemp, JSON.stringify({ version: 1, dataBaseDir: target }), {
          flag: "wx",
          mode: 0o600,
          flush: true,
        });
        await rename(pointerTemp, pointer);
        return {
          ok: true,
          dataBaseDir: target,
          fileCount: files.filter((file) => file.kind === "file").length,
          bytes,
        };
      } catch (error) {
        if (pointerTemp) await rm(pointerTemp, { force: true }).catch(() => {});
        if (target) await rm(target, { recursive: true, force: true }).catch(() => {});
        return { ok: false, error: error instanceof ImportFailure ? error.code : "copy-failed" };
      } finally {
        running = false;
      }
    },
  };
}
