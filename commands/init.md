---
description: Set up the ai-kit plugin in this project (ai/kit/ files, git pre-commit shim), then check it
---

Set up ai-kit in the current project.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/kit.mjs" init` from the project root. It creates the missing `ai/kit/`
   files from templates (never overwrites), writes the `.githooks/pre-commit` shim and sets `core.hooksPath`.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/kit.mjs" check` and fix each problem it names; ask the user before
   moving an existing git hook or editing `.claude/settings.json`.
3. Help the user fill `ai/kit/` for this project: `config.json` (code folders, comment-check scope, dev port, the
   languages for `conventions`, from `${CLAUDE_PLUGIN_ROOT}/conventions/`), `pre-commit.sh` and `post-edit.sh`
   (the repo's own checks), `review-checklist.md`, `analysis-sources.md`. Read the code and docs to propose values.
4. Help write the project part of `CLAUDE.md`: layout, commands, stack rules, branch and deploy, verify commands.
   The working conventions come from the plugin at session start; do not import or copy them.
