import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadZCodeModules } from "../apps/zcode-cli/e2e/memory/memory-e2e-runtime.mjs";
import {
  startScriptedProvider,
  stopScriptedProvider,
} from "../apps/zcode-cli/e2e/compact-microcompact/scripted-provider.mjs";

const providerId = "personal-memory-test";
const modelId = "personal-memory-model";
const preference = "User prefers concise replies.";
const teach = "I prefer concise replies as my general communication style.";
const projectFact = "PROJECT_ALPHA_ONLY uses the synthetic violet build directory.";
const extractionMarker = "Extract up to three stable GLOBAL preferences";

function response(content) {
  return {
    body: {
      id: "msg_personal_memory",
      type: "message",
      role: "assistant",
      model: modelId,
      content: [{ type: "text", text: content }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    },
  };
}
function serialized(body) {
  return JSON.stringify(body);
}
export function memoryMockResponse({ body, method, url }) {
  assert.equal(method, "POST", "Unexpected mock method");
  assert.equal(url, "/v1/messages", "Unexpected mock route");
  assert.equal(body?.model, modelId, "Unexpected model must not receive a synthetic success");
  const text = serialized(body);
  if (text.includes(extractionMarker)) {
    // 固定合成答案只用于验证提取链路，不代表模型能正确判断偏好或项目事实。
    return response(JSON.stringify({ facts: text.includes(teach) ? [preference] : [] }));
  }
  if (text.includes("You are selecting memories that will be useful"))
    return response(JSON.stringify({ selected_memories: [] }));
  return response("SYNTHETIC_MEMORY_TURN_DONE");
}
function registry(module, baseUrl) {
  return new module.ProviderRegistry([
    {
      providerId,
      config: new module.ProviderConfig({
        access: new module.ApiKeyAccessConfig({ apiKey: "synthetic-test-only" }),
        api: new module.ProviderApiConfig({ type: "anthropic-messages", baseUrl }),
        models: [modelId],
        enabled: true,
      }),
      models: [
        {
          modelId,
          config: new module.ModelConfig({
            properties: new module.ModelPropertiesConfig({
              contextWindow: 100000,
              inputFormat: { supportsText: true },
              outputFormat: { supportsText: true },
              supportsToolCall: true,
              supportsJsonSchemaOutput: true,
              supportsNativeWebSearch: false,
              supportsMidConversationSystem: true,
            }),
            optionSpecs: new module.ModelOptionSpecsConfig({
              reasoningLevel: { values: ["disabled"], map: "{}" },
              maxOutputTokens: { max: 8192, map: '{"max_tokens": maxOutputTokens}' },
            }),
          }),
        },
      ],
    },
  ]);
}

async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded 30 seconds`)), 30000);
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Run in a dedicated process: services capture the isolated data root at module load. */
export async function runPersonalMemoryMock({ artifacts } = {}) {
  const root = await mkdtemp(join(tmpdir(), "zcode-personal-memory-e2e-"));
  const output = artifacts
    ? resolve(artifacts)
    : await mkdtemp(join(tmpdir(), "zcode-personal-memory-evidence-"));
  await mkdir(output, { recursive: true });
  const home = join(root, "home");
  const storage = join(home, ".zcode-personal");
  const workspaceA = join(root, "project-a");
  const workspaceB = join(root, "project-b");
  await Promise.all([home, workspaceA, workspaceB].map((path) => mkdir(path, { recursive: true })));
  const originalBase = process.env.ZCODE_DATA_BASE_DIR;
  const originalHome = process.env.ZCODE_DESKTOP_HOME_DIR;
  process.env.ZCODE_DATA_BASE_DIR = home;
  process.env.ZCODE_DESKTOP_HOME_DIR = home;
  let provider;
  const apps = new Set();
  const checks = [];
  let service;
  let result;
  let cleanupError;
  const check = (name, assertion) => {
    assertion();
    checks.push(name);
  };
  try {
    const modules = await loadZCodeModules();
    const { createMemoryService } =
      await import("../packages/services/src/memory/memoryService.ts");
    service = createMemoryService();
    provider = await startScriptedProvider({
      name: "personal-memory",
      handler: memoryMockResponse,
    });
    assert.equal(new URL(provider.baseURL).hostname, "127.0.0.1");
    const env = {
      PATH: process.env.PATH,
      ZCODE_ENV: "test",
      ZCODE_STORAGE_DIR: storage,
      ZCODE_DATA_BASE_DIR: home,
      ZCODE_DESKTOP_HOME_DIR: home,
    };
    async function app(sessionId, workspace) {
      const modelAdapter = modules.bootstrap.createModelAdapter({
        env,
        executionConfig: modules.bootstrap.createRuntimeAiSdkModelExecutionConfig(env),
      });
      const instance = await modules.bootstrap.createZCodeApp({
        env,
        modelAdapter,
        providerRegistry: registry(modules.provider, provider.baseURL),
        sessionId,
        skipUserConfig: true,
        runtimeConfig: {
          memory: { enabled: true, use: true },
          mcp: { enabled: false },
          mode: "default",
          modelSelection: { providerId, modelId, options: { reasoningLevel: "disabled" } },
          modelStreaming: "off",
          subagents: { enabled: false },
          titleGeneration: { enabled: false },
          workingDirectory: workspace,
        },
      });
      apps.add(instance);
      return instance;
    }
    async function turn(instance, prompt) {
      const start = provider.records.length;
      await bounded(instance.submitPrompt(prompt), "model turn");
      await bounded(instance.runtime.drainMemoryExtractions(), "memory extraction");
      const records = provider.records.slice(start);
      const main = records.find(
        (record) =>
          record.requestBody.includes(prompt) &&
          !record.requestBody.includes(extractionMarker) &&
          !record.requestBody.includes("You are now acting as the memory extraction subagent") &&
          !record.requestBody.includes("You are selecting memories that will be useful"),
      );
      assert.ok(main, "A real foreground HTTP request must be captured");
      assert.ok(records.every((record) => record.status === 200));
      return { main: JSON.parse(main.requestBody), records };
    }
    const a = await app("memory-teach-a", workspaceA);
    await turn(a, teach);
    const stored = await service.getGlobalMemory();
    check("automatic extraction persisted actual Markdown with user provenance", () => {
      assert.ok(stored.content.includes(preference));
      assert.match(stored.content, /Source: user session memory-teach-a/);
    });
    const disk = await readFile(join(storage, "cli/memories/global/memory/MEMORY.md"), "utf8");
    assert.equal(disk, stored.content);
    await turn(a, projectFact);
    const afterProjectFact = await service.getGlobalMemory();
    check("project-only assertion not stored by fixed extraction fixture", () =>
      assert.ok(!afterProjectFact.content.includes(projectFact)),
    );
    const projectMemory = modules.core.resolveProjectMemoryRoot({
      cliStorageRoot: join(storage, "cli"),
      workspacePath: workspaceA,
    });
    await mkdir(projectMemory, { recursive: true });
    await writeFile(join(projectMemory, "MEMORY.md"), `# Project A\n\n${projectFact}\n`);
    const b = await app("memory-recall-b", workspaceB);
    const recalled = await turn(b, "Please give a concise answer in project B.");
    check("cross-project request carries global background as user data, not system rules", () => {
      assert.ok(serialized(recalled.main.messages).includes(preference));
      assert.ok(!serialized(recalled.main.system).includes(preference));
      assert.ok(serialized(recalled.main.messages).includes("untrusted background observations"));
      assert.ok(!serialized(recalled.main).includes(projectFact));
    });
    await service.setGlobalMemoryPreferences({ extractionEnabled: false });
    const beforePause = await service.getGlobalMemory();
    const paused = await turn(b, "My other stable preference is concise bullet replies.");
    check("pause blocks extraction requests/writes while existing recall remains", () => {
      assert.ok(!paused.records.some((record) => record.requestBody.includes(extractionMarker)));
      assert.ok(serialized(paused.main).includes(preference));
    });
    assert.equal((await service.getGlobalMemory()).generation, beforePause.generation);
    await service.setGlobalMemoryPreferences({ extractionEnabled: true });
    await service.setGlobalMemorySessionEnabled({ sessionId: "memory-recall-b", enabled: false });
    const disabled = await turn(
      b,
      "Please provide another concise answer while session memory is disabled.",
    );
    check("live session disable removes context and suppresses extraction", () => {
      assert.ok(!serialized(disabled.main).includes(preference));
      assert.ok(!disabled.records.some((record) => record.requestBody.includes(extractionMarker)));
    });
    await service.setGlobalMemorySessionEnabled({ sessionId: "memory-recall-b", enabled: true });
    const beforeDelete = await service.getGlobalMemory();
    await service.updateGlobalMemory({ content: "", expectedGeneration: beforeDelete.generation });
    const deleted = await turn(
      b,
      "Please give a concise answer after deleting the saved preference.",
    );
    check("delete invalidates context in the same live runtime", () =>
      assert.ok(!serialized(deleted.main).includes(preference)),
    );
    assert.equal((await service.getGlobalMemory()).content, "");
    assert.equal(await readFile(join(storage, "cli/memories/global/memory/MEMORY.md"), "utf8"), "");
    await service.setGlobalMemoryPreferences({ enabled: false, extractionEnabled: true });
    const off = await app("memory-profile-off", workspaceB);
    const offResult = await turn(off, teach);
    check("profile disable blocks automatic extraction and persistence", () => {
      assert.ok(!offResult.records.some((record) => record.requestBody.includes(extractionMarker)));
    });
    assert.equal((await service.getGlobalMemory()).content, "");
    result = {
      status: "passed",
      checks,
      requests: provider.records.length,
      artifacts: output,
      realModelCapabilityTested: false,
      electronUiTested: false,
      userDataUsed: false,
    };
    await writeFile(join(output, "memory-result.json"), JSON.stringify(result, null, 2));
    await writeFile(join(output, "memory-persisted-extraction.md"), disk);
  } finally {
    const closed = await Promise.allSettled(
      [...apps].map((instance) => bounded(instance.close(), "runtime close")),
    );
    if (provider) {
      // Only synthetic bodies are retained; headers (including the fake token) are unnecessary.
      await writeFile(
        join(output, "memory-http-requests.json"),
        JSON.stringify(
          provider.records.map(({ requestBody, responseBody, status, url }) => ({
            requestBody,
            responseBody,
            status,
            url,
          })),
          null,
          2,
        ),
      );
      await stopScriptedProvider(provider);
    }
    if (originalBase === undefined) delete process.env.ZCODE_DATA_BASE_DIR;
    else process.env.ZCODE_DATA_BASE_DIR = originalBase;
    if (originalHome === undefined) delete process.env.ZCODE_DESKTOP_HOME_DIR;
    else process.env.ZCODE_DESKTOP_HOME_DIR = originalHome;
    await rm(root, { recursive: true, force: true });
    const failedClose = closed.find((result) => result.status === "rejected");
    if (failedClose) cleanupError = failedClose.reason;
  }
  if (cleanupError) {
    await writeFile(
      join(output, "memory-result.json"),
      JSON.stringify({ status: "failed", error: String(cleanupError) }),
    );
    throw cleanupError;
  }
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  assert.ok(
    args.length === 0 || (args.length === 2 && args[0] === "--artifacts"),
    "Usage: node --import tsx scripts/personal-mock-memory.mjs [--artifacts PATH]",
  );
  console.log(JSON.stringify(await runPersonalMemoryMock({ artifacts: args[1] }), null, 2));
}
