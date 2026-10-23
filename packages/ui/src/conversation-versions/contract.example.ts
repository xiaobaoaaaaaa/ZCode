import type { ConversationVersionsContract } from "./contract.js";

export async function exampleConversationVersions(
  contract: ConversationVersionsContract,
): Promise<void> {
  if (contract.disabled) return;
  const versions = await contract.load();
  const latest = versions.at(-1);
  if (latest) await contract.restore(latest.id);
}
