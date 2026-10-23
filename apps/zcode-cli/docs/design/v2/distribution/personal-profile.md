# Personal profile namespace

This personal fork uses `.zcode-personal` for user-level CLI configuration, credentials, session database, mailbox, logs, workflow archive, trust metadata and telemetry state. Desktop services and CLI must resolve the same namespace. Explicit caller-provided storage paths retain their documented precedence. No official profile is copied or migrated.

Project `.zcode` configuration, hooks, skills and workflow definitions keep their existing paths and authority. Global skills/commands select `.zcode-personal` only for the user scope; `.agents` compatibility remains unchanged. Global memory uses the resolved CLI storage root.

State ownership and distribution acceptance are defined in [personal-distribution](../../../../../../specs/personal-distribution.md). Defaults are owned by the existing config contract and path adapters, not by a second profile cache. A caller-specified directory must be an isolated test/user-selected directory; tests inject temporary HOME paths.

Acceptance: user and project scope resolve separately; desktop bootstrap and CLI credentials/provider config share the personal profile; no reads or writes are made to an official default profile. Native Windows packaging/coexistence remain a separate acceptance gate.
