import type { useServices } from "@/hooks/useServices.js";

type AssistantService = NonNullable<ReturnType<typeof useServices>["workspaceAssistantService"]>;
type History = NonNullable<Awaited<ReturnType<AssistantService["read"]>>>;

export function activeClarification(messages: History["messages"]) {
  // 后台回报不消费人的澄清请求；只有后续真实用户输入会取代待选择项。
  const source = messages.findLast((message) => message.role === "user" && !message.kind);
  if (!source) return undefined;
  const reply = messages.findLast((message) => message.id === `reply:${source.id}`);
  return reply?.choiceRequestId && reply.choices?.length ? { source, reply } : undefined;
}
