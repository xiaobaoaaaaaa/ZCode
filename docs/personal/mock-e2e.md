# Personal fork deterministic model E2E

## Boundary and owners

A test-only HTTP server binds exclusively to 127.0.0.1 on an ephemeral port. It implements the existing BYOK provider wire protocol with synthetic text/tool/stream/error fixtures. It never proxies traffic, returns official authentication/entitlement responses, or reads user configuration. A fixed fake token is a protocol fixture only. No production authentication, sandbox or provider defaults change.

The runner owns fresh profile/workspace/evidence directories, application instances and the server. Existing CLI runtime and Settings/Memory/History services retain ownership of accepted state. Tests use their existing entry points; response assertions inspect actual outgoing model fields/context and persisted files. UI observations use the real packaged Electron renderer, with its normal sandbox, only on the existing GitHub-hosted Windows runner. Local headless protocol checks are not renderer acceptance.

Sequence: synthetic fixtures → loopback server → isolated BYOK configuration → runtime/renderer → fixed response → real tool/state transition → captured next request and UI assertion → evidence → close owned instances/server. Cancellation has a bounded deadline and the server records disconnection. No replay or import may execute tools. All records contain synthetic data only.

## Coverage and acceptance matrix

- Global memory: user preference extraction into real Markdown, recall in another project, project facts excluded, delete invalidates recall, pause and session disable respected. Mock extraction demonstrates plumbing, not quality of model judgment.
- Compact process: consecutive work renders as one row; expand choice survives streaming; errors and approval controls remain independently visible. Renderer screenshots plus assertions are required for UI acceptance.
- Subagent models: main-agent suggestion uses the explicit configured allowlist, fixed/manual selection takes priority, denied/unavailable choices fall back with a reason. Assert real HTTP `model`, not labels alone.
- Earlier edits: active context excludes replaced future turns; version restore recovers context; side-effect counter does not advance during edit/restore. UI and service evidence must be distinguished.
- Official import: synthetic pinned-schema database only; source unchanged, IDs/associations mapped, duplicates skipped and failures rolled back. No real user fixture or credentials.
- Protocol: streamed text and tool calls, non-2xx failure, cancellation/disconnect; unexpected routes/requests fail closed.

Existing focused tests may supply service/UI unit coverage but are never labeled end-to-end. Reports enumerate exact exercised cases and pending renderer scenarios.

## Execution and CI

New test entry points are explicit and separate from `personal-windows-smoke.mjs`. Existing packaging and source checks are preserved. Workflow writes remain unauthorized; any additional CI invocation is delivered as an inert complete proposal for the user to apply manually. No hidden expansion of a packaging/smoke hook. Until the user applies that step and a run passes, renderer E2E is pending.

No credentials, model purchase, external model API, user profile, system package installation, Wine prefix, security-disable flags, release or merge is involved. Existing successful Windows preview artifacts remain intact.

## Commands and current evidence

Prerequisite: `pnpm --filter @zcode/desktop prepare:runtime-assets` builds the CLI packages; use repository Node 24.14.0/pnpm 10.33.2. `node scripts/personal-mock-suite.mjs` runs bounded credential-stripped child processes for protocol, real-runtime memory, real-runtime routing and source-to-target SQLite import. Default evidence is under ignored `packages/desktop/dist-personal-preview/mock-protocol-evidence/`. Fixtures are fresh temporary directories; owned runtime instances and listeners close after each run. Standalone runtime modules require `node --import tsx` because workspace exports include TypeScript sources.

The local suite passed: wire streaming/tool JSON/error/cancel; 18 memory HTTP requests and seven memory assertions; five routing scenarios (allowed, unlisted, disabled, manual priority, unavailable) with actual child HTTP model and tool-result reason; seven SQLite integration assertions (WAL source unchanged, IDs/parents, project association, duplicates, injected transaction rollback, retry, unknown schema).

`node scripts/personal-mock-renderer.mjs` is a separate GitHub-hosted Windows-only entry point requiring the prepared unpacked preview. It seeds a normal custom BYOK provider and ordinary preferences, sends synthetic prompts through the real composer, and asserts compact expansion, early edit/restoration context and no file replay, visible approval/denial, request cancellation, and visible provider error. It saves screenshots, request bodies and logs on success/failure. It does not simulate OAuth or any official identity/entitlement. This runner has NOT been executed on Fedora or Windows yet; static checks and seed validation cannot establish UI acceptance.

To enable cloud execution, manually replace `.github/workflows/personal-validation.yml` with `docs/personal/mock-e2e.workflow.txt`. The complete proposal retains existing steps and permissions, adds two explicitly named mock test steps after the original smoke, and adds always-upload synthetic evidence. No workflow was changed by the agent. Until applied, normal PR CI only runs the original preview validation, not this new renderer suite. If an interactive fixture selector or expected product behavior fails, retain diagnostics and fix the test/product under review; never weaken sandbox/authentication or count process survival as success.

Local verification for this increment: unified four-stage suite passed; seven Node contract/integration tests passed; root typecheck passed; root lint passed with 0 errors/96 existing warnings; changed architecture check passed with 0 violations. These are Fedora/Node results. The additional Windows renderer assertions and their screenshots remain pending the explicitly proposed workflow update, even if the unchanged existing Windows smoke succeeds on this commit.
