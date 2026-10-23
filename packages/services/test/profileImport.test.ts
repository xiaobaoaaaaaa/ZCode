import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const failure = vi.hoisted(() => ({ path: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      if (String(args[0]) === failure.path) throw new Error("Injected disk failure");
      return actual.open(...args);
    },
  };
});
import { createProfileImporter } from "../src/profile-import/index.js";

let root: string;
let source: string;
let target: string;
const id = "project-0123456789abcdef";
const memory = (profile: string, project = id) =>
  join(profile, "cli", "memories", "projects", project, "memory");
async function fixture(profile: string, content = "# Memory\nUse TypeScript.") {
  await mkdir(memory(profile), { recursive: true });
  await writeFile(join(memory(profile), "MEMORY.md"), content);
  await writeFile(join(memory(profile), "style.md"), "Background project data.");
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zcode-import-synthetic-"));
  source = join(root, "official");
  target = join(root, "personal");
  await fixture(source);
});
afterEach(async () => {
  failure.path = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
describe("official profile import — synthetic only", () => {
  it("requires preview, copies exact Markdown only, preserves source and deduplicates", async () => {
    await writeFile(join(source, "credentials.json"), "NEVER COPY");
    await writeFile(join(memory(source), "credentials.json"), "NEVER COPY");
    const importer = createProfileImporter(() => target);
    await expect(importer.confirmProfileImport({ token: "not-a-preview" })).rejects.toThrow(
      "Preview expired",
    );
    const preview = await importer.previewProfileImport({ source });
    expect(preview).toMatchObject({ projects: 1, files: 2 });
    await expect(readdir(target)).rejects.toThrow();
    const report = await importer.confirmProfileImport({
      token: preview.token,
    });
    expect(report).toEqual({ imported: 1, duplicates: 0, conflicts: [] });
    expect(await readdir(memory(target))).toEqual(["MEMORY.md", "style.md"]);
    expect(await readFile(join(memory(source), "MEMORY.md"))).toEqual(
      await readFile(join(memory(target), "MEMORY.md")),
    );
    const again = await importer.previewProfileImport({ source });
    expect(await importer.confirmProfileImport({ token: again.token })).toEqual({
      imported: 0,
      duplicates: 1,
      conflicts: [],
    });
    await expect(importer.confirmProfileImport({ token: again.token })).rejects.toThrow(
      "Preview expired",
    );
  });
  it("preserves an entire conflicting project", async () => {
    await fixture(target, "Personal changes");
    const importer = createProfileImporter(() => target);
    const preview = await importer.previewProfileImport({ source });
    expect(await importer.confirmProfileImport({ token: preview.token })).toEqual({
      imported: 0,
      duplicates: 0,
      conflicts: [id],
    });
    expect(await readFile(join(memory(target), "MEMORY.md"), "utf8")).toBe("Personal changes");
  });
  it("rejects source modification, superseded and expired previews", async () => {
    const importer = createProfileImporter(() => target);
    const old = await importer.previewProfileImport({ source });
    const next = await importer.previewProfileImport({ source });
    await expect(importer.confirmProfileImport({ token: old.token })).rejects.toThrow(
      "Preview expired",
    );
    await writeFile(join(memory(source), "MEMORY.md"), "Changed");
    await expect(importer.confirmProfileImport({ token: next.token })).rejects.toThrow(
      "Source changed",
    );
    const latest = await importer.previewProfileImport({ source });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await expect(importer.confirmProfileImport({ token: latest.token })).rejects.toThrow(
      "Preview expired",
    );
    await expect(readdir(target)).rejects.toThrow();
  });
  it.each(["CON.md", "name:stream.md", "memory.md"])(
    "rejects unsafe or case-aliased name %s",
    async (name) => {
      await writeFile(join(memory(source), name), "data");
      await expect(
        createProfileImporter(() => target).previewProfileImport({ source }),
      ).rejects.toThrow("filename");
    },
  );
  it("rejects symbolic source files and ancestors without following them", async () => {
    await symlink(join(root, "outside"), join(memory(source), "linked.md"));
    const importer = createProfileImporter(() => target);
    await expect(importer.previewProfileImport({ source })).rejects.toThrow("Symbolic link");
    await rm(join(memory(source), "linked.md"));
    await symlink(source, join(root, "alias"), "dir");
    await expect(importer.previewProfileImport({ source: join(root, "alias") })).rejects.toThrow(
      "Unsafe directory",
    );
  });
  it("rejects destination symlink and overlapping source", async () => {
    const outside = join(root, "outside");
    await mkdir(outside);
    await symlink(outside, target, "dir");
    const importer = createProfileImporter(() => target);
    const preview = await importer.previewProfileImport({ source });
    await expect(importer.confirmProfileImport({ token: preview.token })).rejects.toThrow(
      "Unsafe directory",
    );
    expect(await readdir(outside)).toEqual([]);
    await expect(
      createProfileImporter(() => source).previewProfileImport({ source }),
    ).rejects.toThrow("separate");
  });
  it("rejects private-key contents and oversize Markdown", async () => {
    await writeFile(join(memory(source), "style.md"), "-----BEGIN PRIVATE KEY-----");
    const importer = createProfileImporter(() => target);
    await expect(importer.previewProfileImport({ source })).rejects.toThrow("Sensitive");
    await writeFile(join(memory(source), "style.md"), "a".repeat(256 * 1024 + 1));
    await expect(importer.previewProfileImport({ source })).rejects.toThrow("exceeds");
  });
});

it("rolls back owned files after a destination write error", async () => {
  const importer = createProfileImporter(() => target);
  const preview = await importer.previewProfileImport({ source });
  failure.path = join(memory(target), "style.md");
  await expect(importer.confirmProfileImport({ token: preview.token })).rejects.toThrow(
    "Injected disk failure",
  );
  await expect(readdir(memory(target))).rejects.toThrow();
  expect(await readFile(join(memory(source), "MEMORY.md"), "utf8")).toContain("Use TypeScript");
});
