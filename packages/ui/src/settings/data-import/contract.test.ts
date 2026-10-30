import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { IPlatformService } from "@zcode/shared";
import { DataImportControl } from "./index.js";

const state = vi.hoisted(() => ({ platform: undefined as Partial<IPlatformService> | undefined }));
vi.mock("@/hooks/usePlatform.js", () => ({ useOptionalPlatform: () => state.platform }));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));

describe("directory import platform capability", () => {
  it("does not offer a local data import on Web or without a platform", () => {
    for (const platform of [undefined, {}]) {
      state.platform = platform;
      expect(renderToStaticMarkup(createElement(DataImportControl))).toBe("");
    }
  });

  it("offers directory import when the Desktop adapter provides the capability", () => {
    state.platform = { importZCodeDirectory: vi.fn() };
    expect(renderToStaticMarkup(createElement(DataImportControl))).toContain(
      'data-testid="settings-import-data-open"',
    );
  });
});
