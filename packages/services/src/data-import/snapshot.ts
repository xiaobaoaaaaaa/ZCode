import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export class ImportFailure extends Error {
  constructor(
    readonly code: "invalid-source" | "unsafe-path" | "source-changed" | "invalid-database",
  ) {
    super(code);
  }
}

export interface SnapshotFile {
  kind: "file" | "directory";
  path: string;
  size: number;
  hash: string;
  mtimeMs: number;
  mode: number;
}

async function digest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function transient(name: string, prefix: string): boolean {
  // 只排除应用运行文件；workspace 中的 Cargo.lock / yarn.lock 也是用户数据。
  return (
    (prefix === "" && name === "import-profile.json") ||
    /\.(sqlite|sqlite3|db)-shm$/.test(name) ||
    (["v2", "cli"].includes(prefix) && name.endsWith(".json.lock"))
  );
}

export async function snapshotTree(root: string, prefix = ""): Promise<SnapshotFile[]> {
  const files: SnapshotFile[] = [];
  for (const name of (await readdir(join(root, prefix))).sort()) {
    if (transient(name, prefix)) continue;
    const path = join(prefix, name);
    const fullPath = join(root, path);
    const stat = await lstat(fullPath);
    if (stat.isSymbolicLink()) throw new ImportFailure("unsafe-path");
    if (stat.isSocket()) continue;
    if (stat.isDirectory()) {
      files.push({ kind: "directory", path, size: 0, hash: "", mtimeMs: 0, mode: stat.mode });
      files.push(...(await snapshotTree(root, path)));
    } else if (stat.isFile())
      files.push({
        kind: "file",
        path,
        size: stat.size,
        hash: await digest(fullPath),
        mtimeMs: stat.mtimeMs,
        mode: stat.mode,
      });
    else throw new ImportFailure("unsafe-path");
  }
  return files;
}

export async function copySnapshot(
  source: string,
  target: string,
  files: SnapshotFile[],
): Promise<void> {
  for (const file of files) {
    const path = join(target, file.path);
    if (file.kind === "directory") {
      await mkdir(path, { recursive: true, mode: 0o700 });
      continue;
    }
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // COPYFILE_EXCL 保证即使目标被外部操作，也不覆盖既有文件。
    await copyFile(join(source, file.path), path, constants.COPYFILE_EXCL);
    if ((await digest(path)) !== file.hash) throw new ImportFailure("source-changed");
  }
  const after = await snapshotTree(source);
  if (JSON.stringify(after) !== JSON.stringify(files)) throw new ImportFailure("source-changed");
}
