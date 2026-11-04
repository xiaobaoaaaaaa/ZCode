# Turn Cancellation

## Goal

ZCode must support a single cancellation contract for every active user turn.
The local TUI `Esc` shortcut while output is active and ZCode app-server `session/cancel`
notification are input adapters for the same runtime behavior: pause the current
turn output by cancelling active model and tool work, preserve observability, and
return the session to an idle state.

## Scope

Cancellation is scoped to one active turn in one session. There is no process
global abort controller because concurrent sessions, subagents, and background
tasks must not cancel each other by accident.

Each active turn owns a root cancellation scope:

- TUI creates it when a prompt is submitted.
- ZCode app-server creates it when `session/prompt` starts.
- Core links the caller signal into a runtime turn signal.
- Model, permission, tool, filesystem, subprocess, MCP, skill, and artifact
  adapters receive only `AbortSignal`, never the writable `AbortController`.

## User Input Semantics

TUI:

- During normal input, `Esc` must not exit the TUI or mutate the draft input.
  It only shows a local status hint that `Esc` pauses active output and
  confirmed double `Ctrl-C` exits the fullscreen TUI.
- During approval or clarification prompts, `Esc` keeps its local meaning:
  deny the approval or cancel editing the `Other` answer.
- During a busy turn with no focused approval prompt, `Esc` aborts the current
  turn, treats that as pausing active output, and keeps the TUI open.
- `Ctrl-C` first belongs to the focused normal prompt input when that input has
  draft content. It clears the entire draft text and any draft attachments,
  resets the pending exit confirmation, keeps the TUI open, and does not abort
  active work.
- When the normal prompt input is empty, `Ctrl-C` is protected against
  accidental exits. When no local prompt owns the key and no copyable OpenTUI
  text selection exists, the first press only shows `Press Ctrl-C again to
exit.` and arms a short confirmation window. A second consecutive `Ctrl-C`
  inside that window aborts active work and closes the fullscreen TUI. Any
  non-`Ctrl-C` key, draft-clearing `Ctrl-C`, or confirmation timeout clears the
  pending exit.

ZCode app-server:

- `session/cancel` aborts the active prompt controller for that ZCode app-server session.
- Repeated cancel notifications are idempotent.
- Cancelling a missing or idle session is a no-op.
- A cancelled prompt resolves as `stopReason: "cancelled"` and must not surface
  as a JSON-RPC error.

## Runtime Contract

Core treats user cancellation as a first-class turn outcome, not as an unknown
failure.

- Stable error type: `turn_cancelled`.
- User-visible message: `Turn was cancelled.`
- `turn_error` may carry `error.type = "turn_cancelled"` for event consumers.
- Model adapter cancellation such as `model_request_cancelled`, DOM
  `AbortError`, or Node `ABORT_ERR` maps to `turn_cancelled` when it belongs to
  the active turn signal.
- Runtime checks the turn signal at these boundaries:
  - before context/model work starts;
  - before each model request;
  - after a model step returns and before tool scheduling;
  - before each tool execution batch;
  - before follow-up model requests after tool results;
  - during retry sleeps and permission waits.

Once cancellation is observed, runtime stops scheduling new work. Already
running adapters receive the abort signal and perform their own best-effort
cleanup according to their tool or I/O contract.

Network-backed model adapters must treat abort as a transport cancellation, not
only as a local state flag. Provider fetch implementations must pass the active
turn `AbortSignal` to the underlying HTTP client and, for Node `http`/`https`
fallbacks, explicitly destroy both the pending client request and any response
body stream when the signal aborts. This keeps TUI `Esc` and ZCode app-server
`session/cancel` on the same cancellation path: the local TCP/SSE stream is
closed, late provider bytes are ignored by the cancelled turn, and core receives
a structured cancellation result instead of waiting for the remote server to
finish voluntarily.

## Persistence And Resume

Partial assistant output may remain visible to the user, but cancelled turns
must not create provider-visible dangling tool calls on resume.

- Assistant messages opened before cancellation should be completed with an
  error/interrupted marker when storage supports it.
- Pending or running tool parts continue to hydrate as interrupted tool results.
- Cancelled turn events keep the original `traceId`, `sessionId`, `turnId`, and
  current phase so debug views can reconstruct where cancellation landed.

## Explicit continuation after cancellation

The shared App composer uses the V4 `continueTurn` control command after an
interrupted turn. It carries the expected product turn ID, log epoch, revision,
held queue IDs and the selected execution configuration. CommandInbox owns
deduplication/CAS; the gateway supplies the authoritative interrupted target;
the handler obtains an idle-only Core foreground lease before asynchronous
preparation. A changed target, busy runtime, blocking interaction or stale queue
rejects continuation without admitting a user input.

The App input facade prepares the existing execution boundary and calls the
serialized Core turn loop with no new input record, no UserPromptSubmit hook,
and model-only TurnStarted visibility. Execution configuration is a frozen
control submission, independent of a user input intent. There is no synthetic
continue prompt in model history, transcript, session_input or input history.
Control ACKs use the existing persistent command facts for reconnect queries.
Goal continuation retains its separate resumeGoal semantics. Cancellation
cleanup and existing interrupted tool results remain authoritative; continuation
starts a new runtime turn, not a resurrected request or subprocess.

Desktop continuous and Web replayable consume the same TurnStarted/TurnComplete
facts and produce no userInput row for this operation. Regression evidence must
check both projection modes, runtime/provider history, stale-target rejection,
idle lease contention, held queue preservation and duplicate clicks.

显式续跑在发布 TurnStarted 前保存无正文的 assistant 控制边界，语义为隐藏的 `timeline_event`，`anchor.controlTurn=continue`，不进入 provider context。冷恢复识别该边界并恢复 sourceCommandId、model-only 轮及稳定 fork 的消息范围，不能用不存在的用户消息 ID 关联新输出。

控制边界同时解除最近一次 stop 对模型上下文的约束：移除该次中断标记，仅将该轮 cancelled 工具的固定 STOP 文本替换为保留失败与部分副作用可能性的取消事实。历史存储和 UI 不改写；普通新输入仍沿用已有中断标记语义。热续跑与冷恢复共享同一转换，不新增 user/system 提示。

## Tests

Required coverage:

- TUI `Esc` during idle prompt input does not close the TUI and preserves the
  draft input.
- TUI `Esc` pauses an active prompt without closing the TUI.
- TUI `Esc` during approval keeps denying the approval.
- TUI `Ctrl-C` with a non-empty normal prompt draft clears the draft and draft
  attachments without closing or aborting active output.
- TUI first `Ctrl-C` with an empty normal prompt input shows `Press Ctrl-C again
to exit.` without closing; a second consecutive `Ctrl-C` exits.
- Core abort during model wait emits `turn_cancelled`.
- Core abort after a model emits tool calls does not schedule tools.
- Core abort reaches per-tool `AbortSignal` and subprocess adapters.
- Provider network fetch abort destroys in-flight HTTP/SSE requests after
  response headers have been received, so model streams do not remain open until
  the remote server finishes.
- ZCode app-server `session/cancel` resolves an in-flight prompt as `cancelled`, including
  when the prompt throws after observing the abort signal.
- Abort during model retry sleep is not retried.
