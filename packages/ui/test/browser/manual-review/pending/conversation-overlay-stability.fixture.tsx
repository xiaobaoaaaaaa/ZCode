import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import { ConversationTimeline } from "@/v4/ConversationTimeline.js";
import { ToolLayout } from "@/ToolCallBlocks/ToolLayout.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import "@/styles.css";

const query = new URLSearchParams(location.search);
const theme = query.get("theme") === "light" ? "light" : "dark";
const mobile = query.get("mobile") === "true";
document.documentElement.className = `${theme} theme-zai-${theme}`;
const started = Date.now();
const initial: ConversationRow[] = [
  {
    rowId: 20001,
    turnId: "history",
    createdAt: started - 10000,
    createdAtSeq: 1,
    kind: "turnHeader",
    origin: "userInput",
    state: "completedSuccess",
    startedAt: started - 10000,
    endedAt: started - 9000,
    activeMs: 1000,
  },
  {
    rowId: 20002,
    turnId: "history",
    createdAt: started - 10000,
    createdAtSeq: 2,
    kind: "userInput",
    origin: "realUser",
    text: "Previous task",
  },
  {
    rowId: 20003,
    turnId: "history",
    createdAt: started - 9000,
    createdAtSeq: 3,
    kind: "assistantText",
    entityId: "static-answer",
    state: "complete",
    text: "E2E_TOS_SELECTED_TEXT",
  },
  {
    rowId: 20004,
    turnId: "active",
    createdAt: started,
    createdAtSeq: 4,
    kind: "turnHeader",
    origin: "userInput",
    state: "running",
    startedAt: started,
  },
  {
    rowId: 20005,
    turnId: "active",
    createdAt: started,
    createdAtSeq: 5,
    kind: "userInput",
    origin: "realUser",
    text: "Current task",
  },
  {
    rowId: 20006,
    turnId: "active",
    createdAt: started,
    createdAtSeq: 6,
    kind: "assistantText",
    entityId: "active-text",
    state: "streaming",
    text: "STREAM 0",
  },
];
const older: ConversationRow[] = Array.from({ length: 1000 }, (_, i): ConversationRow[] => [
  {
    rowId: i * 3 + 1,
    turnId: `older-${i}`,
    createdAt: i,
    createdAtSeq: i * 3 + 1,
    kind: "turnHeader",
    origin: "userInput",
    state: "completedSuccess",
    startedAt: i,
    endedAt: i + 1,
  },
  {
    rowId: i * 3 + 2,
    turnId: `older-${i}`,
    createdAt: i,
    createdAtSeq: i * 3 + 2,
    kind: "userInput",
    origin: "realUser",
    text: `Older task ${i}`,
  },
  {
    rowId: i * 3 + 3,
    turnId: `older-${i}`,
    createdAt: i,
    createdAtSeq: i * 3 + 3,
    kind: "assistantText",
    entityId: `older-text-${i}`,
    state: "complete",
    text: `Older response ${i}`,
  },
]).flat();
const context = {
  workspacePath: "/fixture",
  theme,
  codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS,
  logEpoch: "tos",
  sessionId: "tos",
} as const;
const header = (
  <div className="p-3">
    <ToolLayout
      toolId="tos-failure"
      icon={null}
      canToggle={false}
      kindLabel="Bash"
      primaryText="fixture command"
      statusLabel="E2E_TOS_FAILED"
      statusTooltip="E2E_TOS_FAILURE_REASON"
      showFailureStatus
    />
  </div>
);

declare global {
  interface Window {
    __overlayFixture: { refresh(): void; stream(): void; prepend(): void };
  }
}

function Fixture() {
  const [rows, setRows] = useState(initial);
  const [asked, setAsked] = useState("");
  useEffect(() => {
    window.__overlayFixture = {
      refresh: () => setRows((value) => [...value]),
      stream: () =>
        setRows((value) =>
          value.map((row) =>
            row.kind === "assistantText" && row.turnId === "active"
              ? { ...row, text: row.text === "STREAM 0" ? "STREAM 1" : "STREAM 0" }
              : row,
          ),
        ),
      prepend: () => setRows((value) => [...older, ...value]),
    };
  }, []);
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <output data-testid="asked">{asked}</output>
      <div className="flex min-h-0 flex-1 flex-col">
        <ConversationTimeline
          rows={rows}
          totalCount={rows.length}
          sessionKey="tos"
          rowContext={context}
          headerSlot={header}
          compactForRemoteControl={mobile}
          selectionActions={{
            enabled: true,
            onAddToCurrentTask: (reference) => setAsked(reference.text),
            onAskInSideChat: (reference) => setAsked(reference.text),
          }}
          hideTurnNavigator
        />
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <TooltipProvider>
    <ZCodeIntlProvider initialLocale={mobile ? "en-US" : "zh-CN"}>
      <Fixture />
    </ZCodeIntlProvider>
  </TooltipProvider>,
);
