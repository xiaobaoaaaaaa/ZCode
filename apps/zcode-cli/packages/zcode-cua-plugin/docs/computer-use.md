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

stop and Escape are terminal for the session. Disconnect releases the runtime's
owners. Actions are never automatically replayed; missing receipts are reported as
possibly_sent. Desktop and mobile attachments use the same Host and session owner.
Cancellation/timeout/crash terminates the native worker; restart ZCode to recover
that Host. Normal stop/Escape only ends the controlling session.
