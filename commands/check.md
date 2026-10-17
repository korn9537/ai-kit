---
description: Check this project's ai-kit wiring (ai/kit/config.json, pre-commit shim, plugin settings)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/kit.mjs" check` from the project root and report the result. For each
problem, apply the fix the line names, rerun `check`, and report what changed. Ask first only before deleting a hook
or file git does not track, or editing settings outside the repo (`~/.claude/settings.json`).
