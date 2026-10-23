# Profile global memory storage

The runtime consumes `GlobalMemoryPort`; only the Node adapter performs I/O. The
bootstrap supplies the adapter from the already isolated CLI profile root.

```
runtime snapshot → extraction → expected generation → exclusive profile lock
                                               → settings check → generation advance
                                               → atomic Markdown replace → unlock
settings edit/delete ──────────────────────────→ same lock and generation protocol
```

Storage is `<cliStorageRoot>/memories/global/config.json` and
`<cliStorageRoot>/memories/global/memory/MEMORY.md`. Configuration defaults to
`{enabled:true, extractionEnabled:true, generation:0, disabledSessionIds:[]}` only
when absent. Invalid configuration fails closed. No process caches this content.

The `.write-lock` directory is acquired with exclusive mkdir. Busy writers fail;
they never steal locks or retry stale snapshots. A crashed writer leaves a lock
requiring inspection, preserving safety over automatic recovery. Settings and
extraction share the generation protocol. Generation advances before replacing
Markdown, so a crash cannot permit an old extraction to overwrite a deletion.
Reads reject an active lock and verify unchanged generation after reading.

The adapter accepts only a fixed filename, rejects symlink path components and
nonregular files, uses private temporary files and atomic rename, and bounds input
and reads to 32 KiB. Windows paths use Node path APIs; there are no caller-supplied
filename segments. A disabled profile, paused extraction, disabled session, stale
generation, or aborted signal cannot commit an automatic write.

Acceptance: defaults without filesystem mutation; read/write roundtrip; stale CAS;
parallel writers; paused/disabled/session-disabled writes; delete invalidation;
invalid config; symlink directories/files; size limit; abort; lock cleanup.
Windows filesystem behavior still requires Windows CI evidence.
