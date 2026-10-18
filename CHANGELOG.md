# Changelog

## 2.5.3

- MIT `LICENSE`; `plugin.json` names it.

## 2.5.2

- `scripts/check-docs.mjs`: the filler rule also reports a vague quantity (`about`, `around`, `roughly`,
  `approximately` before a number or `every <number>`), per ai-docs.md "Exact values".

## 2.5.1

- `scripts/check-docs.mjs`: a rule hit on an edited line is skipped when one removed line of the same hunk,
  outside fences and frontmatter, already held at least as many of each fragment the rule matches (bold text,
  Thai runs); a task-status flip on a bold line passes, a new or repeated fragment is still reported. An
  unchanged line leaving a fence or frontmatter is now checked, and a file renamed from an out-of-scope path
  (for example `README.md` into `docs/`) is checked in full; a line moved in from an out-of-scope file is no longer skipped as a move.

## 2.5.0

- `CLAUDE.core.md`: the agent decides; the owner holds only money, irreversible or outward actions,
  legal/privacy/consent, and changing a Confirmed decision. The BA summary waits for a go only on those; other
  choices go to a new report item 6 Decided (Open is 7, Next session 8). `business-analyst` asks only owner
  questions, else states an assumption (reported under Decided). `/ai-kit:check` and `/ai-kit:init` apply the
  named fixes, asking only before deleting an untracked hook or file or editing settings outside the repo;
  `/ai-kit:migrate` writes review-by-hand wording itself. Commit subagents return their choices too. A build while
  the dev server runs is not asked about: run the typecheck (default and template hints say so; a project hint
  in `ai/kit/config.json` is kept). The analysis-sources template names status labels.

## 2.4.1

- `CLAUDE.core.md` report item 6: Open holds only owner decisions, out-of-scope work and blocked in-scope work;
  in-scope fixable items are fixed before the report, kept limits go in code or docs. Commit subagents return
  item-6 items only.
