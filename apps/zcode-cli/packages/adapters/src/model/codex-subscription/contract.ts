/** Wrap a transport without changing its cancellation/network policy. Reject other endpoints. */
export type CodexResponsesTransport = (fetch: typeof globalThis.fetch) => typeof globalThis.fetch;
export const CODEX_RESPONSES_BASE_URL = "https://chatgpt.com/backend-api/codex";
