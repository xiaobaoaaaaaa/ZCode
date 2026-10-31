import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { BundledTheme } from "shiki";
import {
  buildHighlightedLightweightDiffCode,
  getHighlightedLightweightDiffLine,
  HighlightedLightweightDiffPreview,
} from "@/components/ui/highlighted-lightweight-diff-preview.js";
import { inferCodeLanguage, type PatchCodeViewerSource } from "@/lib/codeViewer.js";
import { getPlainTextPatchPreviewLines } from "@/lib/patchDiffPreview.js";
import type { CodePreviewSettings } from "@/lib/codePreviewSettings.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import type { Theme } from "@/useTheme.js";

export {
  buildHighlightedLightweightDiffCode as buildInlineDiffHighlightCode,
  getHighlightedLightweightDiffLine as getInlineDiffHighlightLine,
};

function resolveInlineDiffHighlightTheme(
  theme: Theme | undefined,
  codePreviewSettings: CodePreviewSettings,
): BundledTheme {
  if (theme === "system") {
    if (typeof window !== "undefined") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? codePreviewSettings.darkTheme
        : codePreviewSettings.lightTheme;
    }

    return codePreviewSettings.lightTheme;
  }

  return theme === "dark" || theme === "zai-dark"
    ? codePreviewSettings.darkTheme
    : codePreviewSettings.lightTheme;
}

export const EditInlineDiffContent = memo(function EditInlineDiffContent({
  preview,
  isRunning = false,
  theme = "system",
  codePreviewSettings = DEFAULT_CODE_PREVIEW_SETTINGS,
}: {
  preview: PatchCodeViewerSource;
  /** 只在运行中的文件预览跟随输出；历史记录仍从头阅读。 */
  isRunning?: boolean;
  /**
   * 应用主题（store 耦合剥离）：决定 diff 高亮取 light/dark 主题。
   * 由调用方（tool call 渲染上下文）传入；默认 "system" 跟随操作系统兜底。
   */
  theme?: Theme;
  /** 代码预览设置（store 耦合剥离）：由调用方传入，需保持引用稳定。 */
  codePreviewSettings?: CodePreviewSettings;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const previousTopRef = useRef(0);
  const wasRunningRef = useRef(false);
  const followOutput = useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport || !followingRef.current) return;
    viewport.scrollTop = viewport.scrollHeight;
    // 内容变短或终态 patch 替换时，浏览器会夹紧 scrollTop；记录实际值，
    // 避免把程序调整产生的 scroll 事件误判为用户向上阅读。
    previousTopRef.current = viewport.scrollTop;
  }, []);

  useLayoutEffect(() => {
    // 原展开容器只更新文本，没有滚动所有者，所以始终停在文件开头。
    // 布局提交后跟随，并覆盖最后一段内容与运行结束同时到达的情况。
    if (isRunning || wasRunningRef.current) followOutput();
    wasRunningRef.current = isRunning;
  }, [followOutput, isRunning, preview.patch]);

  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!isRunning || !viewport || typeof ResizeObserver === "undefined") return;
    // 异步高亮、换行和字号变化可能晚于 patch 提交；只观察当前预览，
    // 不用定时器补滚动，也不移动外层会话或用户的横向阅读位置。
    const observer = new ResizeObserver(followOutput);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    return () => observer.disconnect();
  }, [followOutput, isRunning]);

  const previewLines = useMemo(() => getPlainTextPatchPreviewLines(preview.patch), [preview.patch]);
  const highlightLanguage = useMemo(
    () => inferCodeLanguage(preview.path ?? preview.title, preview.patch),
    [preview.patch, preview.path, preview.title],
  );
  const highlightTheme = useMemo(
    () => resolveInlineDiffHighlightTheme(theme, codePreviewSettings),
    [codePreviewSettings, theme],
  );

  return (
    <div className="space-y-3">
      <div
        ref={scrollRef}
        className="mb-2 max-h-60 overflow-auto rounded-xl border border-border bg-card"
        data-inline-diff-preview
        tabIndex={0}
        onScroll={(event) => {
          const viewport = event.currentTarget;
          const atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 8;
          if (atBottom) followingRef.current = true;
          else if (viewport.scrollTop < previousTopRef.current) followingRef.current = false;
          previousTopRef.current = viewport.scrollTop;
        }}
      >
        {/* 聊天内联 diff 展开时直接挂载 @pierre/diffs 会把高亮和 Shadow DOM 汇总渲染压到主线程，
        导致点击展开后长时间掉帧。这里首帧只渲染轻量 hunk 文本，再在 effect 里异步补 Shiki token；
        之前只保留纯文本会让 session 里的 diff 永久失去语法高亮。 */}
        <HighlightedLightweightDiffPreview
          className="h-full bg-card"
          codePreviewSettings={codePreviewSettings}
          data-inline-diff-highlight-language={highlightLanguage}
          data-inline-diff-highlight-theme={highlightTheme}
          language={highlightLanguage}
          lines={previewLines}
          path={preview.path ?? preview.title}
          theme={highlightTheme}
        />
      </div>
    </div>
  );
});
EditInlineDiffContent.displayName = "EditInlineDiffContent";
