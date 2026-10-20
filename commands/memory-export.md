---
description: Move this repo's auto-memory files into repo files the team can read, then delete the local copies
---

Move auto-memory into the repo (rule: `${CLAUDE_PLUGIN_ROOT}/CLAUDE.core.md`, Project knowledge).

1. Dir: `~/.claude/projects/<slug>/memory/`, slug = main worktree path with each non-alphanumeric as `-`
   (`kit.mjs check` prints it).
   No `.md` file besides an index-only `MEMORY.md` → say so and stop.
2. Read every file, `MEMORY.md` included. Each fact → its target in the working conventions (Project knowledge),
   chosen by content (frontmatter `type` is a hint only); a decision gets the project's default status. Already in
   the repo, code or git log, or stale against the code → drop, list under Decided.
3. Rewrite a fact bound for `ai/` per `${CLAUDE_PLUGIN_ROOT}/docs/ai-docs.md`: English fragments, no bold, the memory's
   Why line kept as a one-line reason; a date only when the fact is a deadline.
4. Commit the repo files, staged by name (a kit proposal is filed, not committed). After the commit, delete the
   moved files and `MEMORY.md` (`rm`, allowed by the guard); ask first for a file you left out.
5. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/kit.mjs" check`; report per memory file: target or dropped, with reason.
