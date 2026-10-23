import type { GlobalProfileRuntimeContract } from "./contract.js";
import type { AgentRuntimeInternal } from "../internal.js";

/** Project history remains canonical; only the current request receives fresh background. */
export async function exampleGlobalProfileRuntime(
  contract: GlobalProfileRuntimeContract,
  runtime: AgentRuntimeInternal,
) {
  const entries = runtime.messageHistory.borrowReadOnlyRuntimeEntries();
  return [...entries, ...(await contract.globalMemoryBackground(runtime, entries))];
}
