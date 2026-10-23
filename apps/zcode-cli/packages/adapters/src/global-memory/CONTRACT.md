# Global memory storage adapter

Factory: `createNodeGlobalMemoryStore({cliStorageRoot})`, also exported through
`@zcode/adapters/global-memory`. Implements `GlobalMemoryPort` for the supplied profile only.

Storage contract is described in `docs/design/v2/memory/global-memory-storage.md`.
Settings and CLI share fixed paths, the exclusive `.write-lock` directory, and
monotonic generation. Atomic replacement and private temporary files prevent torn
Markdown; stale writers cannot resurrect a deleted preference. Busy locks fail
without stealing; crashed locks need explicit inspection. No cache survives reads.

Symlink components and nonregular files are rejected; reads and writes are bounded
to 32 KiB. Common credential markers are rejected on write, but arbitrary unlabeled
secrets cannot be reliably identified. Do not pass secrets to this port.
