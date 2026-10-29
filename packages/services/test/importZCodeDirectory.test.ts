import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import {
  createDataImporter,
  readImportedProfile,
  applyImportedProfileEnvironment,
} from "../src/data-import/index.js";
import { snapshotTree, copySnapshot } from "../src/data-import/snapshot.js";

const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "zcode-import-test-"));
  fixtures.push(root);
  const source = join(root, "source", ".zcode");
  const home = join(root, "current");
  const destination = join(root, "copies");
  await Promise.all([
    mkdir(join(source, "v2"), { recursive: true }),
    mkdir(join(source, "cli", "db"), { recursive: true }),
    mkdir(join(source, "workspace", "default"), { recursive: true }),
    mkdir(join(home, ".zcode", "v2"), { recursive: true }),
    mkdir(destination),
  ]);
  await writeFile(
    join(source, "v2", "setting.json"),
    JSON.stringify({
      locale: "zh-CN",
      lastActiveWorkspace: {
        kind: "local",
        workspacePath: join(source, "workspace", "default"),
        workspacePurpose: "conversation",
      },
    }),
  );
  await writeFile(join(home, ".zcode", "v2", "setting.json"), '{"locale":"en-US"}');
  await writeFile(join(source, "workspace", "default", "note.txt"), "keep workspace");
  const importer = createDataImporter({
    bootstrapHome: home,
    currentDataRoot: join(home, ".zcode"),
  });
  return { root, source, home, destination, importer };
}

