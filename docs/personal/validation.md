# Personal fork validation record

Execution environment: terminal reports Fedora Linux 44, systemd PID 1, a btrfs home filesystem and no detected container. This identifies the command environment; it does not establish the physical machine or explain the cloud conversation label. Workspace: `/home/xiaobao/Documents/Codex/2026-10-23/task/ZCode`.

Node 24.14.0 and pnpm 10.33.2 are temporary task tools under `/tmp/zcode-task-tools`. Locked dependencies were installed with lifecycle scripts disabled. No personal application was installed and no real official profile was read/imported.

## Confirmed checks

- Root `pnpm typecheck`: exit 0 after history/model/import integration.
- Root `pnpm lint`: exit 0, 96 warnings and 0 errors.
- CLI `pnpm --dir apps/zcode-cli typecheck`: 32/32 tasks successful.
- CLI lint: exit 0, 69 warnings, 0 errors, 12 pristine upstream line-count diagnostics admitted by existing policy.
- `pnpm architecture:check --changed`: 0 violations. Final clean `ZCODE_AFFECTED_TEST_BASE=upstream/main pnpm verify:pre-push`: exit 0 (lint, schema and architecture checks passed). The affected selector chose 2,064/2,064 root specifications and skipped them by repository policy; this is not a full root-unit-test pass. Relevant root service/UI tests were run separately.
- Global memory runtime/storage/context: 106 tests; services/settings controls: 37; session-switch race: 1; initial compact/identity/presentation subset: 134. All passed.
- Model selection: 97 core, 97 Host/UI, 2 bootstrap contract and 1 projection tests passed.
- History: 275 backend projection/edit/SQLite tests and 40 UI tests passed, including cold reopen, inactive-branch exclusion and no tool replay. Added admission tests are also included in the final CLI run.
- Import memory plus language/zoom: prior 74 synthetic service/UI tests passed. Final history-source/appearance/memory/settings subset: 39 passed; new history UI/contracts/registration subset: 5 passed. Target persistence/protocol/registration: 7 passed, including real SQLite restore followed by explicit new input. Source fixtures only; no real profile access.

## Full CLI execution

Full CLI tests run under bubblewrap with the host filesystem read-only except the task workspace and `/tmp`. Fixtures that tried default user directories were changed to temporary paths; project-local `.zcode` fixtures remain unchanged. Updated fixture expectations for personal user paths and the optional Agent model contract. An unchanged process-cancellation test had a five-second budget smaller than its bounded polling/teardown plus launch overhead; its test budget is now ten seconds with all assertions preserved. A concurrent dynamic-workflow timeout passed on serial retry (1,983 tests). The complete core suite independently passed: 276 files, 4,187 tests, 22 skipped. Final serial whole-CLI run passed (exit 0): 42/42 Turbo tasks successful, 21 cached, 9m10s; 12,669 test cases passed and 42 skipped across Vitest and the CLI Node test runner. Adapter: 2,281 passed/4 skipped; core: 4,187/22; bootstrap: 3,066/15; browser plugin: 2/1; CLI command tests: 518/0. The earlier bootstrap 103 failures were resolved by temporary-home setup, personal-path fixtures, updated earlier-edit assertions and disabling unrelated background memory requests in the ordinary model test helper; production runtime was not weakened. See bootstrap-test-isolation.md.

## Not verified / explicit boundaries

Windows build, installer coexistence, native helper entitlements, official OAuth callback registration and native desktop/mobile visual acceptance are unverified. React DOM interaction tests are not native desktop acceptance. No live model calls, paid resources or new credentials were used.

GitHub rejected upload of `.github/workflows/personal-validation.yml` because the existing OAuth credential lacks `workflow` scope. No alternate upload or permission expansion was attempted. The proposal remains inert at `windows-validation.workflow.txt`, and the original local commit is retained on `personal/windows-validation-pending`. An authorized maintainer must review and enable Windows validation using a suitably authorized existing path; no workflow ran for this task.

Import supports project Markdown, missing language/zoom fields, and eligible local safe-text sessions with project association. Only the exact pinned 24-migration schema is accepted. Remote/identity-bound and compacted sessions are skipped; permissions, tools, queues, workflows, credentials, theme storage and machine-bound data are excluded. No historical action is replayed. See profile-import.md for bounds and source/target recovery semantics. No whole-profile compatibility is claimed. The draft PR must remain unmerged and unpublished.

## Reproduction

Run `pnpm --dir apps/zcode-cli exec turbo run test --concurrency=1` with Node 24.14.0, pnpm 10.33.2 and `VITEST_MAX_WORKERS=2`, using a read-only host filesystem with only the task workspace and temporary directories writable. The final execution used Turbo 2.9.14 from available workspace tools; it warned about the upstream node-repl-host lockfile entry and browser build output declaration but exited successfully. Full logs remain in the task environment at `/tmp/zcode-cli-full-confirmed.log`, `/tmp/zcode-final-prepush.log`, `/tmp/zcode-final-root-types.log`, `/tmp/zcode-final-cli-types.log`, `/tmp/zcode-final-cli-lint.log`, `/tmp/zcode-final-source-tests.log` and `/tmp/zcode-final-import-tests.log`.
