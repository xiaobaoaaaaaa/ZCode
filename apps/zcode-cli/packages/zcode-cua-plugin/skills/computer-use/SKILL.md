---
name: computer-use
description: "Use for native Windows desktop app UI tasks. Prefer Browser Use for web pages. Main agent only."
---

# Computer Use — open-source Windows

Operate native apps through `agent.computerUse` in `mcp__node_repl__js`. Enable
Computer Use in ZCode settings first. This build supports Windows; macOS/Linux,
PiP and ghost cursors are unavailable. Prefer a dedicated API or connector when it
can finish the task. Use Browser Use for web pages. Main agent only; do not delegate.
Do not substitute shell-based UI automation after an access refusal.

## Bootstrap every call

Each JS call uses a fresh Worker. Bootstrap and actions must be in the same cell:

```js
const root =
  process.env.ZCODE_CUA_PLUGIN_ROOT ??
  process.env.ZCODE_PLUGIN_ROOT ??
  process.env.CLAUDE_PLUGIN_ROOT;
const { join } = await import("node:path");
const { pathToFileURL } = await import("node:url");
const { setupComputerUseRuntime } = await import(
  pathToFileURL(join(root, "scripts", "computer-use-client.mjs")).href
);
await setupComputerUseRuntime({ globals: globalThis });
```

The Host retains observations between cells. JS variables do not survive.

## Observe, act, verify

1. `await agent.computerUse.listApps()` lists running process names and PIDs.
2. Bind an observed app with `await agent.computerUse.getApp({pid})`. If multiple
   windows match, use `computer.list_windows({app_ref:{pid}})` and pass an observed
   `window_id` too. `getApp` does not launch apps; ask the user to open an absent app.
3. `await app.getAXState()` shows a full tree with element indices. Prefer a semantic
   element action or `setValue` on a settable field. Never guess indices.
4. Re-observe to verify the requested result. Accepted input is not proof of success.

`getApp` binds a fresh tree without displaying it. `app.elements()` returns the
full observed element list for filtering. A new observation renumbers indices;
use its indices in subsequent actions. Trees are bounded at 500 elements/depth 12;
truncation is explicit. Password values are never exposed or set.

## API

```ts
const cua = agent.computerUse;
await cua.getState(); // { apps }
await cua.listApps();
const app = await cua.getApp({ pid, window_id });
await app.getAXState();
await app.getScreenshot();
await app.getAXStateAndScreenshot();
await app.elements(); // {index, kind, title, value, actions, settable, focused}[]
await app.click(index); // UIA Invoke/Toggle/Select when supported
await app.setValue(index, "text");
await app.performSecondaryAction(index, "Invoke"); // only advertised actions
await app.selectText(index, "text"); // requires native TextPattern
await app.typeText("Unicode text");
await app.paste("plain text"); // plain Unicode input; clipboard is untouched
await app.pressKey("ctrl+a");
await app.scroll(index, "down", 1);
await app.drag([x1, y1], [x2, y2]);
await cua.stop("Finished");
```

Observe methods display their own text/images. Do not emit the same result again.
Use `{emit:false}` to inspect the return value without displaying text.

`click` accepts an element index or `[x,y]`, with optional `mouseButton`
(`left|right|middle`), `clickCount` (1–3), `modifiers`, `strategy` (`auto|a11y|event`).
`pressKey` accepts normal key names and `+` chords, `holdSeconds` (0–2).
Input strings are limited to 8192 characters. Rich HTML/Markdown paste is unsupported.

## Windows interaction boundaries

UIA pattern actions can work in the background. Pointer/keyboard input may activate
the selected window and uses the real mouse/keyboard. Do not imply background or
focus-free input. Input refuses locked desktops, elevated/protected targets, hidden
or minimized windows and a mismatched foreground window.

Screenshots require the selected window to be foreground and restored. Ask the
user to bring it forward when capture returns FOREGROUND_REQUIRED; do not keep
retrying. Accessibility reading does not require a screenshot.

Coordinates are integer pixels of the latest returned window PNG. Use only numbers
observed in that image: `0 <= x < width`, `0 <= y < height`. Never copy diagnostic
screen bounds into coordinate input. The backend verifies frame identity, window,
geometry and hit target. A moved/resized/replaced/covered target is refused; observe
again. Do not move windows to force stale coordinates to work.

## Stop and errors

Pressing Escape stops the current controller. `cua.stop()` is terminal for this
session. Start a new session to resume. Control is exclusive across ZCode windows;
CONTROLLER_BUSY means another live session owns it. Ask the user to stop that session.
A runtime disconnect releases ownership without waiting for an idle timeout.
If an in-flight native call is cancelled, times out or crashes, that worker is
terminated without replay. Restart ZCode before resuming Computer Use in that Host.

Errors throw `ComputerUseError` with `code`, `actionSent`, and `retry`. If
`actionSent` is true, an action may have happened: observe before deciding what to do;
never blindly repeat. Respect CONTROL_STOPPED, PERMISSION_DENIED, NOT_AUTHORIZED,
SCREEN_LOCKED and non-retryable errors. Unsupported operations fail explicitly.

Full argument reference: `nodeRepl.write(await agent.documentation.get("computer-use"))`.
