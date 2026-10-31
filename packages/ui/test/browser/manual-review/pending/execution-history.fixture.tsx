import { useState } from "react";
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
const mode = query.get("mode") ?? "main";
const theme = query.get("theme") ?? "dark";
document.documentElement.className = `${theme} theme-zai-${theme}`;
const start = 1_700_000_000_000;
const base = { turnId: "history-case", createdAt: start, createdAtSeq: 1 };
function Fixture() {
  const [extra, setExtra] = useState(false);
  const rows: ConversationRow[] = [
    {
      ...base,
      rowId: 1,
      kind: "turnHeader",
      origin: mode === "background" ? "backgroundResult" : "userInput",
      state: "completedSuccess",
      startedAt: start,
      endedAt: start + 3000,
    },
    { ...base, rowId: 2, kind: "userInput", origin: "realUser", text: "E2E_HISTORY_REQUEST" },
    { ...base, rowId: 3, kind: "reasoning", text: "E2E_REASONING", state: "complete" },
    {
      ...base,
      rowId: 4,
      kind: "toolCall",
      toolCallId: "history-bash",
      toolName: "Bash",
      status: "success",
      inputText: '{"command":"echo history"}',
      output: { text: "E2E_HISTORY_LOG" },
    },
    ...(extra
      ? [
          {
            ...base,
            rowId: 5,
            kind: "toolCall" as const,
            toolCallId: "history-read",
            toolName: "Read",
            status: "success" as const,
            inputText: '{"file_path":"/fixture/a.txt"}',
            output: { text: "E2E_READ_LOG" },
          },
        ]
      : []),
    {
      ...base,
      rowId: 6,
      kind: "toolCall",
      toolCallId: "history-error",
      toolName: "Bash",
      status: "error",
      inputText: '{"command":"bad-command"}',
      output: { text: "E2E_TOOL_ERROR" },
    },
    { ...base, rowId: 7, kind: "assistantText", text: "E2E_FINAL_REPLY", state: "complete" },
  ];
  const [unit] = buildConversationTurnRenderUnits(rows, { nowMs: start + 3000 });
  return (
    <>
      <button onClick={() => setExtra(true)}>Append</button>
      <ConversationTurnGroup
        unit={mode === "timeline" ? { ...unit!, timelineOnly: true } : unit!}
        context={{
          workspacePath: "/fixture",
          theme,
          codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS,
          compactForRemoteControl: mobile,
          messageStreamShowReasoning: true,
        }}
        onFeedbackChange={() => undefined}
      />
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <TooltipProvider>
    <ZCodeIntlProvider initialLocale={mobile ? "en-US" : "zh-CN"}>
      <main className="min-h-dvh bg-background text-foreground @container/conversation">
        <Fixture />
      </main>
    </ZCodeIntlProvider>
  </TooltipProvider>,
);
