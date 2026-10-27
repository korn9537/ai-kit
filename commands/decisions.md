---
description: Report the questions ai-kit:decider decided or sent to the owner, from the decision log
---

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/decider.mjs" report` from the project root, with `--since YYYY-MM-DD`
   when the user names a date or period (default: everything). Read only its output: never open the files under
   `ai/usage/decisions/`.
2. Show the report as it prints it, then one line: which decisions look wrong given what you know of the project,
   or "none look wrong". Low confidence ones first.
3. The user overrules a decision → that is new work: make the change and, when the decision is in
   `ai/decisions.md`, set it to the user's choice with status `Confirmed`. The log itself is never edited.
