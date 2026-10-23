# Personal fork validation record

Execution environment: terminal reports Fedora Linux 44, systemd PID 1, a btrfs home filesystem and no detected container. This identifies the command environment; it does not establish the physical machine or explain the cloud conversation label. Workspace: `/home/xiaobao/Documents/Codex/2026-10-23/task/ZCode`.

Node 24.14.0 and pnpm 10.33.2 are temporary task tools under `/tmp/zcode-task-tools`. Locked dependencies were installed with lifecycle scripts disabled. No personal application was installed and no real official profile was read/imported.

## Confirmed checks

- Root `pnpm typecheck`: exit 0 after history/model integration.
- Root `pnpm lint`: exit 0, 96 warnings and 0 errors.
- CLI `pnpm --dir apps/zcode-cli typecheck`: 32/32 tasks successful.
- CLI lint: exit 0, 69 warnings, 0 errors, 12 pristine upstream line-count diagnostics admitted by existing policy.
- `pnpm architecture:check --changed`: 0 violations.
- Global memory runtime/storage/context: 106 tests; services/settings controls: 37; session-switch race: 1; initial compact/identity/presentation subset: 134. All passed.
- Model selection: 97 core, 97 Host/UI, 2 bootstrap contract and 1 projection tests passed.
- History: 275 backend projection/edit/SQLite tests and 40 UI tests passed, including cold reopen, inactive-branch exclusion and no tool replay. Added admission tests are also included in the final CLI run.
- Import memory plus language/zoom: 74 synthetic service/UI tests passed. Source fixtures only; no real profile access.

## Full CLI execution

Full CLI tests run under bubblewrap with the host filesystem read-only except the task workspace and `/tmp`. Fixtures that tried default user directories were changed to temporary paths; project-local `.zcode` fixtures remain unchanged. The first path regression failures were fixed. A later concurrent run hit a 5-second timeout in an unchanged dynamic-workflow test; the serial retry passed that complete 1,983-test suite. Overall serial run is still pending; do not interpret partial package results as a full pass.

## Not verified / explicit boundaries

Windows build, installer coexistence, native helper entitlements, official OAuth callback registration and native desktop/mobile visual acceptance are unverified. React DOM interaction tests are not native desktop acceptance. No live model calls, paid resources or new credentials were used.

GitHub rejected upload of `.github/workflows/personal-validation.yml` because the existing OAuth credential lacks `workflow` scope. No alternate upload or permission expansion was attempted. The proposal remains inert at `windows-validation.workflow.txt`, and the original local commit is retained on `personal/windows-validation-pending`. An authorized maintainer must review and enable Windows validation using a suitably authorized existing path; no workflow ran for this task.

The import specification lists supported categories and unsupported execution/project-state migration. No whole-profile compatibility is claimed. The draft PR must remain unmerged and unpublished.
