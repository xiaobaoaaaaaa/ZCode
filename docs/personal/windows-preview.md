# Windows x64 personal preview

## Scope and ownership

The existing `personal-windows-source-bundles` artifact contains `desktop/out`, not an Electron distribution. A runnable candidate needs the Electron runtime, current-source agent bundle, native modules, search tools, config and notices. The preview script owns orchestration only and reuses upstream preparation, Electron Builder hooks and dependency-closure checks. It never changes the lockfile, installs the application, signs, publishes or registers an installer.

Sequence: locked install and existing CI checks → source/runtime preparation → unsigned `--dir --win --x64 --publish never` → package completeness checks → isolated Windows smoke → archive candidate and evidence. Failure blocks candidate upload. Scripts may execute the application only on a GitHub-hosted Windows x64 runner (`GITHUB_ACTIONS`, `RUNNER_ENVIRONMENT=github-hosted`), with fresh product-specific home/data overrides. No real profile, credentials, model request, import or external tool replay is used. GUI smoke means a visible renderer document plus screenshot, not full native acceptance or authentication compatibility.

Use personal production identity (`io.github.xiaobaoaaaaaa.zcode.personal`, `ZCode Personal`, `.zcode-personal`, `zcode-personal` protocol). “Preview” here describes validation maturity, not the separate upstream Preview backend/flavor. Official account/quotas remain untouched and personal auto-update remains disabled. A ZIP of the unpacked directory is an unsigned preview candidate; it is not an installer and is not a self-contained portable profile (normal launches use the personal profile).

## Inputs and availability

- Electron 41.0.3 from the official Electron GitHub release, downloaded by Electron Builder with its checksum validation. Node/pnpm remain 24.14.0/10.33.2. JS and native dependency versions/integrities remain in pnpm-lock.yaml; node-pty currently resolves to 1.1.0.
- Agent and plugin bundles are built from this checkout using `prepare:runtime-assets`; no downloaded official agent replaces personal modifications. Native node-pty prebuild checks and upstream afterPack checks remain enabled.
- Windows ripgrep 14.1.1 and ugrep 7.8.4 are repository archives; both were independently hashed against `native-search-tools-config.mjs` before this change. Preparation retains archive digest/PE checks and license staging.
- Apache-2.0 LICENSE, NOTICE.md, THIRD-PARTY-NOTICES.md, Electron/Chromium notices and source provenance accompany the candidate. No dependency is added. `third-party/inventory.json` records 19 upstream reviewRequired entries (including some original notices and linked native provenance). Preserve this report; do not claim complete redistribution/license review or publish a release from this workflow.
- `@zcode/zcode-cua` 0.6.5 is the open-source fail-closed placeholder. Computer Use and its proprietary helper are unavailable; do not fetch or fabricate them. Browser import helper remains disabled. Remote SSH/WSL assets are not bundled or validated by this local preview path.

## Verification and permission boundary

Synthetic Node tests validate package rejection, required runtime/notices, Windows target and hosted-runner admission, without launching software. Root typecheck/lint/architecture checks are required. Real runtime smoke must run on the authorized GitHub Windows host; Linux checks cannot establish Windows startup. Smoke verifies packaged Electron/SQLite/node-pty load, a renderer page, and records a screenshot. It does not enter credentials or send chat input. Only freshly allocated temporary directories are removed; the spawned process tree is terminated by its own PID.

The existing workflow remains unchanged by this task because GitHub previously rejected workflow writes. A complete inert replacement proposal is provided for one manual edit, preserving the user's install fix and all passed checks. No package or smoke success is claimed until that workflow runs. No new credentials or scopes are needed for the proposed read-only-content job.

## Inspected source artifact

Run 39908838678 / head 6c3a0afb65df1754b763a8503869f434699b1c4e produced artifact 12482495892 (38,382,476 bytes). Downloaded archive independently hashes to 643f73abb8365f04fb1cef1b503a56954543c76255f160bd1b249868c82d6dfc. Its 6,687 entries include main/host/preload/renderer, metadata, plugin-sandbox assets, source maps and TypeScript build info; no `.exe`, `.dll` or `.node`. It is useful as compilation/debugging evidence, not an executable distribution. No contents were executed.

## One manual workflow edit

After the script commit is available, replace `.github/workflows/personal-validation.yml` with `docs/personal/windows-preview.workflow.txt`. This preserves the user's successful one-worker install command, Node/pnpm pins, typecheck, 133 existing targeted tests, source build and original artifact upload. It extends the timeout to 60 minutes and adds preview contract tests, upstream preparation/unsigned directory build, hosted Windows smoke, archive/checksum and diagnostics. Do not add credentials or publishing. A PR synchronize event should run it once; first check for that run before manually dispatching anything. The preview ZIP is uploaded only after smoke succeeds; diagnostics can upload on failure. A successful script-level smoke is still not feature-level native acceptance, login, installation or full Windows regression.

## Preparation checks (2026-10-23)

Four Node synthetic contract tests passed (host admission; rejection of source-only/missing/empty native packages; isolated credential-free smoke child environment; preservation of the successful workflow steps and success-only candidate upload). Root typecheck exited 0, root lint reported 0 errors/96 existing warnings, and changed architecture check reported 0 violations. No Windows executable was run locally. The new full preparation, Electron packaging, native probe and renderer smoke remain unexecuted until the manual workflow update. The source artifact hash inspection and repository native archive digest checks are evidence of their inputs, not evidence that the candidate starts.
