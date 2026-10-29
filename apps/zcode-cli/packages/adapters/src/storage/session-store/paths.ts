import { homedir } from "node:os";
import { join } from "node:path";

export function getDefaultSessionDbPath(): string {
  return join(process.env.ZCODE_PROFILE_ROOT_DIR || join(process.env.ZCODE_PROFILE_BASE_DIR || homedir(), ".zcode"), "cli", "db", "db.sqlite");
}
