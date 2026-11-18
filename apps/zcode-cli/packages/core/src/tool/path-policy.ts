// ============================================================
// Tool Path Policy
// ============================================================

import { realpath } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { CoreErrorType, createCoreError, createFileSystemError } from "@zcode/contracts";

interface ToolWorkspacePathOptions {
  inputPath: string;
  workingDirectory: string;
  workspaceRoot: string;
  operation: "read" | "write" | "execute";
}

export function resolveWorkspacePath(options: ToolWorkspacePathOptions): string {
  const workingDirectory = normalizeAbsoluteDirectory(
    options.workingDirectory,
    "workingDirectory",
  );
  normalizeAbsoluteDirectory(options.workspaceRoot, "workspaceRoot");
  const requestedPath = options.inputPath;

  if (requestedPath.length === 0) {
    throw createCoreError(CoreErrorType.ToolExecutionFailed, "Tool path must not be empty", {
      context: {
        operation: options.operation,
      },
      recoverable: true,
    });
  }

  const resolvedPath = isAbsolute(requestedPath)
    ? normalize(requestedPath)
    : resolve(workingDirectory, requestedPath);

  // Current release intentionally does not hard-block paths outside workspaceRoot.
  // Cause: subagents may need to inspect user-requested sibling repos or external files
  // before the filesystem permission adapter grows explicit ask/deny rules for them.
  return resolvedPath;
}

export function resolveToolWorkingDirectory(
  inputCwd: string | undefined,
  options: Omit<ToolWorkspacePathOptions, "inputPath">,
): string {
  if (!inputCwd) {
    const workingDirectory = normalizeAbsoluteDirectory(
      options.workingDirectory,
      "workingDirectory",
    );
    normalizeAbsoluteDirectory(options.workspaceRoot, "workspaceRoot");
    return workingDirectory;
  }

  return resolveWorkspacePath({
    ...options,
    inputPath: inputCwd,
  });
}

function normalizeAbsoluteDirectory(value: string, label: string): string {
  const normalized = normalize(value);
  if (!isAbsolute(normalized)) {
    throw createCoreError(
      CoreErrorType.ConfigurationError,
      `${label} must be an absolute path for tool execution`,
      {
        context: {
          [label]: value,
        },
        recoverable: false,
      },
    );
  }
  return normalized;
}

/** 仅用于助手前台的可信执行配置，普通会话继续使用现有路径和权限规则。 */
export interface AssistantReadScope {
  cliStorageRoot?: string;
  memoryRoot?: string;
}

function containsPath(root: string, target: string): boolean {
  const child = relative(root, target);
  return child !== ".." && !child.startsWith(".." + sep) && !isAbsolute(child);
}

export async function scopeAssistantReadPath(
  scope: AssistantReadScope,
  workspaceRoot: string | undefined,
  requestedPath: string,
): Promise<{ path: string; excludedDirectory?: string }> {
  const deny = () =>
    createCoreError(
      CoreErrorType.PermissionDenied,
      "This path is outside the workspace or its enabled project memory.",
      { recoverable: true },
    );
  const [workspace, target, storage] = await Promise.all([
    workspaceRoot ? realpath(workspaceRoot) : undefined,
    realpath(requestedPath).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT" || cause.code === "ENOTDIR") {
        throw createFileSystemError({
          code: "not_found",
          path: requestedPath,
          message: "The requested file or directory does not exist.",
        });
      }
      throw deny();
    }),
    scope.cliStorageRoot ? realpath(scope.cliStorageRoot).catch(() => undefined) : undefined,
  ]);
  // 记忆根目录的路径属于当前 profile 与工作区。根自身的 symlink 也不能改变归属。
  const library = storage && resolve(storage, "memories", "projects");
  const physicalLibrary = library && (await realpath(library).catch(() => undefined));
  const expectedMemory =
    storage && scope.cliStorageRoot && scope.memoryRoot
      ? resolve(storage, relative(scope.cliStorageRoot, scope.memoryRoot))
      : undefined;
  if (
    expectedMemory &&
    library &&
    containsPath(library, expectedMemory) &&
    containsPath(expectedMemory, target)
  ) {
    return { path: target };
  }
  if (
    !workspace ||
    !containsPath(workspace, target) ||
    (scope.cliStorageRoot &&
      containsPath(resolve(scope.cliStorageRoot, "memories", "projects"), requestedPath)) ||
    (physicalLibrary && containsPath(physicalLibrary, target))
  )
    throw deny();
  return {
    path: target,
    ...(physicalLibrary && containsPath(target, physicalLibrary)
      ? { excludedDirectory: physicalLibrary }
      : {}),
  };
}
