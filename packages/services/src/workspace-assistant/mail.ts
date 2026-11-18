import { bindings, readCompletedBatch, type AssistantRequestId } from "./delegations.js";
import type { createAssistantGenerations, UpdateGeneration } from "./generation.js";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ModelSelection } from "@zcode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import type { ZCodeTaskIndexSyncer } from "#src/zcode-agent/zcodeTaskIndexSyncer.js";
import type {
  AssistantHistory,
  AssistantItem,
  AssistantMessage,
  AssistantScope,
} from "./contract.js";
import {
  assistantCommandId,
  type createWorkspaceAssistantRuntime,
  type MailDecision,
  type ObservedOutput,
} from "./runtime.js";

const log = createServiceLogger("WorkspaceAssistant");
export const workspaceKey = (s: AssistantScope) => s.workspaceIdentity?.trim() || s.workspacePath;
interface MailBody {
  scope: AssistantScope;
  text: string;
  selection?: ModelSelection;
  reasoning?: string;
  assistantIntent?: "question" | "update";
  rootWatch?: string;
  batchInput?: string;
}
interface MailRow {
  event_id: string;
  task_id: string;
  after_input: number;
  kind: "incoming" | "watch" | "reply" | "report" | "batch_watch";
  body: string;
  response: string | null;
  waiting_for: string | null;
  delivered: number;
  attempts: number;
  retry_at: number;
}
type Incoming = {
  sessionId: string;
  callId: string;
  turnId: string;
  text: string;
  assistantIntent?: "question" | "update";
};
type Runtime = ReturnType<typeof createWorkspaceAssistantRuntime>;

function getEvent(db: DatabaseSync, key: string, id: string): MailRow | undefined {
  return db
    .prepare("SELECT * FROM workspace_assistant_mail WHERE workspace_key=? AND event_id=?")
    .get(key, id) as unknown as MailRow | undefined;
}
function append(
  db: DatabaseSync,
  key: string,
  id: string,
  taskId: string,
  kind: MailRow["kind"],
  body: MailBody,
  complete = false,
) {
  db.prepare(`INSERT INTO workspace_assistant_mail(workspace_key,event_id,task_id,after_input,kind,body,delivered)
  SELECT ?,?,?,coalesce(max(rowid),0),?,?,? FROM workspace_assistant_inputs WHERE workspace_key=?
  ON CONFLICT(workspace_key,event_id) DO NOTHING`).run(
    key,
    id,
    taskId,
    kind,
    JSON.stringify(body),
    complete ? 1 : 0,
    key,
  );
}
export function describeDelegation(text: string, brief?: string) {
  return brief ? text + "\n\nPreviously agreed context:\n" + brief : text;
}
export function watchBatch(
  db: DatabaseSync,
  scope: AssistantScope,
  inputId: string,
  text: string,
  selection?: ModelSelection,
) {
  const id = "batch:" + createHash("sha256").update(inputId).digest("hex");
  append(db, workspaceKey(scope), id, "", "batch_watch", {
    scope,
    text,
    batchInput: inputId,
    selection,
  });
}
export function watchDelegation(
  db: DatabaseSync,
  scope: AssistantScope,
  taskId: string,
  requestId: AssistantRequestId,
  text: string,
  selection?: ModelSelection,
  rootWatch?: string,
) {
  const command = assistantCommandId(scope, requestId);
  append(db, workspaceKey(scope), command, taskId, "watch", { scope, text, selection, rootWatch });
  return command;
}
export function readMailMessages(db: DatabaseSync, key: string) {
  const rows = db
    .prepare(
      "SELECT * FROM workspace_assistant_mail WHERE workspace_key=? AND kind IN ('incoming','reply','report') ORDER BY rowid",
    )
    .all(key) as unknown as MailRow[];
  const byInput = new Map<number, AssistantMessage[]>();
  for (const row of rows) {
    const body: MailBody = JSON.parse(row.body);
    const messages = byInput.get(row.after_input) ?? [];
    messages.push({
      id: "mail:" + row.event_id,
      role: "assistant",
      ...(row.task_id ? { taskId: row.task_id } : {}),
      kind: row.kind === "incoming" ? "worker" : row.kind === "reply" ? "reply" : "report",
      text: body.text,
      reasoning: body.reasoning,
    });
    byInput.set(row.after_input, messages);
  }
  return { byInput, count: rows.length };
}

