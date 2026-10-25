---
description: Check this project's ai-kit wiring (ai/kit/config.json, pre-commit shim, plugin settings)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/kit.mjs" check` from the project root and report the result. Fix every
`ai-kit:` problem line with the fix it names. For each `!` warning apply its fix unless it needs an owner decision
or says to wait (for example "when next touched"); list those under Open. Rerun `check` and report what changed.
Ask first only before deleting a hook or file git does not track, or editing settings outside the repo
(`~/.claude/settings.json`).
