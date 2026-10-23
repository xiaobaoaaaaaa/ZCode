# Personal adaptation implementation and review plan

Status: implementation in progress; no installation or release is authorized by this plan.

## Baseline and ownership

- Upstream: https://github.com/zai-org/ZCode, Apache-2.0; retain LICENSE, NOTICE.md and THIRD-PARTY-NOTICES.md and complete Git ancestry.
- Verified baseline: `3c5b227649371507ddc4eb46ac5133afe6db1cab`, version 3.16.2.
- Personal fork: https://github.com/xiaobaoaaaaaa/ZCode; authenticated identity verified using GitHub connector and CLI.
- `main` remains an upstream baseline. Implementation branch: `personal/profile-memory-compact`.
- Open a draft PR only against the personal fork. Do not merge, publish a release, install, migrate official data, provision credentials, or schedule background work.

## Independently reviewable changes

1. Personal application identity, data namespace and update isolation. Existing authentication, quotas and security checks remain in force. This is an unofficial personal derivative, not an official ZCode release.
2. Profile memory: local Markdown with existing indexing, global versus project scope, bounded recall, automatic stable-preference extraction, explicit source/time provenance, editable/deletable records, automatic-recording pause and session disable. Only user-origin material may establish preferences; memory remains background data. See the feature specification for contracts and race handling.
3. Compact execution presentation: default-on, independently switchable UI projection, preserving transcript, controls, errors and responses. See `compact-execution.md`.

## Verification requirements

Run repository architecture baseline/context checks before implementation, affected unit tests, root typecheck and lint, CLI typecheck/lint/tests for memory changes, and UI interaction regressions. Record actual commands and exit results. Node 24.14.0 and pnpm 10.33.2 are pinned upstream. Use only isolated test homes inside the task workspace or temporary directory. No tests may read/write official user databases.

Windows compilation or runtime validation must be separately identified; Linux tests are not Windows acceptance. If dependencies or platform prerequisites prevent a check, record the precise blocker without marking it passed. Any proposed GitHub Actions validation must run on the fork without secrets or publication and must not require new paid resources.

## Following upstream

Keep `upstream` pointed at zai-org/ZCode and `origin` at the personal fork. Fetch upstream, review changes and fast-forward fork main only when explicitly continuing maintenance. Merge upstream main into the personal branch, resolve each feature separately, rerun the verification matrix, and keep updates as draft review work until approved. Do not push personal modifications to upstream or silently overwrite divergent fork branches.
