import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryHookRunner } from "../src/hooks/index.js";
import { createSessionId, type SessionTaskType } from "@zcode/contracts";
import { join } from "node:path";
import { resolveProjectMemoryRoot } from "../src/memory/project-root.js";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createTestSessionEventStore } from "./test-event-store.js";
import { MemoryFileSystem } from "./memory-test-utils.js";
import { createTestModelFactory } from "./test-runtime-model.js";

const CLI_STORAGE_ROOT = "/storage/cli";
const WORKSPACE_PATH = "/workspace/project";
let runtimeSequence = 0;

describe("AgentRuntime project Memory context", () => {
  it("runs an assistant read without invoking the ordinary session's tool hooks", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "zcode-assistant-hook-"));
    try {
      const target = join(workspacePath, "fact.txt");
      await writeFile(target, "native read");
      const callback = vi.fn(async () => ({}));
      const hookRunner = createInMemoryHookRunner({
        hooks: [{ event: "PreToolUse", matcher: "Read", callback }],
      });
      const result = await executeMemoryTurn({
        workspacePath,
        workspaceAssistantReadScope: true,
        hookRunner,
        files: { [target]: "native read" },
        memory: { enabled: false },
        modelReply: (_, callIndex) =>
          callIndex === 1
            ? {
                text: "",
                finishReason: "tool-calls",
                toolCalls: [{ id: "read", name: "Read", input: { file_path: target } }],
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              }
            : completedModelReply(),
      });
      expect(result.fileSystemPort.readRequests.map((r) => r.path)).toContain(target);
      expect(callback).not.toHaveBeenCalled();
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it("describes only enabled project memory to the custom assistant prompt without creating a missing index", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-memory-hint-"));
    try {
      const workspacePath = join(dir, "workspace");
      await mkdir(workspacePath);
      const options = {
        workspacePath,
        cliStorageRoot: dir,
        workspaceAssistantReadScope: true,
        systemPrompt: "Assistant Plan",
      };
      const expected = resolveProjectMemoryRoot({ workspacePath, cliStorageRoot: dir });
      const enabled = await executeMemoryTurn(options);
      expect(enabled.providerText).toContain(JSON.stringify(expected));
      expect(enabled.fileSystemPort.createdDirectories.size).toBe(0);
      const disabled = await executeMemoryTurn({ ...options, memory: { enabled: false } });
      expect(disabled.providerText).not.toContain(expected);
      expect(disabled.fileSystemPort.createdDirectories.size).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("never follows a linked assistant memory index or initializes the memory directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-index-scope-"));
    try {
      const workspacePath = join(dir, "workspace");
      const cliStorageRoot = join(dir, "storage");
      const root = resolveProjectMemoryRoot({ workspacePath, cliStorageRoot });
      await mkdir(workspacePath);
      await mkdir(root, { recursive: true });
      const other = join(workspacePath, "other.md");
      const index = join(root, "MEMORY.md");
      await writeFile(other, "UNRELATED_FIXTURE");
      // 用真实文件链接验证隐式索引；Windows 创建文件链接需要系统权限，改用测试目录链接。
      if (process.platform === "win32") {
        await symlink(workspacePath, index, "junction");
      } else {
        await symlink(other, index);
      }
      const result = await executeMemoryTurn({
        workspacePath,
        cliStorageRoot,
        workspaceAssistantReadScope: true,
        files: { [index]: "UNRELATED_FIXTURE", [other]: "UNRELATED_FIXTURE" },
      });
      expect(result.providerText).not.toContain("UNRELATED_FIXTURE");
      expect(result.fileSystemPort.createdDirectories.size).toBe(0);
      expect(result.fileSystemPort.readRequests).toEqual([]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it.each<SessionTaskType>(["interactive", "fork", "selection_side_chat", "workflow_parent"])(
    "injects the frozen Main Memory section for %s even with an empty root",
    async (taskType) => {
      const result = await executeMemoryTurn({ taskType });
      const rootDir = resolveProjectMemoryRoot({
        cliStorageRoot: CLI_STORAGE_ROOT,
        workspacePath: WORKSPACE_PATH,
      });

      expect(result.providerText).toContain("# Memory");
      expect(result.providerText).toContain(
        `You have a persistent file-based memory at \`${rootDir}/\`.`,
      );
      expect(result.fileSystemPort.readRequests).toEqual([
        { maxBytes: undefined, path: join(rootDir, "MEMORY.md") },
      ]);
      expect(Object.keys(result.fileSystemPort.files)).toEqual([]);
      expect([...result.fileSystemPort.createdDirectories]).toEqual([rootDir]);
    },
  );

  it.each<SessionTaskType>(["workflow_child", "subagent_child", "nested_workflow_child"])(
    "does not inject project Memory for %s",
    async (taskType) => {
      const result = await executeMemoryTurn({ taskType });

      expect(result.providerText).not.toContain("# Memory");
      expect(result.fileSystemPort.readRequests).toEqual([]);
      expect(Object.keys(result.fileSystemPort.files)).toEqual([]);
      expect(result.fileSystemPort.createdDirectories.size).toBe(0);
    },
  );

  it("does not create, read, or inject Memory when the feature or use flag is disabled", async () => {
    for (const memory of [
      { enabled: false, use: true },
      { enabled: true, use: false },
    ]) {
      const result = await executeMemoryTurn({ memory });
      expect(result.providerText).not.toContain("# Memory");
      expect(result.fileSystemPort.readRequests).toEqual([]);
      expect(Object.keys(result.fileSystemPort.files)).toEqual([]);
      expect(result.fileSystemPort.createdDirectories.size).toBe(0);
    }
  });

  it("still injects the Memory prompt when directory creation fails", async () => {
    const fileSystemPort = new MemoryFileSystem({});
    fileSystemPort.createDirectory = async () => {
      throw new Error("mkdir failed");
    };
    const result = await executeMemoryTurn({ fileSystemPort });

    expect(result.providerText).toContain("# Memory");
    expect(result.providerText).toContain("write to it directly with the Write tool");
  });

  it("loads a non-empty MEMORY.md into the Main provider user context", async () => {
    const rootDir = resolveProjectMemoryRoot({
      cliStorageRoot: CLI_STORAGE_ROOT,
      workspacePath: WORKSPACE_PATH,
    });
    const indexPath = join(rootDir, "MEMORY.md");
    const indexContent =
      "- [Database test policy](database-test-policy.md) — integration tests use isolated databases";
    const result = await executeMemoryTurn({
      files: { [indexPath]: indexContent },
    });

    expect(result.fileSystemPort.readRequests).toEqual([{ maxBytes: undefined, path: indexPath }]);
    expect(
      result.providerText.match(/Codebase and user instructions are shown below/g),
    ).toHaveLength(1);
    expect(result.providerText).not.toContain("# claudeMd");
    expect(result.providerText).toContain(
      `Contents of ${indexPath} (user's auto-memory, persists across conversations):\n\n${indexContent}`,
    );
  });

  it("seeds a full MEMORY.md read state that permits an immediate Edit", async () => {
    const rootDir = resolveProjectMemoryRoot({
      cliStorageRoot: CLI_STORAGE_ROOT,
      workspacePath: WORKSPACE_PATH,
    });
    const indexPath = join(rootDir, "MEMORY.md");
    const indexContent =
      "- [Database test policy](database-test-policy.md) — integration tests use isolated databases";
    const updatedContent = `${indexContent}\n- [Deployment policy](deployment-policy.md) — staging approval required`;
    const result = await executeMemoryTurn({
      files: { [indexPath]: indexContent },
      modelReply(request, callIndex) {
        if (callIndex === 1) {
          return {
            finishReason: "tool-calls",
            text: "",
            toolCalls: [
              {
                id: "edit-memory-index",
                input: {
                  file_path: indexPath,
                  new_string: updatedContent,
                  old_string: indexContent,
                },
                name: "Edit",
              },
            ],
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }
        return completedModelReply();
      },
    });

    expect(result.fileSystemPort.files[indexPath]).toBe(updatedContent);
    expect(result.providerTexts[1]).not.toContain("File has not been read yet");
  });

  it("keeps transformed MEMORY.md as a partial read state until the model Reads it", async () => {
    const rootDir = resolveProjectMemoryRoot({
      cliStorageRoot: CLI_STORAGE_ROOT,
      workspacePath: WORKSPACE_PATH,
    });
    const indexPath = join(rootDir, "MEMORY.md");
    const indexContent = [
      "---",
      "internal: hidden-index-metadata",
      "---",
      "<!-- hidden top-level note -->",
      "- [Database test policy](database-test-policy.md) — integration tests use isolated databases",
      "",
    ].join("\n");
    const visibleContent =
      "- [Database test policy](database-test-policy.md) — integration tests use isolated databases";
    const result = await executeMemoryTurn({
      files: { [indexPath]: indexContent },
      modelReply(request, callIndex) {
        if (callIndex === 1) {
          return {
            finishReason: "tool-calls",
            text: "",
            toolCalls: [
              {
                id: "edit-transformed-memory-index",
                input: {
                  file_path: indexPath,
                  new_string: `${visibleContent}\n- [New pointer](new-pointer.md) — durable fact`,
                  old_string: visibleContent,
                },
                name: "Edit",
              },
            ],
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }
        return completedModelReply();
      },
    });

    expect(result.providerTexts[0]).toContain(visibleContent);
    expect(result.providerTexts[0]).not.toContain("hidden-index-metadata");
    expect(result.providerTexts[0]).not.toContain("hidden top-level note");
    expect(result.providerTexts[1]).toContain("File has not been read yet");
    expect(result.fileSystemPort.files[indexPath]).toBe(indexContent);
  });

  it("uses an opaque workspace identity instead of interpreting it as a path", async () => {
    const workspaceIdentity = "ssh://host/workspace";
    const result = await executeMemoryTurn({ workspaceIdentity });
    const rootDir = resolveProjectMemoryRoot({
      cliStorageRoot: CLI_STORAGE_ROOT,
      workspaceIdentity,
      workspacePath: WORKSPACE_PATH,
    });

    expect(result.providerText).toContain(`\`${rootDir}/\``);
    expect(rootDir).toContain("/project-");
    expect(rootDir).not.toContain("/workspace-");
  });

  it("leaves legacy summary/topics and explicit remember producers outside the active path", async () => {
    const legacyParent = resolveProjectMemoryRoot({
      cliStorageRoot: CLI_STORAGE_ROOT,
      workspacePath: WORKSPACE_PATH,
    }).replace(/\/memory$/u, "");
    const result = await executeMemoryTurn({
      files: {
        [`${legacyParent}/memory_summary.md`]: "legacy summary",
        [`${legacyParent}/topics/project_old.md`]: "legacy topic",
      },
      prompt: "remember that tests use pnpm test",
    });

    expect(result.fileSystemPort.readRequests).toEqual([
      {
        maxBytes: undefined,
        path: join(
          resolveProjectMemoryRoot({
            cliStorageRoot: CLI_STORAGE_ROOT,
            workspacePath: WORKSPACE_PATH,
          }),
          "MEMORY.md",
        ),
      },
    ]);
    expect(result.fileSystemPort.files).toEqual({
      [`${legacyParent}/memory_summary.md`]: "legacy summary",
      [`${legacyParent}/topics/project_old.md`]: "legacy topic",
    });
    expect(result.providerText).not.toContain("legacy summary");
    expect(result.providerText).not.toContain("legacy topic");
  });
});

async function executeMemoryTurn(
  options: {
    workspacePath?: string;
    cliStorageRoot?: string;
    workspaceAssistantReadScope?: boolean;
    systemPrompt?: string;
    hookRunner?: ReturnType<typeof createInMemoryHookRunner>;
    files?: Record<string, string>;
    fileSystemPort?: MemoryFileSystem;
    memory?: { enabled?: boolean; use?: boolean };
    modelReply?: (request: any, callIndex: number) => any;
    prompt?: string;
    taskType?: SessionTaskType;
    workspaceIdentity?: string;
  } = {},
): Promise<{ fileSystemPort: MemoryFileSystem; providerText: string; providerTexts: string[] }> {
  const fileSystemPort = options.fileSystemPort ?? new MemoryFileSystem(options.files ?? {});
  const providerTexts: string[] = [];
  const runtime = createTestAgentRuntime(
    createSessionId(`runtime-memory-${runtimeSequence++}`),
    {
      memory: {
        cliStorageRoot: options.cliStorageRoot ?? CLI_STORAGE_ROOT,
        enabled: true,
        use: true,
        workspaceIdentity: options.workspaceIdentity,
        ...options.memory,
      },
      taskType: options.taskType,
      workingDirectory: options.workspacePath ?? WORKSPACE_PATH,
      workspaceAssistantReadScope: options.workspaceAssistantReadScope,
      systemPrompt: options.systemPrompt,
    },
    {
      eventStore: createTestSessionEventStore(),
      fileSystemPort,
      hookRunner: options.hookRunner,
      modelFactory: createTestModelFactory({
        async generateText(request) {
          providerTexts.push(request.messages.map((message) => String(message.content)).join("\n"));
          return options.modelReply?.(request, providerTexts.length) ?? completedModelReply();
        },
      } as never),
    },
  );

  await runtime.executeTurn(options.prompt ?? "use project context");
  return { fileSystemPort, providerText: providerTexts.join("\n"), providerTexts };
}

function completedModelReply() {
  return {
    finishReason: "stop" as const,
    text: "done",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  };
}
