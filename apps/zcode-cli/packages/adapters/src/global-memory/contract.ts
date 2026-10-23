import type { GlobalMemoryPort } from "@zcode/contracts";

/** Creates one uncached adapter for the caller-selected, isolated local CLI profile. */
export interface GlobalMemoryStorageOptions {
  cliStorageRoot: string;
}
export type GlobalMemoryStorageFactory = (options: GlobalMemoryStorageOptions) => GlobalMemoryPort;
export { createNodeGlobalMemoryStore } from "./store.js";
