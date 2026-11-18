import { useEffect, useEffectEvent, useState } from "react";
import { useServices } from "@/hooks/useServices.js";

type AssistantService = NonNullable<ReturnType<typeof useServices>["workspaceAssistantService"]>;
type GenerationListener = Parameters<ReturnType<AssistantService["onDynamicGeneration"]>>[0];
type Generations = Parameters<GenerationListener>[0];

/** Host 提供当前活动生成的完整快照；重新挂载后按工作区重新订阅即可接上。 */
export function useWorkspaceAssistantGenerations(
  visible: boolean,
  workspacePath: string,
  workspaceIdentity: string | undefined,
  refreshHistory: () => Promise<void>,
) {
  const service = useServices().workspaceAssistantService;
  const [generations, setGenerations] = useState<Generations>([]);
  const refresh = useEffectEvent(refreshHistory);
  useEffect(() => {
    if (!visible || !service) return;
    let current = true;
    let version = 0;
    let previous: Generations = [];
    const subscription = service.onDynamicGeneration({ workspacePath, workspaceIdentity })((
      next,
    ) => {
      if (!current) return;
      const revision = ++version;
      const finished = previous.some((row) => !next.some((other) => other.id === row.id));
      previous = next;
      if (finished) {
        // 终态由持久化历史裁决。回读期间保留最后一帧，最终行出现时按同一 id 立即去重。
        void refresh().finally(() => {
          if (current && revision === version) setGenerations(next);
        });
      } else setGenerations(next);
    });
    return () => {
      current = false;
      subscription.dispose();
      setGenerations([]);
    };
  }, [service, visible, workspaceIdentity, workspacePath]);
  return generations;
}
