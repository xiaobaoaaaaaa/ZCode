# Codex account panel

The component obtains the active Host service only through hooks. Local state is a disposable
projection and pending UI, never credentials or accepted account state. Host change/unmount
invalidates late UI writes and cancels pending device login. Polling obeys the server interval.
Actions remain available on narrow Web and desktop; all visible labels are localized.

Mounted inside the shared provider detail surface only while the Codex navigation item is selected.
The parent owns selection; this panel owns only disposable account projections and pending actions.
Sync errors use operation-specific retry copy, without exposing raw exceptions.

Account cards reuse the official plan surface with quota meters and compact actions. The available
model list is discovery data, not local enabled state. Success feedback is scoped to the account
whose sync completed. Workspace identity/full reset time remain accessible in tooltips.
