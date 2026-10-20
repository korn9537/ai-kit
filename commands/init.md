---
description: Set up the ai-kit plugin in this project (ai/kit/ files, git pre-commit shim), then check it
---

Set up ai-kit in the current project.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/kit.mjs" init` from the project root. It creates the missing `ai/kit/`
   files from templates (never overwrites), writes the `.githooks/pre-commit` shim, sets `core.hooksPath`, and adds
   `"autoMemoryEnabled": false` to `.claude/settings.json` when the key is absent.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/kit.mjs" check` and fix each problem it names; ask first only
   before deleting a hook or file git does not track, or editing settings outside the repo.
3. Help the user fill `ai/kit/` for this project: `config.json` (code folders, comment-check scope, dev port, the
   languages for `conventions`, from `${CLAUDE_PLUGIN_ROOT}/conventions/`; `ui` per
   `${CLAUDE_PLUGIN_ROOT}/docs/screen-specs.md`, platforms from the `check` warning, `{"platforms": []}` when the
   repo has no screens), `pre-commit.sh` and `post-edit.sh`
   (the repo's own checks), `review-checklist.md`, `analysis-sources.md`. Read the code and docs to propose values.
4. Help write the project part of `CLAUDE.md`: layout, commands, stack rules, branch and deploy, verify commands.
   The working conventions come from the plugin at session start; do not import or copy them.
5. Tell the user to restart the Claude Code session so the SessionStart hook injects the working conventions.
