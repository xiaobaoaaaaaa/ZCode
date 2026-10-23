import { expect, it, vi } from "vitest";
import { exampleHistoryImport } from "./contract.example.js";
it("preview does not import before user confirmation", async () => {
  const confirmHistoryImport = vi.fn();
  const previewHistoryImport = vi.fn(async () => ({
    token: "preview",
    source: "/selected",
    sessions: [],
    skipped: [],
    messages: 0,
  }));
  await exampleHistoryImport({ previewHistoryImport, confirmHistoryImport }, "/selected");
  expect(previewHistoryImport).toHaveBeenCalledWith({ source: "/selected", sourceClosed: true });
  expect(confirmHistoryImport).not.toHaveBeenCalled();
});
