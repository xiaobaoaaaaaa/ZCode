// @vitest-environment jsdom
import { createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import en from "@/i18n/locales/en-US.js";
import {
  SettingsGlobalSearch,
  useSettingsSearchDestination,
  type SettingsSearchResult,
} from "@/settings-search/contract.js";
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    locale: "en-US",
    intl: { formatMessage: ({ id }: { id: string }) => en[id] ?? id },
  }),
}));
const scroll = vi.fn();
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = scroll;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function Harness() {
  const [target, setTarget] = useState<SettingsSearchResult | null>(null);
  const ref = useSettingsSearchDestination(target);
  return createElement(
    "div",
    null,
    createElement(SettingsGlobalSearch, { options: {}, onSelect: setTarget }),
    createElement(
      "div",
      { ref },
      createElement(
        "h2",
        { "data-settings-search-id": `section:${target?.section}`, tabIndex: -1 },
        "Section",
      ),
      target?.section === "appearance"
        ? createElement(
            "div",
            { tabIndex: -1, "data-settings-search-id": "settings.uiFontSize" },
            "Font target",
          )
        : null,
    ),
  );
}
describe("settings search interaction", () => {
  it("falls back to the section heading and clears its highlight when navigation leaves", () => {
    function Destination({ target }: { target: { id: string; section: string } | null }) {
      const ref = useSettingsSearchDestination(target);
      return createElement(
        "div",
        { ref },
        createElement(
          "h2",
          { "data-settings-search-id": "section:general", tabIndex: -1 },
          "General",
        ),
      );
    }
    const view = render(
      createElement(Destination, { target: { id: "unmounted", section: "general" } }),
    );
    const heading = screen.getByRole("heading", { name: "General" });
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute("data-settings-search-highlight")).toBe("true");
    view.rerender(createElement(Destination, { target: null }));
    expect(heading.hasAttribute("data-settings-search-highlight")).toBe(false);
  });

  it("clears without navigating, selects and focuses a mounted destination, and can select it again", async () => {
    render(createElement(Harness));
    fireEvent.click(screen.getByRole("button", { name: "Search settings…" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "unfindable-xyz" } });
    expect(await screen.findByText("No matching settings")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(scroll.mock.calls.filter((call) => call[0]?.block === "center")).toHaveLength(0);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) fireEvent.click(screen.getByRole("button", { name: "Search settings…" }));
      const input = screen.getByRole("combobox") as HTMLInputElement;
      expect(input.value).toBe("");
      fireEvent.change(input, { target: { value: en["settings.uiFontSize"] } });
      fireEvent.click(screen.getByRole("option", { name: new RegExp(en["settings.uiFontSize"]) }));
      await waitFor(() => expect(document.activeElement?.textContent).toBe("Font target"));
      expect(document.activeElement?.getAttribute("data-settings-search-highlight")).toBe("true");
    }
    expect(scroll.mock.calls.filter((call) => call[0]?.block === "center")).toHaveLength(2);
  });
});
