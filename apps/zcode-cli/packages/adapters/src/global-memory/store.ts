import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, rmdir, unlink } from "node:fs/promises";
import { dirname, join, parse, resolve, sep } from "node:path";
import type { GlobalMemoryPort, GlobalMemorySnapshot } from "@zcode/contracts";

const MAX_BYTES = 32_768;
const SENSITIVE_CONTENT =
  /(?:-----BEGIN|\b(?:password|passwd|api[_ -]?key|access[_ -]?token|secret|credential)\s*[:=]|\b(?:sk-|ghp_|github_pat_)[a-z0-9_-]{12,}|密码|密钥)/iu;
const DEFAULT_CONFIG = {
  enabled: true,
  extractionEnabled: true,
  generation: 0,
  disabledSessionIds: [] as string[],
};
type Config = Omit<GlobalMemorySnapshot, "content">;

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** Validate existing ancestors before mkdir/read so a profile link cannot escape its root. */
async function assertPlainPath(path: string, leaf: "file" | "directory"): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const component of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    try {
      const stat = await lstat(current);
      const last = current === absolute;
      if (
        stat.isSymbolicLink() ||
        !(last && leaf === "file" ? stat.isFile() : stat.isDirectory())
      ) {
        throw new Error("Unsafe global memory storage path");
      }
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  }
}

async function readText(path: string): Promise<string | undefined> {
  await assertPlainPath(path, "file");
  try {
    const handle = await open(path, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES)
        throw new Error("Invalid global memory file size");
      const current = await lstat(path);
      if (
        !current.isFile() ||
        current.isSymbolicLink() ||
        current.dev !== stat.dev ||
        current.ino !== stat.ino
      ) {
        throw new Error("Global memory file changed during open");
      }
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_BYTES) throw new Error("Global memory size limit exceeded");
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

function decodeConfig(raw: string | undefined): Config {
  if (raw === undefined) return { ...DEFAULT_CONFIG, disabledSessionIds: [] };
  const config: unknown = JSON.parse(raw);
  if (
    typeof config !== "object" ||
    config === null ||
    !("enabled" in config) ||
    typeof config.enabled !== "boolean" ||
    !("extractionEnabled" in config) ||
    typeof config.extractionEnabled !== "boolean" ||
    !("generation" in config) ||
    !Number.isSafeInteger(config.generation) ||
    (config.generation as number) < 0 ||
    ("disabledSessionIds" in config &&
      (!Array.isArray(config.disabledSessionIds) ||
        !config.disabledSessionIds.every((id) => typeof id === "string")))
  )
    throw new Error("Invalid global memory configuration");
  return {
    enabled: config.enabled,
    extractionEnabled: config.extractionEnabled,
    generation: config.generation as number,
    disabledSessionIds:
      "disabledSessionIds" in config ? (config.disabledSessionIds as string[]) : [],
  };
}

async function assertUnlocked(lockPath: string): Promise<void> {
  try {
    await lstat(lockPath);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  throw new Error("Global memory is busy");
}

async function atomicWrite(path: string, content: string): Promise<void> {
  if (Buffer.byteLength(content, "utf8") > MAX_BYTES)
    throw new Error("Global memory size limit exceeded");
  await assertPlainPath(path, "file");
  const temporary = join(dirname(path), `.global-memory-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await assertPlainPath(path, "file");
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
    });
  }
}

export function createNodeGlobalMemoryStore(input: { cliStorageRoot: string }): GlobalMemoryPort {
  const root = join(resolve(input.cliStorageRoot), "memories", "global");
  const memoryDirectory = join(root, "memory");
  const contentPath = join(memoryDirectory, "MEMORY.md");
  const configPath = join(root, "config.json");
  const lockPath = join(root, ".write-lock");

  return {
    async read(options) {
      options?.signal?.throwIfAborted();
      await assertPlainPath(root, "directory");
      await assertUnlocked(lockPath);
      const config = decodeConfig(await readText(configPath));
      const content = (await readText(contentPath)) ?? "";
      const after = decodeConfig(await readText(configPath));
      await assertUnlocked(lockPath);
      if (after.generation !== config.generation)
        throw new Error("Global memory changed during read");
      options?.signal?.throwIfAborted();
      return { ...config, content };
    },
    async write(value, options) {
      options?.signal?.throwIfAborted();
      if (SENSITIVE_CONTENT.test(value.content))
        throw new Error("Sensitive global memory content rejected");
      if (!Number.isSafeInteger(value.expectedGeneration) || value.expectedGeneration < 0) {
        throw new Error("Invalid global memory generation");
      }
      if (Buffer.byteLength(value.content, "utf8") > MAX_BYTES) {
        throw new Error("Global memory size limit exceeded");
      }
      await assertPlainPath(memoryDirectory, "directory");
      await mkdir(memoryDirectory, { recursive: true, mode: 0o700 });
      await assertPlainPath(memoryDirectory, "directory");
      await mkdir(lockPath, { mode: 0o700 });
      try {
        const config = decodeConfig(await readText(configPath));
        if (
          !config.enabled ||
          !config.extractionEnabled ||
          config.generation !== value.expectedGeneration ||
          (value.sessionId !== undefined && config.disabledSessionIds.includes(value.sessionId))
        )
          return false;
        if (config.generation === Number.MAX_SAFE_INTEGER)
          throw new Error("Global memory generation exhausted");
        options?.signal?.throwIfAborted();
        // 先推进世代：删除/暂停后旧的在途抽取永远不能重新获得写入资格。
        await atomicWrite(
          configPath,
          JSON.stringify({ ...config, generation: config.generation + 1 }),
        );
        await atomicWrite(contentPath, value.content);
        return true;
      } finally {
        await rmdir(lockPath);
      }
    },
  };
}
