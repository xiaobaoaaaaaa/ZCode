/** 原 renderer 是主题/语言/样式唯一 owner；承载 document 只镜像展示。 */
export function mirrorSidePaneDocument(
  child: Window,
  title: string,
  transparent = false,
): () => void {
  const document = child.document;
  document.title = title;
  // 相对样式、字体和图片仍从原应用地址加载；about:blank 不提供资源基址。
  const base = document.createElement("base");
  base.href = window.document.baseURI;
  document.head.append(base);
  const syncRoot = () => {
    for (const name of document.documentElement.getAttributeNames()) {
      document.documentElement.removeAttribute(name);
    }
    for (const attribute of window.document.documentElement.attributes) {
      document.documentElement.setAttribute(attribute.name, attribute.value);
    }
    document.body.className = "h-screen overflow-hidden text-foreground";
    document.documentElement.style.background = transparent ? "transparent" : "var(--background)";
    document.body.style.background = transparent ? "transparent" : "var(--background)";
  };
  const styles = new Map<Element, Element>();
  const syncStyles = () => {
    const sources = new Set(window.document.head.querySelectorAll('style, link[rel="stylesheet"]'));
    for (const [source, clone] of styles) {
      if (!sources.has(source)) {
        clone.remove();
        styles.delete(source);
      }
    }
    for (const source of sources) {
      const previous = styles.get(source);
      const clone = source.cloneNode(true) as Element;
      if (previous?.isEqualNode(clone)) continue;
      if (previous) previous.replaceWith(clone);
      else document.head.append(clone);
      styles.set(source, clone);
    }
  };
  syncRoot();
  syncStyles();
  const rootObserver = new MutationObserver(syncRoot);
  rootObserver.observe(window.document.documentElement, { attributes: true });
  const styleObserver = new MutationObserver(syncStyles);
  styleObserver.observe(window.document.head, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
  return () => {
    rootObserver.disconnect();
    styleObserver.disconnect();
  };
}
