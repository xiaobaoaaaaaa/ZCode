# Official profile import — supported subset

Owner: MemoryService delegates to the personal-profile-import adapter. UI owns only the entered source path and preview; the adapter owns one expiring preview lease. Explicit user action only; no startup discovery, profile scanning, or real-profile acceptance tests.

## Verified formats and limits

Upstream 3.16.2 stores project Markdown at `<profile>/cli/memories/projects/<slug>-<16hex>/memory/*.md` (core/memory/project-root.ts). Copy this subset only. Preserve the exact project ID and Markdown bytes; do not follow Markdown links, relocate projects, or execute content. Project identity/path must still match to use the imported memory. Imported prose remains untrusted background data, subject to the existing memory instructions. Never promote it to user rules or global preferences.

The SQLite baseline contains schema_migration checksums/app_version, session/message/part, workflows and permissions. It is deliberately NOT opened or copied, including WAL/SHM: a live database needs SQLite online backup plus schema-aware semantic merge. Sessions, registered projects, settings, login credentials, encrypted/host-bound data, indexes, global memory and all non-Markdown files are unsupported. UI states this before preview/confirmation; no promise of whole-profile compatibility. Arbitrary secrets embedded in user Markdown cannot be reliably identified: UI asks users to inspect source Markdown and exclude sensitive material before importing; common private-key/token patterns abort preview as an extra check.

## State and sequence

`source input → read-only validated snapshot → preview lease (10 minutes) → explicit confirm → revalidate source + target → exclusive destination create → report`

One preview per service, replaced by later previews; confirm consumes the lease. Calls with invalid/expired tokens fail. UI disables edits while requests run and clears obsolete previews whenever the input changes. Copy reads source only, never writes/locks it. Stable no-follow file handles plus complete rescan/hash before copying reject observed source changes; this does not claim a transactional snapshot of an active source. UI tells users to close the official app first. Any database remains untouched, so no WAL consistency claim is made.

Reject symlinks in every existing ancestor and enumerated tree entry, unsafe Windows names/ADS/reserved names, case-folded filename aliases, oversized files (256 KiB), oversized imports (8 MiB/500 files/100 projects), malformed UTF-8, and unknown layouts. Exact workspace identifiers only. Destination must be disjoint from source. Existing workspace directories are never merged: identical imported Markdown means duplicate, otherwise conflict; skip the entire workspace to preserve references. Missing workspaces use mkdir-exclusive admission and wx files. On error remove only files/directories created by this operation; if rollback fails, report exact recovery paths. A process crash may leave a partial new workspace; a repeat preview reports it as conflict, never overwrites it. Recovery is manual deletion of that *personal* workspace after inspecting it, then retry. No durable background jobs or auto-resume.

## Acceptance

Synthetic fixtures only: preview counts without writes; explicit lease confirmation; exact bytes and unchanged source; repeat dedupe; whole-workspace conflicts; source changes; denied symlinks/Windows names/secrets/unknown structure; destination containment; stale token; partial failure cleanup. UI verification: input→preview→confirm and request/error states; desktop/narrow layouts and both themes remain required manual checks unless automated browser evidence is captured. Linux tests do not establish Windows acceptance.
