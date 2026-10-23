import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { overlaps } from "./pathSafety.js";
import { withOfflineHistorySnapshot } from "./historySnapshot.js";
import type {
  HistoryImportBundle,
  HistoryImportContract,
  HistoryImportPreview,
  HistoryImportReport,
} from "./contract.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const secret =
  /-----BEGIN (?:\w+ )?PRIVATE KEY-----|(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})|(?:api[_-]?key|password|access[_-]?token|authorization)\s*[=:]\s*["']?[^\s"']{8,}/i;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Unsupported JSON record");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 256 * 1024): string {
  if (typeof value !== "string" || Buffer.byteLength(value) > max || value.includes("\0"))
    throw new Error("Unsupported text field");
  return value;
}
function timestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Unsupported timestamp");
  return value;
}
interface StoredMessage {
  id: string;
  time_created: number;
  data: string;
  sequence: number;
}
/** Strict subset of contracts/rewind selectActiveConversationBranch; ambiguous legacy records reject. */
function activeMessages(messages: StoredMessage[], revertJson: unknown): StoredMessage[] {
  if (revertJson === null) return messages;
  const revert = record(JSON.parse(text(revertJson)));
  if (typeof revert.targetMessageID !== "string") throw new Error("Unrecognized rewind branch");
  const byId = new Map(messages.map((message) => [message.id, message]));
  const target = messages.findIndex((message) => message.id === revert.targetMessageID);
  if (target < 0) throw new Error("Missing rewind target");
  let kept = messages.slice(0, target);
  if (revert.keptMessageIDs !== undefined) {
    if (
      !Array.isArray(revert.keptMessageIDs) ||
      revert.keptMessageIDs.some((id) => typeof id !== "string" || !byId.has(id))
    )
      throw new Error("Invalid kept branch");
    kept = revert.keptMessageIDs.map((id) => byId.get(String(id))!);
  }
  const cutId = revert.branchCutAfterMessageID ?? revert.createdMessageID;
  if (cutId !== undefined) {
    if (typeof cutId !== "string") throw new Error("Invalid branch cursor");
    const cut = messages.findIndex((message) => message.id === cutId);
    if (cut < 0) throw new Error("Missing branch cursor");
    kept = [...kept, ...messages.slice(cut + (revert.branchCutAfterMessageID ? 1 : 0))];
  }
  if (new Set(kept.map((message) => message.id)).size !== kept.length)
    throw new Error("Ambiguous branch ordering");
  return kept;
}

