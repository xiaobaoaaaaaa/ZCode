# Open-source Windows Computer Use reference

Read the installed computer-use skill for bootstrap, observation/action order,
Windows focus requirements and stopping rules. This reference describes only the
implemented open-source Windows backend. Enable the plugin in desktop settings.

The low-level methods live under `agent.computerUse.computer`. They accept one
strict arguments object. Prefer the bound `getApp({pid, window_id})` API described
in the skill. Apps must already be running; names match process names from listApps.
Unknown keys, unsupported strategies and missing identities are rejected.

```text
list_apps({})
list_windows({app_ref}) -> {windows:[{window_id,title,pid,bounds}]}
get_app_state({app_ref,include_screenshot?,disable_diffing?,tree_shown_to_model?})
left_click({app_ref,target,mouse_button?,click_count?,modifiers?,strategy?,return_state?})
left_click_drag({app_ref,from_target,to,modifiers?,strategy?,return_state?})
scroll({app_ref,target,scroll_direction,scroll_amount?,strategy?,return_state?})
type({app_ref,text,target?,strategy?,return_state?})
set_value({app_ref,target,value,strategy?,return_state?})
select_text({app_ref,target,text_range:[start,length],return_state?})
key({app_ref,text,repeat?,hold_seconds?,strategy?,return_state?})
paste({app_ref,text,format?:"text",return_state?})
perform_action({app_ref,target,action,return_state?})
request_access({capabilities?:["accessibility","screen_recording"]})
stop_computer_control({reason?})
```

- `app_ref`: `{pid?:number,name?:string,window_id?:number}`. At least pid or name.
  An explicit window must belong to that process. Ambiguity fails instead of picking
  an unrelated app. Running process names are used, not Start-menu display names.
- `target`: `{type:"element",index}` or `{type:"coordinate",x,y,frame_id?}`.
  Element indices belong to the latest observation of this app in this session.
  Coordinates belong to its latest PNG; omitted frame id resolves in the backend.
  `set_value`, `select_text` and `perform_action` require element targets.
- `strategy`: `auto|a11y|event`. `a11y` refuses operations without a semantic pattern;
  `event` uses foreground input. No strategy bypasses system permissions.
- `return_state`: `none|compact|full`. Both requested state modes return the full,
  bounded tree. `disable_diffing` is accepted; this backend always returns full state.
- Buttons: `left|right|middle`, click count 1–3. Scroll direction `up|down|left|right`,
  amount 1–10 pages. Key repeat 1–20, hold 0–2 seconds. Text/value length ≤8192.
- Modifiers/chords: `ctrl`, `alt`, `shift`, `win`/`super`, ASCII letters/digits,
  Return/Enter, Escape, Tab, Backspace, Delete, Space, arrows, Home/End, PageUp/PageDown,
  Insert, F1–F24. Unsupported punctuation keys fail; use typeText for literal text.
- Semantic actions: only the observed element's advertised Invoke, Toggle, Select,
  Expand, Collapse or Focus. setValue requires writable ValuePattern; selectText
  requires TextPattern. Password controls are excluded.
- paste sends plain Unicode input without modifying the clipboard. HTML/Markdown
  and background key injection are not supported.

Observations include state_id, app, window, elements, text, snapshot_mode="full"
and has_image. A successful screenshot includes one PNG followed by image_ref
with frame_id, width, height and SHA-256. The pipeline preserves the exact bytes;
invalid/modified image pairs fail closed. Coordinates are raster pixels, never
native screen points. Screenshot size is limited to 8 MiB and 24 million pixels.

request_access reports interactive desktop availability, not a grant to bypass
Windows integrity, UAC or protected windows. Every input independently rechecks its
target and applicable OS permissions. Do not switch to other automation after refusal.

The bound API returns typed values. `computer.*` instead hands back what the tool
itself produced after unwrapping. A separate JSON block that mirrors the producer's
compact structured metadata is ignored for this step. The metadata remains in the
host output. A call resolves to one of three shapes.

- **The parsed payload.** A result carrying exactly one text block is
  `JSON.parse`d for you, so you get the tool's own shape with no `content` to
  walk. `list_apps` and `list_windows` land here.
