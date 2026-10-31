# Codex subscription

Host owns credentials and pending device logins. RPC exposes only safe projections;
request authentication is a separate Host-only port. Commands await encrypted persistence.
Store transactions use a cross-process lock and reload current state before token rotation.
Cancelled/expired/replaced login attempts cannot commit late results. Re-login must match
user and workspace. Removing an account never selects another. Quota network failure
preserves last-good values with stale=true. Provider identity remains stable per account.

See [spec](../../../../docs/codex-subscription/spec.md).
