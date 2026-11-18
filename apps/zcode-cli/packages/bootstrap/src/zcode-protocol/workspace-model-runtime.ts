/* eslint-disable max-lines -- workspace 模型协议与兼容请求处理仍集中在本文件。 */
import { createInMemorySessionEventStore, createSqliteSessionStore } from "@zcode/adapters/storage";
import {
  createSessionId,
  SessionEventType,
  type ModelStreamingPayload,
  type TurnCompletePayload,
  type ToolCallStartedPayload,
  type ToolCallResultPayload,
  type WorkspaceId,
  type SessionId,
  type ModelSelection,
} from "@zcode/contracts";
import {
  zcodeProtocolNotifications,
  type ZCodeWorkspaceGenerateTextParams,
  type ZCodeWorkspaceGenerateTextProgress,
  type ZCodeWorkspaceGenerateTextResult,
  zcodeProviderTestModelConnectivityParamsSchema,
  zcodeWorkspaceReadPresentationParamsSchema,
  type ZCodeWorkspaceRef,
} from "@zcode/shared";
import type { ZCodeApp, ZCodeAppOptions } from "../app/types.js";
import { listProtocolSlashCommands } from "./slash-commands.js";
import {
  parseParams,
  type ZCodeProtocolAgentServerContext,
  type ZCodeProtocolSessionRecord,
} from "./server-types.js";
import { createProviderRuntimeHeadersPort } from "./provider-runtime-headers.js";
import { offPeakLifecycleNotificationSchema } from "@zcode/shared";
import { V4_NOTIFICATIONS } from "@zcode/shared/zcode-protocol-v4";

export async function readWorkspacePresentation(
  context: ZCodeProtocolAgentServerContext,
  rawParams: unknown,
) {
  const params = parseParams(zcodeWorkspaceReadPresentationParamsSchema, rawParams);
  return {
    workspace: params.workspace,
    mode: "build" as const,
    slashCommands: await listProtocolSlashCommands({
      // 灰度门是 Host 判定的 workspace 级事实，目录装配读进程缓存。
      dynamicWorkflowEnabled: context.appRuntimePreferences.dynamicWorkflowEnabled,
      env: context.deps.env,
      logger: context.logger,
      pluginPreparation: context.deps?.pluginPreparation,
      pluginDiscovery: context.deps?.pluginDiscovery,
      workspaceIdentity: params.workspace.workspaceIdentity,
      remoteSessionId: params.workspace.remoteSessionId,
      workingDirectory: params.workspace.workspacePath,
    }),
  };
}

export async function testProviderModelConnectivity(
  context: ZCodeProtocolAgentServerContext,
  rawParams: unknown,
  abortSignal?: AbortSignal,
) {
  const params = parseParams(zcodeProviderTestModelConnectivityParamsSchema, rawParams);
  // 旧 Personal Config 跨进程 watcher 可能永久漏掉原子写事件；连接测试若不先
  // 主动刷新，会反复查询旧 Registry。这里复用正式 Registry refresh，不旁路创建配置事实。
  await context.deps.refreshProviderRegistry?.("provider-connectivity");
  const active = Array.from(context.sessions.values()).find(
    (record) => record.workspace.workspaceKey === params.workspace.workspaceKey,
  );
  const app =
    active?.app ??
    (await createWorkspaceZCodeApp(context, params.workspace, {
      env: context.deps.env,
      eventStore: createInMemorySessionEventStore(),
      runtimeConfig: { workingDirectory: params.workspace.workspacePath },
      sessionStore: context.deps.sessionStore,
      version: context.deps.version,
    }));
  try {
    await app.testModelConnectivity(
      { selection: params.selection as ModelSelection },
      { abortSignal },
    );
    return { success: true as const };
  } finally {
    if (!active) await app.close?.();
  }
}

export async function createWorkspaceZCodeApp(
  context: ZCodeProtocolAgentServerContext,
  workspace: ZCodeWorkspaceRef,
  options: Omit<ZCodeAppOptions, "providerRegistry">,
): Promise<ZCodeApp> {
  const providerRuntimeHeadersPort =
    options.providerRuntimeHeadersPort ?? createProviderRuntimeHeadersPort(context, workspace);
  return context.deps.createZCodeApp({
    ...options,
    // Hook Trust 等对外字段用会话所属 workspace 的 key；受管 worktree 会话 = 项目 key。
    workspaceKey: workspace.workspaceKey,
    onOffPeakLifecycleEvent: (event) =>
      context.notify({
        method: V4_NOTIFICATIONS.offPeakLifecycle,
        params: offPeakLifecycleNotificationSchema.parse(event),
      }),
    includeVisualize: true,
    platform: context.deps.platform,
    providerRuntimeHeadersPort,
    runtimeConfig: {
      ...options.runtimeConfig,
      // createZCodeApp 会把 workingDirectory 规范化为执行 cwd。把协议入口的
      // workspacePath 单独注入 runtime，session 持久化才能保留本地 workspaceKey 的路径表示。
      workspacePath: workspace.workspacePath,
      // 远端 session 是 shared-host CUA 的第二层隔离边界：不能只传 workspacePath/identity，
      // 否则同一远端 workspace 的不同 attachment 会复用 Accessibility frame/action 状态。
      // 放在这个 helper 里而不是各调用点，是为了两条 session 创建路径都拿到同一份隔离键。
      ...(workspace.remoteSessionId ? { remoteSessionId: workspace.remoteSessionId } : {}),
      ...(workspace.workspaceIdentity
        ? {
            memory: {
              ...options.runtimeConfig?.memory,
              workspaceIdentity: workspace.workspaceIdentity,
            },
          }
        : {}),
      // Electron/Protocol 主会话之前没有像 CLI/TUI 那样显式开启模型流式，
      // 导致主 turn 退回 generateText 非流式请求，遇到返回 SSE 的兼容端点会按 JSON 解析失败。
      modelStreaming: options.runtimeConfig?.modelStreaming ?? "on",
    },
  });
}