describe("ZCode directory snapshot import", () => {
  it("imports uncheckpointed WAL, settings and workspace while preserving source/current data", async () => {
    const f = await fixture();
    const db = new DatabaseSync(join(f.source, "cli", "db", "db.sqlite"));
    db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE session(id TEXT, directory TEXT, title TEXT); INSERT INTO session VALUES ('session-1', '/external/project', 'history body');",
    );
    const sourceBefore = await readFile(join(f.source, "v2", "setting.json"));
    try {
      const result = await f.importer.importDirectory({
        sourceDirectory: join(f.root, "source"),
        destinationParent: f.destination,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      const targetRoot = join(result.dataBaseDir, ".zcode");
      const copied = new DatabaseSync(join(targetRoot, "cli", "db", "db.sqlite"));
      try {
        expect(copied.prepare("SELECT * FROM session").get()).toMatchObject({
          id: "session-1",
          directory: "/external/project",
          title: "history body",
        });
      } finally {
        copied.close();
      }
      expect(await readFile(join(targetRoot, "workspace", "default", "note.txt"), "utf8")).toBe(
        "keep workspace",
      );
      expect(
        JSON.parse(await readFile(join(targetRoot, "v2", "setting.json"), "utf8")),
      ).toMatchObject({
        locale: "zh-CN",
        dataBaseDir: result.dataBaseDir,
        lastActiveWorkspace: {
          kind: "local",
          workspacePath: join(targetRoot, "workspace", "default"),
          workspacePurpose: "conversation",
        },
      });
      expect(await readFile(join(f.source, "v2", "setting.json"))).toEqual(sourceBefore);
      expect(await readFile(join(f.home, ".zcode", "v2", "setting.json"), "utf8")).toBe(
        '{"locale":"en-US"}',
      );
      expect(readImportedProfile(f.home)).toBe(result.dataBaseDir);
      const env: Record<string, string> = { HOME: f.home };
      applyImportedProfileEnvironment(result.dataBaseDir, env);
      expect(env.HOME).toBe(f.home);
      expect(env.ZCODE_SESSION_DB_PATH).toBe(join(targetRoot, "cli", "db", "db.sqlite"));
      expect(env.ZCODE_PROFILE_BASE_DIR).toBe(result.dataBaseDir);
    } finally {
      db.close();
    }
  });

  it("rejects malformed sources and recursive destinations without changing the active choice", async () => {
    const f = await fixture();
    expect(
      await f.importer.importDirectory({
        sourceDirectory: f.destination,
        destinationParent: f.destination,
      }),
    ).toMatchObject({ ok: false, error: "invalid-source" });
    expect(
      await f.importer.importDirectory({ sourceDirectory: f.source, destinationParent: f.source }),
    ).toMatchObject({ ok: false, error: "unsafe-path" });
    expect(readImportedProfile(f.home)).toBeNull();
    expect(await readdir(f.destination)).toEqual([]);
  });

  it("does not publish corrupt SQLite or follow symlinks", async () => {
    const f = await fixture();
    await writeFile(join(f.source, "cli", "db", "db.sqlite"), "not a database");
    expect(
      await f.importer.importDirectory({
        sourceDirectory: f.source,
        destinationParent: f.destination,
      }),
    ).toMatchObject({ ok: false, error: "invalid-database" });
    expect(await readdir(f.destination)).toEqual([]);
    await symlink(
      f.home,
      join(f.source, "external"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(
      await f.importer.importDirectory({
        sourceDirectory: f.source,
        destinationParent: f.destination,
      }),
    ).toMatchObject({ ok: false, error: "unsafe-path" });
    expect(readImportedProfile(f.home)).toBeNull();
  });

  it("rejects concurrent imports and retains earlier copies on repeated import", async () => {
    const f = await fixture();
    const request = { sourceDirectory: f.source, destinationParent: f.destination };
    const first = f.importer.importDirectory(request);
    expect(await f.importer.importDirectory(request)).toMatchObject({ ok: false, error: "busy" });
    expect((await first).ok).toBe(true);
    expect((await f.importer.importDirectory(request)).ok).toBe(true);
    expect(await readdir(f.destination)).toHaveLength(2);
  });

  it("rejects changes after the source snapshot and keeps the previous startup choice on failure", async () => {
    const f = await fixture();
    const request = { sourceDirectory: f.source, destinationParent: f.destination };
    const imported = await f.importer.importDirectory(request);
    expect(imported.ok).toBe(true);
    const previous = readImportedProfile(f.home);
    const files = await snapshotTree(f.source);
    await writeFile(join(f.source, "workspace", "default", "note.txt"), "changed while copying");
    await expect(copySnapshot(f.source, join(f.root, "partial"), files)).rejects.toMatchObject({
      code: "source-changed",
    });
    await writeFile(join(f.source, "v2", "setting.json"), '{"locale":123}');
    expect(await f.importer.importDirectory(request)).toMatchObject({
      ok: false,
      error: "invalid-source",
    });
    expect(readImportedProfile(f.home)).toBe(previous);
    expect(await readdir(f.destination)).toHaveLength(1);
  });

  it("relocates only internal workspace paths and pauses copied automations and bots", async () => {
    const f = await fixture();
    const cli = new DatabaseSync(join(f.source, "cli", "db", "db.sqlite"));
    cli.exec("CREATE TABLE session(id TEXT)");
    cli.close();
    const db = new DatabaseSync(join(f.source, "v2", "tasks-index.sqlite"));
    const internal = join(f.source, "workspace", "default");
    db.exec(
      "CREATE TABLE tasks(workspace_path TEXT, workspace_key TEXT, title TEXT, host_id TEXT); CREATE TABLE automations(enabled INTEGER);",
    );
    db.prepare("INSERT INTO tasks VALUES (?, ?, ?, ?)").run(
      internal,
      internal,
      "keep message " + internal,
      "local",
    );
    db.prepare("INSERT INTO tasks VALUES (?, ?, ?, ?)").run(
      internal,
      "ssh:opaque-identity",
      "external",
      "remote:server:test",
    );
    db.exec("INSERT INTO automations VALUES (1)");
    db.close();
    await writeFile(
      join(f.source, "v2", "bot-config.v3.json"),
      JSON.stringify({ version: 3, bots: [{ id: "test", enabled: true }] }),
    );
    const result = await f.importer.importDirectory({
      sourceDirectory: f.source,
      destinationParent: f.destination,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const imported = new DatabaseSync(
      join(result.dataBaseDir, ".zcode", "v2", "tasks-index.sqlite"),
    );
    try {
      expect(imported.prepare("SELECT * FROM tasks").all()).toEqual([
        {
          workspace_path: join(result.dataBaseDir, ".zcode", "workspace", "default"),
          workspace_key: join(result.dataBaseDir, ".zcode", "workspace", "default"),
          title: "keep message " + internal,
          host_id: "local",
        },
        {
          workspace_path: internal,
          workspace_key: "ssh:opaque-identity",
          title: "external",
          host_id: "remote:server:test",
        },
      ]);
      expect(imported.prepare("SELECT enabled FROM automations").get()?.enabled).toBe(0);
    } finally {
      imported.close();
    }
    expect(
      JSON.parse(
        await readFile(join(result.dataBaseDir, ".zcode", "v2", "bot-config.v3.json"), "utf8"),
      ).bots[0].enabled,
    ).toBe(false);
    expect(
      JSON.parse(await readFile(join(f.source, "v2", "bot-config.v3.json"), "utf8")).bots[0]
        .enabled,
    ).toBe(true);
  });

  it("preserves empty folders and project lock files while excluding app runtime locks", async () => {
    const f = await fixture();
    const workspace = join(f.source, "workspace", "default");
    await mkdir(join(workspace, "empty"));
    await mkdir(join(f.source, "v2", "setting.json.lock"));
    for (const name of ["Cargo.lock", "yarn.lock", "import-profile.json", "data.sock"]) {
      await writeFile(join(workspace, name), "user content");
    }
    const result = await f.importer.importDirectory({
      sourceDirectory: f.source,
      destinationParent: f.destination,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const target = join(result.dataBaseDir, ".zcode");
    expect((await stat(join(target, "workspace", "default", "empty"))).isDirectory()).toBe(true);
    for (const name of ["Cargo.lock", "yarn.lock", "import-profile.json", "data.sock"]) {
      expect(await readFile(join(target, "workspace", "default", name), "utf8")).toBe(
        "user content",
      );
    }
    expect(await readdir(join(target, "v2"))).not.toContain("setting.json.lock");
  });

  it("rejects partial local history but accepts remote-only indexes without a local session DB", async () => {
    const f = await fixture();
    const path = join(f.source, "v2", "tasks-index.sqlite");
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE tasks(task_id TEXT, host_id TEXT); INSERT INTO tasks VALUES ('missing-body', 'local')",
    );
    db.close();
    const request = { sourceDirectory: f.source, destinationParent: f.destination };
    expect(await f.importer.importDirectory(request)).toEqual({
      ok: false,
      error: "invalid-source",
    });
    expect(readImportedProfile(f.home)).toBeNull();
    expect(await readdir(f.destination)).toEqual([]);
    const remote = new DatabaseSync(path);
    remote.exec("UPDATE tasks SET host_id='remote:server:test'");
    remote.close();
    expect((await f.importer.importDirectory(request)).ok).toBe(true);
  });

  it("rejects external CLI storage redirects and accepts canonical tilde paths", async () => {
    const f = await fixture();
    const request = { sourceDirectory: f.source, destinationParent: f.destination };
    for (const storage of [{ dir: f.home }, { sessionDbPath: join(f.home, "db.sqlite") }]) {
      await writeFile(join(f.source, "cli", "config.json"), JSON.stringify({ storage }));
      expect(await f.importer.importDirectory(request)).toEqual({
        ok: false,
        error: "invalid-source",
      });
    }
    await writeFile(
      join(f.source, "cli", "config.json"),
      JSON.stringify({ storage: { dir: "~/.zcode", sessionDbPath: "~/.zcode/cli/db/db.sqlite" } }),
    );
    expect((await f.importer.importDirectory(request)).ok).toBe(true);
  });

  it("relocates attachment references while preserving historical text and external files", async () => {
    const f = await fixture();
    const original = join(f.source, "workspace", "default", "附件 with spaces.txt");
    await writeFile(original, "attachment bytes");
    const db = new DatabaseSync(join(f.source, "cli", "db", "db.sqlite"));
    db.exec(
      "CREATE TABLE part(data TEXT); CREATE TABLE message(data TEXT); CREATE TABLE input_history(attachments TEXT)",
    );
    const file = {
      type: "file",
      url: pathToFileURL(original).href,
      source: { type: "file", path: original },
      metadata: { originalUrl: original, preview: { text: original } },
    };
    const parts = [
      file,
      { type: "text", text: original },
      { type: "tool", state: { output: original, attachments: [file] } },
      { type: "file", url: "/external/photo.png" },
    ];
    for (const part of parts) db.prepare("INSERT INTO part VALUES (?)").run(JSON.stringify(part));
    db.prepare("INSERT INTO message VALUES (?)").run(
      JSON.stringify({
        role: "assistant",
        path: { cwd: join(f.source, "workspace", "default"), root: "/external" },
      }),
    );
    db.prepare("INSERT INTO input_history VALUES (?)").run(
      JSON.stringify([{ type: "file", path: original, content: original }]),
    );
    db.close();
    const request = { sourceDirectory: f.source, destinationParent: f.destination };
    const result = await f.importer.importDirectory(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const root = join(result.dataBaseDir, ".zcode");
    const targetFile = join(root, "workspace", "default", "附件 with spaces.txt");
    const copied = new DatabaseSync(join(root, "cli", "db", "db.sqlite"));
    try {
      const rows = copied
        .prepare("SELECT data FROM part")
        .all()
        .map((row) => JSON.parse(String(row.data)));
      const expected = {
        ...file,
        url: pathToFileURL(targetFile).href,
        source: { type: "file", path: targetFile },
        metadata: { originalUrl: targetFile, preview: { text: original } },
      };
      expect(rows).toEqual([
        expected,
        parts[1],
        { type: "tool", state: { output: original, attachments: [expected] } },
        parts[3],
      ]);
      expect(JSON.parse(String(copied.prepare("SELECT data FROM message").get()?.data))).toEqual({
        role: "assistant",
        path: { cwd: join(root, "workspace", "default"), root: "/external" },
      });
      expect(
        JSON.parse(
          String(copied.prepare("SELECT attachments FROM input_history").get()?.attachments),
        ),
      ).toEqual([{ type: "file", path: targetFile, content: original }]);
      expect(await readFile(targetFile, "utf8")).toBe("attachment bytes");
      expect(await readFile(original, "utf8")).toBe("attachment bytes");
    } finally {
      copied.close();
    }
    const unchanged = new DatabaseSync(join(f.source, "cli", "db", "db.sqlite"), {
      readOnly: true,
    });
    try {
      expect(
        JSON.parse(String(unchanged.prepare("SELECT data FROM part LIMIT 1").get()?.data)),
      ).toEqual(file);
    } finally {
      unchanged.close();
    }
  });
});