- **A plain string.** The same single-text-block result, when its text is not
  JSON. `get_app_state` without a screenshot lands here, so you get the rendered
  tree. Use a bound app's `elements()` to access the element table.
- **The raw MCP envelope,** `{ content: [...] }`. Returned unchanged for anything
  else, most often because `include_screenshot: true` added an image block. Read
  the blocks out of `content`; there is no parsed payload, and the envelope also
  carries host-only fields this contract does not cover.

So branch on the shape instead of assuming one:

```js
const wins = await agent.computerUse.computer.list_windows({
  app_ref: { name: "Notes" },
});
nodeRepl.write(`windows: ${JSON.stringify(wins)}`);       // parsed payload

const shot = await agent.computerUse.computer.get_app_state({
  app_ref: { name: "Notes" },
  include_screenshot: true,
});
const image = shot.content.find((block) => block.type === "image");  // envelope
```

Never pass a whole envelope to `nodeRepl.write` or `JSON.stringify`: the image
block is large, and a bound app's `getAXStateAndScreenshot()` already submits the
picture for you.

## Windows

A capture is always scoped to one window of one app, so a multi-window app needs
you to say which window. `list_windows` returns one row per window, in the app's
own window order:

- `window_id` — stable integer. Pass it back inside `app_ref` to address that
  window.
- `title` — the window title; `""` or `null` for a window that carries none.
  `""` means the window has an `AXTitle` that is empty — a Qt or custom-drawn
  panel typically looks like this. `null` means the title could not be read at
  all, which happens both for an AX window whose `AXTitle` read fails and for a
  row the broker merged in from CoreGraphics, so it does not tell the two apart.
  Use `subrole` for that distinction.
- `subrole` — the window's `AXSubrole`, present only on a real AX window. A row
  merged in from CoreGraphics (a WindowServer surface the accessibility tree does
  not expose) has no `subrole` at all, so the field's presence is what separates
  "a window you can bind and operate" from "a leftover surface". Its own value
  discriminates weakly: a survey of 34 windows across 30 apps found 31 of them
  reporting `AXStandardWindow`, with `AXDialog` the only other value that carried
  information. macOS only.
- `text_preview` — a content sample for a window with no usable title: the first
  few strings found inside it, joined and truncated. **Never an identifier.** The
  order comes from the accessibility child order, which is creation order and
  carries no semantic guarantee — in the same app a dialog yields its heading
  while a main window yields toolbar noise. It is collected only when `title` is
  empty, omitted when nothing could be collected, and it can contain whatever the
  window displays, including the user's own data. Read it as a hint for choosing
  which window to observe, then confirm by observing that window. macOS only.
- `bounds` — `[x, y, width, height]` in global screen points. Diagnostic only:
  these must never be copied into a coordinate target.
- `main` — the app's AX main window. `focused` — the app's AX focused (key)
  window. Neither one means the app is the system-frontmost application;
  `listApps()` reports that as `active`.
- `onscreen` — `false` marks a window CoreGraphics still owns after the app closed
  its real windows. That row is neither user-visible nor operable, so skip it when
  choosing a target. It carries a different meaning from occluded or minimized,
  both of which stay operable and stay `true`.
- `index` — the row's position in this response, not an element index and not a
  window id.

Bind a window and every call in that cell stays on it:

```js
const app = await agent.computerUse.getApp({ pid: 23192, window_id: 27367 });
await app.getAXState();
```

`agent.computerUse.getWindow(target, windowId)` binds the same way and reads
better when the target is a name. Either form throws `STALE_STATE` when that
window cannot be resolved, instead of quietly capturing a different one.

Without a `window_id` the app's main/key window is captured, and that resolution
runs again on **every** observation. A modal that opened since the last
observation therefore becomes the captured window. Element indices are
per-window and are renumbered by each observation, so an index taken before the
window changed can address an unrelated control afterwards.

So when an action fails unexpectedly, or the tree reads like a different part of
the app, check the observation's `window` block first: a modal dialog appears
there as the captured window. Read its contents, then decide. Dismiss it only
when it is not the intended target — press Escape, or use the dialog's own cancel
control — and observe again afterwards. When the dialog *is* the task, act on it.
Judging "my previous action worked" from a tree that turns out to be the dialog's
is the specific mistake this section exists to prevent: the element you were
looking for is absent because you are reading a different window, not because
the action removed it.


