---
description: Remove ai-kit's wiring from this project (git hooks, core.hooksPath, the CLAUDE.md pointer line, the plugin flag); ai/kit/ is kept unless --purge
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/kit.mjs" uninstall` from the project root (add `--purge` to also delete
`ai/kit/`) and report the result.

It only reverses what `init` (or an equivalent manual setup) itself wrote: the `.githooks/pre-commit` and
`.githooks/commit-msg` shims (only when they are still the ai-kit shim — a project's own hook there is left alone
and named), `core.hooksPath` (only when nothing else still lives in `.githooks/`), the `<!-- ... -->`-free pointer
line in `CLAUDE.md`, `<git-common-dir>/ai-kit-root`, and `"ai-kit@korn9537"` in `.claude/settings.json`'s or
`.claude/settings.local.json`'s `enabledPlugins` (never `~/.claude/settings.json`, which is the user's own scope).
`ai/kit/` itself — the project's filled-in `config.json`, `pre-commit.sh`, `conventions/`, and so on — is left in
place unless `--purge` is given, since it is the project's own content, not generated wiring.

Anything the command could not safely touch (a non-kit hook, `core.hooksPath` still needed by another hook) is
printed with `!` and left for the user to resolve by hand; relay that list, then tell the user to restart the
Claude Code session.
