import { createHash, randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { isRemoteWorkspaceIdentity, type ModelSelection } from "@zcode/shared";
import type {
  AssistantDecision,
  AssistantHistory,
  AssistantInput,
  AssistantItem,
  AssistantMessage,
  AssistantScope,
  IWorkspaceAssistantService,
} from "./contract.js";
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
  })
  .strict();

type RecordedDecision = AssistantDecision & {
  executionSelection?: ModelSelection;
};

interface Exchange {
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
    .prepare("SELECT * FROM workspace_assistant_inputs WHERE workspace_key=? ORDER BY rowid")
    .all(key) as unknown as Exchange[];
}

function history(rows: Exchange[]): AssistantHistory {
  const items = new Map<string, AssistantItem>();
  const messages: AssistantMessage[] = [];
  let settled = 0;
  for (const row of rows) {
    messages.push({
      id: row.input_id,
      role: "user",
      text: row.text,
      ...(row.target_id ? { taskId: row.target_id } : {}),
      ...(!row.settled ? { retryable: true } : {}),
    });
    if (!row.settled || !row.decision) continue;
    settled++;
    const decision: AssistantDecision = JSON.parse(row.decision);
    const reply = { id: `reply:${row.input_id}`, role: "assistant" as const };
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
  return { revision: `${rows.length}/${settled}`, items: [...items.values()], messages };
}

export function createWorkspaceAssistantService(
  options: Parameters<typeof createWorkspaceAssistantRuntime>[0] & {
    database(): Promise<DatabaseSync>;
  },
): IWorkspaceAssistantService {
  const runtime = createWorkspaceAssistantRuntime(options);
  const queue = new Map<string, Promise<AssistantHistory>>();
  const keyOf = (scope: AssistantScope) => scope.workspaceIdentity?.trim() || scope.workspacePath;

  async function submit(scope: AssistantScope, input: AssistantInput): Promise<AssistantHistory> {
    const key = keyOf(scope);
    const db = await options.database();
    const before = history(exchanges(db, key));
    const findItem = (id: string) => {
      const item = before.items.find((candidate) => candidate.taskId === id);
      if (!item) throw new Error("workspace-assistant.unknown-task");
      return item;
    };
    if (input.targetTaskId) findItem(input.targetTaskId);
    db.prepare(`INSERT INTO workspace_assistant_inputs(workspace_key,input_id,text,target_id,project_id)
      VALUES(?,?,?,?,?) ON CONFLICT(workspace_key,input_id) DO NOTHING`).run(
      key,
      input.id,
      input.text,
      input.targetTaskId ?? null,
      scope.projectId ?? null,
    );
    const get = () =>
      db
        .prepare("SELECT * FROM workspace_assistant_inputs WHERE workspace_key=? AND input_id=?")
        .get(key, input.id) as unknown as Exchange;
    let row = get();
    if (row.text !== input.text || row.target_id !== (input.targetTaskId ?? null))
      throw new Error("workspace-assistant.input-conflict");
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
        );
      }
      if (decision.kind === "continue") findItem(decision.taskId);
      if (decision.kind === "clarify") decision.choices?.forEach(findItem);
      // 创建参数与分派决定一起冻结。丢失 ACK 后即使用户切换了模型，同一命令仍可原样重试。
      const recorded: RecordedDecision =
        decision.kind === "new"
          ? { ...decision, executionSelection: await runtime.preferredModel() }
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
      );
      db.prepare(
        "UPDATE workspace_assistant_inputs SET settled=1 WHERE workspace_key=? AND input_id=?",
      ).run(key, input.id);
    }
    return history(exchanges(db, key));
  }

  return {
    async read(scope, knownRevision) {
      const key = keyOf(scopeSchema.parse(scope));
      const db = await options.database();
      if (knownRevision) {
        // 历史只有追加与单向确认两类可见变化，轮询进展时无需反复传输全部对话。
        const counts = db
          .prepare(
            "SELECT count(*) AS total,coalesce(sum(settled),0) AS settled FROM workspace_assistant_inputs WHERE workspace_key=?",
          )
          .get(key)!;
        if (knownRevision === `${counts.total}/${counts.settled}`) return null;
      }
      return history(exchanges(db, key));
    },
    async send(rawScope, rawInput) {
      const scope = scopeSchema.parse(rawScope);
      const input = inputSchema.parse(rawInput);
      const key = keyOf(scope);
      const previous = queue.get(key);
      const operation = previous
        ? previous.catch(() => undefined).then(() => submit(scope, input))
        : submit(scope, input);
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
      const rows = db
        .prepare(`SELECT assigned_id,decision FROM workspace_assistant_inputs
        WHERE workspace_key=? AND settled=1 AND assigned_id IS NOT NULL AND assigned_id IN (SELECT value FROM json_each(?))`)
        .all(keyOf(scope), JSON.stringify([...ids]));
      return runtime.progressMany(
        scope,
        rows.map((row) => ({
          taskId: String(row.assigned_id),
          title: JSON.parse(String(row.decision)).title,
        })),
      );
    },
  };
}
