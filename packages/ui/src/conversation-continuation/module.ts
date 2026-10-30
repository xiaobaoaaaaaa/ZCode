export const conversationContinuationModule = {
  id: "conversation-continuation",
  requires: ["shared", "ui"],
  provides: ["conversation-continuation"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
