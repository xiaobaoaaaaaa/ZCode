// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HistoryImportSettingsView } from "@/history-import/index.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
afterEach(cleanup);
const preview = {
  token: "token",
  source: "/official",
  sessions: [
    { sourceKey: "source", title: "Saved history", directory: "/work/project", messages: 2 },
  ],
  skipped: [],
  messages: 2,
};
function show(service: Parameters<typeof HistoryImportSettingsView>[0]["service"]) {
  return render(
    createElement(
      ZCodeIntlProvider,
      { initialLocale: "en-US" },
      createElement(HistoryImportSettingsView, { service }),
    ),
  );
}
it("requires closed-source acknowledgement, previews paths and separately confirms", async () => {
  const service = {
    previewHistoryImport: vi.fn(async () => preview),
    confirmHistoryImport: vi.fn(async () => ({
      imported: 1,
      duplicates: 0,
      sessions: [{ sourceKey: "source", sessionId: "new", directory: "/work/project" }],
    })),
  };
  show(service);
  fireEvent.change(screen.getByLabelText(/Official profile folder/), {
    target: { value: "/official" },
  });
  const button = screen.getByRole("button", { name: "Preview conversation import" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(button);
  await screen.findByText(/Saved history/);
  expect(service.previewHistoryImport).toHaveBeenCalledWith({
    source: "/official",
    sourceClosed: true,
  });
  expect(service.confirmHistoryImport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm copy into personal sessions" }));
  await screen.findByText(/Imported 1 sessions/);
  expect(service.confirmHistoryImport).toHaveBeenCalledWith({ token: "token" });
});
it("invalidates stale previews and retains visible failure without duplicate requests", async () => {
  let reject!: (reason: Error) => void;
  const service = {
    previewHistoryImport: vi.fn(async () => preview),
    confirmHistoryImport: vi.fn(
      () =>
        new Promise<never>((_, fail) => {
          reject = fail;
        }),
    ),
  };
  show(service);
  const input = screen.getByLabelText(/Official profile folder/);
  fireEvent.change(input, { target: { value: "/official" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Preview conversation import" }));
  await screen.findByText(/Saved history/);
  fireEvent.change(input, { target: { value: "/different" } });
  expect(screen.queryByRole("button", { name: "Confirm copy into personal sessions" })).toBeNull();
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Preview conversation import" }));
  await screen.findByText(/Saved history/);
  const confirm = screen.getByRole("button", { name: "Confirm copy into personal sessions" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(service.confirmHistoryImport).toHaveBeenCalledOnce();
  reject(new Error("Source changed; preview again"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Source changed"));
});
