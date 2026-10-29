import { agentToolEntry } from "../src/tool/handlers/agent.js";
import type { ToolExecutionContext } from "../src/tool/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentInputSchema, createSessionId, type ModelSelection } from "@zcode/contracts";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createTestModelFactory } from "./test-runtime-model.js";
import { createTestSessionEventStore } from "./test-event-store.js";
import { AgentRuntime } from "../src/runtime.js";

describe("Subagent 有效选择到实际执行", () => {
  afterEach(() => vi.restoreAllMocks());
  const parent = {
    providerId: "custom-provider",
    modelId: "parent-model",
    options: { reasoningLevel: "high" },
  };
  const original = {
    providerId: "account:bigmodel-individual-coding-plan",
    modelId: "GLM-5.3",
    options: { reasoningLevel: "high" },
  };
  const effective = { ...original, providerId: "account:bigmodel-team-coding-plan" };

  const chosen = { providerId: "custom", modelId: "chosen", options: { reasoningLevel: "low" } };

  it.each([
    "explicit",
    "inherit",
    "inherit-plan",
    "override",
    "unavailable",
    "invocation",
    "invocation-background",
    "invalid-model",
    "bound-model",
  ] as const)("%s：通过 Agent tool 创建真实 child 并检查请求使用的模型", async (kind) => {
    const childSelections: ModelSelection[] = [];
    const resolveEffectiveModelSelection = vi.fn((selection: ModelSelection) => ({
      effectiveSelection:
        kind === "unavailable" || kind === "override"
          ? null
          : selection.modelId === "chosen"
            ? selection
            : effective,
    }));
    let mainCalls = 0;
    const executeTurnSpy = vi.spyOn(AgentRuntime.prototype, "executeTurn");
    const runtime = createTestAgentRuntime(
      createSessionId(`effective-child-${kind}`),
      {
        mode: "yolo",
        planEnabled: kind === "inherit-plan",
        workingDirectory: "/workspace/project",
        modelSelection: parent,
        subagents: {
          profiles: [
            {
              name: "researcher",
              description: "Research code",
              source: "user",
              tools: ["Read"],
              systemPrompt: "Return a short result.",
              ...(kind.startsWith("inherit") ? {} : { modelSelection: original }),
            },
          ],
        },
      },
      {
        eventStore: createTestSessionEventStore(),
        resolveEffectiveModelSelection,
        modelCatalogPort: {
          listModels: () => [
            {
              providerId: chosen.providerId,
              modelId: chosen.modelId,
              reasoningLevels: ["low", "high"],
              defaultReasoningLevel: "low",
              current: false,
            },
          ],
        },
        modelFactory: createTestModelFactory({
          async generateText(_request, observation) {
            const metadata = observation.invocationContext?.metadata as
              | { querySource?: string }
              | undefined;
            const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
            if (metadata?.querySource === "subagent") {
              childSelections.push({
                providerId: observation.model.providerId,
                modelId: observation.model.modelId,
                options: { reasoningLevel: observation.model.options.reasoningLevel! },
              });
              return { finishReason: "stop", text: "child done", usage };
            }
            if (++mainCalls === 1)
              return {
                finishReason: "tool-calls",
                text: "",
                usage,
                toolCalls: [
                  {
                    id: "call_child",
                    name: "Agent",
                    input: {
                      description: "Research",
                      prompt: "Research code",
                      subagent_type: "researcher",
                      ...(["invocation", "invocation-background", "bound-model"].includes(kind)
                        ? { model: `${chosen.providerId}/${chosen.modelId}` }
                        : {}),
                      ...(kind === "invalid-model" ? { model: "unknown/missing" } : {}),
                      ...(kind === "invocation-background" ? { run_in_background: true } : {}),
                    },
                  },
                ],
              };
            return { finishReason: "stop", text: "done", usage };
          },
        }),
      },
    );
    await runtime.executeTurn(
      "Run the researcher.",
      undefined,
      kind === "override" || kind === "bound-model"
        ? {
            intent: {
              sourceCommandId: "execution-override",
              kind: "sendText",
              requestedDelivery: "start-now",
              modelSelection: effective,
            },
            modelExecution: {
              selectionScope: "execution",
              subagents: { foregroundModel: "submission", background: "deny" },
            },
          }
        : undefined,
    );
    if (kind === "invocation-background")
      await vi.waitFor(() => expect(childSelections).toHaveLength(1));
    expect(childSelections).toEqual(
      ["unavailable", "invalid-model", "bound-model"].includes(kind)
        ? []
        : [
            kind.startsWith("inherit")
              ? parent
              : kind.startsWith("invocation")
                ? chosen
                : effective,
          ],
    );
    expect(resolveEffectiveModelSelection).toHaveBeenCalledTimes(
      ["explicit", "unavailable", "invocation", "invocation-background"].includes(kind) ? 1 : 0,
    );
    expect(original.providerId).toBe("account:bigmodel-individual-coding-plan");
    expect(runtime.getSessionModelSelection()).toEqual(parent);
    if (kind === "inherit-plan") {
      const child = executeTurnSpy.mock.contexts.find((context) => context !== runtime);
      expect(child?.getMode()).toBe("yolo");
      expect(child?.getPlanEnabled()).toBe(true);
    }
    executeTurnSpy.mockRestore();
  });
});

describe("Agent invocation model validation before launch", () => {
  const catalog = [
    { providerId: "home", modelId: "parent", current: true, reasoningLevels: [] },
    {
      providerId: "home",
      modelId: "child",
      current: false,
      reasoningLevels: ["low", "high"],
      defaultReasoningLevel: "low",
    },
    { providerId: "away", modelId: "remote", current: false, reasoningLevels: [] },
    {
      providerId: "home",
      modelId: "disabled",
      current: false,
      reasoningLevels: [],
      disabledReason: "disabled by policy",
    },
  ];

  it.each([
    ["missing", catalog, "not_found"],
    ["disabled", catalog, "disabled"],
    ["child$max", catalog, "reasoning_level_unknown"],
    ["remote", catalog, "other_provider"],
    [
      "child",
      [...catalog, { ...catalog[1]!, providerId: "away" }].filter((e) => !e.current),
      "ambiguous",
    ],
    ["home/child", undefined, "model_catalog_unavailable"],
  ] as const)("rejects %s (%s) without spawning", async (model, entries, reason) => {
    const launch = vi.fn();
    const context = {
      subagentPort: { launch },
      ...(entries ? { modelCatalogPort: { listModels: () => entries } } : {}),
    } as unknown as ToolExecutionContext;
    await expect(
      agentToolEntry.handler({ description: "check", prompt: "check", model }, context),
    ).rejects.toThrow(reason);
    expect(launch).not.toHaveBeenCalled();
  });

  it.each(["", "  ", null, 42])("rejects malformed model %s at the schema boundary", (model) => {
    expect(
      AgentInputSchema.safeParse({ description: "check", prompt: "check", model }).success,
    ).toBe(false);
  });
});
