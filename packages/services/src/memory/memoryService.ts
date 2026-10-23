import { createProfileImporter } from "../profile-import/index.js";
import type { Memory, MemoryConfig } from "@zcode/shared";
import {
  type IMemoryService,
  type GlobalMemorySnapshot,
  type ProjectMemoryFileSummary,
  type ProjectMemoryWorkspaceSummary,
} from "./memory.js";
import { lstat, mkdir, readFile, readdir, realpath, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readProjectMemoryFileFromStableHandle } from "#src/memory/projectMemoryStableRead.js";
import { getZCodeDataRootDir } from "#src/paths.js";

const PROJECT_MEMORY_INDEX_FILE_NAME = "MEMORY.md";
const PROJECT_MEMORY_DIRECTORY_NAME = "memory";
const PROJECT_KEY_SUFFIX_PATTERN = /^(.*)-[a-f0-9]{16}$/i;

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function getProjectMemoriesRoot(): string {
  return join(getZCodeDataRootDir(), "cli", "memories", "projects");
}

function isValidPathSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    basename(value) === value &&
    !value.includes("/") &&
    !value.includes("\\")
  );
}

function isProjectMemoryFileName(fileName: string): boolean {
  return (
    fileName === PROJECT_MEMORY_INDEX_FILE_NAME ||
    (fileName.endsWith(".md") && fileName !== PROJECT_MEMORY_INDEX_FILE_NAME)
  );
}

function resolveWorkspaceLabel(workspaceId: string): string {
  const slug = PROJECT_KEY_SUFFIX_PATTERN.exec(workspaceId)?.[1];
  return slug?.trim() || workspaceId;
}

async function isPlainDirectory(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isDirectory() && !metadata.isSymbolicLink();
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function requirePlainDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Project Memory directory is not a regular directory: ${path}`);
  }
}

async function requireProjectMemoriesRoot(): Promise<string> {
  const projectsRoot = getProjectMemoriesRoot();
  // 只校验 workspace 子目录时，projectsRoot symlink 会让 list/read 跟随到本地数据目录外。
  await requirePlainDirectory(projectsRoot);
  return projectsRoot;
}

async function requireExactProjectMemoryFile(
  memoryRoot: string,
  fileName: string,
): Promise<string> {
  const memoryEntries = await readdir(memoryRoot, { withFileTypes: true });
  const fileEntry = memoryEntries.find((entry) => entry.name === fileName);
  const requestedFilePath = join(memoryRoot, fileName);
  if (!fileEntry) {
    // 文件确实不存在时继续透传原始 ENOENT；只有大小写别名能命中时才拒绝读取。
    await lstat(requestedFilePath);
    throw new Error(`Project Memory file name does not match exactly: ${fileName}`);
  }
  if (!fileEntry.isFile() || fileEntry.isSymbolicLink()) {
    throw new Error(`Project Memory file is not a regular file: ${fileName}`);
  }
  return requestedFilePath;
}

async function assertContainedProjectMemoryPath(
  projectsRoot: string,
  targetPath: string,
): Promise<void> {
  const projectsRootRealPath = await realpath(projectsRoot);
  const targetRealPath = await realpath(targetPath);
  const relativePath = relative(projectsRootRealPath, targetRealPath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Project Memory path is outside the local profile: ${targetPath}`);
  }
}

function compareProjectMemoryFiles(
  left: ProjectMemoryFileSummary,
  right: ProjectMemoryFileSummary,
): number {
  if (left.kind !== right.kind) {
    return left.kind === "index" ? -1 : 1;
  }
  return left.name.localeCompare(right.name, "en");
}

function resolveUserHomeDir(): string {
  const envHome = process.env.HOME?.trim() || process.env.USERPROFILE?.trim();
  return envHome && envHome.length > 0 ? envHome : homedir();
}

function getUserMemoryDir(): string {
  return join(resolveUserHomeDir(), ".claude", "memory");
}

/**
 * 获取 agent 对应的 memory 文件名
 */
function getMemoryFileName(_agentId: string): string {
  // 目前只支持 MEMORY.md，后续可以根据 agent 类型扩展
  return "MEMORY.md";
}

const GLOBAL_MEMORY_MAX_BYTES = 32 * 1024;