function evidenceForQuestion(text: string, question: string) {
  if (text.length <= 12000) return text;
  // 长输出按原顺序保留首尾和命中问题关键词的段落，同时带上来源会话以便复核完整结果。
  const chunks = text.match(/[\s\S]{1,800}/g) ?? [];
  const words = [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(question)]
    .filter((token) => token.isWordLike && token.segment.length > 1)
    .slice(0, 80)
    .map((token) => token.segment.toLowerCase());
  const ranked = chunks.map((chunk, index) => {
    const content = chunk.toLowerCase();
    return { index, score: words.filter((word) => content.includes(word)).length };
  });
  const keep = new Set([
    0,
    chunks.length - 1,
    ...ranked
      .filter((x) => x.score)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((x) => x.index),
  ]);
  return [...keep]
    .sort((a, b) => a - b)
    .map((i) => chunks[i])
    .join("\n[…]\n");
}

export function createAssistantMailbox(options: {
  database(): Promise<DatabaseSync>;
  runtime: Runtime;
  streams: ReturnType<typeof createAssistantGenerations>;
  index: Pick<ZCodeTaskIndexSyncer, "ensureWorkspaceSubscription" | "onSessionTerminalEvent">;
  history(db: DatabaseSync, key: string): AssistantHistory;
}) {
  const { runtime } = options;
  let disposed = false;
  const active = new Set<string>();
  const queued = new Set<string>();
  const retries = new Map<string, ReturnType<typeof setTimeout>>();
  const retryDelay = new Map<string, number>();
  const watchedTasks = new Map<string, Set<string>>();

  function finish(db: DatabaseSync, key: string, id: string) {
    db.prepare(
      "UPDATE workspace_assistant_mail SET delivered=1 WHERE workspace_key=? AND event_id=?",
    ).run(key, id);
  }
  function visible(
    db: DatabaseSync,
    key: string,
    row: MailRow,
    kind: "reply" | "report",
    message: { text: string; reasoning?: string },
  ) {
    const body: MailBody = JSON.parse(row.body);
    append(
      db,
      key,
      kind + ":" + row.event_id,
      row.task_id,
      kind,
      { scope: body.scope, ...message },
      true,
    );
  }
  // 重复的终态事件不能反复计费。模型重试配额和最早重试时间随来源事件落盘。
  function tryAgain(db: DatabaseSync, key: string, row: MailRow) {
    const attempt = row.attempts + 1;
    db.prepare(
      "UPDATE workspace_assistant_mail SET attempts=attempts+1,retry_at=? WHERE workspace_key=? AND event_id=?",
    ).run(Date.now() + attempt * 5000, key, row.event_id);
    return attempt < 3;
  }
  function owned(db: DatabaseSync, key: string, id: string) {
    return bindings(db, key, [id], false)[0];
  }
  function originalAssignment(row: ReturnType<typeof owned>) {
    return row ? describeDelegation(row.text, row.brief) : "";
  }
  function dependency(
    db: DatabaseSync,
    scope: AssistantScope,
    key: string,
    sender: string,
    target: string,
  ) {
    // 依赖绑定收到问题时可以观察到的最近委托；后续给 B 的其他输入不会替换已经选中的回合。
    const watches = db
      .prepare(
        "SELECT event_id FROM workspace_assistant_mail WHERE workspace_key=? AND task_id=? AND kind='watch' AND json_extract(body,'$.rootWatch') IS NULL ORDER BY rowid DESC LIMIT 1",
      )
      .get(key, target);
    let watchId = watches?.event_id;
    if (!watchId) {
      const targetBinding = owned(db, key, target);
      if (targetBinding && typeof targetBinding.requestId !== "string")
        watchId = assistantCommandId(scope, targetBinding.requestId);
    }
    if (!watchId) {
      const previous = db
        .prepare(`SELECT input_id,text,decision FROM workspace_assistant_inputs WHERE workspace_key=? AND settled=1 AND
        (assigned_id=? OR json_extract(decision,'$.taskId')=?) ORDER BY rowid DESC LIMIT 1`)
        .get(key, target, target);
      if (!previous) return undefined;
      const result = JSON.parse(String(previous.decision));
      watchId = watchDelegation(
        db,
        scope,
        target,
        String(previous.input_id),
        String(previous.text),
        result.executionSelection,
      );
      queued.add(key);
    }
    const cycle = db
      .prepare(`WITH RECURSIVE dependencies(id) AS (
      SELECT ? UNION SELECT w.task_id FROM dependencies d JOIN workspace_assistant_mail i ON i.workspace_key=? AND i.task_id=d.id AND i.delivered=0
      JOIN workspace_assistant_mail w ON w.workspace_key=i.workspace_key AND w.event_id=i.waiting_for)
      SELECT 1 FROM dependencies WHERE id=? LIMIT 1`)
      .get(target, key, sender);
    return cycle ? undefined : String(watchId);
  }

  async function processIncoming(
    db: DatabaseSync,
    key: string,
    row: MailRow,
    scope: AssistantScope,
    update: UpdateGeneration,
  ) {
    const body: MailBody = JSON.parse(row.body);
    // 明确的单向汇报已作为 worker 消息入库。无需模型确认；正式回合结束时另由助手总结最终输出。
    if (body.assistantIntent === "update") {
      finish(db, key, row.event_id);
      return;
    }
    const senderRow = owned(db, key, row.task_id);
    if (!senderRow) return;
    const sender = { taskId: row.task_id, title: senderRow.title };
    let decision: MailDecision;
    if (!row.response) {
      const history = options.history(db, key);
      const reserved = db
        .prepare(
          "SELECT task_id FROM workspace_assistant_batch_items WHERE workspace_key=? AND accepted=0",
        )
        .all(key);
      const items = [
        ...history.items,
        ...bindings(
          db,
          key,
          reserved.map((r) => String(r.task_id)),
          false,
        ).map(({ taskId, title }) => ({ taskId, title })),
      ];
      const ranked = items
        .toReversed()
        .sort(
          (a, b) =>
            Number(body.text.includes(b.title) || body.text.includes(b.taskId)) -
            Number(body.text.includes(a.title) || body.text.includes(a.taskId)),
        );
      try {
        decision = await runtime.reply(
          scope,
          sender,
          body.text,
          ranked.slice(0, 80),
          history.messages,
          body.selection,
          update,
        );
        if (body.assistantIntent === "question" && decision.kind === "report")
          throw new Error("workspace-assistant.expected-answer");
      } catch {
        if (disposed || tryAgain(db, key, row)) return;
        decision = {
          kind: "reply",
          text: "The workspace assistant could not resolve this message. Describe the missing information to the user before proceeding.",
        };
      }
      if (disposed) return;
      let wait: string | undefined;
      if (decision.kind === "wait") {
        wait = dependency(db, scope, key, sender.taskId, decision.taskId);
        if (!wait)
          decision = {
            kind: "reply",
            text: "The requested dependency has no available delegated turn, or would create a circular wait. Report this blocker and ask the user for the missing information.",
          };
      }
      db.prepare(
        "UPDATE workspace_assistant_mail SET response=?,waiting_for=? WHERE workspace_key=? AND event_id=? AND response IS NULL",
      ).run(JSON.stringify(decision), wait ?? null, key, row.event_id);
      row = getEvent(db, key, row.event_id)!;
    }
    decision = JSON.parse(row.response!);
    if (decision.kind === "report") {
      visible(db, key, row, "report", decision);
      finish(db, key, row.event_id);
      return;
    }
    let answer: string;
    let reasoning = decision.reasoning;
    const frozen = (JSON.parse(row.response!) as { answer?: { text: string; reasoning?: string } })
      .answer;
    if (frozen) {
      answer = frozen.text;
      reasoning = frozen.reasoning;
    } else if (decision.kind === "wait") {
      const root = row.waiting_for!;
      const sourceWatch = getEvent(db, key, root);
      if (!sourceWatch) return;
      // B 自己可能在等 C，等普通队列接纳 B 的恢复输入，再取这条委托链最后的真实结果。
      const pending = db
        .prepare(`SELECT 1 FROM workspace_assistant_mail WHERE workspace_key=? AND task_id=? AND kind='incoming' AND delivered=0
        AND json_extract(body,'$.rootWatch')=? AND coalesce(json_extract(body,'$.assistantIntent'),'question')!='update' LIMIT 1`)
        .get(key, sourceWatch.task_id, root);
      if (pending) return;
      const continued = db
        .prepare(
          "SELECT * FROM workspace_assistant_mail WHERE workspace_key=? AND kind='watch' AND json_extract(body,'$.rootWatch')=? ORDER BY rowid DESC LIMIT 1",
        )
        .get(key, root) as unknown as MailRow | undefined;
      const observed = continued ?? sourceWatch;
      const report = getEvent(db, key, "report:" + observed.event_id);
      if (!report) return;
      const origin = owned(db, key, report.task_id);
      const source = {
        taskId: report.task_id,
        title: origin?.title ?? report.task_id,
      };
      {
        const summary: MailBody = JSON.parse(report.body);
        const raw = observed.response ?? "";
        let result: { text: string; reasoning?: string };
        try {
          result = await runtime.answerDependency(
            scope,
            body.text,
            { item: sender, assignment: originalAssignment(senderRow) },
            {
              item: source,
              assignment: originalAssignment(origin),
              turnRequest: (JSON.parse(sourceWatch.body) as MailBody).text,
              summary: summary.text,
              output: evidenceForQuestion(raw, body.text + " " + String(senderRow.text)),
            },
            body.selection,
            update,
          );
        } catch {
          if (disposed || tryAgain(db, key, row)) return;
          result = {
            text:
              "The workspace assistant could not verify a specific answer. Ask the user to clarify before using this result. Source summary: " +
              summary.text,
          };
        }
        if (disposed) return;
        // 模型回复先固化，再投递。丢失回执或双窗口竞争时，原任务始终收到相同的命令载荷。
        db.prepare(
          "UPDATE workspace_assistant_mail SET response=json_set(response,'$.answer',json(?)) WHERE workspace_key=? AND event_id=? AND json_extract(response,'$.answer') IS NULL",
        ).run(
          JSON.stringify({
            ...result,
            text: `From ${source.title} (${source.taskId}):\n${result.text}`,
          }),
          key,
          row.event_id,
        );
        const committed = JSON.parse(getEvent(db, key, row.event_id)!.response!).answer;
        answer = committed.text;
        reasoning = committed.reasoning;
      }
    } else answer = decision.text;
    const prompt = `[Workspace assistant reply]\nQuestion: ${body.text}\n\n${answer}`;
    const requestId = "mail-reply:" + row.event_id;
    try {
      await runtime.dispatch(scope, sender, prompt, requestId, false);
    } catch (error) {
      if (!(error instanceof Error && error.message === "workspace-assistant.deleted")) throw error;
      visible(db, key, row, "report", {
        text: "This task was deleted before the workspace assistant could deliver its reply.",
      });
      finish(db, key, row.event_id);
      return;
    }
    if (disposed) return;
    // 回投同样对应一个可总结的普通轮次。重放时 CommandInbox 的命令 ID 与内容都保持稳定。
    watchDelegation(
      db,
      scope,
      sender.taskId,
      requestId,
      prompt,
      body.selection,
      body.rootWatch ?? assistantCommandId(scope, senderRow.requestId),
    );
    visible(db, key, row, "reply", { text: answer, reasoning });
    finish(db, key, row.event_id);
    queued.add(key);
  }

  async function processWatches(db: DatabaseSync, scope: AssistantScope, rows: MailRow[]) {
    const key = workspaceKey(scope);
    const grouped = Map.groupBy(rows, (r) => r.task_id);
    for (const [taskId, watches] of grouped) {
      const origin = owned(db, key, taskId);
      if (!origin) continue;
      const item: AssistantItem = { taskId, title: origin.title };
      const [fact] = await runtime.progressMany(scope, [item]);
      if (!fact || fact.status === "unavailable") continue;
      let outputs = new Map<string, ObservedOutput>();
      try {
        if (fact.status !== "deleted")
          outputs = await runtime.completion(
            scope,
            item,
            new Set(watches.map((r) => r.event_id)),
            fact.status,
          );
      } catch {
        log.warn(undefined, "Could not read a delegated turn");
        continue;
      }
      for (const row of watches) {
        if (disposed) return;
        const body: MailBody = JSON.parse(row.body);
        const output = outputs.get(row.event_id);
        if (!output && fact.status !== "deleted") continue;
        await options.streams.run(
          scope,
          { id: "mail:report:" + row.event_id, requestId: row.event_id, kind: "report", taskId },
          async (update) => {
            let report: { text: string; reasoning?: string };
            if (!output)
              report = { text: "The delegated task was deleted before its result was available." };
            else if (output.blocked) report = { text: output.text };
            else {
              try {
                report = await runtime.report(
                  scope,
                  item,
                  body.text,
                  output.text,
                  body.selection,
                  update,
                );
              } catch {
                if (disposed || tryAgain(db, key, row)) return;
                report = {
                  text:
                    "The workspace assistant could not summarize this turn. Worker output:\n" +
                    output.text.slice(0, 1600),
                };
              }
            }
            if (disposed) return;
            // 原始结论单独留在回合观察记录，仅定向提问读取，不随长历史反复传给 Renderer。
            db.prepare(
              "UPDATE workspace_assistant_mail SET response=coalesce(response,?) WHERE workspace_key=? AND event_id=?",
            ).run(output?.text ?? report.text, key, row.event_id);
            visible(db, key, row, "report", report);
            finish(db, key, row.event_id);
          },
        );
      }
    }
  }
  async function processBatch(db: DatabaseSync, scope: AssistantScope, row: MailRow) {
    const key = workspaceKey(scope);
    const body: MailBody = JSON.parse(row.body);
    if (!body.batchInput) return;
    const inputId = body.batchInput;
    const before = readCompletedBatch(db, key, inputId);
    if (!before) return;
    await options.streams.run(
      scope,
      { id: "mail:report:" + row.event_id, requestId: row.event_id, kind: "report" },
      async (update) => {
        let result: { text: string; reasoning?: string };
        try {
          result = await runtime.reportBatch(
            scope,
            body.text,
            before.results,
            body.selection,
            update,
          );
        } catch {
          if (disposed || tryAgain(db, key, row)) return;
          result = {
            text:
              "The workspace assistant could not generate an overall conclusion. The recorded results are:\n" +
              before.results.map((r) => r.item.title + " — " + r.summary).join("\n"),
          };
        }
        if (disposed) return;
        // 生成过程中用户可继续原任务。与最新回执在同一短事务中复验，避免旧结论覆盖新回合。
        db.exec("BEGIN IMMEDIATE");
        try {
          const latest = readCompletedBatch(db, key, inputId);
          if (latest?.basis === before.basis) {
            visible(db, key, row, "report", result);
            finish(db, key, row.event_id);
          } else queued.add(key);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    );
  }
  async function drain(scope: AssistantScope) {
    const key = workspaceKey(scope);
    if (disposed) return;
    if (active.has(key)) {
      queued.add(key);
      return;
    }
    active.add(key);
    clearTimeout(retries.get(key));
    retries.delete(key);
    try {
      const db = await options.database();
      do {
        queued.delete(key);
        const rows = db
          .prepare(
            "SELECT * FROM workspace_assistant_mail WHERE workspace_key=? AND delivered=0 ORDER BY rowid",
          )
          .all(key) as unknown as MailRow[];
        if (!rows.length || disposed) {
          retryDelay.delete(key);
          watchedTasks.delete(key);
          return;
        }
        watchedTasks.set(key, new Set(rows.map((row) => row.task_id)));
        options.index.ensureWorkspaceSubscription(scope);
        const ready = rows.filter((r) => r.retry_at <= Date.now());
        try {
          await processWatches(
            db,
            scope,
            ready.filter((r) => r.kind === "watch"),
          );
        } catch {
          log.warn(undefined, "Could not read delegated turn output");
        }
        for (const row of ready.filter((r) => r.kind === "incoming")) {
          if (disposed) return;
          try {
            await options.streams.run(
              scope,
              {
                id: "mail:reply:" + row.event_id,
                requestId: row.event_id,
                kind: "reply",
                taskId: row.task_id,
              },
              (update) => processIncoming(db, key, row, scope, update),
            );
          } catch {
            log.warn(undefined, "Worker message processing deferred");
          }
        }
        for (const row of ready.filter((r) => r.kind === "batch_watch")) {
          if (disposed) return;
          await processBatch(db, scope, row);
        }
      } while (queued.has(key) && !disposed);
    } catch {
      log.warn(undefined, "Delegation observation deferred");
    } finally {
      active.delete(key);
      if (!disposed && !retries.has(key) && retryDelay.has(key)) {
        const delay = retryDelay.get(key)!;
        retryDelay.set(key, Math.min(delay * 2, 60000));
        const timer = setTimeout(() => void drain(scope), delay);
        timer.unref();
        retries.set(key, timer);
      }
    }
  }
  function wake(scope: AssistantScope) {
    if (disposed) return;
    retryDelay.set(workspaceKey(scope), 2000);
    void drain(scope);
  }
  const sub = options.index.onSessionTerminalEvent(({ target }) => {
    const key = workspaceKey(target);
    if (watchedTasks.get(key)?.has(target.sessionId)) wake(target);
  });
  return {
    wake,
    async recover() {
      const db = await options.database();
      if (disposed) return;
      const keys = db
        .prepare(
          "SELECT min(rowid),body FROM workspace_assistant_mail WHERE delivered=0 GROUP BY workspace_key",
        )
        .all();
      for (const row of keys) wake((JSON.parse(String(row.body)) as MailBody).scope);
    },
    async receive(scope: AssistantScope, mail: Incoming) {
      const key = workspaceKey(scope);
      const db = await options.database();
      const origin = owned(db, key, mail.sessionId);
      if (!origin || disposed) throw new Error("workspace-assistant.unknown-task");
      const id =
        "incoming:" +
        createHash("sha256")
          .update(JSON.stringify([mail.sessionId, mail.turnId, mail.callId]))
          .digest("hex");
      const selection = origin.selection;
      const latest = db
        .prepare(
          "SELECT event_id,body FROM workspace_assistant_mail WHERE workspace_key=? AND task_id=? AND kind='watch' ORDER BY rowid DESC LIMIT 1",
        )
        .get(key, mail.sessionId);
      const rootWatch = latest
        ? (JSON.parse(String(latest.body)).rootWatch ?? String(latest.event_id))
        : assistantCommandId(scope, origin.requestId);
      append(db, key, id, mail.sessionId, "incoming", {
        scope,
        text: mail.text,
        selection,
        assistantIntent: mail.assistantIntent,
        rootWatch,
      });
      const row = getEvent(db, key, id)!;
      const persisted: MailBody = JSON.parse(row.body);
      if (persisted.text !== mail.text || persisted.assistantIntent !== mail.assistantIntent)
        throw new Error("workspace-assistant.input-conflict");
      if (!row.delivered) wake(scope);
    },
    dispose() {
      disposed = true;
      options.streams.dispose();
      sub.dispose();
      for (const timer of retries.values()) clearTimeout(timer);
      retries.clear();
      retryDelay.clear();
      watchedTasks.clear();
    },
  };
}
