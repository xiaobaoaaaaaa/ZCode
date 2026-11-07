# @zcode/zcode-cua

Open-source Windows Computer Use using system UI Automation and Win32. Enable the
Computer Use plugin in the Windows desktop app, then ask the agent to operate an
already running app. Escape stops control. No additional runtime download is needed.

The Host owns the authenticated broker and live runtime leases. Input is exclusive
across ZCode windows. Observations, element actions, Unicode input, shortcuts,
pointer actions and exact PNG screenshots use the existing `agent.computerUse` SDK.

macOS/Linux, private native helpers, PiP and ghost cursors remain unavailable.
`zcodeCuaPlaceholder: true` means private native artifacts are absent; Windows source
is bundled into the normal desktop/Agent build. See
`docs/desktop/opensource-windows-computer-use.md` for product boundaries.

Validation: `pnpm --filter @zcode/zcode-cua test` and
`pnpm --filter @zcode/zcode-cua test:windows` (opens an isolated test form).
Packaged MCP/Worker check:
`node --test apps/zcode-cli/packages/node-repl-host/test/windows-bundle.test.mjs`.

After an in-flight native call is cancelled, times out or crashes, restart ZCode
to replace that Host's terminated worker. Normal stop/Escape only ends its session.

License: Apache-2.0.
