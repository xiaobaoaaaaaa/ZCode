import { useEffect, useRef, useState } from "react";
import type { IZCodeAgentService } from "@zcode/services";
import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import { ensureAgentV4ConnectionHandshake } from "@/v4/agentV4ConnectionHandshake.js";
import { resolveLatestCompletedAssistantPreviewTurn } from "@/v4/assistantPreviewPptxAutoOpen.js";
import { useOptionalServices } from "@/hooks/useServices.js";

/** 预测只是占位；按回答身份复用请求，键入/删空和同轮标题更新不会重新调用模型。 */
export function useFollowUpQuestion(
  enabled: boolean,
  snapshot: ConversationSnapshot | null,
  sessionId: string | null,
  workspacePath: string,
  workspaceIdentity?: string,
  remoteSessionId?: string,
): string | undefined {
  const service = useOptionalServices()?.zcodeAgentService;
  const answer =
    enabled && snapshot?.sessionId === sessionId && snapshot?.control.phase === "completedSuccess"
      ? resolveLatestCompletedAssistantPreviewTurn(snapshot.rows.window)
      : null;
  const key = answer
    ? JSON.stringify([
        workspaceIdentity?.trim() || workspacePath,
        remoteSessionId,
        sessionId,
        snapshot?.logEpoch,
        answer.turnId,
        answer.rowId,
        answer.entityId,
      ])
    : null;
  const revision = snapshot?.revision;
  const request = useRef<{
    key: string;
    service: IZCodeAgentService;
    promise: Promise<string | undefined>;
  } | null>(null);
  const [result, setResult] = useState<{
    key: string;
    service: IZCodeAgentService;
    text: string;
  }>();

  useEffect(() => {
    if (!key || !service || !sessionId || revision === undefined) return;
    let current = true;
    if (request.current?.key !== key || request.current.service !== service) {
      const predict = async () => {
        const hello = await ensureAgentV4ConnectionHandshake(service);
        if (hello.capabilities.inputPrediction !== true) return;
        const response = await service.conversationInputPredictionV4({
          workspacePath,
          workspaceIdentity,
          remoteSessionId,
          sessionId,
          revision,
          purpose: "followUpQuestion",
        });
        return response.decision === "show" ? response.candidates[0]?.text : undefined;
      };
      request.current = { key, service, promise: predict().catch(() => undefined) };
    }
    void request.current.promise.then((text) => {
      if (current && text)
        setResult((previous) =>
          previous?.key === key && previous.service === service && previous.text === text
            ? previous
            : { key, service, text },
        );
    });
    return () => {
      current = false;
    };
  }, [key, service, sessionId, revision, workspacePath, workspaceIdentity, remoteSessionId]);

  return result && result.key === key && result.service === service ? result.text : undefined;
}
