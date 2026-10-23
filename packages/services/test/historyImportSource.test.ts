import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHistoryImporter } from "../src/profile-import/index.js";
import { SESSION_IMPORT_MIGRATIONS } from "../src/profile-import/sessionSchema.js";
import { SQLITE_MIGRATIONS } from "../../../apps/zcode-cli/packages/adapters/src/storage/session-store/migrations.js";
import type { HistoryImportBundle } from "../src/profile-import/contract.js";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
let root: string;
let source: string;
let dbPath: string;
let db: DatabaseSync;
const bundles: HistoryImportBundle[] = [];
const commit = vi.fn(async (input: HistoryImportBundle[]) => {
  bundles.push(...input);
  return {
    imported: input.length,
    duplicates: 0,
    sessions: input.map((bundle) => ({
      sourceKey: bundle.sourceKey,
      sessionId: `new-${bundle.sourceSessionId}`,
      directory: bundle.directory,
    })),
  };
});
function importer() {
  return createHistoryImporter({ destinationProfile: () => join(root, "personal"), commit });
}
function session(id = "s1", revert: unknown = null) {
  db.prepare(
    "INSERT INTO session (id,project_id,slug,directory,title,version,time_created,time_updated,revert) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    "old-project",
    id,
    join(root, "project"),
    "Project discussion",
    "3.16.2",
    1,
    2,
    revert ? JSON.stringify(revert) : null,
  );
}
function message(
  id: string,
  role: "user" | "assistant",
  content: string,
  sequence: number,
  extra: Record<string, unknown> = {},
  sessionId = "s1",
) {
  db.prepare(
    "INSERT INTO message(id,session_id,time_created,time_updated,data,sequence) VALUES (?,?,?,?,?,?)",
  ).run(id, sessionId, sequence + 1, sequence + 1, JSON.stringify({ role, ...extra }), sequence);
  part(id, 0, "text", content, sessionId);
}
function part(
  messageId: string,
  sequence: number,
  type: string,
  content: string,
  sessionId = "s1",
  extra: Record<string, unknown> = {},
) {
  db.prepare(
    "INSERT INTO part(id,message_id,session_id,time_created,time_updated,data,sequence) VALUES (?,?,?,?,?,?,?)",
  ).run(
    `${messageId}-p${sequence}`,
    messageId,
    sessionId,
    1,
    1,
    JSON.stringify({ type, text: content, ...extra }),
    sequence,
  );
}
async function sourceState() {
  const dir = dirname(dbPath);
  return Promise.all(
    (await readdir(dir)).sort().map(async (name) => {
      const path = join(dir, name);
      const info = await stat(path);
      return {
        name,
        bytes: hash(await readFile(path)),
        size: info.size,
        mtime: info.mtimeMs,
        ctime: info.ctimeMs,
      };
    }),
  );
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zcode-history-source-synthetic-"));
  source = join(root, "official");
  dbPath = join(source, "cli", "db", "db.sqlite");
  await mkdir(dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec(
    await readFile(
      fileURLToPath(
        new URL(
          "../../../apps/zcode-cli/packages/adapters/src/storage/session-store/schema.baseline.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  );
  for (const migration of SESSION_IMPORT_MIGRATIONS)
    db.prepare(
      "INSERT INTO schema_migration(id,checksum,app_version,time_applied) VALUES (?,?,?,?)",
    ).run(migration.id, migration.checksum, "synthetic", 1);
  db.prepare(
    "INSERT INTO zcode_database_identity(scope,identity) VALUES ('session','synthetic-db')",
  ).run();
  db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
  bundles.length = 0;
  commit.mockClear();
});
afterEach(async () => {
  db.close();
  await rm(root, { recursive: true, force: true });
});
describe("source history import with synthetic SQLite only", () => {
  it("pins current migration IDs/checksums including 0024 identity", () => {
    expect(SESSION_IMPORT_MIGRATIONS).toEqual(
      SQLITE_MIGRATIONS.map((item) => ({ id: item.id, checksum: hash(item.sql.trim()) })),
    );
    expect(SESSION_IMPORT_MIGRATIONS).toHaveLength(24);
  });
  it("reads WAL-only text via a private copy without writing any source file/SHM", async () => {
    session();
    message("u1", "user", "Please explain the project", 0);
    message("a1", "assistant", "Visible answer", 1);
    part("a1", 1, "reasoning", "PRIVATE REASONING");
    part("a1", 2, "tool", "TOOL SECRET", "s1", { input: { apiKey: "secret" } });
    message("hidden", "user", "MODEL ONLY", 2, { visibility: "model-only" });
    part("a1", 3, "text", "IGNORED", "s1", { ignored: true });
    const before = await sourceState();
    const owner = importer();
    const preview = await owner.previewHistoryImport({ source, sourceClosed: true });
    expect(preview.sessions).toHaveLength(1);
    expect(preview.messages).toBe(2);
    expect(commit).not.toHaveBeenCalled();
    await owner.confirmHistoryImport({ token: preview.token });
    expect(bundles[0]!.messages.map((item) => item.text)).toEqual([
      "Please explain the project",
      "Visible answer",
    ]);
    expect(JSON.stringify(bundles)).not.toMatch(
      /PRIVATE REASONING|TOOL SECRET|MODEL ONLY|IGNORED|apiKey/,
    );
    expect(bundles[0]).toMatchObject({
      sourceSessionId: "s1",
      directory: join(root, "project"),
      workspaceId: null,
      sourceProfile: source,
    });
    expect(await sourceState()).toEqual(before);
    const again = await owner.previewHistoryImport({ source, sourceClosed: true });
    expect(again.sessions[0]!.sourceKey).toBe(preview.sessions[0]!.sourceKey);
  });
  it("selects only the current edited branch and preserves kept-message order", async () => {
    session("s1", {
      targetMessageID: "old-u",
      keptMessageIDs: ["u0", "a0"],
      branchCutAfterMessageID: "old-a",
      versions: [{ messageIDs: ["old-u", "old-a"] }],
    });
    message("u0", "user", "first", 0);
    message("a0", "assistant", "first reply", 1);
    message("old-u", "user", "INVALID OLD QUESTION", 2);
    message("old-a", "assistant", "INVALID OLD ANSWER", 3);
    message("new-u", "user", "edited question", 4);
    message("new-a", "assistant", "new answer", 5);
    const owner = importer();
    const preview = await owner.previewHistoryImport({ source, sourceClosed: true });
    await owner.confirmHistoryImport({ token: preview.token });
    expect(bundles[0]!.messages.map((item) => item.text)).toEqual([
      "first",
      "first reply",
      "edited question",
      "new answer",
    ]);
  });
  it("fails closed on unknown future schema and corrupted checksums", async () => {
    const owner = importer();
    db.prepare("INSERT INTO schema_migration VALUES ('9999_future','unknown','future',1)").run();
    await expect(owner.previewHistoryImport({ source, sourceClosed: true })).rejects.toThrow(
      "schema/checksum",
    );
    db.exec(
      "DELETE FROM schema_migration WHERE id='9999_future'; UPDATE schema_migration SET checksum='corrupt' WHERE id='0001_base_session_store'",
    );
    await expect(owner.previewHistoryImport({ source, sourceClosed: true })).rejects.toThrow(
      "schema/checksum",
    );
    expect(commit).not.toHaveBeenCalled();
  });
  it("requires offline confirmation and rejects changed source on confirm without committing", async () => {
    session();
    message("u1", "user", "Hello", 0);
    const owner = importer();
    await expect(
      owner.previewHistoryImport({ source, sourceClosed: false } as never),
    ).rejects.toThrow("Close the official app");
    const preview = await owner.previewHistoryImport({ source, sourceClosed: true });
    message("a1", "assistant", "New source reply", 1);
    await expect(owner.confirmHistoryImport({ token: preview.token })).rejects.toThrow(
      "database changed",
    );
    expect(commit).not.toHaveBeenCalled();
  });
  it("skips sensitive plaintext and ambiguous branch records, never includes secret in reasons", async () => {
    session();
    message("u1", "user", "api_key=sk-abcdefghijklmnopqrstuvwxyz", 0);
    session("s2", { messageID: "unknown" });
    message("u2", "user", "invalid branch", 0, {}, "s2");
    const preview = await importer().previewHistoryImport({ source, sourceClosed: true });
    expect(preview.sessions).toHaveLength(0);
    expect(preview.skipped).toHaveLength(2);
    expect(JSON.stringify(preview)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });
  it("rejects symlink source ancestors and never reads another profile", async () => {
    await symlink(source, join(root, "alias"), "dir");
    await expect(
      importer().previewHistoryImport({ source: join(root, "alias"), sourceClosed: true }),
    ).rejects.toThrow("Unsafe directory");
  });
  it("consumes a failed commit lease and allows safe retry with unchanged dedupe key", async () => {
    session();
    message("u1", "user", "Hello", 0);
    const owner = importer();
    const preview = await owner.previewHistoryImport({ source, sourceClosed: true });
    commit.mockRejectedValueOnce(new Error("Target rolled back"));
    await expect(owner.confirmHistoryImport({ token: preview.token })).rejects.toThrow(
      "Target rolled back",
    );
    await expect(owner.confirmHistoryImport({ token: preview.token })).rejects.toThrow(
      "Preview expired",
    );
    const retry = await owner.previewHistoryImport({ source, sourceClosed: true });
    expect(retry.sessions[0]!.sourceKey).toBe(preview.sessions[0]!.sourceKey);
    await owner.confirmHistoryImport({ token: retry.token });
    expect(bundles).toHaveLength(1);
  });
  it("skips legacy summary objects, hidden compaction records and identity-bound projects", async () => {
    session();
    message("summary", "user", "legacy summary", 0, {
      summary: { body: "private compact summary" },
    });
    session("s2");
    message("normal", "user", "hello", 0, {}, "s2");
    message("compact", "user", "hidden", 1, { synthetic: true }, "s2");
    part("compact", 1, "compaction", "", "s2");
    session("s3");
    message("remote", "user", "remote task", 0, {}, "s3");
    db.prepare("UPDATE session SET workspace_id='remote:server:/project' WHERE id='s3'").run();
    const preview = await importer().previewHistoryImport({ source, sourceClosed: true });
    expect(preview.sessions).toHaveLength(0);
    expect(preview.skipped).toHaveLength(3);
    expect(preview.skipped.map((item) => item.reason).join(" ")).toMatch(
      /Summarized.*Compacted.*remapping/,
    );
  });
});
