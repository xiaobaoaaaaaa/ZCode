// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ConversationVersions } from "@/conversation-versions/index.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";

it("previews versions, blocks duplicate restore and shows recoverable failures", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const load = vi.fn(async () => [{ id: "old", createdAt: 1000, messageCount: 4 }]);
  let rejectRestore!: (reason: Error) => void;
  const restore = vi.fn(
    () =>
      new Promise<void>((_, reject) => {
        rejectRestore = reject;
      }),
  );
  const render = (disabled: boolean) =>
    act(async () =>
      root.render(
        createElement(
          ZCodeIntlProvider,
          { initialLocale: "en-US" },
          createElement(ConversationVersions, { disabled, load, restore }),
        ),
      ),
    );
  try {
    await render(true);
    expect(container.querySelector("button")!.disabled).toBe(true);
    await render(false);
    await act(async () => container.querySelector("button")!.click());
    expect(load).toHaveBeenCalledOnce();
    expect(container.querySelector("select")!.value).toBe("old");
    expect(container.textContent).toContain("files");
    await act(async () => container.querySelectorAll("button")[1]!.click());
    expect(restore).toHaveBeenCalledWith("old");
    expect([...container.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
    await act(async () => rejectRestore(new Error("stale revision")));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector("select")).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
