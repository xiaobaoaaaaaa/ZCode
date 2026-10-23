import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeGlobalMemoryStore } from "../src/global-memory/store.js";

describe("profile global memory storage", () => {
  let directory: string;
  let root: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "zcode-global-memory-"));
    root = join(directory, "cli", "memories", "global");
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const config = (overrides: Record<string, unknown> = {}) => ({
    enabled: true,
    extractionEnabled: true,
    generation: 0,
    disabledSessionIds: [],
    ...overrides,
  });
  function store() {
    return createNodeGlobalMemoryStore({ cliStorageRoot: join(directory, "cli") });
  }
  async function saveConfig(overrides: Record<string, unknown>) {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "config.json"), JSON.stringify(config(overrides)));
  }

  it("reads defaults without creating profile files", async () => {
    expect(await store().read()).toEqual({ ...config(), content: "" });
    await expect(readFile(join(root, "config.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("commits once and rejects stale snapshots across store instances", async () => {
    expect(
      await store().write({ content: "preferred language: Chinese", expectedGeneration: 0 }),
    ).toBe(true);
    expect(await store().write({ content: "stale", expectedGeneration: 0 })).toBe(false);
    expect(await store().read()).toMatchObject({
      generation: 1,
      content: "preferred language: Chinese",
    });
  });
  it.each([{ enabled: false }, { extractionEnabled: false }, { disabledSessionIds: ["s1"] }])(
    "rejects disabled automatic writes: %j",
    async (overrides) => {
      await saveConfig(overrides);
      expect(
        await store().write({ content: "ignored", expectedGeneration: 0, sessionId: "s1" }),
      ).toBe(false);
      expect((await store().read()).content).toBe("");
    },
  );
  it("does not resurrect content after settings deletes it and advances generation", async () => {
    await store().write({ content: "old preference", expectedGeneration: 0 });
    await saveConfig({ generation: 2 });
    await writeFile(join(root, "memory", "MEMORY.md"), "");
    expect(await store().write({ content: "old preference", expectedGeneration: 1 })).toBe(false);
    expect((await store().read()).content).toBe("");
  });
  it("serializes competing writers without silently overwriting", async () => {
    const results = await Promise.allSettled([
      store().write({ content: "first", expectedGeneration: 0 }),
      store().write({ content: "second", expectedGeneration: 0 }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled" && result.value)).toHaveLength(
      1,
    );
    expect((await store().read()).generation).toBe(1);
  });
  it("fails closed on busy storage and never steals a lock", async () => {
    await mkdir(join(root, ".write-lock"), { recursive: true });
    await expect(store().read()).rejects.toThrow("busy");
    await expect(store().write({ content: "x", expectedGeneration: 0 })).rejects.toMatchObject({
      code: "EEXIST",
    });
  });
  it("rejects malformed configuration and releases acquired locks", async () => {
    await saveConfig({ generation: "0" });
    await expect(store().write({ content: "x", expectedGeneration: 0 })).rejects.toThrow(
      "configuration",
    );
    await expect(store().read()).rejects.toThrow("configuration");
    await saveConfig({});
    expect(await store().write({ content: "valid", expectedGeneration: 0 })).toBe(true);
  });
  it("rejects symlinked directories and files", async () => {
    const outside = join(directory, "outside");
    await mkdir(outside);
    await mkdir(join(directory, "cli", "memories"), { recursive: true });
    await symlink(outside, root, "junction");
    await expect(store().read()).rejects.toThrow("Unsafe");
    await expect(store().write({ content: "x", expectedGeneration: 0 })).rejects.toThrow("Unsafe");
    await rm(root);
    await mkdir(join(root, "memory"), { recursive: true });
    await writeFile(join(outside, "secret"), "secret");
    await symlink(join(outside, "secret"), join(root, "memory", "MEMORY.md"));
    await expect(store().read()).rejects.toThrow("Unsafe");
    await expect(store().write({ content: "x", expectedGeneration: 0 })).rejects.toThrow("Unsafe");
    expect(await readFile(join(outside, "secret"), "utf8")).toBe("secret");
  });
  it("bounds file sizes and honors cancellation before writing", async () => {
    await expect(
      store().write({ content: "中".repeat(10_923), expectedGeneration: 0 }),
    ).rejects.toThrow("size limit");
    const controller = new AbortController();
    controller.abort();
    await expect(
      store().write({ content: "x", expectedGeneration: 0 }, { signal: controller.signal }),
    ).rejects.toThrow();
    expect((await store().read()).generation).toBe(0);
  });
  it("rejects recognizable credentials before creating storage", async () => {
    await expect(
      store().write({ content: "api_key=never-store-this", expectedGeneration: 0 }),
    ).rejects.toThrow("Sensitive");
    expect((await store().read()).generation).toBe(0);
  });
});
