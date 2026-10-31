import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { ToolCallRow } from "@zcode/shared/zcode-protocol-v4";
import { EditToolCallBlock } from "@/ToolCallBlocks/renderers/edit.js";
import { readRawToolCallFileSummaries } from "@/ToolCallBlocks/fileSummaries.js";
import { buildToolDisplayModel } from "@/lib/toolDisplay.js";
import { mapToolStatus } from "@/lib/mapToolStatus.js";
import { isCompactToolCallRunningState } from "@/lib/toolCallSummary.js";
import { toolCallRowToLegacyNode } from "@/v4/toolCallRowAdapter.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import {
  DEFAULT_CODE_PREVIEW_SETTINGS,
  type CodePreviewSettings,
} from "@/lib/codePreviewSettings.js";
import { Button } from "@/components/ui/button.js";
import "@/styles.css";

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "dark" ? "zai-dark" : "zai-light";
document.documentElement.className = `theme-${theme} ${theme === "zai-dark" ? "dark" : "light"}`;
const content = (count: number) =>
  Array.from({ length: count }, (_, i) => `const line${i + 1} = "streamed file content";`).join(
    "\n",
  );

function row(id: string, count: number, status: ToolCallRow["status"]): ToolCallRow {
  const inputText = JSON.stringify({ file_path: `${id}.ts`, content: content(count) });
  return {
    kind: "toolCall",
    rowId: 1,
    turnId: "fixture",
    toolCallId: id,
    toolName: "Write",
    status,
    // 输入流保留未闭合 JSON，覆盖真实 Write 参数增量的预览适配。
    inputText: status === "inputStreaming" ? inputText.slice(0, -2) : inputText,
    createdAt: 1,
    createdAtSeq: 1,
  };
}

const noNestedTools = () => null;
function FileTool({
  value,
  settings,
  changes,
}: {
  value: ToolCallRow;
  settings: CodePreviewSettings;
  changes?: Record<string, { type: "add"; newText: string }>;
}) {
  const toolCallNode = toolCallRowToLegacyNode(value);
  const { toolCall } = toolCallNode;
  // 多文件使用 renderer 仍支持的 legacy changes 契约；V4 Write 走上面的真实输入适配。
  if (changes) toolCall.raw = { changes };
  const displayModel = buildToolDisplayModel(toolCall, "");
  return (
    <EditToolCallBlock
      toolCallNode={toolCallNode}
      workspacePath=""
      displayModel={displayModel}
      viewerSource={displayModel.viewerSource}
      rawFileSummaries={readRawToolCallFileSummaries(toolCall.raw, toolCall)}
      isRunning={isCompactToolCallRunningState(mapToolStatus(toolCall.status))}
      statusLabel={toolCall.status}
      childToolList={null}
      nestedToolRenderer={noNestedTools}
      theme={theme}
      codePreviewSettings={settings}
    />
  );
}

function Fixture() {
  const [count, setCount] = useState(40);
  const [status, setStatus] = useState<ToolCallRow["status"]>("inputStreaming");
  const [wrap, setWrap] = useState(false);
  const settings = { ...DEFAULT_CODE_PREVIEW_SETTINGS, wrapLongLines: wrap };
  const multi = row("multi", count, status);
  multi.toolName = "Edit";
  multi.inputText = "";
  const changes = Object.fromEntries(
    ["a.ts", "b.ts"].map((path) => [path, { type: "add" as const, newText: content(count) }]),
  );
  return (
    <main className="min-h-screen bg-background text-foreground p-4 space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setCount((n) => n + 20)}>append</Button>
        <Button
          onClick={() => {
            setCount((n) => n + 10);
            setStatus("success");
          }}
        >
          finish
        </Button>
        <Button
          onClick={() => {
            setCount((n) => n + 10);
            setStatus("error");
          }}
        >
          fail
        </Button>
        <Button onClick={() => setCount(1000)}>large</Button>
        <Button onClick={() => setWrap((value) => !value)}>wrap</Button>
      </div>
      <section data-testid="live">
        <FileTool value={row("live", count, status)} settings={settings} />
      </section>
      <section data-testid="multi">
        <FileTool value={multi} settings={settings} changes={changes} />
      </section>
      <section data-testid="history">
        <FileTool value={row("history", 50, "success")} settings={settings} />
      </section>
      <output data-testid="count">{count}</output>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <ZCodeIntlProvider initialLocale={params.get("locale") === "en-US" ? "en-US" : "zh-CN"}>
    <Fixture />
  </ZCodeIntlProvider>,
);
