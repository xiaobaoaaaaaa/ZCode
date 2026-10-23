# Global memory port

`GlobalMemoryPort` is the runtime I/O boundary for local profile memory. `read`
returns fresh Markdown, switches, generation, and disabled session IDs. Only an
absent configuration uses enabled defaults; malformed or unsafe storage rejects.
`write` is an automatic extraction commit with compare-and-swap generation and
optional session identity. It resolves false for stale or disabled writes and
rejects storage, size, lock, or cancellation errors. Successful writes wait for
atomic file replacement. No event, cloud sync, or cache is maintained here.

Memory content is background data; this interface grants it no instruction priority.
