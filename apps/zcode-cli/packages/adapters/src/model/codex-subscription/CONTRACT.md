# Codex Responses transport

Only the fixed ChatGPT Codex Responses URL is accepted. Redirects are forbidden.
Normalize backend-specific fields after generic model option mapping. Preserve input,
tool schemas and abort signal. Streaming requests keep the native Responses event stream;
non-streaming callers receive the terminal response object extracted from SSE.
The forced-stream backend contract, not Content-Type, determines this conversion:
successful non-streaming calls consume SSE even when the header is absent or incorrect.
HTTP errors and original streaming calls pass through. Missing terminal events, stream
errors and cancellation fail the call; the wrapper never retries or returns partial success.
API-key providers never enter this wrapper. Endpoint routing is disabled for Codex access.
