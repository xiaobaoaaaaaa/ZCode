import { createRoot } from "react-dom/client";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import { ConversationTurnGroup } from "@/v4/ConversationTurnGroup.js";
import { buildConversationTurnRenderUnits } from "@/v4/conversationTurnRenderUnits.js";
import "@/styles.css";

const query = new URLSearchParams(location.search);
const mobile = query.get("mobile") === "true";
const highspeed = false;
const running = query.get("running") === "true";
const missing = query.get("missing") === "true";
const legacy = query.get("legacy") === "true";
const theme = query.get("theme") === "light" ? "light" : "dark";
document.documentElement.className = `${theme} theme-zai-${theme}`;
const base = { turnId: "performance-footer", createdAt: 1_700_000_000_000, createdAtSeq: 1 };
const rows: ConversationRow[] = [
  {
    ...base,
    rowId: 1,
    kind: "turnHeader",
    origin: "userInput",
    state: running ? "running" : "completedSuccess",
    ...(legacy
      ? {}
      : {
          performance: {
            requestCount: 2,
            inputTokens: 1200,
            outputTokens: 300,
            reasoningTokens: null,
            cacheReadTokens: 600,
            cacheWriteTokens: 0,
            modelDurationMs: missing ? null : 8000,
            firstResponseTotalMs: missing ? 0 : 2000,
            firstResponseCount: missing ? 0 : 2,
            generationDurationMs: missing ? 0 : 6000,
            timedOutputTokens: missing ? 0 : 300,
            timedRequestCount: missing ? 0 : 2,
          },
        }),
    startedAt: base.createdAt,
  },
  {
    ...base,
    rowId: 2,
    kind: "userInput",
    origin: "realUser",
    text: "说明本轮性能统计",
    ...(highspeed
      ? {
          highspeed: {
            schemaVersion: 1,
            cardId: "hsc-hooks",
            taskId: "performance-footer",
            provider: "zai",
            model: "glm-5",
            issuedAt: 1_000,
            expiresAt: 10_000,
          },
        }
      : {}),
  },
  {
    ...base,
    rowId: 3,
    kind: "hookInvocation",
    entityId: "hook-1",
    productTurnId: base.turnId,
    visibility: "visible",
    hookInvocationId: "hook-1",
    hookEventName: "UserPromptSubmit",
    hookCount: 1,
    state: "completed",
    startedAt: base.createdAt,
    endedAt: base.createdAt + 25,
    durationMs: 25,
    lane: "assistantWork",
    executions: [
      {
        hookRunId: "execution-1",
        hookIndex: 0,
        didExecute: true,
        state: "completed",
        outcome: "success",
        sourceKind: "user",
        startedAt: base.createdAt,
        endedAt: base.createdAt + 25,
        durationMs: 25,
      },
    ],
  },
  ...(!highspeed
    ? [
        {
          ...base,
          rowId: 4,
          kind: "assistantText" as const,
          state: "complete" as const,
          entityId: "assistant-1",
          text: "你好！我是 ZCode，有什么可以帮你的吗？\n\n直接告诉我你想做什么就行。",
        },
      ]
    : []),
];
const visibleRows =
  query.get("empty") === "true"
    ? rows.filter((row) => row.kind === "turnHeader" || row.kind === "userInput")
    : rows;
const [unit] = buildConversationTurnRenderUnits(visibleRows);

// 真实组件、主题与点击行为；只读投影输入固定，不建立 runtime 或远控连接。
createRoot(document.getElementById("root")!).render(
  <TooltipProvider>
    <ZCodeIntlProvider initialLocale={mobile ? "en-US" : "zh-CN"}>
      <main className="min-h-dvh bg-background text-foreground @container/conversation">
        <ConversationTurnGroup
          unit={{ ...unit!, showHighspeedOutputFooter: highspeed }}
          context={{
            workspacePath: "/fixture",
            theme,
            codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS,
            compactForRemoteControl: mobile,
          }}
          onFeedbackChange={() => undefined}
        />
      </main>
    </ZCodeIntlProvider>
  </TooltipProvider>,
);
