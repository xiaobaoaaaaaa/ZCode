# Earlier-message editing in the current conversation

The V4 projection exposes edit for canonical real-user inputs in the active conversation, not just the latest input. Synthetic messages, absent/stale entities and inactive branches remain ineligible. Historical edit is unavailable during active work or a pending interaction; the existing latest-input stop/admission barrier remains authoritative. Commands retain revision/log-epoch checks.

The existing `editUserQuery` command rewinds only the active conversation, retains durable messages and submits the edited user input under the existing permission policy. The same session ID remains selected. Before editing, the runtime saves a restorable version of the complete prior active branch. Restoring a version only changes the active transcript/context; it never reruns model/tool calls or changes workspace files.

The editor explicitly warns that later conversation is regenerated and that executed commands, external operations and file changes are not automatically undone. The ordinary send action preserves workspace state. Any separate existing explicit file reset remains separately labelled and guarded.

```text
user edits canonical history -> revision/admission guard -> preserve previous version
 -> same-session branch cut -> regenerated input -> ordinary permissions
restore selected version -> idle/revision guard -> switch active branch -> rebuild context
```

Acceptance: earlier idle user row gets a valid edit target; active work blocks historical edit; stale/synthetic targets reject; editing keeps session identity; old content remains durable; repeated edits preserve recoverable versions; restoration does not execute tools; context excludes inactive branches; visible warning is present in the editor. Platform and browser E2E evidence must be reported separately from unit tests.

Validation: backend projection/edit/SQLite history suite passed 275 cases, including close/reopen persistence, inactive-branch exclusion and zero tool replay during restore. UI edit/version interaction suite passed 40 cases. Native end-to-end and Windows validation remain unperformed. The existing large ProductProjection reducer retains its single state owner with a documented max-lines exception; this feature does not split the protocol state machine solely for file size.
