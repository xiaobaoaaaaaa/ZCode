import { constants } from "node:fs";
import { lstat, open, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { plainAncestors } from "./pathSafety.js";
import { SESSION_IMPORT_MIGRATIONS } from "./sessionSchema.js";

const MAX_DATABASE_BYTES = 64 * 1024 * 1024;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
async function readBinary(path: string, optional: boolean) {
  await plainAncestors(dirname(path));
  let before;
  try {
    before = await lstat(path, { bigint: true });
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_DATABASE_BYTES)
    throw new Error("Unsupported or oversized SQLite file");
  const signature = (stat: typeof before) =>
    [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    await plainAncestors(dirname(path));
    const opened = await handle.stat({ bigint: true });
    if (signature(opened) !== signature(before) || !opened.isFile())
      throw new Error("SQLite source changed while opening");
    const buffer = Buffer.alloc(Number(opened.size) + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    await plainAncestors(dirname(path));
    const final = await handle.stat({ bigint: true });
    const named = await lstat(path, { bigint: true });
    if (
      signature(final) !== signature(before) ||
      signature(named) !== signature(before) ||
      named.isSymbolicLink() ||
      offset !== Number(opened.size)
    )
      throw new Error("SQLite source changed; close the official app and retry");
    const bytes = buffer.subarray(0, offset);
    return { bytes, signature: signature(final), digest: hash(bytes) };
  } finally {
    await handle.close();
  }
}
async function rawSnapshot(source: string) {
  const path = join(source, "cli", "db", "db.sqlite");
  const db = await readBinary(path, false);
  const wal = await readBinary(`${path}-wal`, true);
  if (!db) throw new Error("Missing source SQLite file");
  return {
    db,
    wal,
    fingerprint: hash(JSON.stringify([db.signature, db.digest, wal?.signature, wal?.digest])),
    digest: hash(`${db.digest}:${wal?.digest ?? ""}`),
  };
}

/** Never opens the original using SQLite: even a readonly SQLite WAL connection can write SHM. */
export async function withOfflineHistorySnapshot<T>(
  source: string,
  read: (db: DatabaseSync, digest: string) => T,
): Promise<{ value: T; fingerprint: string }> {
  const before = await rawSnapshot(source);
  const staging = await mkdtemp(join(tmpdir(), "zcode-history-import-"));
  try {
    const file = join(staging, "db.sqlite");
    await writeFile(file, before.db.bytes, { flag: "wx", mode: 0o600 });
    if (before.wal) await writeFile(`${file}-wal`, before.wal.bytes, { flag: "wx", mode: 0o600 });
    const after = await rawSnapshot(source);
    if (after.fingerprint !== before.fingerprint)
      throw new Error("Source changed during offline copy; close the official app and retry");
    const db = new DatabaseSync(file, { readOnly: true, allowExtension: false });
    try {
      db.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF");
      const result = db.prepare("PRAGMA quick_check").all();
      if (result.length !== 1 || Object.values(result[0]!)[0] !== "ok")
        throw new Error("Source SQLite integrity check failed");
      for (const table of [
        "schema_migration",
        "session",
        "message",
        "part",
        "zcode_database_identity",
      ]) {
        const schema = db.prepare("SELECT type,sql FROM sqlite_master WHERE name=?").get(table);
        if (
          schema?.type !== "table" ||
          typeof schema.sql !== "string" ||
          /^CREATE\s+VIRTUAL\s+TABLE/i.test(schema.sql)
        ) {
          throw new Error("Unsupported SQLite table structure");
        }
      }
      const actual = db
        .prepare("SELECT id, checksum FROM schema_migration ORDER BY id LIMIT 25")
        .all();
      if (
        actual.length !== SESSION_IMPORT_MIGRATIONS.length ||
        actual.some(
          (row, index) =>
            row.id !== SESSION_IMPORT_MIGRATIONS[index]!.id ||
            row.checksum !== SESSION_IMPORT_MIGRATIONS[index]!.checksum,
        )
      )
        throw new Error(
          "Unsupported SQLite migration schema/checksum; only the current verified schema can be imported",
        );
      return { value: read(db, before.digest), fingerprint: before.fingerprint };
    } finally {
      db.close();
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
