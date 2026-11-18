import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { getE2EAppDataPaths } from "./desktop-app.js";

export function resolveE2EProjectMemoryRoot(workspacePath: string) {
  const normalizedWorkspace = resolve(workspacePath);
  const key =
    process.platform === "win32" ? normalizedWorkspace.toLowerCase() : normalizedWorkspace;
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
  const slug = basename(normalizedWorkspace)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return join(
    getE2EAppDataPaths().storageRoot,
    "cli",
    "memories",
    "projects",
    `${slug || "project"}-${hash}`,
    "memory",
  );
}
