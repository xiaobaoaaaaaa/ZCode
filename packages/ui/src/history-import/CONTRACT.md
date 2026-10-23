# Official history import UI

Local ServiceProvider → existing task-service hook → preview lease → explicit confirm → pure-storage import and recoverable task/project registration. The runtime owns persistence, ID remapping and duplicate detection. This component owns only the source path, closed-source acknowledgement, preview and report. Changing input invalidates the displayed preview; requests disable duplicate actions. Errors remain visible. No model, tool, permission, queued input or workflow is executed by this UI.

Only current-branch user/assistant text is migrated. The preview identifies destination project paths and excluded sessions. Resuming an imported session requires a later ordinary user action with the personal app's permissions/model configuration.
