---
description: Migrate a project from the in-repo ai-kit 1.x copy to the plugin, then init and check
---

Migrate the current project from ai-kit 1.x.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/kit.mjs" migrate` from the project root. It refuses on a dirty working
   tree or when there is nothing 1.x to migrate (then run `/ai-kit:init` instead). Otherwise it deletes `ai-kit/`
   and the old agent copies, removes the kit hooks from `.claude/settings.json` and enables the plugin there, drops
   the `@ai-kit/CLAUDE.core.md` import, cleans `ai/kit/`, then runs `init` and `check`.
2. Show the user its summary. For each review-by-hand line, propose the new wording and wait for a go.
3. Tell the user to review `git diff`, stage the listed files by name, commit, and restart the Claude Code session.
