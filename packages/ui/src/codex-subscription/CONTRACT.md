# Codex account panel

The component obtains the active Host service only through hooks. Local state is a disposable
projection and pending UI, never credentials or accepted account state. Host change/unmount
invalidates late UI writes and cancels pending device login. Polling obeys the server interval.
Actions remain available on narrow Web and desktop; all visible labels are localized.
