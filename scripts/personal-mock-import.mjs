import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHistoryImporter } from "../packages/services/src/profile-import/history.ts";
import { SESSION_IMPORT_MIGRATIONS } from "../packages/services/src/profile-import/sessionSchema.ts";
import { createSqliteSessionStore } from "../apps/zcode-cli/packages/adapters/src/storage/session-store/sqlite-session-store.ts";

export async function runImportEvidence() {
  const root = await mkdtemp(join(tmpdir(), "zcode-mock-import-"));
  const source = join(root, "official");
  const dir = join(source, "cli", "db");
  await mkdir(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, "db.sqlite"));
  let target;
  let inspector;
  try {
    db.exec(
      await readFile(
        new URL(
          "../apps/zcode-cli/packages/adapters/src/storage/session-store/schema.baseline.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (const m of SESSION_IMPORT_MIGRATIONS)
      db.prepare(
        "INSERT INTO schema_migration(id,checksum,app_version,time_applied) VALUES (?,?,?,?)",
      ).run(m.id, m.checksum, "synthetic", 1);
    db.exec(
      "INSERT INTO zcode_database_identity(scope,identity) VALUES ('session','mock-import-db'); PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0",
    );
    const add = (id) => {
      db.prepare(
        "INSERT INTO session(id,project_id,slug,directory,title,version,time_created,time_updated) VALUES (?,?,?,?,?,?,?,?)",
      ).run(id, "old-project", id, join(root, "workspace"), "Synthetic discussion", "test", 1, 2);
      for (const [i, role] of ["user", "assistant"].entries()) {
        const mid = `${id}-${i}`;
        db.prepare(
          "INSERT INTO message(id,session_id,time_created,time_updated,data,sequence) VALUES (?,?,?,?,?,?)",
        ).run(mid, id, i + 1, i + 1, JSON.stringify({ role }), i);
        db.prepare(
          "INSERT INTO part(id,message_id,session_id,time_created,time_updated,data,sequence) VALUES (?,?,?,?,?,?,?)",
        ).run(
          `${mid}-text`,
          mid,
          id,
          1,
          1,
          JSON.stringify({ type: "text", text: `Synthetic ${role}` }),
          0,
        );
      }
    };
    add("source-session");
    const state = async () =>
      Promise.all(
        (await readdir(dir)).sort().map(async (n) => [
          n,
          createHash("sha256")
            .update(await readFile(join(dir, n)))
            .digest("hex"),
        ]),
      );
    target = await createSqliteSessionStore({ dbPath: join(root, "target.sqlite") });
    inspector = new DatabaseSync(join(root, "target.sqlite"));
    const owner = createHistoryImporter({
      destinationProfile: () => join(root, "personal"),
      commit: async (bundles) => {
        const sessions = [];
        let duplicates = 0;
        for (const bundle of bundles) {
          const result = await target.importOfficialHistory({
            bundle,
            projectID: "mapped-project",
            version: "synthetic",
          });
          if (result.alreadyImported) duplicates++;
          sessions.push({
            sourceKey: bundle.sourceKey,
            sessionId: result.session.id,
            directory: result.session.directory,
          });
        }
        return { imported: bundles.length - duplicates, duplicates, sessions };
      },
    });
    const before = await state();
    const preview = await owner.previewHistoryImport({ source, sourceClosed: true });
    assert.equal(preview.messages, 2);
    const report = await owner.confirmHistoryImport({ token: preview.token });
    assert.equal(report.imported, 1);
    const id = report.sessions[0].sessionId;
    assert.notEqual(id, "source-session");
    const messages = await target.messages({ sessionID: id });
    assert.equal(messages.length, 2);
    assert.equal(messages[1].info.parentID, messages[0].info.id);
    assert.equal(
      inspector.prepare("select project_id from session where id=?").get(id).project_id,
      "mapped-project",
    );
    const again = await owner.previewHistoryImport({ source, sourceClosed: true });
    assert.equal((await owner.confirmHistoryImport({ token: again.token })).duplicates, 1);
    assert.deepEqual(await state(), before);
    add("rollback-session");
    const rollbackPreview = await owner.previewHistoryImport({ source, sourceClosed: true });
    inspector.exec(
      "CREATE TRIGGER reject_fixture BEFORE INSERT ON part BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END",
    );
    await assert.rejects(
      owner.confirmHistoryImport({ token: rollbackPreview.token }),
      /synthetic disk failure/,
    );
    assert.equal(inspector.prepare("select count(*) n from session").get().n, 1);
    inspector.exec("DROP TRIGGER reject_fixture");
    const retry = await owner.previewHistoryImport({ source, sourceClosed: true });
    assert.equal((await owner.confirmHistoryImport({ token: retry.token })).imported, 1);
    db.exec("INSERT INTO schema_migration VALUES ('9999_future','unknown','synthetic',1)");
    await assert.rejects(
      owner.previewHistoryImport({ source, sourceClosed: true }),
      /schema\/checksum/,
    );
    const result = {
      status: "passed",
      assertions: [
        "WAL source unchanged",
        "real target ID and parent remapping",
        "project association",
        "repeat deduplication",
        "transaction failure rollback",
        "retry recovery",
        "unknown schema rejected",
      ],
    };
    const evidence = await mkdtemp(join(tmpdir(), "zcode-mock-import-evidence-"));
    await writeFile(join(evidence, "result.json"), JSON.stringify(result, null, 2));
    return { ...result, evidence };
  } finally {
    inspector?.close();
    target?.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await runImportEvidence(), null, 2));
