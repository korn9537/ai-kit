# Changelog

## 2.11.0

- `ai-kit:business-analyst` and `ai-kit:change-reviewer` default to sonnet (was opus). The caller passes
  `model: "opus"` when the change touches a DB schema or migration, a calculation, a permission, or a decision
  recorded as final (`CLAUDE.core.md` "Agent model"; the Stop hook's reason says the same).
- BA runs for DB and business-rule changes only; a UI-only change (layout, copy, style) is summarized by the main
  session. A small job's final report holds Done, Checked and Git, plus Decided and Open when they hold anything.
- `review-before-stop.sh`: a change of at most `review.skip_lines` changed code lines (default 10), with no new file
  and no path matching `review.always` (migrations, schema, auth, permission, policy, `.sql`, `.prisma`), passes
  without a review. A review is an Agent of type `ai-kit:change-reviewer`, or a general-purpose one with "review" in
  its description (an Explore agent named "review ..." no longer counts). The block reason names only the next step
  for the review state (none, reviewed, re-checked). Without a snapshot the diff covers only the paths this session
  edited, so another session's work in a shared checkout is not counted. `open("x")` reads and `sed -i` on `/tmp`
  no longer count as repo writes; a codemod, a formatter run with `--fix`/`--write`, and `mv`/`cp`/`rm` on a repo path
  do. `cd <root>` now matches the root without its trailing slash. The small-change pass applies only before the first
  review (fixes always go to the re-check), and a commit batch whose description holds "review" is not taken for a
  review. Test: `hooks/review-before-stop.test.sh`.
- Coordinator pipeline: CONFIRMED fixes go back to the commit's own subagent by SendMessage instead of a fresh
  `commit: fix` subagent; a commit subagent's brief has it read `CLAUDE.core.md` "Working conventions" first.
- `post-edit-check.sh` starts `node` only for the checks whose include/skip scope holds the edited file.
  `handoff-nudge.sh` reads the transcript tail only.

## 2.10.0

- `docs/plan-batching.md`: a request or plan with several items starts with one inventory pass (item → files,
  functions, shared resources), asks all owner questions at once, and batches items that touch the same file into one
  commit; separate commits only for move-only splits, contract changes and revertable migrations. A bug or
  calculation fix covers its whole unit before the commit; a mechanical sweep over many files uses a codemod or
  script; hot files (plan, decision log, roadmap, lockfile) are updated once per batch.
- Coordinator pipeline (`CLAUDE.core.md`): when a commit subagent returns, its reviewer (reading `git show <hash>`)
  and the next independent batch's commit subagent start in the same message; still one commit subagent editing
  the repo at a time. Fix subagents run once no commit subagent runs.
- Independent reads, searches and checks go out in one message.
- `docs/shared-checkout.md`: self-contained commits are per batch of code, not per item.

## 2.9.0

- `/ai-kit:retrofit` (`commands/retrofit.md`): brings an existing project into the `ai/` layout. No argument →
  survey and `ai/plans/retrofit.md`; then one category per run and commit (`config`, `move`, `data`,
  `decisions`, `requirements`, `screens`, `api`), written only from the code and existing docs; unknowns become
  open questions; an extracted decision keeps a final source status as `Confirmed`, else `Default`.
- `kit.mjs check` UI detection also looks at tracked top-level folders and `packages/*` (e.g. `mobile/`), skipping
  `docs/`, `website/`, `examples/`: a project without a `ui` key may see the detection warning for the first time.
- `docs/screen-specs.md`: an index line without a spec yet, `- <name> → <entry file> (no spec)`.
- `kit.mjs inventory` (read-only): `ai/` entries outside the layout, schema sources, screen files with a
  `ui.include` suggestion, API spec and route files, decision docs, other `.md` outside `ai/`. Test:
  `scripts/kit-inventory.test.mjs`.

## 2.8.0

- Screen specs for web and mobile projects (`docs/screen-specs.md`): config key `ui` (`platforms`, `include`,
  `api`); one file per screen in `ai/screens/` linked to the API spec; order data → spec → API spec → API → screen;
  existing screens get a spec when next changed.
- `conventions/general.md` item 11: one screen = one server read, the client only formats; item 6: a business
  state change is its own command.
- `scripts/check-specs.mjs` (pre-commit, warnings only): endpoints missing from `ui.api` (`.md` folder, OpenAPI
  JSON or YAML), more than one read, duplicate ids, index drift, a new screen file no spec lists; `--map` prints
  the reverse map. Tests: `scripts/check-specs.test.mjs`.
- `kit.mjs check`: problem on a malformed `ui`; warns when a web or mobile repo has no `ui` key, or `ui.platforms`
  is set without `ai/screens/index.md`. Core rule, BA and reviewer read the screen specs when `ui.platforms` is set.
- `ai/` layout (`docs/ai-layout.md`): fixed categories (decisions, requirements, data per entity, feature specs,
  screens, API, plans, notes), file names, ids and a format per type; one template each in `templates/ai/` (not
  copied by `init`). `ai/data/` is the base that screen and API specs point to. `analysis-sources.md` template
  and BA fallback use these paths; `kit.mjs check` warns on any other top-level entry under `ai/`.
- AI-only doc scope narrowed to `ai/**/*.md`: files outside `ai/` are not governed; a doc the agent creates goes
  under `ai/` unless the user names another place or form. `check-docs.mjs` default and template `docs.include`:
  `^ai/.*\.md$` (existing projects keep their `docs.include`; `check` warns while it equals the old template value).

## 2.7.0

- Project knowledge lives in the repo, never in auto-memory (one machine only, the team never sees it):
  `CLAUDE.core.md` rule with the target per kind of fact; references go to `ai/notes.md`.
- `hooks/memory-guard.sh` (PreToolUse on Write/Edit/MultiEdit/NotebookEdit/Bash): blocks writes into
  `~/.claude/projects/*/memory/`, names the repo file instead.
- `kit.mjs init` adds `"autoMemoryEnabled": false` to `.claude/settings.json` (existing projects: rerun init);
  `init` and `check` warn, never fail, on auto-memory on or memory files left; `hooks/session-start.sh` asks for
  the export while files are left.
- `/ai-kit:memory-export` (`commands/memory-export.md`): moves each memory file to its repo target, then deletes
  the local copy.

## 2.6.0

- Kit proposals: a project session files a GitHub issue labelled `proposal` on korn9537/ai-kit for a cross-repo
  standard, a review finding seen twice, a user correction that holds in any repo, or a kit gap; never an edit of
  the installed plugin (the old core rule pointed there, which an update overwrites). `docs/kit-proposals.md`: when
  to file, the cross-repo test, search before filing, fallback file `ai/kit/kit-proposals.md` without `gh`.
  `.github/ISSUE_TEMPLATE/proposal.md`: the issue body.
- `/ai-kit:harvest` (`commands/harvest.md`): in the ai-kit clone, accept, merge or reject open proposals; accepted
  ones land in one commit with `Closes #<n>`.
- `CLAUDE.core.md` Conventions and `agents/business-analyst.md` item 5 point to the issue route.
- `hooks/session-start.sh`: asks for filing when `ai/kit/kit-proposals.md` is not empty.

## 2.5.4

- `scripts/check-docs.mjs`: one removed line excuses only one added copy as a move, a copy in its own file first
  (a line removed once and added three times reported two hits less than it should). HEAD versions are read with
  one `git cat-file --batch` instead of one `git show` per changed doc. The filler rule also reports `~` before a
  digit and about, around, roughly, approximately before (a) dozen, hundred or thousand; a year 1900-2099 after
  them passes.
- `scripts/check-docs.test.mjs`: fixture tests (temp git repos) for check-docs.
- `CLAUDE.core.md`, `conventions/csharp.md`, `conventions/typescript.md`: "over 40 KB" (was "~40 KB");
  the commit-subagent paragraph in `CLAUDE.core.md` rewrapped. README lists the test.

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
