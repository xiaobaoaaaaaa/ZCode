import { ZCODE_DATA_DIR_NAME } from "@zcode/shared/env";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export function importedProfileFile(bootstrapHome: string): string {
  return join(bootstrapHome, ZCODE_DATA_DIR_NAME, "import-profile.json");
}

/** 启动前同步读取：必须早于 logger/setting/Host 初始化，运行时不能切换。 */
export function readImportedProfile(bootstrapHome: string): string | null {
  try {
    const value: unknown = JSON.parse(readFileSync(importedProfileFile(bootstrapHome), "utf8"));
    if (!value || typeof value !== "object") return null;
    const profile = value as { version?: unknown; dataBaseDir?: unknown };
    if (
      profile.version !== 1 ||
      typeof profile.dataBaseDir !== "string" ||
      !isAbsolute(profile.dataBaseDir)
    )
      return null;
    if (!statSync(join(profile.dataBaseDir, ZCODE_DATA_DIR_NAME, "v2", "setting.json")).isFile())
      return null;
    return profile.dataBaseDir;
  } catch {
    return null;
  }
}

export function applyImportedProfileEnvironment(
  baseDir: string,
  env: Record<string, string | undefined> = process.env,
): void {
  env.ZCODE_PROFILE_BASE_DIR = baseDir;
  env.ZCODE_DATA_BASE_DIR = baseDir;
  applyStorageEnvironment(baseDir, env);
}

/** Personal 启动不读取官方 profile，也不通过改变 HOME 隔离配置。 */
export function applyPersonalDataEnvironment(
  baseDir: string,
  env: Record<string, string | undefined> = process.env,
): void {
  env.ZCODE_DATA_BASE_DIR ||= baseDir;
  applyStorageEnvironment(baseDir, env);
}

function applyStorageEnvironment(baseDir: string, env: Record<string, string | undefined>): void {
  const root = join(baseDir, ZCODE_DATA_DIR_NAME);
  env.ZCODE_PROFILE_ROOT_DIR = root;
  env.ZCODE_HOME = root;
  env.ZCODE_STORAGE_DIR = root;
  env.ZCODE_SESSION_DB_PATH = join(root, "cli", "db", "db.sqlite");
  env.ZCODE_LOG_DIR = join(root, "cli", "log");
}
