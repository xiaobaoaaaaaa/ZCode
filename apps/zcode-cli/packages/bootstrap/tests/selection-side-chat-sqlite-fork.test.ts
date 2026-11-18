import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CompactTimelineStatus,
  createMessageId,
  createModelId,
  createModelProviderId,
  createPartId,
} from "@zcode/contracts";
import { zcodeProtocolMethods } from "@zcode/shared";
import {
  conversationTopic,
  conversationTopicFrameSchema,
  routedTopicWireFrameSchema,
  V4_METHODS,
} from "@zcode/shared/zcode-protocol-v4";
import { ZCodeProtocolAgentServer } from "../src/zcode-protocol/server.js";
import {
  createRegistryBackedTestApp,
  createTestProviderRegistry,
} from "./helpers/registry-backed-test-app.js";
import type {
  MessageId,
  MessageWithParts,
  SessionId,
  SessionRevert,
  SessionStorePort,
} from "@zcode/contracts";
import { createSqliteSessionStore } from "../../adapters/src/storage/session-store/sqlite-session-store.js";
import { createSelectionSideConversation } from "../../core/src/runtime/methods/session-fork.js";
import { mergeColdConversationEvents } from "../src/zcode-protocol-v4/cold-event-merge.js";
import { ConversationTopicPublisher } from "../src/zcode-protocol-v4/conversation-topic-publisher.js";

const parentId = "fork-sql-parent" as SessionId;
const ids = ["user-first", "assistant-first", "user-next", "assistant-active"] as MessageId[];

function history(): MessageWithParts[] {
  return ids.map((id, index) => {
    const user = index % 2 === 0;
    const time = { created: index + 1, completed: index + 2 };
    return {
      info: {
        id,
        sessionID: parentId,
        role: user ? "user" : "assistant",
        time,
        agent: "build",
        tools: {},
        ...(user
          ? { modelSelection: { providerId: "glm", modelId: "glm-4-air" } }
          : {
              parentID: ids[index - 1],
              providerId: "glm",
              modelId: "glm-4-air",
              cost: 0,
              tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
            }),
        anchor: {
          origin: user ? "realUser" : "assistant",
          turnId: `turn-${Math.floor(index / 2)}`,
          productTurnId: `product-${Math.floor(index / 2)}`,
        },
      },
      parts: [
        {
          id: `text-${index}`,
          messageID: id,
          sessionID: parentId,
          type: "text",
          text: `body ${id}: ${"large output ".repeat(500)}`,
        },
      ],
    } as MessageWithParts;
  });
}

