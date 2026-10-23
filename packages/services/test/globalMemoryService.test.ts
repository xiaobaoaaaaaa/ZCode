import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryService } from "../src/memory/memoryService.js";
import { getZCodeDataRootDir, setDataBaseDir } from "../src/paths.js";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "global-memory-test-"));
  setDataBaseDir(directory);
});
afterEach(async () => {
  setDataBaseDir(null);
  await rm(directory, { recursive: true, force: true });
});
const root = () => join(getZCodeDataRootDir(), "cli", "memories", "global");

describe("profile global memory", () => {
  it("defaults on and supports edit, pause, disable session and deletion with stale editor protection", async () => {
    const service = createMemoryService();
    expect(await service.getGlobalMemory()).toEqual({
      content: "",
      enabled: true,
      extractionEnabled: true,
      generation: 0,
      disabledSessionIds: [],
    });
    const edited = await service.updateGlobalMemory({
      content: "偏好中文\n",
      expectedGeneration: 0,
    });
    expect(edited.generation).toBe(1);
    expect(
      (await service.setGlobalMemoryPreferences({ extractionEnabled: false })).extractionEnabled,
    ).toBe(false);
    expect(
      (await service.setGlobalMemorySessionEnabled({ sessionId: "session-1", enabled: false }))
        .disabledSessionIds,
    ).toEqual(["session-1"]);
    const fresh = await service.getGlobalMemory();
    await service.updateGlobalMemory({ content: "", expectedGeneration: fresh.generation });
    await expect(
      service.updateGlobalMemory({
        content: edited.content,
        expectedGeneration: edited.generation,
      }),
    ).rejects.toThrow("changed");
    expect((await service.getGlobalMemory()).content).toBe("");
  });
  it("does not steal a writer lock or read a partial transaction", async () => {
    const service = createMemoryService();
    await service.getGlobalMemory();
    await mkdir(join(root(), ".write-lock"));
    await expect(service.getGlobalMemory()).rejects.toThrow("being edited");
    await expect(service.setGlobalMemoryPreferences({ enabled: false })).rejects.toThrow(
      "being edited",
    );
  });
  it("rejects linked memory files without reading or overwriting targets", async () => {
    const service = createMemoryService();
    await service.getGlobalMemory();
    await symlink(join(directory, "outside.md"), join(root(), "memory", "MEMORY.md"));
    await expect(service.getGlobalMemory()).rejects.toThrow();
    await expect(
      service.updateGlobalMemory({ content: "x", expectedGeneration: 0 }),
    ).rejects.toThrow();
  });
  it("fails closed on a present incomplete config", async () => {
    const service = createMemoryService();
    await service.getGlobalMemory();
    await writeFile(join(root(), "config.json"), "{}");
    await expect(service.getGlobalMemory()).rejects.toThrow("Invalid global memory configuration");
    await expect(service.setGlobalMemoryPreferences({ enabled: true })).rejects.toThrow(
      "Invalid global memory configuration",
    );
  });
  it("rejects credential-shaped content", async () => {
    await expect(
      createMemoryService().updateGlobalMemory({
        content: "api_key=do-not-store",
        expectedGeneration: 0,
      }),
    ).rejects.toThrow("credentials");
  });
  it("rejects oversized edits", async () => {
    await expect(
      createMemoryService().updateGlobalMemory({
        content: "中".repeat(32768),
        expectedGeneration: 0,
      }),
    ).rejects.toThrow("32 KiB");
  });
});
