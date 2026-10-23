import { homedir } from "node:os";
import { join } from "node:path";

export function getDefaultSessionDbPath(): string {
  return join(homedir(), ".zcode-personal", "cli", "db", "db.sqlite");
}
