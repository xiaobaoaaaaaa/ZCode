import type { CodexResponsesTransport } from "./contract.js";
export function codexTransportExample(wrap: CodexResponsesTransport, fetch: typeof globalThis.fetch) {
  return wrap(fetch);
}
