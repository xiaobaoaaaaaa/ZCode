import { open, readFile, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isRemoteWorkspaceIdentity } from "@zcode/shared";
import { ImportFailure, type SnapshotFile } from "./snapshot.js";

function relocatePath(value: string, source: string, target: string): string {
  return value === source || value.startsWith(source + sep)
    ? target + value.slice(source.length)
    : value;
}

function relocateSettings(value: unknown, source: string, target: string): unknown {
  if (typeof value === "string") return relocatePath(value, source, target);
  if (Array.isArray(value)) return value.map((item) => relocateSettings(item, source, target));
  if (value && typeof value === "object") {
    // 远程路径即使字面等于本机来源路径，也不属于本机副本。
    if ("kind" in value && value.kind === "remote") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        relocatePath(key, source, target),
        relocateSettings(item, source, target),
      ]),
    );
  }
  return value;
}

const PATH_COLUMNS = new Set([
  "workspace_path",
  "workspace_key",
  "workspace_identity",
  "workspace_id",
  "root_path",
  "directory",
  "path",
  "worktree",
  "cwd",
  "script_path",
]);
function quoteIdentifier(value: string): string {
  return '"' + value.replaceAll('"', '""') + '"';
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function relocateReference(value: string, source: string, target: string): string {
  if (!value.startsWith("file:")) return relocatePath(value, source, target);
  try {
    const path = fileURLToPath(value);
    const relocated = relocatePath(path, source, target);
    return path === relocated ? value : pathToFileURL(relocated).href;
  } catch {
    return value;
  }
}

function relocatePayload(value: unknown, table: string, source: string, target: string): void {
  const fields = (item: unknown, keys: string[]) => {
    const object = record(item);
    if (!object) return;
    for (const key of keys)
      if (typeof object[key] === "string")
        object[key] = relocateReference(object[key], source, target);
  };
  if (table === "input_history" && Array.isArray(value)) {
    for (const attachment of value) fields(attachment, ["path"]);
    return;
  }
  const object = record(value);
  if (!object) return;
  // 只改附件/工作目录元数据，正文和工具输入输出必须保留历史原文。
  if (table === "message" && object.role === "assistant") fields(object.path, ["cwd", "root"]);
  if (table !== "part") return;
  if (object.type === "file") {
    fields(object, ["url"]);
    fields(object.source, ["path"]);
    fields(object.metadata, ["originalUrl", "artifactUri"]);
  } else if (object.type === "tool") {
    const attachments = record(object.state)?.attachments;
    if (Array.isArray(attachments))
      for (const attachment of attachments) relocatePayload(attachment, "part", source, target);
  }
}

function relocateDatabasePaths(
  db: DatabaseSync,
  name: string,
  columns: string[],
  source: string,
  target: string,
): void {
  const pathColumns = columns.filter((column) => PATH_COLUMNS.has(column));
  const jsonColumns = columns.filter((column) =>
    ["execution_directories", "additional_directories"].includes(column),
  );
  const payloadColumns = columns.filter(
    (column) =>
      (["message", "part"].includes(name) && column === "data") ||
      (name === "input_history" && column === "attachments"),
  );
  if (!pathColumns.length && !jsonColumns.length && !payloadColumns.length) return;
  const quoted = quoteIdentifier(name);
  for (const row of db.prepare(`SELECT rowid AS __import_rowid, * FROM ${quoted}`).all()) {
    if (typeof row.host_id === "string" && row.host_id !== "local") continue;
    if (
      [row.workspace_identity, row.workspace_id, row.workspace_key].some(
        (identity) => typeof identity === "string" && isRemoteWorkspaceIdentity(identity),
      )
    )
      continue;
    if (name === "project_roots") {
      const project = db
        .prepare("SELECT host_id FROM projects WHERE project_id = ?")
        .get(row.project_id!);
      if (project?.host_id && project.host_id !== "local") continue;
    }
    for (const column of [...pathColumns, ...jsonColumns, ...payloadColumns]) {
      const value = row[column];
      if (typeof value !== "string") continue;
      let next = jsonColumns.includes(column)
        ? JSON.stringify(relocateSettings(JSON.parse(value), source, target))
        : relocatePath(value, source, target);
      if (payloadColumns.includes(column)) {
        const payload = JSON.parse(value);
        const before = JSON.stringify(payload);
        relocatePayload(payload, name, source, target);
        const after = JSON.stringify(payload);
        next = before === after ? value : after;
      }
      if (next !== value)
        db.prepare(`UPDATE ${quoted} SET ${quoteIdentifier(column)} = ? WHERE rowid = ?`).run(
          next,
          row.__import_rowid!,
        );
    }
  }
}

function prepareDatabase(
  path: string,
  source: string,
  target: string,
  relocate: boolean,
  missingSessionDb: boolean,
): void {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { allowExtension: false });
    db.exec("PRAGMA trusted_schema=OFF");
    const checks = db.prepare("PRAGMA integrity_check").all();
    if (checks.length !== 1 || Object.values(checks[0]!)[0] !== "ok") throw new Error("integrity");
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all();
    db.exec("BEGIN IMMEDIATE");
    for (const table of tables) {
      if (!relocate) continue;
      const name = String(table.name);
      const columns = db
        .prepare(`PRAGMA table_info(${quoteIdentifier(name)})`)
        .all()
        .map((column) => String(column.name));
      // 仅复制 App 索引会显示空历史，必须同时携带本地 CLI 会话正文。
      if (missingSessionDb && name === "tasks") {
        const local = columns.includes("host_id")
          ? " WHERE host_id IS NULL OR host_id IN ('local', '')"
          : "";
        if (db.prepare(`SELECT 1 FROM ${quoteIdentifier(name)}${local} LIMIT 1`).get())
          throw new ImportFailure("invalid-source");
      }
      relocateDatabasePaths(db, name, columns, source, target);
      if (name === "automations" && columns.includes("enabled"))
        db.exec('UPDATE "automations" SET "enabled" = 0');
    }
    db.exec("COMMIT; PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (error) {
    throw error instanceof ImportFailure ? error : new ImportFailure("invalid-database");
  } finally {
    db?.close();
  }
}