- Paths with `"`, `\`, control or non-ASCII characters are no longer skipped: `check-docs.mjs` reads C-quoted diff
  headers, `check-comments.mjs` lists files with `-z`, `review-before-stop.sh` and the pre-commit kit-check trigger
  use `core.quotePath=false` (a comment-only edit to such a file no longer asks for a review).

## 2.4.0

- `scripts/check-docs.mjs`, run by pre-commit and post-edit: added lines of docs in `docs.include` (default
  `CLAUDE.md`, `docs/**/*.md`, `ai/**/*.md`; `docs.skip` drops READMEs, mockups, design) fail on emoji, bold, filler,
  dates, Thai outside quotes or code (allowed in table rows). Skips fences, code spans, frontmatter, moved lines
  (renames, splits), merges, cherry-picks and reverts; quotes exempt Thai and dates; runs before prettier. Off:
  `include: "^$"`. `ai/kit/` templates drop bold labels.

## 2.3.0

- `CLAUDE.core.md` §Language: reply to the user in Thai; docs, comments, commits and subagent briefs in English.
  New `docs/ai-docs.md`: docs are for AI readers only, token-minimal; when a review runs, `change-reviewer` also
  checks touched docs against it.

## 2.2.0

- `conventions/dart.md` §4: user-facing strings go through gen-l10n `AppLocalizations`, never a literal in a
  widget; ARB files keep the same keys; dates and numbers through one locale-aware helper.

## 2.1.0

- `kit.mjs migrate` (and `/ai-kit:migrate`) migrates a 1.x repo in one step: deletes `ai-kit/` and the old agent
  copies, drops the kit hooks and enables the plugin in `.claude/settings.json`, removes the `@ai-kit` import,
  cleans `ai/kit/` (config and known header lines), then runs `init` and `check`. Refuses on a dirty tree, or when
  `ai-kit/` is not the tracked 1.x copy. Deletes only files git tracks, after all writes; lists edited agent copies
  and any `ai-kit/` file the plugin lacks with a `git show HEAD:<path>` hint; keeps an existing marketplace entry and an
  explicit `false` for the plugin.

## 2.0.0

- Ships as a Claude Code plugin in its own repo (`korn9537/ai-kit`), which is also the `korn9537` marketplace.
  Projects enable `ai-kit@korn9537` in `.claude/settings.json` instead of copying `ai-kit/` (README §Migrating).
- Hooks are wired in `hooks/hooks.json` with `${CLAUDE_PLUGIN_ROOT}`; `settings.hooks.json` is gone. Every hook
  exits silently in a project without `ai/kit/`.
- New `session-start.sh` injects `CLAUDE.core.md` (replaces the `@ai-kit/CLAUDE.core.md` import; plain text without
  `jq`) and records the plugin path in `<git-common-dir>/ai-kit-root` for the pre-commit shim, as `init` does. Hooks
  use the git toplevel of the project dir, so a session started in a subdirectory still finds `ai/kit/`.
- Agents are `ai-kit:change-reviewer` and `ai-kit:business-analyst`, read from the plugin; `.claude/agents/` copies
  must go.
- `sync.mjs` is replaced by `scripts/kit.mjs init|check` and the `/ai-kit:init`, `/ai-kit:check` commands; no
  `install` or `collect`. `check` also fails when the plugin is enabled in no settings scope or 1.x leftovers remain
  (including `code_dirs` `ai-kit` and a missing `shared_checkout_doc`).
- The `.githooks/pre-commit` shim finds the kit through `ai-kit-root`; without it, it warns and runs only
  `ai/kit/pre-commit.sh`.
- `shared_checkout_doc` defaults to the plugin's `docs/shared-checkout.md`; templates drop `ai-kit` from
  `code_dirs`. `VERSION` is gone: `version` in `.claude-plugin/plugin.json` is the only source.

## 1.4.1

- `post-edit-check.sh` runs in a repo with no `package.json`; `node_modules` is required only when one exists.

## 1.4.0

- Conventions for `csharp` and `typescript`. `general.md` gains one save = one write (upload first, bulk), paged
  lists, no read in a loop, server-side authorization, no committed secrets, 24px targets (44pt in `dart.md`);
  `sql.md` gains names, enum strings, FKs, unique names, concurrent indexes, three-step NOT NULL, idempotent imports,
  DDL via migrations. Moved out: `/v1`, the UUID v7 column default, problem+json `code`, the append-only trigger.
- `sync.mjs check` reports an `ai/kit/config.json` that is malformed or not a JSON object instead of throwing.

## 1.3.0

- Cross-repo coding rules in `conventions/` (`general.md` plus one file per language), chosen by config
  `conventions` (default `[]`); read by both agents and `CLAUDE.core.md`, checked by `sync.mjs check`.

## 1.2.2

- The closing phrase is shown without backticks where the model is told to write it (`CLAUDE.core.md`, the
  `review-before-stop.sh` block message), since the hook does not count a backticked phrase. Code spans in kit
  Markdown stay on one line, so prettier in a project's pre-commit does not reflow them.

## 1.2.1

- A commit subagent never launches its own reviewer (it doubled every review). `review-before-stop.sh` counts
  `Review closed: re-checked once` (not quoted) in a main-session reply right after a re-check as a review. It also
  reads the reply being stopped from the hook input (`last_assistant_message`), which may not be in the transcript yet.

## 1.2.0

- Multi-commit plans run with the main session as coordinator and one fresh background subagent per commit
  (`CLAUDE.core.md`); `review-before-stop.sh` counts a finished subagent's edits and asks for a fresh background
  reviewer per commit with one re-check.
- `handoff-nudge.sh` (UserPromptSubmit) and report item 7 "Next session"; config `handoff.max_context`.

## 1.1.0

- `check-comments.mjs`: Go and Dart support. Go directives and Dart `// ignore:` lines do not count as comments,
  `_test.go`/`_test.dart` files are exempt from the dated check, and Go files marked
  `// Code generated ... DO NOT EDIT.` are skipped.

## 1.0.0

- First portable release: `CLAUDE.core.md`, agents `business-analyst` and
  `change-reviewer`, hooks (review-before-stop, review-snapshot, post-edit-check, git-add-all-guard,
  build-while-dev-guard), pre-commit runner, `check-comments.mjs`, `sync.mjs` install/check/collect, `ai/kit/`
  templates.
