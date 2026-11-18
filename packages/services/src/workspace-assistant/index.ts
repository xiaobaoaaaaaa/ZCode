import { createHash, randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  isRemoteWorkspaceIdentity,
  modelSelectionSchema,
  type ModelSelection,
} from "@zcode/shared";
import { submissionModeSchema } from "@zcode/shared/zcode-protocol-v4";
import type { ZCodeTaskIndexSyncer } from "#src/zcode-agent/zcodeTaskIndexSyncer.js";
import {
  createAssistantMailbox,
  describeDelegation,
  readMailMessages,
  watchDelegation,
  watchBatch,
  workspaceKey,
} from "./mail.js";
import type {
  AssistantDecision,
  AssistantHistory,
  AssistantInput,
  AssistantItem,
  AssistantMessage,
  AssistantScope,
  IWorkspaceAssistantService,
} from "./contract.js";
import { createAssistantGenerations, type UpdateGeneration } from "./generation.js";
import { batchSlots, bindings } from "./delegations.js";
import { createWorkspaceAssistantRuntime } from "./runtime.js";

export { IWorkspaceAssistantService } from "./contract.js";

const scopeSchema = z
  .object({
    workspacePath: z.string().min(1).refine(isAbsolute),
    workspaceIdentity: z.string().trim().optional(),
    projectId: z.string().min(1).optional(),
  })
  .strict()
  .refine((s) => !isRemoteWorkspaceIdentity(s.workspaceIdentity ?? ""));
const inputSchema = z
  .object({
    id: z.string().min(1).max(160),
    text: z.string().trim().min(1).max(32000),
    targetTaskId: z.string().min(1).optional(),
    modelSelection: modelSelectionSchema.optional(),
    permissionMode: submissionModeSchema.optional(),
  })
  .strict();

type RecordedDecision = AssistantDecision & {
  executionSelection?: ModelSelection;
  executionPermissionMode?: AssistantInput["permissionMode"];
  delegated?: true;
};

interface Exchange {
  rowid: number;
  preferences: string | null;
  input_id: string;
  text: string;
  target_id: string | null;
  project_id: string | null;
  decision: string | null;
  assigned_id: string | null;
  settled: number;
}

function exchanges(db: DatabaseSync, key: string): Exchange[] {
  return db
    .prepare("SELECT rowid,* FROM workspace_assistant_inputs WHERE workspace_key=? ORDER BY rowid")
    .all(key) as unknown as Exchange[];
}

function history(db: DatabaseSync, key: string): AssistantHistory {
  const rows = exchanges(db, key);
  const mail = readMailMessages(db, key);
  const items = new Map<string, AssistantItem>();
  const messages: AssistantMessage[] = [];
  let settled = 0;
  const children = batchSlots(db, key);
  const groups = Map.groupBy(children, (c) => c.input_id);
  function add(row: Exchange) {
    messages.push({
      id: row.input_id,
      role: "user",
      text: row.text,
      ...(row.target_id ? { taskId: row.target_id } : {}),
      ...(!row.settled ? { retryable: true } : {}),
    });
    if (!row.decision) return;
    settled += row.settled;
    const decision: AssistantDecision = JSON.parse(row.decision);
    const reply = {
      id: `reply:${row.input_id}`,
      role: "assistant" as const,
      reasoning: decision.reasoning,
    };
    if (decision.kind === "batch") {
      for (const slot of groups.get(row.input_id) ?? []) {
        if (!slot.accepted) continue;
        const child = decision.tasks[slot.ordinal]!;
        items.set(slot.task_id, { taskId: slot.task_id, title: child.title });
        messages.push({
          ...reply,
          id: slot.ordinal === 0 ? reply.id : reply.id + ":" + slot.ordinal,
          text: child.title,
          taskId: slot.task_id,
          reasoning: slot.ordinal === 0 ? decision.reasoning : undefined,
        });
      }
      return;
    }
    if (!row.settled) return;
    if (decision.kind === "new" && row.assigned_id) {
      items.set(row.assigned_id, { taskId: row.assigned_id, title: decision.title });
      messages.push({ ...reply, text: decision.title, taskId: row.assigned_id });
    } else if (decision.kind === "continue") {
      messages.push({
        ...reply,
        text: items.get(decision.taskId)?.title ?? decision.taskId,
        taskId: decision.taskId,
      });
    } else if (decision.kind === "answer" || decision.kind === "clarify") {
      messages.push({
        ...reply,
        text: decision.text,
        ...(decision.kind === "clarify" && decision.choices
          ? {
              choices: decision.choices,
              // 同一澄清只有一次决定。两个窗口同选复用回执；不同选择由原提交内容比对拒绝。
              choiceRequestId: `choice-${createHash("sha256").update(row.input_id).digest("hex")}`,
            }
          : {}),
      });
    }
  }
  for (const row of rows) {
    add(row);
    messages.push(...(mail.byInput.get(row.rowid) ?? []));
  }
  return {
    revision: `${rows.length}/${settled}/${mail.count}/${children.filter((c) => c.accepted).length}`,
    items: [...items.values()],
    messages,
  };
}

