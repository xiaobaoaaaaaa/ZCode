# Conversation versions

The UI reads version metadata and requests restoration using callbacks bound to one session. The runtime owns persisted message IDs and rebuilds the active context. The session pane sends revision-checked commands and rehydrates through the existing V4 transport. No tool execution or file rollback is triggered by restoration.

Disable controls while work runs. Pending requests disable repeat submission; errors stay visible. Session changes remount the component, so results cannot overwrite another conversation. Both desktop continuous updates and remote replay use the same authoritative refreshed projection.
