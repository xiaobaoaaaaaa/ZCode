import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, rmdir, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { readProjectMemoryFileFromStableHandle } from "../memory/projectMemoryStableRead.js";
import type {
  PersonalProfileImportContract,
  ProfileImportPreview,
  ProfileImportReport,
} from "./contract.js";

interface Snapshot {
  projects: Map<string, Map<string, string>>;
  files: number;
  bytes: number;
  digest: string;
}
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";
function safeName(name: string): boolean {
  return (
    /^[a-zA-Z0-9_.-]+$/.test(name) &&
    !/[. ]$/.test(name) &&
    name !== "." &&
    name !== ".." &&
    !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)
  );
}
async function plainAncestors(path: string, allowMissing = false): Promise<void> {
  let current = resolve(path);
  for (;;) {
    try {
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error(`Unsafe directory: ${current}`);
    } catch (e) {
      if (!(allowMissing && missing(e))) throw e;
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
async function ensureDirectory(path: string): Promise<void> {
  await plainAncestors(path, true);
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (e) {
    if (missing(e)) {
      await ensureDirectory(dirname(path));
      await mkdir(path, { mode: 0o700 }).catch(async (reason) => {
        if ((reason as NodeJS.ErrnoException).code !== "EEXIST") throw reason;
      });
    } else if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  await plainAncestors(path);
}
async function snapshot(source: string): Promise<Snapshot> {
  const root = join(source, "cli", "memories", "projects");
  await plainAncestors(root);
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.length > 100) throw new Error("Import exceeds 100 projects");
  const result: Snapshot = {
    projects: new Map(),
    files: 0,
    bytes: 0,
    digest: "",
  };
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      !/^[a-z0-9._-]+-[a-f0-9]{16}$/.test(entry.name) ||
      !safeName(entry.name)
    )
      throw new Error(`Unsupported project layout: ${entry.name}`);
    const memory = join(root, entry.name, "memory");
    await plainAncestors(memory);
    const files = await readdir(memory, { withFileTypes: true });
    if (files.length > 500) throw new Error("Import exceeds file limit");
    const markdown = new Map<string, string>();
    const seen = new Set<string>();
    for (const file of files.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (file.isSymbolicLink()) throw new Error(`Symbolic link is not supported: ${file.name}`);
      if (!file.name.endsWith(".md")) continue;
      if (!file.isFile() || !safeName(file.name) || seen.has(file.name.toLowerCase()))
        throw new Error(`Unsafe or ambiguous Markdown filename: ${file.name}`);
      seen.add(file.name.toLowerCase());
      const { content } = await readProjectMemoryFileFromStableHandle({
        fileName: file.name,
        filePath: join(memory, file.name),
        maxBytes: 256 * 1024,
        validatePath: () => plainAncestors(memory),
      });
      if (
        content.includes("\uFFFD") ||
        /-----BEGIN (?:\w+ )?PRIVATE KEY-----|(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/.test(
          content,
        )
      )
        throw new Error(
          `Sensitive or invalid Markdown must be removed before import: ${file.name}`,
        );
      result.bytes += Buffer.byteLength(content);
      result.files++;
      if (result.bytes > 8 * 1024 * 1024 || result.files > 500)
        throw new Error("Import exceeds 8 MiB / 500 files");
      markdown.set(file.name, content);
    }
    if (!markdown.has("MEMORY.md"))
      throw new Error(`Unsupported project layout (missing MEMORY.md): ${entry.name}`);
    result.projects.set(entry.name, markdown);
  }
  result.digest = createHash("sha256")
    .update(JSON.stringify([...result.projects].map(([id, files]) => [id, [...files]])))
    .digest("hex");
  return result;
}
function overlaps(a: string, b: string): boolean {
  const rel = relative(a, b);
  return !rel || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function createProfileImporter(destination: () => string): PersonalProfileImportContract {
  let busy = false;
  let lease: { preview: ProfileImportPreview; snapshot: Snapshot; expires: number } | undefined;
  return {
    async previewProfileImport(params) {
      if (busy) throw new Error("Import operation is already running");
      if (!params || typeof params.source !== "string" || !isAbsolute(params.source))
        throw new Error("Select an absolute official profile path");
      busy = true;
      lease = undefined;
      try {
        const source = resolve(params.source);
        const target = resolve(destination());
        if (overlaps(source, target) || overlaps(target, source))
          throw new Error("Source and personal profile must be separate");
        const data = await snapshot(source);
        const preview = {
          source,
          token: randomUUID(),
          projects: data.projects.size,
          files: data.files,
          bytes: data.bytes,
        };
        lease = { preview, snapshot: data, expires: Date.now() + 10 * 60_000 };
        return preview;
      } finally {
        busy = false;
      }
    },
    async confirmProfileImport(params) {
      if (busy) throw new Error("Import operation is already running");
      const current = lease;
      if (
        !current ||
        !params ||
        typeof params.token !== "string" ||
        params.token !== current.preview.token ||
        Date.now() > current.expires
      )
        throw new Error("Preview expired; preview the source again");
      lease = undefined;
      busy = true;
      const createdFiles: Array<{
        path: string;
        ino: number;
        dev: number;
        mtimeMs: number;
        size: number;
      }> = [];
      const createdDirs: string[] = [];
      try {
        const data = await snapshot(current.preview.source);
        if (data.digest !== current.snapshot.digest)
          throw new Error("Source changed; close the official app and preview again");
        const target = resolve(destination());
        if (overlaps(current.preview.source, target) || overlaps(target, current.preview.source))
          throw new Error("Source and personal profile must be separate");
        const root = join(target, "cli", "memories", "projects");
        await ensureDirectory(root);
        const report: ProfileImportReport = {
          imported: 0,
          duplicates: 0,
          conflicts: [],
        };
        for (const [id, files] of data.projects) {
          await plainAncestors(root);
          const existing = (await readdir(root)).find(
            (name) => name.toLowerCase() === id.toLowerCase(),
          );
          if (existing) {
            let duplicate = existing === id;
            try {
              const memory = join(root, existing, "memory");
              await plainAncestors(memory);
              const names = await readdir(memory);
              duplicate &&= names.length === files.size;
              for (const [name, text] of files) {
                const result = await readProjectMemoryFileFromStableHandle({
                  fileName: name,
                  filePath: join(memory, name),
                  maxBytes: 256 * 1024,
                  validatePath: () => plainAncestors(memory),
                });
                duplicate &&= result.content === text;
              }
            } catch {
              duplicate = false;
            }
            if (duplicate) report.duplicates++;
            else report.conflicts.push(id);
            continue;
          }
          const workspace = join(root, id);
          try {
            await mkdir(workspace, { mode: 0o700 });
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "EEXIST") {
              report.conflicts.push(id);
              continue;
            }
            throw e;
          }
          createdDirs.push(workspace);
          const memory = join(workspace, "memory");
          await mkdir(memory, { mode: 0o700 });
          createdDirs.push(memory);
          for (const [name, content] of files) {
            await plainAncestors(memory);
            const path = join(memory, name);
            const handle = await open(path, "wx", 0o600);
            const initial = await handle.stat();
            const owned = {
              path,
              ino: initial.ino,
              dev: initial.dev,
              mtimeMs: initial.mtimeMs,
              size: initial.size,
            };
            createdFiles.push(owned);
            try {
              await handle.writeFile(content);
            } finally {
              const stat = await handle.stat();
              owned.mtimeMs = stat.mtimeMs;
              owned.size = stat.size;
              await handle.close();
            }
          }
          report.imported++;
        }
        return report;
      } catch (error) {
        const recovery: string[] = [];
        for (const file of createdFiles.reverse()) {
          try {
            await plainAncestors(dirname(file.path));
            const stat = await lstat(file.path);
            if (
              stat.ino !== file.ino ||
              stat.dev !== file.dev ||
              stat.mtimeMs !== file.mtimeMs ||
              stat.size !== file.size ||
              stat.isSymbolicLink()
            )
              throw new Error("File changed");
            await unlink(file.path);
          } catch (e) {
            if (!missing(e)) recovery.push(file.path);
          }
        }
        for (const path of createdDirs.reverse()) {
          try {
            await plainAncestors(path);
            await rmdir(path);
          } catch (e) {
            if (!missing(e)) recovery.push(path);
          }
        }
        if (recovery.length)
          throw new Error(
            `Import failed; inspect personal-profile partial copies: ${recovery.join(", ")}. ${String(error)}`,
          );
        throw error;
      } finally {
        busy = false;
      }
    },
  };
}