export function createWorkspaceAssistantService(
  options: Parameters<typeof createWorkspaceAssistantRuntime>[0] & {
    database(): Promise<DatabaseSync>;
    index: Pick<
      ZCodeTaskIndexSyncer,
      "ensureWorkspaceSubscription" | "onSessionTerminalEvent" | "getSessionSummary"
    >;
  },
) {
  const runtime = createWorkspaceAssistantRuntime(options, async (scope, ids) => {
    const db = await options.database();
    const waits = db
      .prepare(
        "SELECT DISTINCT task_id FROM workspace_assistant_mail WHERE workspace_key=? AND delivered=0 AND waiting_for IS NOT NULL AND task_id IN (SELECT value FROM json_each(?))",
      )
      .all(workspaceKey(scope), JSON.stringify(ids));
    return new Set(waits.map((r) => String(r.task_id)));
  });
  const queue = new Map<string, Promise<AssistantHistory>>();
  const keyOf = workspaceKey;
  const streams = createAssistantGenerations();
  const mailbox = createAssistantMailbox({ ...options, runtime, history, streams });

  async function submit(
    scope: AssistantScope,
    input: AssistantInput,
    update: UpdateGeneration,
  ): Promise<AssistantHistory> {
    const key = keyOf(scope);
    const db = await options.database();
    const before = history(db, key);
    const findItem = (id: string) => {
      const item = before.items.find((candidate) => candidate.taskId === id);
      if (!item) throw new Error("workspace-assistant.unknown-task");
      return item;
    };
    if (input.targetTaskId) findItem(input.targetTaskId);
    const preferences = JSON.stringify({
      modelSelection: input.modelSelection,
      permissionMode: input.permissionMode,
    });
    db.prepare(`INSERT INTO workspace_assistant_inputs(workspace_key,input_id,text,target_id,project_id,preferences)
      VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_key,input_id) DO NOTHING`).run(
      key,
      input.id,
      input.text,
      input.targetTaskId ?? null,
      scope.projectId ?? null,
      preferences,
    );
    const get = () =>
      db
        .prepare("SELECT * FROM workspace_assistant_inputs WHERE workspace_key=? AND input_id=?")
        .get(key, input.id) as unknown as Exchange;
    let row = get();
    if (row.text !== input.text || row.target_id !== (input.targetTaskId ?? null))
      throw new Error("workspace-assistant.input-conflict");
    // 重试时始终使用首次提交固化的选项。用户可能已经切换模型，队列中的请求仍属原选择。
    const frozen: Pick<AssistantInput, "modelSelection" | "permissionMode"> = JSON.parse(
      row.preferences ?? "{}",
    );
    if (!row.decision) {
      let decision: AssistantDecision;
      if (input.targetTaskId) {
        decision = { kind: "continue", taskId: input.targetTaskId };
      } else {
        decision = await runtime.route(
          scope,
          input.text,
          before.items,
          before.messages.filter((m) => m.id !== input.id && !m.retryable),
          frozen.modelSelection,
          update,
        );
      }
      if (decision.kind === "continue") findItem(decision.taskId);
      if (decision.kind === "clarify") decision.choices?.forEach(findItem);
      // 创建参数与分派决定一起冻结。丢失 ACK 后即使用户切换了模型，同一命令仍可原样重试。
      const recorded: RecordedDecision =
        decision.kind === "new" || decision.kind === "batch"
          ? {
              ...decision,
              delegated: true,
              executionPermissionMode: frozen.permissionMode ?? "guarded",
              executionSelection: frozen.modelSelection ?? (await runtime.preferredModel()),
            }
          : decision;
      const assigned = decision.kind === "new" ? `sess_${randomUUID()}` : null;
      const immediate = decision.kind === "answer" || decision.kind === "clarify";
      // 两个窗口可能同时收到同一提交。只有首次写入的决定和任务 ID 有效，发送前必须重新读取。
      db.prepare(`UPDATE workspace_assistant_inputs SET decision=?,assigned_id=?,settled=?
        WHERE workspace_key=? AND input_id=? AND decision IS NULL`).run(
        JSON.stringify(recorded),
        assigned,
        immediate ? 1 : 0,
        key,
        input.id,
      );
      row = get();
    }
    if (!row.settled) {
      const decision: RecordedDecision = JSON.parse(row.decision!);
      const dispatchScope = { ...scope, projectId: row.project_id ?? undefined };
      if (decision.kind === "batch") {
        // 先分配所有真实任务 ID 再并行接纳，反向工具调用从第一条开始就可以校验归属。
        const reserve = db.prepare(
          "INSERT INTO workspace_assistant_batch_items(workspace_key,input_id,ordinal,task_id) VALUES(?,?,?,?) ON CONFLICT(workspace_key,input_id,ordinal) DO NOTHING",
        );
        for (let i = 0; i < decision.tasks.length; i++)
          reserve.run(key, input.id, i, "sess_" + randomUUID());
        watchBatch(db, dispatchScope, input.id, row.text, decision.executionSelection);
        const results = await Promise.allSettled(
          batchSlots(db, key, input.id)
            .filter((s) => !s.accepted)
            .map(async (slot) => {
              const child = decision.tasks[slot.ordinal]!;
              const item = { taskId: slot.task_id, title: child.title };
              const requestId = { inputId: input.id, ordinal: slot.ordinal };
              await runtime.dispatch(
                dispatchScope,
                item,
                child.request,
                requestId,
                true,
                child.brief,
                decision.executionSelection,
                decision.executionPermissionMode ?? frozen.permissionMode,
              );
              watchDelegation(
                db,
                dispatchScope,
                item.taskId,
                requestId,
                describeDelegation(child.request, child.brief),
                decision.executionSelection,
              );
              db.prepare(
                "UPDATE workspace_assistant_batch_items SET accepted=1 WHERE workspace_key=? AND input_id=? AND ordinal=?",
              ).run(key, input.id, slot.ordinal);
              mailbox.wake(dispatchScope);
            }),
        );
        const failed = results.find((r) => r.status === "rejected");
        if (failed) throw failed.reason;
      } else {
        if (decision.kind !== "new" && decision.kind !== "continue")
          throw new Error("workspace-assistant.invalid-decision");
        const item =
          decision.kind === "new"
            ? { taskId: row.assigned_id!, title: decision.title }
            : findItem(decision.taskId);
        await runtime.dispatch(
          { ...scope, projectId: row.project_id ?? undefined },
          item,
          row.text,
          input.id,
          decision.kind === "new",
          decision.brief,
          decision.executionSelection,
          decision.executionPermissionMode ??
            (decision.kind === "new" && !decision.delegated ? "build" : frozen.permissionMode),
          decision.kind !== "new" || decision.delegated === true,
        );
        watchDelegation(
          db,
          scope,
          item.taskId,
          input.id,
          describeDelegation(row.text, decision.brief),
          frozen.modelSelection ?? decision.executionSelection,
        );
      }
      db.prepare(
        "UPDATE workspace_assistant_inputs SET settled=1 WHERE workspace_key=? AND input_id=?",
      ).run(key, input.id);
      mailbox.wake(scope);
    }
    return history(db, key);
  }

  const service: IWorkspaceAssistantService = {
    onDynamicGeneration(scope) {
      return streams.listen(scopeSchema.parse(scope));
    },
    async read(scope, knownRevision) {
      const key = keyOf(scopeSchema.parse(scope));
      const db = await options.database();
      if (knownRevision) {
        // 历史只有追加与单向确认两类可见变化，轮询进展时无需反复传输全部对话。
        const counts = db
          .prepare(
            "SELECT count(*) AS total,coalesce(sum(settled),0) AS settled,(SELECT count(*) FROM workspace_assistant_mail WHERE workspace_key=? AND kind IN ('incoming','reply','report')) AS mail,(SELECT count(*) FROM workspace_assistant_batch_items WHERE workspace_key=? AND accepted=1) AS children FROM workspace_assistant_inputs WHERE workspace_key=?",
          )
          .get(key, key, key)!;
        if (knownRevision === `${counts.total}/${counts.settled}/${counts.mail}/${counts.children}`)
          return null;
      }
      return history(db, key);
    },
    async send(rawScope, rawInput) {
      const scope = scopeSchema.parse(rawScope);
      const input = inputSchema.parse(rawInput);
      const key = keyOf(scope);
      const previous = queue.get(key);
      const run = () =>
        streams.run(
          scope,
          { id: "reply:" + input.id, requestId: input.id, kind: "router" },
          (update) => submit(scope, input, update),
        );
      const operation = previous ? previous.catch(() => undefined).then(run) : run();
      queue.set(key, operation);
      try {
        return await operation;
      } finally {
        if (queue.get(key) === operation) queue.delete(key);
      }
    },
    async progress(rawScope, input) {
      const scope = scopeSchema.parse(rawScope);
      const ids = new Set(z.array(z.string().min(1)).max(500).parse(input.taskIds));
      if (!ids.size) return [];
      const db = await options.database();
      const tasks = bindings(db, keyOf(scope), [...ids], true);
      return runtime.progressMany(scope, tasks);
    },
  };
  return { service, mailbox };
}