## Workflow

After performing one or more UI actions, call `getAXState()` before deciding what
to do next: that is how you see what your actions did.

An element index addresses the app's most recent observation, so several actions
may reuse one index without re-observing between them — click an index, then type
into it, in the same cell. Observing renumbers the tree, so take indices from the
newest one. A vanished element fails closed with `ELEMENT_UNAVAILABLE`.

The accessibility tree comes back as a diff only against a tree this cell already
showed you, listing the removed, added and changed elements; the omitted rows are
unchanged and their indices stay valid. The first tree after binding, and the
first after a screenshot-only observation, are always complete. Pass
`{ disableDiffing: true }` for a full tree at any point. If a standalone
`getAXState()` reports no change, do not immediately repeat it without an
intervening action.

Minimize round trips while keeping the state fresh:

- Batch deterministic actions and the resulting `getAXState()` into one call.
- `agent.computerUse.getApp(...)` returns the binding and displays nothing; call
  `getAXState()` when you need to see the state.
- Prefer a directly relevant result already visible in the current state over
  opening broader intermediate UI such as "Show All".
- Once the requested result is visibly present, stop exploring and respond.

```typescript
await target.click(42);
await target.setValue(42, "example.com");
await target.pressKey("Return");
await target.typeText("hello");
await target.scroll(42, "down", 1);
await target.scroll([640, 480], "down", 1);
await target.selectText(42, "hello");
await target.performSecondaryAction(42, "Expand");
await target.getAXState();
```

## Output

- For text, use `nodeRepl.write(...)`. For images, `nodeRepl.emitImage(...)`.
- `getAXState()`, `getScreenshot()`, `getAXStateAndScreenshot()`,
  `agent.computerUse.getState()` and `agent.computerUse.listApps()`
  **display their own result**; `agent.computerUse.getApp(...)` does not — it binds only. Never pass their return value to `write` or
  `emitImage`: a second raster in one result breaks the one-raster rule and the
  frame is removed entirely, leaving no picture at all. Pass `{ emit: false }` to
  suppress the display and still get the value back.
- Action methods display nothing and resolve to `undefined` on success.

## Errors

Actions resolve to `undefined` when they succeed and throw `ComputerUseError`
when they do not. The fields you act on:

- `code` — `PERMISSION_DENIED`, `NOT_AUTHORIZED`, `APP_NOT_FOUND`,
  `AMBIGUOUS_APP`, `LAUNCH_FAILED`, `INVALID_APP`, `ELEMENT_UNAVAILABLE`,
  `STALE_STATE`, `NOT_SETTABLE`, `NOT_SELECTABLE`, `ACTION_UNAVAILABLE`,
  `FOREGROUND_REQUIRED`, `CONTROLLER_BUSY`, `CONTROL_STOPPED`, `SCREEN_LOCKED`,
  `HELPER_UNAVAILABLE`, `VERSION_MISMATCH`, `TIMEOUT`,
  `STRUCTURED_STATE_UNAVAILABLE`, `INTERNAL`.
- `actionSent` — whether the action may already have reached the app. Retry a
  non-idempotent action only when this is `false`; otherwise observe first.
- `FOREGROUND_REQUIRED` comes only from `strategy: "event"` (and from `paste` on a
  background app). On macOS nothing in this surface can bring an app forward, so do
  not retry it and do not look for an activation call: switch to an element target,
  `setValue`, or an accessibility action, which all work on a background app.
- `retry` — `"reobserve"`, `"retry"` or `"never"`.

```js
try {
  await app.performSecondaryAction(7, "Show Menu");
} catch (e) {
  if (e.code === "ACTION_UNAVAILABLE") {
    await app.getAXState({ disableDiffing: true });   // the tree lists each element's actions
  } else if (e.code === "CONTROLLER_BUSY") {
    nodeRepl.write(`another ZCode Computer Use session owns control: ${e.details.owner}`);
  } else if (e.actionSent) {
    await app.getAXState();                            // may already have landed; look first
  } else throw e;
}
```

`CONTROLLER_BUSY` is never retryable. Report the owner from the error and ask the
user to close the other session. Stop immediately after `agent.computerUse.stop()`, a kill
switch, or a permission refusal, and do not switch to a different UI-automation
technology after an access refusal.

