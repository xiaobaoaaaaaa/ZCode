import { createContext, useContext } from "react";

// 弹层跟随所属内容的 document；独立于窗口组件，避免基础控件反向加载窗口组件形成循环。
export const WindowPortalContext = createContext<HTMLElement | undefined>(undefined);
export const useSidePaneWindowPortalContainer = () => useContext(WindowPortalContext);
