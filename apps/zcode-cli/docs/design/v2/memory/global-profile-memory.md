# Personal profile memory

Profile memory is local background data, never a higher-priority instruction. Project facts remain in project memory. No vector database, sync, credential storage, or execution-protocol changes.

## Ownership and order

```text
real user text -> runtime structured extraction -> GlobalMemoryPort CAS write
settings edit/delete/pause/session disable -> same profile disk lock -> generation++
provider request -> fresh snapshot -> relevance selection -> bounded background attachment
```

The isolated personal profile owns `cli/memories/global/config.json` and `memory/MEMORY.md`. Default enabled and extractionEnabled are true. `disabledSessionIds` blocks reads and writes for a session. The node adapter and settings service use the same `.write-lock` directory; no stealing stale locks. Each successful mutation increments generation. Extraction captures generation before its model request; CAS checks generation and controls again under lock. Conflicting extraction is discarded, never resurrecting deleted content. No persistent recall cache or transcript insertion is used for global data.

Extraction sees only the latest explicitly tagged real-user text; assistant text, tools, webpages, synthetic messages, and quoted blocks are excluded. A schema-only auxiliary model request has no tools. Save only stable preferences, explicit feedback and general habits; projects, facts about repositories, secrets and attempts to override authority are rejected. Every accepted item includes scope, timestamp and session provenance. A conservative local guard complements the model classifier. Pause affects recording; disabling affects both recording and recall.

Recall selects at most four Markdown entries relevant to the current user query, with a 6,000-character request budget. Each provider request re-reads the file and checks controls, so a later deletion or disable is reflected in subsequent requests. Requests already sent cannot be recalled. Global memory is rendered as a meta-user background attachment with an explicit non-instruction boundary, never as the system prompt. Existing project-memory indexing remains separate.

Automatic extraction uses JSON-schema output when supported; other models receive a JSON-only request. Both paths use strict local parsing and discard malformed responses, never granting tool access. Project memory.use does not switch off global memory; its profile/session controls are independent. Headless extractionEnabled=false suppresses automatic recording.

Settings support view/edit/delete and separate pause/enabled controls. Current-session disable is profile-local. Files use atomic replacement, a 32 KiB UTF-8 limit and fixed safe paths, with symlink rejection and Windows-safe temporary names.

## Acceptance

- Different projects can recall a stable user preference, but project-only facts are rejected.
- Tool outputs and synthetic user messages never become extraction input.
- Deleting/editing/disabling during extraction causes stale CAS to fail.
- Concurrent sessions cannot overwrite each other's updates.
- Disabled sessions neither read nor record; pause preserves reads.
- Recall never exceeds budget and does not survive deletion in a cache.
- Invalid JSON, secrets, unsafe paths, symlinks and oversized content are rejected.
- Linux unit/type/lint evidence is distinct from Windows build and interactive acceptance.
