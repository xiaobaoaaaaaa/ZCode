import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { GitDiffResult } from "@zcode/shared";
import type { IBroadcastService } from "@zcode/services";
import { GitPaneChangeCard } from "@/GitPaneChangeCard.js";
import { PreviewPaneContent } from "@/previewPaneContent.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { StoreContext, useZCodeStore } from "@/store/StoreProvider.js";
import { createZCodeStore } from "@/store/index.js";
import "@/styles.css";

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
const before = `export const message = "old ${"long words ".repeat(28)}";\nexport const token = "${"a".repeat(280)}";\n`;
const after = `export const message = "new ${"long words ".repeat(28)}";\nexport const token = "${"b".repeat(280)}";\n`;
const patch = (path: string) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,2 +1,2 @@\n${before
    .trimEnd()
    .split("\n")
    .map((line) => `-${line}`)
    .join("\n")}\n${after
    .trimEnd()
    .split("\n")
    .map((line) => `+${line}`)
    .join("\n")}\n`;
const singlePatch = patch("long.ts");
// 多文件 patch 通过既有安全预检进入轻量回退，不伪造渲染分支。
const multiPatch = singlePatch + patch("second.ts");
const noop = () => {};
const broadcast: IBroadcastService = {
  send: async () => {},
  onMessage: () => ({ dispose: noop }),
  acquireClaim: async () => ({ status: "unavailable" }),
  commitClaim: async () => {},
  releaseClaim: async () => {},
  tryClaim: async () => false,
};
const store = createZCodeStore(broadcast);
store.getState().setTheme(theme === "dark" ? "zai-dark" : "zai-light");
const pageLabels = {
  loading: "Loading",
  loadError: "Error",
  previousPage: "Previous",
  nextPage: "Next",
  pageInput: "Page",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
};
const previewDefaults = {
  filePreview: null,
  fileTooLarge: false,
  loadingInitial: false,
  loadingImagePreview: false,
  imagePreview: null,
  mediaSource: null,
  loadingMediaPreview: false,
  mediaPreviewUrl: null,
  onMediaError: noop,
  onMediaLoadedMetadata: noop,
  loadingPdfPreview: false,
  pdfViewerSource: null,
  pdfViewerLabels: { ...pageLabels, noData: "Empty" },
  loadingOfficePreview: false,
  officePreview: null,
  officePreviewKind: null,
  loadingPptxPreview: false,
  pptxPreviewData: null,
  pptxViewerLabels: {
    ...pageLabels,
    noSlides: "Empty",
    thumbnails: "Thumbnails",
    thumbnail: String,
    exportPdf: "Export",
    exportingPdf: "Exporting",
    exportPdfSuccess: String,
    exportPdfFailed: "Failed",
    selectElement: "Select",
    exitElementSelection: "Exit",
    aiEdit: "Edit",
    commentPlaceholder: "Comment",
    cancelAiEdit: "Cancel",
    addToConversation: "Add",
    referencedPageMissing: String,
    referencedSourceChanged: String,
  },
  pptxReferenceSource: null,
  pptxReferenceNavigation: null,
  pptxReferenceNavigationReady: false,
  error: null,
  resolvedTheme: theme,
  markdownViewMode: "preview",
  svgViewMode: "preview",
  codeComments: [],
  codeCommentLabels: {
    addComment: "Add",
    addCommentTooltip: "Add",
    commentPlaceholder: "Comment",
    submitComment: "Submit",
    cancelComment: "Cancel",
    deleteComment: "Delete",
    commentLine: "Line",
    commentRange: "Range",
  },
} satisfies Omit<
  ComponentProps<typeof PreviewPaneContent>,
  "source" | "codePreviewSettings" | "codeTheme" | "wrapLongLines"
>;

function Fixture() {
  const settings = useZCodeStore((state) => state.codePreviewSettings);
  const setSettings = useZCodeStore((state) => state.setCodePreviewSettings);
  return (
    <main className="min-h-screen bg-background p-3 text-foreground">
      <label>
        <input
          type="checkbox"
          checked={settings.wrapLongLines}
          onChange={(event) => setSettings({ wrapLongLines: event.target.checked })}
        />
        Wrap long lines
      </label>
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 440px))" }}
      >
        {(["full", "patch", "fallback"] as const).map((kind) => {
          const diff: GitDiffResult = {
            path: "long.ts",
            availability: "patch",
            patch: kind === "fallback" ? multiPatch : singlePatch,
            beforeContent: kind === "full" ? before : null,
            afterContent: kind === "full" ? after : null,
          };
          return (
            <section
              key={kind}
              data-testid={`git-${kind}`}
              className="min-w-0 border border-border"
            >
              <GitPaneChangeCard
                change={{
                  path: "long.ts",
                  repoRelativePath: "long.ts",
                  workspaceRelativePath: "long.ts",
                  kind: "modified",
                  section: "unstaged",
                  added: 2,
                  removed: 2,
                  isStaged: false,
                  isUntracked: false,
                  isConflicted: false,
                  diff,
                }}
                contextMenuLabels={{
                  copyAbsolutePath: "Copy",
                  copyRelativePath: "Copy relative",
                  revealInFileManager: "Reveal",
                  revealInFileTree: "Find",
                }}
                diffState={diff}
                isDiffLoading={false}
                isExpanded
                canRevealInFileManager={false}
                codePreviewSettings={settings}
                resolvedTheme={theme}
                onCopyAbsolutePath={noop}
                onCopyRelativePath={noop}
                onOpenChange={noop}
                onRevealInFileManager={noop}
              />
            </section>
          );
        })}
        {(["full", "patch", "fallback"] as const).map((kind) => (
          <section
            key={kind}
            data-testid={`preview-${kind}`}
            className="min-w-0 border border-border"
          >
            <PreviewPaneContent
              {...previewDefaults}
              source={
                kind === "full"
                  ? {
                      type: "multi-file-diff",
                      title: "long.ts",
                      path: "long.ts",
                      beforeContent: before,
                      afterContent: after,
                    }
                  : {
                      type: "patch",
                      title: "long.ts",
                      path: "long.ts",
                      patch: kind === "patch" ? singlePatch : multiPatch,
                    }
              }
              codePreviewSettings={settings}
              codeTheme={theme === "dark" ? settings.darkTheme : settings.lightTheme}
              wrapLongLines={settings.wrapLongLines}
            />
          </section>
        ))}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <ZCodeIntlProvider initialLocale={params.get("locale") === "en-US" ? "en-US" : "zh-CN"}>
    <StoreContext.Provider value={store}>
      <TooltipProvider>
        <Fixture />
      </TooltipProvider>
    </StoreContext.Provider>
  </ZCodeIntlProvider>,
);