export function hasSessionModelProvider(
  _context: ZCodeProtocolAgentServerContext,
  record: Pick<ZCodeProtocolSessionRecord, "app" | "workspace">,
  providerId: string,
): boolean {
  return record.app.listModels().some((model) => model.ref.providerId === providerId);
}

export function resolveSessionModelContextWindow(
  _context: ZCodeProtocolAgentServerContext,
  record: Pick<ZCodeProtocolSessionRecord, "app" | "workspace" | "restoredModelSelection">,
): number | undefined {
  // 缺档位会让恢复选择暂不绑定 Runtime，但模型身份仍可只读查询容量，不能伪造 20 万。
  const selection = record.app.runtime.getSessionModelSelection() ?? record.restoredModelSelection;
  const value = selection && record.app.getModelOption?.(selection)?.contextWindow;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export interface WorkspaceAssistantSlot {
  workspacePath: string;
  busy: boolean;
  sessionId: SessionId;
  session?: WorkspaceAssistantSession;
}

interface WorkspaceAssistantSession {
  app: ZCodeApp;
  memoryEnabled: boolean;
  instructions: string;
}

async function createAssistantSession(
  context: ZCodeProtocolAgentServerContext,
  params: ZCodeWorkspaceGenerateTextParams,
  inspect: boolean,
  memoryEnabled: boolean,
  instructions: string,
  sessionId: SessionId,
): Promise<WorkspaceAssistantSession> {
  // 使用普通 SessionStore。进程内保存工具历史，辅助会话不会出现在普通任务索引或历史输入里。
  const store = await createSqliteSessionStore({ dbPath: ":memory:" });
  try {
    const app = await createWorkspaceZCodeApp(context, params.workspace, {
      sessionId,
      env: context.deps.env,
      version: context.deps.version,
      eventStore: createInMemorySessionEventStore(),
      sessionStore: store,
      permissionBroker: {
        requestPermission: async () => ({
          decision: "deny",
          reason: "Workspace assistant read scope",
        }),
      },
      runtimeConfig: {
        mode: "plan",
        planEnabled: true,
        modelSelection: params.selection,
        systemPrompt: instructions,
        workingDirectory: params.workspace.workspacePath,
        workspaceIdentity: params.workspace.workspaceIdentity as WorkspaceId | undefined,
        workspaceAssistantReadScope: true,
        toolAllowlist: inspect ? ["Read", "Glob", "Grep"] : [],
        nativeSearchEnhancementsEnabled: false,
        toolSearch: { mode: "off" },
        dynamicWorkflowEnabled: false,
        subagents: { enabled: false },
        mcp: { enabled: false },
        memory: { extractionEnabled: false, ...(memoryEnabled ? {} : { enabled: false }) },
        titleGeneration: { enabled: false },
      },
    });
    const close = app.close?.bind(app);
    let closing: Promise<void> | undefined;
    app.close = () =>
      (closing ??= Promise.resolve()
        .then(close)
        .finally(() => store.close()));
    return { app, memoryEnabled, instructions };
  } catch (error) {
    store.close();
    throw error;
  }
}

export async function runWorkspaceAssistantTurn(
  context: ZCodeProtocolAgentServerContext,
  params: ZCodeWorkspaceGenerateTextParams,
  inspect: boolean,
  memoryEnabled: boolean,
  abortSignal?: AbortSignal,
): Promise<ZCodeWorkspaceGenerateTextResult> {
  const foreground = params.querySource === "workspace_assistant_router";
  const key = params.workspace.workspaceIdentity?.trim() || params.workspace.workspacePath;
  const messages = params.messages ?? [];
  const instructions = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const prompt =
    params.prompt ??
    messages
      .filter((m) => m.role !== "system")
      .map((m) => m.content)
      .join("\n\n");
  const residents = (context.workspaceAssistantSessions ??= new Map<
    string,
    WorkspaceAssistantSlot
  >());
  const slot: WorkspaceAssistantSlot = (foreground && residents.get(key)) || {
    workspacePath: params.workspace.workspacePath,
    busy: false,
    sessionId: createSessionId(),
  };
  // Host 已串行接纳同工作区输入。直接并发的协议调用不能在前一轮生成时切换其模型或权限。
  if (slot.busy) throw new Error("Workspace assistant session is busy");
  slot.busy = true;
  if (foreground) residents.set(key, slot);
  let completed = false;
  try {
    const existing = slot.session;
    if (
      existing &&
      (slot.workspacePath !== params.workspace.workspacePath ||
        existing.memoryEnabled !== memoryEnabled ||
        existing.instructions !== instructions)
    ) {
      await existing.app.close?.();
      slot.session = undefined;
    }
    slot.workspacePath = params.workspace.workspacePath;
    const session = (slot.session ??= await createAssistantSession(
      context,
      params,
      inspect,
      memoryEnabled,
      instructions,
      slot.sessionId,
    ));
    abortSignal?.throwIfAborted();
    const result = await executeAssistantTurn(context, session.app, params, prompt, abortSignal);
    completed = true;
    return result;
  } finally {
    try {
      // 中断后的原生历史可能含没有终态的工具步骤。下次从 Host 已接纳的历史恢复。
      if (!foreground || !completed) {
        if (foreground) residents.delete(key);
        await slot.session?.app.close?.();
      }
    } finally {
      slot.busy = false;
    }
  }
}

async function executeAssistantTurn(
  context: ZCodeProtocolAgentServerContext,
  app: ZCodeApp,
  params: ZCodeWorkspaceGenerateTextParams,
  prompt: string,
  abortSignal?: AbortSignal,
): Promise<ZCodeWorkspaceGenerateTextResult> {
  const operationId = params.streamProgress && params.operationId;
  let text = "";
  let reasoning = "";
  let toolActivity: ZCodeWorkspaceGenerateTextProgress["toolActivity"];
  const toolNames = new Map<string, string>();
  let lastEmit = 0;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const emit = () => {
    pending = undefined;
    if (operationId && !abortSignal?.aborted) {
      context.notify({
        method: zcodeProtocolNotifications.workspaceGenerateTextProgress,
        params: { operationId, text, reasoning, ...(toolActivity ? { toolActivity } : {}) },
      });
      lastEmit = Date.now();
    }
  };
  const changed = () => {
    if (!operationId || pending) return;
    const delay = 50 - (Date.now() - lastEmit);
    if (delay <= 0) emit();
    else pending = setTimeout(emit, delay);
  };
  let terminal: TurnCompletePayload | undefined;
  try {
    await app.setModel(params.selection, { transient: true });
    const result = await app.submitPrompt(prompt, {
      abortSignal,
      modelExecution: { selectionScope: "execution", memoryExtraction: "skip" },
      onEvent(event) {
        if (event.type === SessionEventType.TurnComplete)
          terminal = event.payload as TurnCompletePayload;
        if (event.type === SessionEventType.ModelRequest) {
          // 同一 turn 可在读取工具后再次请求。新一轮正文替换上一轮；各步实际思考连续展示。
          text = "";
          if (reasoning) reasoning += "\n\n";
        }
        if (event.type === SessionEventType.ToolCallStarted) {
          const { toolName, toolCallId } = event.payload as ToolCallStartedPayload;
          if (!toolName) return;
          toolNames.set(toolCallId, toolName);
          toolActivity = { name: toolName, status: "running" };
          if (pending) clearTimeout(pending);
          emit();
          return;
        }
        if (
          event.type === SessionEventType.ToolCallResult ||
          event.type === SessionEventType.ToolCallError
        ) {
          const { toolCallId, result } = event.payload as ToolCallResultPayload;
          const name = toolNames.get(toolCallId);
          toolNames.delete(toolCallId);
          if (!name) return;
          const running = toolNames.values().next().value;
          toolActivity = running
            ? { name: running, status: "running" }
            : { name, status: result?.success ? "completed" : "failed" };
          if (pending) clearTimeout(pending);
          emit();
          return;
        }
        if (event.type !== SessionEventType.ModelStreaming) return;
        const part = event.payload as ModelStreamingPayload;
        if (part.kind === "reasoning_delta") reasoning += part.delta;
        else if (part.kind === "text_delta") text += part.delta;
        else return;
        changed();
      },
    });
    abortSignal?.throwIfAborted();
    terminal ??= result.events.findLast((e) => e.type === SessionEventType.TurnComplete)
      ?.payload as TurnCompletePayload | undefined;
    if (!terminal || terminal.resultType !== "success")
      throw new Error(
        `Workspace assistant turn ended: ${terminal?.resultType ?? "missing terminal event"}`,
      );
    const usage = result.usage;
    return {
      text: result.response,
      selection: params.selection,
      finishReason: "stop",
      ...(reasoning.trim() ? { reasoning: reasoning.trimEnd() } : {}),
      ...(usage
        ? {
            usage: {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
              reasoningTokens: usage.reasoningTokens,
              cacheReadTokens: usage.cacheReadTokens,
              cacheWriteTokens: usage.cacheWriteTokens,
            },
          }
        : {}),
    };
  } finally {
    if (pending) {
      clearTimeout(pending);
      emit();
    }
  }
}
