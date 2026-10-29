import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyImportedProfileEnvironment, readImportedProfile } from "./index.js";

describe("imported profile startup contract", () => {
  it("sets only application paths and preserves system home and unrelated environment", () => {
    const base = join(tmpdir(), "profile");
    const env = { HOME: "/original", USERPROFILE: "/original-windows", PATH: "original-path" };
    applyImportedProfileEnvironment(base, env);
    expect(env).toEqual({
      HOME: "/original",
      USERPROFILE: "/original-windows",
      PATH: "original-path",
      ZCODE_PROFILE_BASE_DIR: base,
      ZCODE_DATA_BASE_DIR: base,
      ZCODE_STORAGE_DIR: join(base, ".zcode"),
      ZCODE_SESSION_DB_PATH: join(base, ".zcode", "cli", "db", "db.sqlite"),
      ZCODE_LOG_DIR: join(base, ".zcode", "cli", "log"),
    });
  });

  it("ignores invalid or unavailable startup selections", async () => {
    const home = await mkdtemp(join(tmpdir(), "zcode-profile-contract-"));
    try {
      await mkdir(join(home, ".zcode"));
      for (const value of [
        "invalid json",
        JSON.stringify({ version: 1, dataBaseDir: "relative" }),
        JSON.stringify({ version: 1, dataBaseDir: join(home, "missing") }),
        JSON.stringify({ version: 2, dataBaseDir: home }),
      ]) {
        await writeFile(join(home, ".zcode", "import-profile.json"), value);
        expect(readImportedProfile(home)).toBeNull();
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