describe("selection side chat SQLite fork integration", () => {
  it.each(["idle", "active", "rewound"] as const)(
    "copies the correct %s branch with child-local references and complete payloads",
    async (state) => {
      const store = await createSqliteSessionStore({ dbPath: ":memory:" });
      try {
        await store.createSession({
          id: parentId,
          projectID: "project" as never,
          slug: "parent",
          directory: "/workspace",
          title: "parent",
          version: "test",
        });
        const messages = history();
        const assistant = messages[1]!;
        assistant.parts.push({
          id: "tool-first",
          sessionID: parentId,
          messageID: assistant.info.id,
          type: "tool",
          tool: "Read",
          callID: "source-call",
          state: {
            status: "completed",
            input: { source: "user-first" },
            output: "assistant-first body",
            title: "Read",
            metadata: {},
            time: { start: 1, end: 2 },
            attachments: [
              {
                id: "nested-file",
                sessionID: parentId,
                messageID: assistant.info.id,
                type: "file",
                mime: "image/png",
                url: "data:image/png;base64,source-call",
              },
            ],
          },
        } as never);
        assistant.parts.push({
          id: "compact-first",
          sessionID: parentId,
          messageID: assistant.info.id,
          type: "compaction",
          auto: false,
          summaryMessageId: assistant.info.id,
          tail_start_id: ids[0],
          metadata: { compactLeadingMessageIds: [ids[0], "outside-old-branch"] },
          compactBoundary: {
            summaryMessageIds: [assistant.info.id],
            lastSummarizedMessageId: ids[0],
            attachmentMessageIds: [ids[0]],
            hookResultMessageIds: [ids[0]],
            preservedSegment: {
              headMessageId: ids[0],
              anchorMessageId: ids[0],
              tailMessageId: assistant.info.id,
            },
            turnId: "turn-0",
          },
        } as never);
        assistant.parts.push({
          id: "timeline-first",
          sessionID: parentId,
          messageID: assistant.info.id,
          type: "timeline",
          timelineType: "context_compaction",
          anchorMessageId: ids[0],
          anchorTurnId: "turn-0",
          summaryMessageId: assistant.info.id,
        } as never);
        for (const message of messages) {
          await store.saveMessage(message.info);
          for (const part of message.parts) await store.savePart(part);
        }
        if (state === "rewound")
          await store.updateSession({
            id: parentId,
            revert: {
              targetMessageID: ids[2],
              keptMessageIDs: ids.slice(0, 2),
              branchCutAfterMessageID: ids[3],
            } as SessionRevert,
          });
        const parentBefore = await store.messages({ sessionID: parentId });
        const measured: SessionStorePort = new Proxy(store, {
          get(target, property) {
            if (property === "messages")
              return () => {
                throw new Error("fork must not read full bodies into JS");
              };
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const runtime = {
          sessionId: parentId,
          sessionStore: measured,
          activeTurn: state === "active" ? { turnId: "turn-1" } : null,
          rootTraceContext: { traceId: "trace-fork-sql" },
          config: { agentName: "build", mode: "build" },
          getSessionModelSelection: () => ({ providerId: "glm", modelId: "glm-4-air" }),
          workingDirectory: "/workspace",
          workspaceRoot: "/workspace",
        };
        const result = await createSelectionSideConversation.call(runtime as never, {
          sourceCommandId: "create-child",
        });
        const child = await store.messages({ sessionID: result.forkedSessionId });
        const count = state === "idle" ? 4 : state === "active" ? 3 : 2;
        expect(result.copiedMessageCount).toBe(count);
        expect(child).toHaveLength(count + 1);
        expect(child.slice(0, count).map((message) => message.info.visibility)).toEqual(
          Array(count).fill("model-only"),
        );
        expect(child.slice(0, count).map((message) => message.parts[0])).toEqual(
          parentBefore.slice(0, count).map((message, index) => ({
            ...message.parts[0],
            id: child[index]!.parts[0]!.id,
            sessionID: result.forkedSessionId,
            messageID: child[index]!.info.id,
          })),
        );
        expect(child[1]!.info).toMatchObject({ parentID: child[0]!.info.id });
        expect(child[0]!.info.anchor?.turnId).not.toBe("turn-0");
        expect(child[1]!.parts[1]).toMatchObject({
          state: {
            input: { source: "user-first" },
            output: "assistant-first body",
            attachments: [
              {
                sessionID: result.forkedSessionId,
                messageID: child[1]!.info.id,
                url: "data:image/png;base64,source-call",
              },
            ],
          },
        });
        expect(child[1]!.parts[1]).not.toMatchObject({ callID: "source-call" });
        expect(child[1]!.parts[2]).toMatchObject({
          summaryMessageId: child[1]!.info.id,
          tail_start_id: child[0]!.info.id,
          metadata: { compactLeadingMessageIds: [child[0]!.info.id] },
          compactBoundary: {
            summaryMessageIds: [child[1]!.info.id],
            preservedSegment: {
              headMessageId: child[0]!.info.id,
              anchorMessageId: child[0]!.info.id,
              tailMessageId: child[1]!.info.id,
            },
          },
        });
        expect(child[1]!.parts[3]).toMatchObject({
          anchorMessageId: child[0]!.info.id,
          anchorTurnId: child[0]!.info.anchor!.turnId,
          summaryMessageId: child[1]!.info.id,
        });
        expect(child.at(-1)!.info).toMatchObject({ source: "selection_side_chat" });
        const sessionId = String(result.forkedSessionId);
        const publisher = new ConversationTopicPublisher(sessionId, "side-chat-test");
        const merged = mergeColdConversationEvents({
          sessionId,
          messages: child,
          memoryEvents: [],
        });
        expect(merged.usedDurableTranscript).toBe(true);
        publisher.rehydrate(merged.events);
        for (const deliveryProfile of ["continuous", "replayable"] as const) {
          const { frame } = publisher.subscribe({ connectionId: deliveryProfile, deliveryProfile });
          expect(frame?.payload).toMatchObject({
            kind: "snapshot",
            snapshot: { rows: { window: [], totalCount: 0 } },
          });
          expect(publisher.getRowsRange({ limit: 20 }, deliveryProfile)).toMatchObject({
            rows: [],
            hasMore: false,
          });
        }
        expect(await store.messages({ sessionID: parentId })).toEqual(parentBefore);
        const duplicate = await createSelectionSideConversation.call(runtime as never, {
          sourceCommandId: "create-child",
        });
        expect(duplicate.forkedSessionId).toBe(result.forkedSessionId);
        expect(await store.messages({ sessionID: result.forkedSessionId })).toEqual(child);
      } finally {
        store.close();
      }
    },
  );
});

// SSC37 用真实协议、运行时和 SQLite 分别验证注册、首订阅、首次模型命令，检测多读历史而不依赖机器速度。
describe("selection side chat opening and first model switch", () => {
  it.each([
    [8, false],
    [8, true],
    [240, false],
    [240, true],
  ] as const)(
    "%i parent turns, completed compact=%s",
    async (turns, compact) => {
      const cwd = await mkdtemp(join(tmpdir(), "zcode-side-chat-"));
      const store = await createSqliteSessionStore({ dbPath: ":memory:" });
      const initial = {
        providerId: createModelProviderId("provider-a"),
        modelId: createModelId("model-a"),
        options: { reasoningLevel: "high" },
      };
      const next = { ...initial, modelId: createModelId("model-b") };
      const registry = createTestProviderRegistry([initial, next]);
      const apps: Awaited<ReturnType<typeof createRegistryBackedTestApp>>[] = [];
      const server = new ZCodeProtocolAgentServer({
        cwd,
        sessionStore: store,
        createZCodeApp: async (options) => {
          const app = await createRegistryBackedTestApp({
            ...options,
            env: {},
            skipUserConfig: true,
            providerRegistry: registry,
            configuredDefaultModelSelection: initial,
          });
          apps.push(app);
          return app;
        },
      });
      server.setNotificationSink((message) => {
        if (
          "id" in message &&
          message.method === zcodeProtocolMethods.sessionRequestRuntimePreferences
        )
          void server.handleMessage({
            id: message.id,
            result: { nativeSearchEnhancementsEnabled: false, memoryEnabled: false },
          });
      });
      const command = (
        type: string,
        sessionId: string | null,
        payload: Record<string, unknown>,
        cursor?: { revision: number; logEpoch: string },
      ) =>
        server.handleMessage({
          id: type,
          method: V4_METHODS.command,
          params: {
            clientId: "test",
            commandId: type,
            issuedAt: 1,
            sessionId,
            type,
            payload,
            ...(cursor ? { baseRevision: cursor.revision, baseLogEpoch: cursor.logEpoch } : {}),
          },
        });
      try {
        expect(
          await command("createSession", null, {
            workspaceId: cwd,
            config: { modelSelection: initial },
          }),
        ).toMatchObject({ result: { status: "accepted" } });
        const parent = apps[0]!;
        await parent.runtime.ensureSessionPersistedForExternalActivity("");
        const sessionID = parent.sessionId;
        const body = "x".repeat(64 * 1024);
        for (let turn = 0; turn < turns; turn++) {
          const time = { created: turn * 2 + 1, completed: turn * 2 + 2 };
          const user = createMessageId();
          const assistant = createMessageId();
          await store.saveMessage({
            id: user,
            sessionID,
            role: "user",
            time,
            agent: "build",
            modelSelection: initial,
            anchor: { origin: "realUser", sourceCommandId: `input-${turn}` },
          });
          await store.savePart({
            id: createPartId(),
            sessionID,
            messageID: user,
            type: "text",
            text: `question ${turn}`,
          });
          await store.saveMessage({
            id: assistant,
            sessionID,
            role: "assistant",
            time,
            parentID: user,
            agent: "build",
            mode: "build",
            modelId: initial.modelId,
            providerId: initial.providerId,
            cost: 0,
            tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
            path: { cwd, root: cwd },
          });
          await store.savePart({
            id: createPartId(),
            sessionID,
            messageID: assistant,
            type: "text",
            text: body,
          });
          if (compact && turn === Math.floor(turns / 2))
            await store.savePart({
              id: createPartId(),
              sessionID,
              messageID: assistant,
              type: "compaction",
              auto: false,
              operationId: "compact",
              timelineStatus: CompactTimelineStatus.Completed,
              tail_start_id: user,
            });
        }
        const reads = vi.spyOn(store, "messages");
        const created = await command("createSelectionSideSession", sessionID, {});
        expect(created, JSON.stringify(created)).toMatchObject({
          result: { status: "accepted", result: { type: "createSelectionSideSession" } },
        });
        const child = apps[1]!;
        const createReads = reads.mock.calls.filter(
          ([q]) => q.sessionID === child.sessionId,
        ).length;
        reads.mockClear();
        const subscribe = async (clientMode: "desktop-continuous" | "web-remote-replayable") => {
          const result = await server.handleMessage({
            id: clientMode,
            method: V4_METHODS.conversationSubscribe,
            params: {
              connectionId: clientMode,
              clientMode,
              topic: conversationTopic(child.sessionId),
            },
          });
          expect(result).toHaveProperty("result");
          const wire = routedTopicWireFrameSchema.parse(
            server.takePostResponseMessages(clientMode)[0]?.params,
          );
          if (wire.kind !== "complete") throw new Error("Expected complete frame");
          const { payload } = conversationTopicFrameSchema.parse(wire.frame);
          if (payload.kind !== "snapshot") throw new Error("Expected snapshot");
          expect(payload.snapshot.rows.totalCount).toBe(0);
          return payload.snapshot;
        };
        const snapshot = await subscribe("desktop-continuous");
        const subscribeReads = reads.mock.calls.length;
        reads.mockClear();
        const switched = await command(
          "switchModelConfig",
          child.sessionId,
          { provider: next.providerId, model: next.modelId, thought: "high" },
          snapshot,
        );
        expect(switched, JSON.stringify(switched)).toMatchObject({
          result: { status: "accepted" },
        });
        const switchReads = reads.mock.calls.length;
        expect(child.runtime.getSessionModelSelection()).toEqual(next);
        expect(parent.runtime.getSessionModelSelection()).toEqual(initial);
        const replay = await subscribe("web-remote-replayable");
        expect(replay.config?.model).toBe(next.modelId);
        expect({ createReads, subscribeReads, switchReads }).toEqual({
          createReads: 1,
          subscribeReads: 1,
          switchReads: 0,
        });
      } finally {
        try {
          await server.shutdown();
        } finally {
          store.close();
          await rm(cwd, { recursive: true, force: true });
        }
      }
    },
    30000,
  );
});
