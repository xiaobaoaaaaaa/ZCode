import { useCallback, useRef, useSyncExternalStore } from "react";
import type { SidePaneWindowActions } from "./contract.js";

/** 注册表只路由显示操作，不复制 useAppPanels 的标签或会话状态。 */
export function useSidePaneWindows() {
  const entries = useRef(new Map<string, { key: string; actions: SidePaneWindowActions }>());
  const listeners = useRef(new Set<() => void>());
  const revision = useRef(0);
  const notify = useCallback(() => {
    revision.current += 1;
    for (const listener of listeners.current) listener();
  }, []);
  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const snapshot = useCallback(() => revision.current, []);
  useSyncExternalStore(subscribe, snapshot);
  const register = useCallback(
    (id: string, key: string, actions: SidePaneWindowActions) => {
      entries.current.set(id, { key, actions });
      const unsubscribe = actions.subscribe(notify);
      notify();
      return () => {
        unsubscribe();
        if (entries.current.get(id)?.actions === actions) {
          entries.current.delete(id);
          notify();
        }
      };
    },
    [notify],
  );
  const getPhase = useCallback(
    (id: string) => entries.current.get(id)?.actions.getSnapshot() ?? "docked",
    [],
  );
  const detach = useCallback((id: string) => entries.current.get(id)?.actions.detach(), []);
  const dock = useCallback((id: string) => entries.current.get(id)?.actions.dock(), []);
  const acceptDrop = useCallback((key: string) => {
    const entry = [...entries.current.values()].find((candidate) => candidate.key === key);
    if (!entry) return false;
    void entry.actions.dock();
    return true;
  }, []);
  return { register, detach, dock, acceptDrop, getPhase };
}
