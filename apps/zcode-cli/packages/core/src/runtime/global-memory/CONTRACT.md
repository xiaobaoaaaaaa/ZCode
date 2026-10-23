# Global profile runtime

Owner: runtime. The adapter owns disk mutation. Only explicitly tagged real-user input is eligible for classification. No model tool execution is permitted. A snapshot generation is checked at commit, so profile deletion, edits or controls supersede in-flight extraction. Capture of a session trace is inherited by the auxiliary request; exceptions are logged without recording contents.

`globalMemoryBackground` reads each request, checks global/session controls and returns bounded background observations. It does not mutate canonical history. `scheduleGlobalMemoryExtraction` permits one in-flight extraction per runtime and uses an abort controller for shutdown. Unsupported structured-output models do not record automatically. Project memory and global controls are independent. Global session controls live in the profile snapshot. The existing headless extractionEnabled policy still suppresses background model calls.

The model classifier is conservative but cannot prove perfect semantic classification or detect arbitrary secrets. Local credential-pattern checks are additional defense. Settings permit inspection, correction and deletion.
