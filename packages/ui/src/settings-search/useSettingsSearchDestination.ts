import { useEffect, useRef } from "react";

/** 仅处理已提交内容的焦点/滚动，不修改设置值；每次选择用新对象允许同项重复定位。 */
export function useSettingsSearchDestination(target: { id: string; section: string } | null) {
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!target || !contentRef.current) return;
    const anchors = [
      ...contentRef.current.querySelectorAll<HTMLElement>("[data-settings-search-id]"),
    ];
    const node =
      anchors.find((node) => node.dataset.settingsSearchId === target.id) ??
      anchors.find((node) => node.dataset.settingsSearchId === `section:${target.section}`);
    if (!node) return;
    node.dataset.settingsSearchHighlight = "true";
    node.focus({ preventScroll: true });
    node.scrollIntoView({ block: "center", behavior: "instant" });
    return () => {
      delete node.dataset.settingsSearchHighlight;
    };
  }, [target]);
  return contentRef;
}