export async function prepareImportedCopy(
  source: string,
  baseDir: string,
  files: SnapshotFile[],
): Promise<void> {
  const target = join(baseDir, ".zcode");
  const hasSessionDb = files.some(
    (file) => file.kind === "file" && file.path === join("cli", "db", "db.sqlite"),
  );
  for (const file of files) {
    if (file.kind !== "file" || !/\.(sqlite|sqlite3|db)$/.test(file.path)) continue;
    const path = join(target, file.path);
    const owned = [join("v2", "tasks-index.sqlite"), join("cli", "db", "db.sqlite")].includes(
      file.path,
    );
    const handle = await open(path, "r");
    const header = Buffer.alloc(16);
    try {
      await handle.read(header, 0, 16, 0);
    } finally {
      await handle.close();
    }
    // workspace 内的普通 .db 文件不能被当成 ZCode 表改写。
    if (owned || header.toString("utf8") === "SQLite format 3\0")
      prepareDatabase(
        path,
        source,
        target,
        owned,
        file.path === join("v2", "tasks-index.sqlite") && !hasSessionDb,
      );
  }
  const settingsPath = join(target, "v2", "setting.json");
  const parsed = JSON.parse(await readFile(settingsPath, "utf8"));
  const settings = relocateSettings(parsed, source, target) as Record<string, unknown>;
  settings.dataBaseDir = baseDir;
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
  for (const file of files.filter((entry) =>
    [
      join("cli", "config.json"),
      join("v2", "bot-config.json"),
      join("v2", "bot-config.v3.json"),
    ].includes(entry.path),
  )) {
    const path = join(target, file.path);
    const config = relocateSettings(
      JSON.parse(await readFile(path, "utf8")),
      source,
      target,
    ) as Record<string, unknown>;
    if (Array.isArray(config.bots))
      for (const bot of config.bots) {
        if (bot && typeof bot === "object") bot.enabled = false;
      }
    await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 });
  }
}