## Notes

- `elements()` returns the element table as data, including the rows the rendered
  tree trimmed for length, so filter it in JS instead of guessing a hidden index.
  It observes without displaying anything, which costs one broker round trip and
  makes the next `getAXState()` return a full tree rather than a diff — reach for
  it when the tree said `indices are sparse`, not on every turn.
- A container can also report only part of its children, and that is a different
  limit from the one above: the header says `showing A-B of N items`, and those
  rows never entered the observation, so `elements()` does not recover them
  either. This is what a long list or a spreadsheet grid looks like — the rows you
  need may simply have no index. Reach the rest through the app itself: scroll the
  container and observe again, or move the app's own selection (arrow keys, a
  Name Box, a search field) and read the value back from the focused element.
- Prefer element-index actions over coordinate actions whenever an accessibility
  element is available. They are semantic, precise, background-safe and do not
  steal the user's focus. Fall back to a screenshot and coordinates only when
  accessibility cannot locate or express the target.
- Coordinates are integer pixels of the **latest returned raster**. Take them only
  by looking at that raster. Element and window bounds in the tree are diagnostic
  global screen points and must never be used as a coordinate. The SDK binds the
  raster internally; you never pass a frame id.
- A pointer action can be accepted and still do nothing where you aimed. Some apps
  ignore the position carried by a synthesized pointer event and act on wherever the
  real pointer happens to sit, so the same coordinate produces a different result
  depending on where the user left the mouse. The next observation says so with
  `[effect_evidence unchanged]`; when it does, **do not repeat the coordinate** —
  act on an element index, or drive the app from the keyboard (arrow keys,
  shortcuts, or a value typed into a field), which lands on a background app.
- The tree always lists each element's `actions`. `performSecondaryAction` accepts
  only an action the element advertises — do not guess one.
- `selectText` locates text inside an editable element. Use `prefix`/`suffix` to
  disambiguate repeated matches and `selectionType` to place the cursor instead of
  selecting. An ambiguous match is refused rather than resolved to the first hit.
- `pressKey` accepts xdotool-style keysyms as well as short names: `"a"`,
  `"Return"`, `"Tab"`, `"Control_L+a"`, `"super+c"`, `"Up"`. macOS uses `cmd`;
  Linux and Windows use `ctrl`. `{ holdSeconds }` holds the key or chord.
- Use `paste` for rich text, or for a target `setValue` cannot set; for plain text
  into a settable element `setValue` is the better path. It borrows the system
  pasteboard and restores the user's clipboard afterwards. A paste no app reads
  fails with a timeout rather than reporting success. A paste shortcut cannot name
  a target field, so it lands wherever the keyboard focus is — check the result.
- There is no need to open or launch apps; `agent.computerUse.getApp(...)` launches the app in
  the background if it is not already running. There is no separate launch tool.
  Its argument is a display name, a
  bundle identifier, or the same `{name|bundle_id|pid}` object the tools take.
  For a string the SDK sends a
  dotted, space-free string as `bundle_id` and anything else as `name`, and
  retries with the other field once if the app is not found, so either form
  works. There is no path form: `app_ref` has no path field.
  Nothing here fronts a window or takes the user's focus, except on Windows:
  launching a non-packaged app takes focus, and `include_screenshot=true` on a
  minimized window restores it. A minimized window's tree stays fully usable, so
  keep the default unless you need pixels.
- Observations wait an appropriate amount of time before capturing. Do **not**
  pause or delay (no `setTimeout`) before getting UI state; rely on that wait.
- When the state does not show what you expected, observe once more before trying
  a different approach: an animation or a load may still have been in flight.

Persist until the request is fully completed end to end. Attempting an action is
not completion: verify that the returned UI state visibly shows the requested
result. If an action leaves the state unchanged, produces no results, or only
reaches an intermediate page, try another approach. Respond only after the
requested state is visibly present, or explain a concrete blocker you cannot
resolve.

stop and Escape are terminal for the session. Disconnect releases the runtime's
owners. Actions are never automatically replayed; missing receipts are reported as
possibly_sent. Desktop and mobile attachments use the same Host and session owner.
Cancellation/timeout/crash terminates the native worker; restart ZCode to recover
that Host. Normal stop/Escape only ends the controlling session.