async function globalMemoryRoot(): Promise<string> {
  const base = getZCodeDataRootDir();
  // 校验所有既有祖先，不能让 profile 的父目录链接绕过本地作用域。
  let ancestor = resolve(base);
  for (;;) {
    try {
      await requirePlainDirectory(ancestor);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  await mkdir(base, { recursive: true, mode: 0o700 });
  await requirePlainDirectory(base);
  let current = base;
  for (const segment of ["cli", "memories", "global", "memory"]) {
    current = join(current, segment);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await requirePlainDirectory(current);
  }
  return join(base, "cli", "memories", "global");
}

async function readGlobalText(path: string): Promise<string | undefined> {
  try {
    return (
      await readProjectMemoryFileFromStableHandle({
        fileName: basename(path),
        filePath: path,
        maxBytes: GLOBAL_MEMORY_MAX_BYTES,
        validatePath: async () => {
          await globalMemoryRoot();
        },
      })
    ).content;
  } catch (error) {
    if (isNotFoundError(error)) return undefined;
    throw error;
  }
}

async function readGlobalSnapshot(root: string): Promise<GlobalMemorySnapshot> {
  const raw = await readGlobalText(join(root, "config.json"));
  const config: unknown = raw === undefined ? {} : JSON.parse(raw);
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new Error("Invalid global memory configuration");
  const c = config as Partial<GlobalMemorySnapshot>;
  if (
    (raw !== undefined &&
      (typeof c.enabled !== "boolean" ||
        typeof c.extractionEnabled !== "boolean" ||
        !Number.isSafeInteger(c.generation))) ||
    (c.enabled !== undefined && typeof c.enabled !== "boolean") ||
    (c.extractionEnabled !== undefined && typeof c.extractionEnabled !== "boolean") ||
    (c.generation !== undefined && (!Number.isSafeInteger(c.generation) || c.generation < 0)) ||
    (c.disabledSessionIds !== undefined &&
      (!Array.isArray(c.disabledSessionIds) ||
        c.disabledSessionIds.some((id) => typeof id !== "string")))
  ) {
    throw new Error("Invalid global memory configuration");
  }
  return {
    content: (await readGlobalText(join(root, "memory", "MEMORY.md"))) ?? "",
    enabled: c.enabled ?? true,
    extractionEnabled: c.extractionEnabled ?? true,
    generation: c.generation ?? 0,
    disabledSessionIds: c.disabledSessionIds ?? [],
  };
}

async function atomicGlobalWrite(path: string, content: string): Promise<void> {
  // 固定文件名并拒绝链接，避免 Windows 别名和链接将编辑导向 profile 外。
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe global memory file");
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function mutateGlobalMemory(
  update: (snapshot: GlobalMemorySnapshot) => GlobalMemorySnapshot,
): Promise<GlobalMemorySnapshot> {
  const root = await globalMemoryRoot();
  const lock = join(root, ".write-lock");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error("Global memory is being edited. Refresh and retry.");
    throw error;
  }
  try {
    const before = await readGlobalSnapshot(root);
    const next = update(before);
    if (before.generation === Number.MAX_SAFE_INTEGER)
      throw new Error("Global memory generation exhausted");
    next.generation = before.generation + 1;
    if (Buffer.byteLength(next.content, "utf8") > GLOBAL_MEMORY_MAX_BYTES)
      throw new Error("Global memory exceeds 32 KiB");
    // 先递增 generation：若内容写入失败，旧抽取仍不能覆盖用户的删除/编辑意图。
    const { content, ...config } = next;
    const serializedConfig = JSON.stringify(config, null, 2);
    if (Buffer.byteLength(serializedConfig, "utf8") > GLOBAL_MEMORY_MAX_BYTES)
      throw new Error("Global memory configuration exceeds 32 KiB");
    await atomicGlobalWrite(join(root, "config.json"), serializedConfig);
    if (content !== before.content)
      await atomicGlobalWrite(join(root, "memory", "MEMORY.md"), content);
    return next;
  } finally {
    await rm(lock, { recursive: true });
  }
}

/**
 * 创建 Memory 服务实例
 */
export function createMemoryService(): IMemoryService {
  const importer = createProfileImporter(getZCodeDataRootDir);
  async function loadMemory(params: {
    workspacePath: string;
    agentId: string;
  }): Promise<{ memory: Memory | null }> {
    const { agentId } = params;

    try {
      const fileName = getMemoryFileName(agentId);
      const memoryDir = getUserMemoryDir();

      // 直接从用户级 ~/.claude/memory 目录读取
      const filePath = join(memoryDir, fileName);
      try {
        const content = await readFile(filePath, "utf-8");
        return {
          memory: {
            content: content || "",
            enabled: true,
          },
        };
      } catch {
        // 文件不存在，返回 null
        return { memory: null };
      }
    } catch (error) {
      console.error("Failed to load memory:", error);
      return { memory: null };
    }
  }

  async function saveMemory(params: {
    workspacePath: string;
    agentId: string;
    config: MemoryConfig;
  }): Promise<void> {
    const { agentId, config } = params;

    try {
      // 直接保存到用户级 ~/.claude/memory 目录
      const memoryDir = getUserMemoryDir();
      await mkdir(memoryDir, { recursive: true });

      const fileName = getMemoryFileName(agentId);
      const filePath = join(memoryDir, fileName);
      await writeFile(filePath, config.content, "utf-8");
    } catch (error) {
      console.error("Failed to save memory:", error);
      throw error;
    }
  }

  async function clearMemory(params: { workspacePath: string; agentId: string }): Promise<void> {
    const { agentId } = params;

    try {
      const fileName = getMemoryFileName(agentId);
      const memoryDir = getUserMemoryDir();
      const filePath = join(memoryDir, fileName);

      try {
        await writeFile(filePath, "", "utf-8");
      } catch {
        // 文件不存在，忽略错误
      }
    } catch (error) {
      console.error("Failed to clear memory:", error);
      throw error;
    }
  }

  async function getUserMemoryDirectory(): Promise<{ path: string }> {
    const memoryDir = getUserMemoryDir();
    try {
      await mkdir(memoryDir, { recursive: true });
    } catch {
      // 目录已存在
    }
    return { path: memoryDir };
  }

  async function listProjectMemories(): Promise<ProjectMemoryWorkspaceSummary[]> {
    let projectsRoot: string;
    let projectEntries;
    try {
      projectsRoot = await requireProjectMemoriesRoot();
      projectEntries = await readdir(projectsRoot, { withFileTypes: true });
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }
      throw error;
    }

    const workspaces: ProjectMemoryWorkspaceSummary[] = [];
    for (const projectEntry of projectEntries) {
      if (!projectEntry.isDirectory() || projectEntry.isSymbolicLink()) {
        continue;
      }

      const workspaceId = projectEntry.name;
      const workspaceRoot = join(projectsRoot, workspaceId);
      const memoryRoot = join(workspaceRoot, PROJECT_MEMORY_DIRECTORY_NAME);
      if (!(await isPlainDirectory(workspaceRoot)) || !(await isPlainDirectory(memoryRoot))) {
        continue;
      }

      let memoryEntries;
      try {
        memoryEntries = await readdir(memoryRoot, { withFileTypes: true });
      } catch (error) {
        // 目录检查后 Memory Agent 仍可能删除目录；catalog 快照只跳过已消失的 workspace。
        if (isNotFoundError(error)) {
          continue;
        }
        throw error;
      }
      const files: ProjectMemoryFileSummary[] = [];
      for (const memoryEntry of memoryEntries) {
        if (
          !memoryEntry.isFile() ||
          memoryEntry.isSymbolicLink() ||
          !isProjectMemoryFileName(memoryEntry.name)
        ) {
          continue;
        }

        const filePath = join(memoryRoot, memoryEntry.name);
        let fileMetadata;
        try {
          fileMetadata = await lstat(filePath);
        } catch (error) {
          // readdir 后事实文件可能被并发删除；它不再属于本次只读快照。
          if (isNotFoundError(error)) {
            continue;
          }
          throw error;
        }
        if (!fileMetadata.isFile() || fileMetadata.isSymbolicLink()) {
          continue;
        }
        files.push({
          name: memoryEntry.name,
          path: filePath,
          kind: memoryEntry.name === PROJECT_MEMORY_INDEX_FILE_NAME ? "index" : "item",
          size: fileMetadata.size,
          updatedAt: fileMetadata.mtimeMs,
        });
      }

      if (files.length === 0) {
        continue;
      }

      files.sort(compareProjectMemoryFiles);
      workspaces.push({
        id: workspaceId,
        label: resolveWorkspaceLabel(workspaceId),
        updatedAt: Math.max(...files.map((file) => file.updatedAt)),
        files,
      });
    }

    workspaces.sort(
      (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id, "en"),
    );
    return workspaces;
  }

  async function readProjectMemoryFile(params: {
    workspaceId: string;
    fileName: string;
  }): Promise<{ content: string; updatedAt: number }> {
    if (
      !isValidPathSegment(params.workspaceId) ||
      !isValidPathSegment(params.fileName) ||
      !isProjectMemoryFileName(params.fileName)
    ) {
      throw new Error("Invalid Project Memory path");
    }

    const projectsRoot = await requireProjectMemoriesRoot();
    const workspaceRoot = join(projectsRoot, params.workspaceId);
    const memoryRoot = join(workspaceRoot, PROJECT_MEMORY_DIRECTORY_NAME);
    await requirePlainDirectory(workspaceRoot);
    await requirePlainDirectory(memoryRoot);

    // Bugfix：大小写不敏感文件系统会让请求名称命中不同大小写的磁盘文件，绕过 catalog 白名单。
    const filePath = await requireExactProjectMemoryFile(memoryRoot, params.fileName);
    return readProjectMemoryFileFromStableHandle({
      fileName: params.fileName,
      filePath,
      validatePath: async () => {
        await requireProjectMemoriesRoot();
        await requirePlainDirectory(workspaceRoot);
        await requirePlainDirectory(memoryRoot);
        await requireExactProjectMemoryFile(memoryRoot, params.fileName);
        await assertContainedProjectMemoryPath(projectsRoot, filePath);
      },
    });
  }

  return {
    ...importer,
    getGlobalMemory: async () => {
      const root = await globalMemoryRoot();
      const assertUnlocked = async () => {
        try {
          await lstat(join(root, ".write-lock"));
        } catch (error) {
          if (isNotFoundError(error)) return;
          throw error;
        }
        throw new Error("Global memory is being edited. Refresh and retry.");
      };
      await assertUnlocked();
      const snapshot = await readGlobalSnapshot(root);
      await assertUnlocked();
      const latest = await readGlobalSnapshot(root);
      if (snapshot.generation !== latest.generation)
        throw new Error("Global memory changed. Refresh and retry.");
      return snapshot;
    },
    updateGlobalMemory: async ({ content, expectedGeneration }) => {
      if (typeof content !== "string" || Buffer.byteLength(content) > GLOBAL_MEMORY_MAX_BYTES)
        throw new Error("Global memory exceeds 32 KiB");
      if (
        /(?:-----BEGIN|\b(?:password|passwd|api[_ -]?key|access[_ -]?token|secret|credential)\s*[:=]|\b(?:sk-|ghp_|github_pat_)[a-z0-9_-]{12,}|密码|密钥)/iu.test(
          content,
        )
      )
        throw new Error("Do not store passwords, keys or credentials in global memory");
      return mutateGlobalMemory((snapshot) => {
        if (snapshot.generation !== expectedGeneration)
          throw new Error("Global memory changed. Refresh before saving.");
        return {
          ...snapshot,
          content: content
            ? `${content.trimEnd()}\n\n<!-- Scope: global | Source: user settings | Recorded: ${new Date().toISOString()} -->\n`
            : "",
        };
      });
    },
    setGlobalMemoryPreferences: async (params) =>
      mutateGlobalMemory((snapshot) => {
        if (
          (params.enabled !== undefined && typeof params.enabled !== "boolean") ||
          (params.extractionEnabled !== undefined && typeof params.extractionEnabled !== "boolean")
        )
          throw new Error("Invalid global memory preference");
        return {
          ...snapshot,
          enabled: params.enabled ?? snapshot.enabled,
          extractionEnabled: params.extractionEnabled ?? snapshot.extractionEnabled,
        };
      }),
    setGlobalMemorySessionEnabled: async ({ sessionId, enabled }) => {
      if (
        typeof sessionId !== "string" ||
        !sessionId.trim() ||
        sessionId.length > 256 ||
        typeof enabled !== "boolean"
      )
        throw new Error("Invalid session memory preference");
      return mutateGlobalMemory((snapshot) => ({
        ...snapshot,
        disabledSessionIds: enabled
          ? snapshot.disabledSessionIds.filter((id) => id !== sessionId)
          : [...new Set([...snapshot.disabledSessionIds, sessionId])],
      }));
    },
    loadMemory,
    saveMemory,
    clearMemory,
    getUserMemoryDirectory,
    listProjectMemories,
    readProjectMemoryFile,
  };
}
