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

function TimingFixture() {
  const [autoExpand, setAutoExpand] = useState(query.get("autoExpand") === "true");
  const [startedAt, setStartedAt] = useState(start);
  const [generation, setGeneration] = useState(0);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [turnEnded, setTurnEnded] = useState(false);
  const [mountKey, setMountKey] = useState(0);
  const [phaseBoundary, setPhaseBoundary] = useState(false);
  const [nextTool, setNextTool] = useState(false);
  const [toolCount, setToolCount] = useState(0);
  const [toolStatus, setToolStatus] = useState<"running" | "success" | null>(null);
  const interrupted = query.get("ending") === "interrupted";
  const timingBase = {
    turnId: `timing-${generation}`,
    createdAt: startedAt,
    createdAtSeq: 1,
  };
  const rows: ConversationRow[] = [
    {
      ...timingBase,
      rowId: 1,
      kind: "turnHeader",
      origin: mode === "background" ? "backgroundResult" : "userInput",
      state: turnEnded ? (interrupted ? "completedInterrupted" : "completedSuccess") : "running",
      startedAt,
      ...(turnEnded ? { endedAt: endedAt! } : {}),
    },
    { ...timingBase, rowId: 2, kind: "userInput", origin: "realUser", text: "E2E_TIMING" },
    // 官方仅将至少两条连续摘要折叠；先放入已完成工具，验收真实分组的卸载与计时。
    {
      ...timingBase,
      rowId: 3,
      kind: "toolCall",
      toolCallId: "timing-preflight",
      toolName: "Bash",
      status: "success",
      inputText: '{"command":"echo preflight"}',
      output: { text: "preflight" },
    },
    {
      ...timingBase,
      rowId: 4,
      kind: "reasoning",
      text: "E2E_TIMED_REASONING",
      state: endedAt === null ? "streaming" : interrupted ? "interrupted" : "complete",
      ...(endedAt === null ? {} : { durationMs: endedAt - startedAt }),
    },
    ...(toolStatus
      ? Array.from({ length: toolCount }, (_, index) => ({
          ...timingBase,
          rowId: 5 + index,
          kind: "toolCall" as const,
          toolCallId: index === 0 ? "auto-expand-bash" : `auto-expand-bash-${index}`,
          toolName: "Bash",
          status: index === toolCount - 1 ? toolStatus : ("success" as const),
          inputText: '{"command":"echo auto-expand"}',
          ...(index < toolCount - 1 || toolStatus === "success"
            ? { output: { text: "E2E_AUTO_LOG" } }
            : {}),
        }))
      : []),
    ...(phaseBoundary
      ? [
          {
            ...timingBase,
            rowId: 100,
            kind: "assistantText" as const,
            text: "E2E_NEXT_STAGE",
            state: "complete" as const,
          },
        ]
      : []),
    ...(nextTool
      ? [
          {
            ...timingBase,
            rowId: 101,
            kind: "reasoning" as const,
            text: "E2E_NEXT_STAGE_REASONING",
            state: "complete" as const,
          },
          {
            ...timingBase,
            rowId: 102,
            kind: "toolCall" as const,
            toolCallId: "next-stage-bash",
            toolName: "Bash",
            status: "running" as const,
            inputText: '{"command":"echo next"}',
          },
        ]
      : []),
    ...(turnEnded
      ? [
          {
            ...timingBase,
            rowId: 103,
            kind: "assistantText" as const,
            text: "E2E_TIMING_DONE",
            state: "complete" as const,
          },
        ]
      : []),
  ];
  const [unit] = buildConversationTurnRenderUnits(rows, { nowMs: Date.now() });
  return (
    <>
      <button onClick={() => setAutoExpand((value) => !value)}>Toggle auto expand</button>
      <button onClick={() => setPhaseBoundary(true)}>Next stage</button>
      <button onClick={() => setNextTool(true)}>Start next activity</button>
      <button
        onClick={() => {
          setToolCount((count) => Math.max(1, count));
          setToolStatus("running");
        }}
      >
        Append running tool
      </button>
      <button
        onClick={() => {
          setToolCount((count) => count + 1);
          setToolStatus("running");
        }}
      >
        Append another tool
      </button>
      <button onClick={() => setToolStatus("success")}>Finish tool</button>
      <button onClick={() => setEndedAt(Date.now())}>Finish reasoning</button>
      <button onClick={() => setTurnEnded(true)}>Finish turn</button>
      <button onClick={() => setMountKey((key) => key + 1)}>Remount</button>
      <button
        onClick={() => {
          setStartedAt(Date.now());
          setGeneration((value) => value + 1);
          setEndedAt(null);
          setTurnEnded(false);
          setToolStatus(null);
          setToolCount(0);
          setPhaseBoundary(false);
          setNextTool(false);
        }}
      >
        New thought
      </button>
      <ConversationTurnGroup
        key={`${generation}:${mountKey}`}
        unit={mode === "timeline" ? { ...unit!, timelineOnly: true } : unit!}
        context={{
          workspacePath: "/fixture",
          theme,
          codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS,
          compactForRemoteControl: mobile,
          messageStreamShowReasoning: true,
          executionActivityAutoExpandEnabled: autoExpand,
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
        {query.get("scenario") === "timing" ? <TimingFixture /> : <Fixture />}
      </main>
    </ZCodeIntlProvider>
  </TooltipProvider>,
);
