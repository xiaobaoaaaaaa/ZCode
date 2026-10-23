// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect } from "vitest";
import type { ToolCallRow } from "@zcode/shared/zcode-protocol-v4";
import { CompactExecutionRun } from "@/v4/ConversationTurnGroup.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";

const tool = (rowId: number, status: ToolCallRow["status"]): ToolCallRow => ({
  rowId,
  turnId: "compact-test",
  createdAt: 1000,
  createdAtSeq: rowId,
  kind: "toolCall",
  toolCallId: `tool-${rowId}`,
  toolName: "Bash",
  input: { command: "npm test" },
  inputText: '{"command":"npm test"}',
  status,
  startedAt: 1000,
  ...(status === "success" ? { endedAt: 2000 } : {}),
});

describe("compact execution interaction", () => {
  it("keeps expand/collapse choices through streaming appends and completion", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (rows: ToolCallRow[]) =>
      act(async () => {
        root.render(
          createElement(
            ZCodeIntlProvider,
            { initialLocale: "en-US" },
            createElement(CompactExecutionRun, {
              rows,
              children: createElement(
                "div",
                { "data-original-record": true },
                "Original transcript",
              ),
            }),
          ),
        );
      });
    try {
      await render([tool(1, "running")]);
      const button = () => container.querySelector("button")!;
      expect(button().getAttribute("aria-expanded")).toBe("false");
      await act(async () => button().click());
      expect(button().getAttribute("aria-expanded")).toBe("true");
      expect(container.querySelector("[data-original-record]")).not.toBeNull();
      await render([tool(1, "success"), tool(2, "running")]);
      expect(button().getAttribute("aria-expanded")).toBe("true");
      expect(button().textContent).toContain("2 commands");
      await act(async () => button().click());
      await render([tool(1, "success"), tool(2, "success")]);
      expect(button().getAttribute("aria-expanded")).toBe("false");
      expect(button().textContent).toContain("Execution records");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
