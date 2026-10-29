import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export function importedProfileFile(bootstrapHome: string): string {
  return join(bootstrapHome, ".zcode", "import-profile.json");
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
    if (!statSync(join(profile.dataBaseDir, ".zcode", "v2", "setting.json")).isFile()) return null;
    return profile.dataBaseDir;
  } catch {
    return null;
  }
}

export function applyImportedProfileEnvironment(
  baseDir: string,
  env: Record<string, string | undefined> = process.env,
): void {
  const root = join(baseDir, ".zcode");
  env.ZCODE_PROFILE_BASE_DIR = baseDir;
  env.ZCODE_DATA_BASE_DIR = baseDir;
  env.ZCODE_STORAGE_DIR = root;
  env.ZCODE_SESSION_DB_PATH = join(root, "cli", "db", "db.sqlite");
  env.ZCODE_LOG_DIR = join(root, "cli", "log");
}
