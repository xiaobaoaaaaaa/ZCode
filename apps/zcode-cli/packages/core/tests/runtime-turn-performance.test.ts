import { expect, it } from "vitest";
import {
  createSessionId,
  ModelTransportKind,
  SessionEventType,
  type ModelCompletePayload,
} from "@zcode/contracts";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createTestSessionEventStore } from "./test-event-store.js";
import { createTestModelFactory } from "./test-runtime-model.js";
import { createRecordingMessageStore } from "./runtime-output-token-continuation-test-helpers.js";

it("PERF03 captures provider timing and retains it through final assistant persistence", async () => {
  const store = createRecordingMessageStore();
  const eventStore = createTestSessionEventStore();
  const append = eventStore.append.bind(eventStore);
  let publishedSamples = 0;
  eventStore.append = async (event) => {
    if (event.type === SessionEventType.ModelComplete) {
      const sample = (event.payload as ModelCompletePayload).requestPerformance;
      if (sample) {
        const saved = store.savedMessages.find((message) => message.id === sample.requestId);
        expect(saved?.metadata?.requestPerformance).toEqual(sample);
        // 指标先落盘，但 assistant 的工具/最终完成边界仍由原来的收口负责。
        expect(saved?.time.completed).toBeUndefined();
        expect(saved?.finish).toBeUndefined();
        publishedSamples += 1;
      }
    }
    return append(event);
  };
  const runtime = createTestAgentRuntime(
    createSessionId("performance-runtime"),
    {
      modelStreaming: "off",
      titleGeneration: { enabled: false },
    },
    {
      sessionStore: store as never,
      eventStore,
      modelFactory: createTestModelFactory({
        async generateText(_request, observation) {
          await observation.invocationContext?.statusSink?.publish({
            type: "model_request_completed",
            attempt: 1,
            maxAttempts: 1,
            requestId: "network-request",
            providerId: observation.model.providerId,
            modelId: observation.model.modelId,
            timestamp: new Date().toISOString(),
            traceId: "performance-trace",
            transport: ModelTransportKind.Sse,
            durationMs: 4000,
            timeToFirstContentMs: 1000,
          });
          return {
            text: "done",
            finishReason: "stop",
            toolCalls: [],
            usage: { inputTokens: 600, outputTokens: 150, cacheReadTokens: 300 },
          };
        },
      }),
    },
  );
  const result = await runtime.executeTurn("E2E_TURN_PERFORMANCE");
  const complete = result.events.find((event) => event.type === SessionEventType.ModelComplete)
    ?.payload as ModelCompletePayload;
  expect(complete.requestPerformance).toMatchObject({
    durationMs: 4000,
    firstResponseMs: 1000,
    inputTokens: 600,
    outputTokens: 150,
    cacheReadTokens: 300,
  });
  const saved = store.savedMessages.find(
    (message) => message.id === complete.requestPerformance?.requestId,
  );
  expect(saved?.metadata?.requestPerformance).toEqual(complete.requestPerformance);
  expect(saved?.time.completed).toBeGreaterThan(0);
  expect(publishedSamples).toBe(1);
});
