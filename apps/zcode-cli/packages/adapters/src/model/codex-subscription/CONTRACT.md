# Codex Responses transport

Only the fixed ChatGPT Codex Responses URL is accepted. Redirects are forbidden.
Normalize backend-specific fields after generic model option mapping. Preserve input,
tool schemas and abort signal. Streaming requests keep the native Responses event stream;
non-streaming callers receive the terminal response object extracted from SSE.
API-key providers never enter this wrapper. Endpoint routing is disabled for Codex access.