function readHistory(db: DatabaseSync, source: string, databaseHash: string) {
  const rows = db
    .prepare(
      "SELECT id,title,directory,workspace_id,time_created,time_updated,revert FROM session WHERE time_deleted IS NULL AND task_type='interactive' ORDER BY time_created,id LIMIT 101",
    )
    .all();
  if (rows.length > 100) throw new Error("History import is limited to 100 sessions per source");
  const identity = db
    .prepare("SELECT identity FROM zcode_database_identity WHERE scope='session'")
    .get();
  const sourceIdentity = identity ? text(identity.identity, 1024) : `path:${hash(source)}`;
  const bundles: HistoryImportBundle[] = [];
  const skipped: HistoryImportPreview["skipped"] = [];
  let bytes = 0;
  for (const row of rows) {
    const sourceSessionId = text(row.id, 512);
    try {
      if (row.workspace_id !== null)
        throw new Error("Remote or identity-bound project requires explicit project remapping");
      const title = text(row.title, 4096);
      const directory = text(row.directory, 4096);
      if (!isAbsolute(directory)) throw new Error("Project path is not local to this platform");
      if (secret.test(title))
        throw new Error("Sensitive text pattern; remove sensitive content before import");
      const stored = db
        .prepare(
          "SELECT id,time_created,data,sequence FROM message WHERE session_id=? ORDER BY sequence IS NULL,sequence,time_created,rowid LIMIT 2001",
        )
        .all(sourceSessionId) as unknown as StoredMessage[];
      if (stored.length > 2000 || stored.some((message) => !Number.isSafeInteger(message.sequence)))
        throw new Error("Unsupported message order or size");
      if (new Set(stored.map((message) => message.sequence)).size !== stored.length)
        throw new Error("Ambiguous message order");
      const messages: HistoryImportBundle["messages"] = [];
      const branch = activeMessages(stored, row.revert);
      let sessionBytes = 0;
      for (const message of branch) {
        const data = record(JSON.parse(text(message.data, 1024 * 1024)));
        if (data.summary !== undefined)
          throw new Error("Summarized history requires a verified context conversion");
        const parts = db
          .prepare(
            "SELECT data,sequence FROM part WHERE session_id=? AND message_id=? ORDER BY sequence IS NULL,sequence,time_created,id LIMIT 1001",
          )
          .all(sourceSessionId, message.id);
        if (parts.length > 1000 || parts.some((part) => !Number.isSafeInteger(part.sequence)))
          throw new Error("Unsupported part order or size");
        const parsedParts = parts.map((part) => record(JSON.parse(text(part.data, 1024 * 1024))));
        if (parsedParts.some((part) => part.type === "compaction"))
          throw new Error("Compacted history requires a verified context conversion");
        if (data.role !== "user" && data.role !== "assistant")
          throw new Error("Unsupported message role");
        if (data.synthetic === true || data.visibility === "model-only") continue;
        if (data.visibility !== undefined && data.visibility !== "user-visible")
          throw new Error("Unsupported message visibility");
        if (data.semantics !== undefined) {
          const semantics = record(data.semantics);
          if (semantics.uiVisibility !== "visible" || semantics.transcriptVisibility !== "visible")
            continue;
          if (
            data.role === "user" &&
            semantics.origin !== "real_user" &&
            semantics.origin !== "import"
          )
            continue;
          if (
            data.role === "assistant" &&
            semantics.origin !== "agent_runtime" &&
            semantics.origin !== "import"
          )
            continue;
          if (
            data.role === "user" &&
            semantics.kind !== "user_prompt" &&
            semantics.kind !== "slash_command"
          )
            continue;
          if (data.role === "assistant" && semantics.kind !== "assistant_response") continue;
        }
        if (data.anchor !== undefined) {
          const anchor = record(data.anchor);
          if (data.role === "user" && anchor.origin !== undefined && anchor.origin !== "realUser")
            continue;
        }
        const texts: string[] = [];
        for (const value of parsedParts) {
          if (value.type === "compaction")
            throw new Error("Compacted history requires a verified context conversion");
          if (value.type !== "text" || value.synthetic === true || value.ignored === true) continue;
          const content = text(value.text);
          if (secret.test(content))
            throw new Error("Sensitive text pattern; remove sensitive content before import");
          sessionBytes += Buffer.byteLength(content);
          if (sessionBytes > 1024 * 1024) throw new Error("Session exceeds 1 MiB of visible text");
          texts.push(content);
        }
        if (texts.length)
          messages.push({
            role: data.role,
            text: texts.join("\n"),
            createdAt: timestamp(message.time_created),
          });
      }
      if (!messages.length || messages[0]!.role !== "user")
        throw new Error("No complete user-led text history");
      const contentHash = hash(JSON.stringify({ title, directory, messages }));
      bytes += sessionBytes;
      if (bytes > 8 * 1024 * 1024) throw new Error("History import exceeds 8 MiB");
      bundles.push({
        sourceKey: hash(`${sourceIdentity}\0${sourceSessionId}\0${contentHash}`),
        sourceSessionId,
        sourceProfile: source,
        sourceDatabaseHash: databaseHash,
        contentHash,
        title,
        directory,
        workspaceId: row.workspace_id === null ? null : text(row.workspace_id, 1024),
        createdAt: timestamp(row.time_created),
        updatedAt: timestamp(row.time_updated),
        messages,
      });
    } catch (error) {
      // JSON parser error strings can include source plaintext. Return only controlled reason classes.
      const reason =
        error instanceof SyntaxError
          ? "Malformed session JSON"
          : error instanceof Error
            ? error.message
            : "Unsupported session";
      skipped.push({ sourceSessionId, reason });
    }
  }
  return { bundles, skipped };
}

export function createHistoryImporter(options: {
  destinationProfile: () => string;
  commit: (bundles: HistoryImportBundle[]) => Promise<HistoryImportReport>;
}): HistoryImportContract {
  let busy = false;
  let lease: { preview: HistoryImportPreview; fingerprint: string; expires: number } | undefined;
  return {
    async previewHistoryImport(params) {
      if (busy) throw new Error("History import already running");
      if (
        !params ||
        params.sourceClosed !== true ||
        typeof params.source !== "string" ||
        !isAbsolute(params.source)
      )
        throw new Error("Close the official app and explicitly confirm its absolute profile path");
      const source = resolve(params.source);
      const destination = resolve(options.destinationProfile());
      if (overlaps(source, destination) || overlaps(destination, source))
        throw new Error("Source and personal profile must be separate");
      busy = true;
      lease = undefined;
      try {
        const snapshot = await withOfflineHistorySnapshot(source, (db, digest) =>
          readHistory(db, source, digest),
        );
        const preview = {
          token: randomUUID(),
          source,
          sessions: snapshot.value.bundles.map((bundle) => ({
            sourceKey: bundle.sourceKey,
            title: bundle.title,
            directory: bundle.directory,
            messages: bundle.messages.length,
          })),
          skipped: snapshot.value.skipped,
          messages: snapshot.value.bundles.reduce(
            (count, bundle) => count + bundle.messages.length,
            0,
          ),
        };
        lease = { preview, fingerprint: snapshot.fingerprint, expires: Date.now() + 10 * 60_000 };
        return preview;
      } finally {
        busy = false;
      }
    },
    async confirmHistoryImport(params) {
      if (busy) throw new Error("History import already running");
      const current = lease;
      if (
        !current ||
        !params ||
        params.token !== current.preview.token ||
        Date.now() > current.expires
      )
        throw new Error("Preview expired; preview history again");
      lease = undefined;
      busy = true;
      try {
        const source = current.preview.source;
        const destination = resolve(options.destinationProfile());
        if (overlaps(source, destination) || overlaps(destination, source))
          throw new Error("Source and personal profile must be separate");
        const snapshot = await withOfflineHistorySnapshot(source, (db, digest) =>
          readHistory(db, source, digest),
        );
        if (snapshot.fingerprint !== current.fingerprint)
          throw new Error("Source database changed; close the official app and preview again");
        return await options.commit(snapshot.value.bundles);
      } finally {
        busy = false;
      }
    },
  };
}
