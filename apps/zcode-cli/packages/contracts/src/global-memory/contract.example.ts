import type { GlobalMemoryPort } from "./contract.js";

/** A stale generation is a rejected commit, never an invitation to retry stale content. */
export async function exampleGlobalMemoryPort(port: GlobalMemoryPort): Promise<boolean> {
  const snapshot = await port.read();
  if (!snapshot.enabled || !snapshot.extractionEnabled) return false;
  return port.write({ content: snapshot.content, expectedGeneration: snapshot.generation });
}
