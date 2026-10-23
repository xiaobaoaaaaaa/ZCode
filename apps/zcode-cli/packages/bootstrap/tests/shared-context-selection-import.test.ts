import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { SessionStorePort } from "@zcode/contracts";
import { ZCodeProtocolAgentServer } from "../src/zcode-protocol/server.js";
import {
  createSessionRecordForV4,
  closeSession,
  importHistory,
} from "../src/zcode-protocol/server-operations.js";
import type { ZCodeProtocolAgentServerContext } from "../src/zcode-protocol/server-types.js";
import { createFakeApp } from "./helpers/fake-zcode-app.js";

describe("分享上下文导入与当前选择合同", () => {
  it.each(["", "account:zai-individual-coding-plan/GLM-5.3"])(
    "导入保留完整上下文，不要求可执行模型：%s",
    async (model) => {
      const commitSharedContextImportBundle = vi.fn<
        NonNullable<SessionStorePort["commitSharedContextImportBundle"]>
      >(async () => {});
      const resume = vi.fn(async () => undefined);
      const server = new ZCodeProtocolAgentServer({
        sessionStore: {
          commitSharedContextImportBundle,
          getSession: async () => null,
        } as unknown as SessionStorePort,
        createZCodeApp: (options) => createFakeApp(options, { getModel: () => model, resume }),
      });
      const context = (server as unknown as { context: ZCodeProtocolAgentServerContext }).context;
      const sessionId = "shared-context-model-test";
      try {
        await expect(
          createSessionRecordForV4(context, {
            sessionId,
            workspace: { workspacePath: "/fixture", workspaceKey: "/fixture" },
            importedHistory: {
              source: "sharedContext",
              title: "来自分享：测试",
              markdown: "保留分享上下文",
              provenance: {
                shareId: "share-test",
                projectionSha256: "a".repeat(64),
                artifactSetSha256: "b".repeat(64),
                markdownSha256: "c".repeat(64),
                formatterVersion: 1,
                installedArtifacts: [],
              },
            },
          }),
        ).resolves.toEqual({ sessionId });
        expect(commitSharedContextImportBundle).toHaveBeenCalledTimes(1);
        const bundle = commitSharedContextImportBundle.mock.calls[0]![0] as unknown as Parameters<
          NonNullable<SessionStorePort["commitSharedContextImportBundle"]>
        >[0];
        expect(bundle.contextMessage.info).not.toHaveProperty("model");
        expect(bundle.contextMessage.info).toMatchObject({
          visibility: "model-only",
          source: "shared_context",
        });
        if (model) {
          expect(bundle.contextMessage.info).toHaveProperty("modelSelection", {
            providerId: "account:zai-individual-coding-plan",
            modelId: "GLM-5.3",
          });
        } else {
          expect(bundle.contextMessage.info).not.toHaveProperty("modelSelection");
        }
        expect(bundle.contextMessage.parts[0]).toMatchObject({ text: "保留分享上下文" });
        expect(resume).toHaveBeenCalledTimes(1);
      } finally {
        if (context.sessions.has(sessionId)) await closeSession(context, { sessionId });
      }
    },
  );
});

it("official import remains inert even with an unanswered user message", async () => {
  const root = await mkdtemp(join(tmpdir(), "official-import-runtime-"));
  const createZCodeApp = vi.fn(() => {
    throw new Error("must not create runtime/model/MCP");
  });
  const importOfficialHistory = vi.fn(async () => ({
    alreadyImported: false,
    session: {
      id: "new-import",
      directory: root,
      title: "History",
      time: { created: 1, updated: 1 },
    },
  }));
  const server = new ZCodeProtocolAgentServer({
    sessionStore: { importOfficialHistory } as unknown as SessionStorePort,
    createZCodeApp,
  });
  const context = (server as unknown as { context: ZCodeProtocolAgentServerContext }).context;
  try {
    await expect(
      importHistory(context, {
        bundle: {
          sourceKey: "a".repeat(64),
          sourceDatabaseHash: "b".repeat(64),
          contentHash: "c".repeat(64),
          sourceSessionId: "old",
          sourceProfile: "/synthetic/source",
          directory: root,
          workspaceId: null,
          title: "History",
          createdAt: 1,
          updatedAt: 1,
          messages: [{ role: "user", text: "Never auto execute this", createdAt: 1 }],
        },
      }),
    ).resolves.toMatchObject({ sessionId: "new-import" });
    expect(createZCodeApp).not.toHaveBeenCalled();
    expect(context.sessions.size).toBe(0);
    expect(importOfficialHistory).toHaveBeenCalledTimes(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("resumes imported text only when the user explicitly continues", async () => {
  const { createHash } = await import("node:crypto");
  const { createSqliteSessionStore } = await import("../../adapters/src/storage/index.js");
  const { AgentRuntime } = await import("../../core/src/runtime.js");
  const { createTestSessionEventStore } = await import("../../core/tests/test-event-store.js");
  const { createTestModelFactory } = await import("../../core/tests/test-runtime-model.js");
  const { createTestModelSelection } = await import("../../core/tests/test-model-selection.js");
  const { createProjectId } = await import("@zcode/contracts");
  const store = await createSqliteSessionStore({ dbPath: ":memory:" });
  const root = await mkdtemp(join(tmpdir(), "official-import-continue-"));
  try {
    const messages = [
      { role: "user" as const, text: "Imported question", createdAt: 1 },
      { role: "assistant" as const, text: "Imported answer", createdAt: 2 },
      { role: "user" as const, text: "Unanswered imported question", createdAt: 3 },
    ];
    const title = "Imported history";
    const bundle = {
      sourceKey: "d".repeat(64),
      sourceSessionId: "original-id",
      sourceProfile: "/synthetic/source",
      sourceDatabaseHash: "e".repeat(64),
      contentHash: createHash("sha256")
        .update(JSON.stringify({ title, directory: root, messages }))
        .digest("hex"),
      title,
      directory: root,
      workspaceId: null,
      createdAt: 1,
      updatedAt: 3,
      messages,
    };
    const result = await store.importOfficialHistory!({
      bundle,
      projectID: createProjectId("synthetic-project"),
      version: "test",
    });
    const requests: string[] = [];
    const factory = vi.fn(
      createTestModelFactory({
        generateText: async (request) => {
          requests.push(JSON.stringify(request.messages));
          return {
            finishReason: "stop",
            text: "continued",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        },
      }),
    );
    const runtime = new AgentRuntime(
      result.session.id,
      { workingDirectory: root, titleGeneration: { enabled: false } },
      { sessionStore: store, eventStore: createTestSessionEventStore(), modelFactory: factory },
    );
    expect(await runtime.resumeFromStore()).toMatchObject({ messageCount: 3, partCount: 3 });
    expect(factory).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    await runtime.executeTurn("Explicitly continue now", undefined, {
      intent: {
        kind: "sendText",
        modelSelection: createTestModelSelection("test/model"),
        requestedDelivery: "start-now",
        sourceCommandId: "continue-import",
      },
    });
    expect(requests).toHaveLength(1);
    for (const text of [...messages.map((message) => message.text), "Explicitly continue now"])
      expect(requests[0]).toContain(text);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
