import { useEffect, useRef, useState } from "react";
import type { IZCodeSessionService } from "@zcode/services";
import { useOptionalServices, useServices } from "@/hooks/useServices.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";

export function useZCodeSessionService(
  workspacePath?: string,
  preferredRemoteSessionId?: string | null,
  workspaceIdentity?: string | null,
): IZCodeSessionService {
  const services = workspacePath
    ? useWorkspaceServices(workspacePath, preferredRemoteSessionId, workspaceIdentity)
    : useServices();
  return services.zcodeSessionService;
}

/** Profile preference only; runtime reads this disk policy on each request. */
export function useGlobalMemorySession(sessionId?: string | null) {
  const services = useOptionalServices();
  const memory = services?.memoryService;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestEpoch = useRef(0);
  useEffect(() => {
    let active = true;
    requestEpoch.current++;
    setBusy(false);
    setEnabled(null);
    setError(null);
    if (sessionId && memory?.getGlobalMemory) {
      memory
        .getGlobalMemory()
        .then((snapshot) => {
          if (active) setEnabled(!snapshot.disabledSessionIds.includes(sessionId));
        })
        .catch((reason) => {
          if (active) setError(String(reason));
        });
    }
    return () => {
      active = false;
    };
  }, [memory, sessionId]);
  const toggle = async () => {
    if (!sessionId || !memory || enabled === null || busy) return;
    const epoch = requestEpoch.current;
    setBusy(true);
    setError(null);
    try {
      const result = await memory.setGlobalMemorySessionEnabled({ sessionId, enabled: !enabled });
      // 会话切换后旧请求不能覆盖新会话的开关投影。
      if (epoch === requestEpoch.current)
        setEnabled(!result.disabledSessionIds.includes(sessionId));
    } catch (reason) {
      if (epoch === requestEpoch.current) setError(String(reason));
    } finally {
      if (epoch === requestEpoch.current) setBusy(false);
    }
  };
  return { enabled, error, busy, toggle };
}
