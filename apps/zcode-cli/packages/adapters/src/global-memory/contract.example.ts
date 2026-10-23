import { createNodeGlobalMemoryStore } from "./contract.js";

export async function exampleGlobalMemoryStorage(cliStorageRoot: string): Promise<boolean> {
  const store = createNodeGlobalMemoryStore({ cliStorageRoot });
  const snapshot = await store.read();
  return store.write({
    content: "- Preference: concise answers. Scope: global. Source: explicit user feedback.\n",
    expectedGeneration: snapshot.generation,
    sessionId: "example-session",
  });
}
