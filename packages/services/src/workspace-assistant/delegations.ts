import type { DatabaseSync } from "node:sqlite";
import type { ModelSelection } from "@zcode/shared";
import type { AssistantDecision, AssistantItem } from "./contract.js";
export type AssistantRequestId = string | { inputId: string; ordinal: number };

interface Binding extends AssistantItem {
  requestId: AssistantRequestId;
  text: string;
  brief?: string;
  selection?: ModelSelection;
}
export function bindings(
  db: DatabaseSync,
  key: string,
  taskIds: string[],
  acceptedOnly: boolean,
): Binding[] {
  const targets = JSON.stringify(taskIds);
  const rows = db
    .prepare(`SELECT input_id,text,decision,assigned_id AS task_id,NULL AS ordinal FROM workspace_assistant_inputs
    WHERE workspace_key=? AND assigned_id IN (SELECT value FROM json_each(?)) AND (settled=1 OR ?=0)
    UNION ALL SELECT i.input_id,i.text,i.decision,b.task_id,b.ordinal FROM workspace_assistant_batch_items b
    JOIN workspace_assistant_inputs i ON i.workspace_key=b.workspace_key AND i.input_id=b.input_id
    WHERE b.workspace_key=? AND b.task_id IN (SELECT value FROM json_each(?)) AND (b.accepted=1 OR ?=0)`)
    .all(key, targets, Number(acceptedOnly), key, targets, Number(acceptedOnly));
  return rows.flatMap((row) => {
    const decision: AssistantDecision & { executionSelection?: ModelSelection } = JSON.parse(
      String(row.decision),
    );
    const inputId = String(row.input_id);
    const assignment =
      decision.kind === "new"
        ? { title: decision.title, request: String(row.text), brief: decision.brief }
        : decision.kind === "batch"
          ? decision.tasks[Number(row.ordinal)]
          : undefined;
    if (!assignment) return [];
    return [
      {
        taskId: String(row.task_id),
        title: assignment.title,
        requestId: row.ordinal === null ? inputId : { inputId, ordinal: Number(row.ordinal) },
        text: assignment.request,
        brief: assignment.brief,
        selection: decision.executionSelection,
      },
    ];
  });
}
export interface BatchSlot {
  input_id: string;
  ordinal: number;
  task_id: string;
  accepted: number;
}
export function batchSlots(db: DatabaseSync, key: string, inputId?: string): BatchSlot[] {
  const sql =
    "SELECT input_id,ordinal,task_id,accepted FROM workspace_assistant_batch_items WHERE workspace_key=?";
  return (inputId
    ? db.prepare(sql + " AND input_id=? ORDER BY ordinal").all(key, inputId)
    : db.prepare(sql + " ORDER BY input_id,ordinal").all(key)) as unknown as BatchSlot[];
}

export interface BatchResult {
  item: AssistantItem;
  assignment: string;
  turnRequest: string;
  summary: string;
  output: string;
}
export function readCompletedBatch(db: DatabaseSync, key: string, inputId: string) {
  const slots = batchSlots(db, key, inputId);
  if (!slots.length || slots.some((slot) => !slot.accepted)) return;
  const ids = slots.map((slot) => slot.task_id);
  const pending = db
    .prepare(`SELECT 1 FROM workspace_assistant_mail WHERE workspace_key=? AND delivered=0
    AND task_id IN (SELECT value FROM json_each(?)) LIMIT 1`)
    .get(key, JSON.stringify(ids));
  if (pending) return;
  const tasks = new Map(bindings(db, key, ids, true).map((b) => [b.taskId, b]));
  const latest = db.prepare(`SELECT event_id,body,response FROM workspace_assistant_mail
    WHERE workspace_key=? AND task_id=? AND kind='watch' AND delivered=1 ORDER BY rowid DESC LIMIT 1`);
  const readReport = db.prepare(
    "SELECT body FROM workspace_assistant_mail WHERE workspace_key=? AND event_id=?",
  );
  const results: BatchResult[] = [];
  const evidenceIds: string[] = [];
  for (const id of ids) {
    const task = tasks.get(id);
    const turn = latest.get(key, id);
    if (!task || !turn) return;
    const report = readReport.get(key, "report:" + turn.event_id);
    if (!report) return;
    results.push({
      item: { taskId: id, title: task.title },
      assignment: task.text,
      turnRequest: JSON.parse(String(turn.body)).text,
      summary: JSON.parse(String(report.body)).text,
      output: String(turn.response ?? ""),
    });
    evidenceIds.push(String(turn.event_id));
  }
  return { results, basis: JSON.stringify(evidenceIds) };
}
