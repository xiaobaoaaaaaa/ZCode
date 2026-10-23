import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadZCodeModules } from "../apps/zcode-cli/e2e/memory/memory-e2e-runtime.mjs";
import { startPersonalMockProvider } from "./personal-mock-provider.mjs";

export async function runRoutingEvidence() {
  const root = await mkdtemp(join(tmpdir(), "zcode-mock-routing-"));
  const evidence = await mkdtemp(join(tmpdir(), "zcode-mock-routing-evidence-"));
  const modules = await loadZCodeModules();
  const p = modules.provider;
  const providerId = "personal:mock";
  const selection = (modelId) => ({ providerId, modelId, options: { reasoningLevel: "disabled" } });
  const records = [];
  const server = await startPersonalMockProvider();
  try {
    for (const scenario of [
      { name: "allowed", enabled: true, proposed: "child", expected: "child", reason: "allowed" },
      {
        name: "unlisted",
        enabled: true,
        proposed: "not-allowed",
        expected: "parent",
        reason: "not allowed",
      },
      {
        name: "disabled",
        enabled: false,
        proposed: "child",
        expected: "parent",
        reason: "disabled",
      },
      {
        name: "manual",
        enabled: true,
        proposed: "child",
        manual: "fixed",
        expected: "fixed",
        reason: "Manual",
      },
      {
        name: "unavailable",
        enabled: true,
        proposed: "missing",
        expected: "parent",
        reason: "unavailable",
      },
    ]) {
      let calls = 0;
      const start = server.records.length;
      server.setHandler(({ body }) => {
        const text = JSON.stringify(body.messages);
        if (text.includes("CHILD_ROUTING_ONLY") && !text.includes("PARENT_ROUTING_ONLY"))
          return { text: "CHILD_DONE" };
        if (++calls === 1)
          return {
            toolCalls: [
              {
                id: `delegate_${scenario.name}`,
                name: "Agent",
                input: {
                  description: "Synthetic routing probe",
                  prompt: "CHILD_ROUTING_ONLY",
                  model: `${providerId}/${scenario.proposed}`,
                },
              },
            ],
          };
        return { text: "PARENT_DONE" };
      });
      const modelConfig = new p.ModelConfig({
        properties: new p.ModelPropertiesConfig({
          contextWindow: 200000,
          inputFormat: { supportsText: true },
          outputFormat: { supportsText: true },
          supportsToolCall: true,
          supportsJsonSchemaOutput: true,
          supportsMidConversationSystem: true,
        }),
        optionSpecs: new p.ModelOptionSpecsConfig({
          reasoningLevel: { values: ["disabled"], map: "{}" },
          maxOutputTokens: { max: 32000, map: '{"max_tokens": maxOutputTokens}' },
        }),
      });
      const registry = new p.ProviderRegistry([
        {
          providerId,
          config: new p.ProviderConfig({
            access: new p.ApiKeyAccessConfig({ apiKey: "FAKE_TEST_ONLY" }),
            api: new p.ProviderApiConfig({ type: "anthropic-messages", baseUrl: server.baseURL }),
            models: ["parent", "child", "fixed"],
            enabled: true,
          }),
          models: ["parent", "child", "fixed"].map((modelId) => ({ modelId, config: modelConfig })),
        },
      ]);
      const storageRoot = join(root, scenario.name);
      const workspace = join(storageRoot, "workspace");
      await mkdir(workspace, { recursive: true });
      const env = {
        PATH: process.env.PATH,
        ZCODE_ENV: "test",
        ZCODE_STORAGE_DIR: storageRoot,
        ZCODE_DATA_BASE_DIR: storageRoot,
        ZCODE_DESKTOP_HOME_DIR: storageRoot,
      };
      const adapter = modules.bootstrap.createModelAdapter({
        env,
        executionConfig: modules.bootstrap.createRuntimeAiSdkModelExecutionConfig(env),
      });
      const app = await modules.bootstrap.createZCodeApp({
        env,
        modelAdapter: adapter,
        providerRegistry: registry,
        resolveEffectiveModelSelection: (value) => {
          const check = registry.validateSelection(value);
          return check.ok
            ? { effectiveSelection: value }
            : { effectiveSelection: null, selectionIssue: check.code };
        },
        skipUserConfig: true,
        sessionId: `mock-${scenario.name}`,
        runtimeConfig: {
          workingDirectory: workspace,
          mode: "build",
          modelSelection: selection("parent"),
          modelStreaming: "on",
          memory: { enabled: false, globalEnabled: false },
          mcp: { enabled: false },
          titleGeneration: { enabled: false },
          subagents: {
            enabled: true,
            maxTurns: 3,
            mainAgentModelPolicy: {
              enabled: scenario.enabled,
              allowedModels: [selection("child"), selection("missing")],
            },
            ...(scenario.manual
              ? {
                  builtInModelSelectionOverrides: { "general-purpose": selection(scenario.manual) },
                }
              : {}),
          },
        },
      });
      try {
        await app.submitPrompt("PARENT_ROUTING_ONLY delegate a synthetic question");
        const captured = server.records.slice(start);
        const child = captured.find(
          (r) =>
            JSON.stringify(r.body.messages).includes("CHILD_ROUTING_ONLY") &&
            !JSON.stringify(r.body.messages).includes("PARENT_ROUTING_ONLY"),
        );
        assert.ok(child, `child HTTP request missing: ${scenario.name}`);
        assert.equal(child.body.model, scenario.expected, scenario.name);
        const toolResults = JSON.stringify(captured.at(-1).body.messages);
        assert.ok(
          toolResults.includes(scenario.reason),
          `${scenario.name}: actual fallback reason absent`,
        );
        records.push({
          scenario: scenario.name,
          expectedModel: scenario.expected,
          actualModel: child.body.model,
          reasonAsserted: scenario.reason,
        });
      } finally {
        await writeFile(
          join(evidence, `requests-${scenario.name}.json`),
          JSON.stringify(server.records.slice(start), null, 2),
        );
        await app.close();
      }
    }
    await writeFile(
      join(evidence, "result.json"),
      JSON.stringify({ status: "passed", records }, null, 2),
    );
    await writeFile(join(evidence, "requests.json"), JSON.stringify(server.records, null, 2));
    return { status: "passed", evidence, records };
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await runRoutingEvidence(), null, 2));
