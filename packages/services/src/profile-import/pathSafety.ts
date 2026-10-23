import { lstat, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";
export async function plainAncestors(path: string, allowMissing = false): Promise<void> {
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
export async function ensureDirectory(path: string): Promise<void> {
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
export function overlaps(a: string, b: string): boolean {
  const rel = relative(a, b);
  return !rel || (!rel.startsWith("..") && !isAbsolute(rel));
}
