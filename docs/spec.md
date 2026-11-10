# ai-kit spec

Reader: agents changing the kit. What each file does and which process calls it. Behavior detail lives in the
file named; this file is the map. `scripts/spec.test.mjs` fails when a file below `agents/`, `commands/`, `hooks/`,
`githooks/`, `scripts/`, `workflows/`, `docs/`, `templates/` or `conventions/` (any depth; `docs/superpowers/` by
folder) is not named here, when a file named here does not exist, and on a prose line over 120 characters.

Shape: a Claude Code plugin. `hooks/hooks.json` wires hooks, `commands/` are slash commands, `agents/` are subagents,
`CLAUDE.core.md` is injected at session start. Every hook exits 0 in a project without `ai/kit/` (`kit_enabled`).
A project holds its own settings in `ai/kit/` and two git shims in `.githooks/` that call `githooks/`.

## Files

### Plugin root

| File | Role |
|---|---|
| `.claude-plugin/plugin.json` | plugin name and version; the version is bumped on every release |
| `.claude-plugin/marketplace.json` | marketplace entry for `korn9537` |
| `CLAUDE.core.md` | the rules every session reads: Git, Language, Working conventions, Delegation and report; injected by `session-context.sh` (up to "Delegation and report") and `session-start.sh` (the rest) |
| `CHANGELOG.md` | one entry per version |
| `README.md` | install, settings, commands, editing the kit |
| `.gitattributes`, `.gitignore`, `LICENSE` | `.gitattributes` forces LF (the scripts must run from a Windows checkout); the others as named |
| `.github/ISSUE_TEMPLATE/proposal.md` | body of a kit proposal issue (`docs/kit-proposals.md`) |
| `.githooks/pre-commit` | the kit clone's own pre-commit: wrap check; runs the handoff and run-plan tests when a route changes |

### hooks/ (Claude Code hooks)

| File | Event | What it does |
|---|---|---|
| `hooks/hooks.json` | n/a | wires every script below to its event and matcher |
| `hooks/lib.sh` | sourced | `kit_enabled`, `kit_conf` (reads `ai/kit/config.json`), project root, path spelling, `kit_core` and `kit_inject` (the core text), `kit_memory_dir`, `kit_state_dir` (the review, usage-cache, usage and decider state folders; twin of `scripts/lib/state-dirs.mjs`), `kit_split_cmd` (splits a Bash line into simple commands; quote characters removed, a quoted text stays one word; heredoc bodies and comments dropped), `kit_code_lines`, `kit_review_skippable`, `KIT_REVIEWER_JQ` (the reviewer test shared by `review-snapshot.sh` and `review-before-stop.sh`) |
| `hooks/session-context.sh` | SessionStart | injects the first half of `CLAUDE.core.md` |
| `hooks/session-start.sh` | SessionStart | injects the second half plus notes (unfiled proposals, open plans, auto-memory files, stale unattended copies); writes `<git-common-dir>/ai-kit-root`; records the work tree as the review snapshot; flushes idle usage buffers |
| `hooks/bash-guard.sh` | PreToolUse Bash | blocks a sweeping `git add`/`git commit -a`, and a build command while `build_guard.port` listens |
| `hooks/memory-guard.sh` | PreToolUse Write, Edit, MultiEdit, NotebookEdit | blocks writes into the auto-memory dir |
| `hooks/agent-model-guard.sh` | PreToolUse Agent, Task | blocks a general-purpose or Explore subagent launched without `model` |
| `hooks/ask-guard.sh` | PreToolUse AskUserQuestion | blocks an ask until `ai-kit:decider` returned OWNER within 30 minutes (one OWNER serves one ask; verdict read by `decider.mjs guard`); lets it through when `decider.enabled` is false, the question matches `decider.always_owner`, or node is missing |
| `hooks/review-before-stop.sh` | Stop | blocks the final reply until `ai-kit:change-reviewer` reviewed the code edited since the last review; passes small, comment-only, moved-only changes |
| `hooks/review-snapshot.sh` | PostToolUse Agent, Task, SendMessage; also `--tree` from session-start | records the work tree when the main session calls a review, so the Stop hook can diff against it |
| `hooks/post-edit-check.sh` | PostToolUse Edit, Write, MultiEdit | runs the comment and doc checks and `ai/kit/post-edit.sh` on the edited file, in parallel |
| `hooks/handoff-nudge.sh` | UserPromptSubmit; PostToolUse Bash, Read, Grep, Glob | notes only, never blocks: "Next session" prompt past `handoff.max_context`; send searches to a subagent; read a line range instead of a whole file |
| `hooks/kit-log.sh` | Stop (`stop`, `subagent-stop`), SubagentStop (`subagent-stop`), SessionEnd (`session-end`) | calls `usage.mjs` (`record`, `end`) and `decider.mjs sync`; buffers each round's token use; writes `ai/usage/` records at session end; logs decider verdicts |
| `hooks/*.test.sh` | n/a | fixture tests, one per hook that has one |

### githooks/ (git hooks, called by the project's `.githooks/` shims)

| File | Role |
|---|---|
| `githooks/pre-commit` | runs in order: stage `ai/usage/` records, backslash path, `check-docs`, `eslint-disable ... moved verbatim`, 40 KB size, prettier, `ai/kit/pre-commit.sh`, `check-comments`, `check-specs`, `kit.mjs check` when kit files are staged |
| `githooks/commit-msg` | requires exactly one `Job: <yyyy-mm-dd>-<slug>` trailer; a merge and a `fixup!`, `squash!` or `amend!` commit pass |
| `githooks/*.test.sh` | fixture tests |

### agents/ (subagents)

| File | Model | Role |
|---|---|---|
| `agents/business-analyst.md` | opus medium | read-only analysis before a DB or business-rule change; 8-section report ending in Done when and Owner decisions |
| `agents/change-reviewer.md` | opus medium | read-only fresh review of a change (findings CONFIRMED or PLAUSIBLE), re-check mode, plan-review mode |
| `agents/committer.md` | sonnet medium | implements one batch, verifies once, makes one commit; reports hash, files, choices, open items |
| `agents/decider.md` | opus medium | decides a question the main session would put to the owner: DECIDED or OWNER with one recommendation; its verdict lines are logged |

### commands/ (slash commands)

| File | Role |
|---|---|
| `commands/init.md` | `kit.mjs init`, then check |
| `commands/check.md` | `kit.mjs check` |
| `commands/migrate.md` | `kit.mjs migrate` for a 1.x repo, then init and check |
| `commands/uninstall.md` | `kit.mjs uninstall` |
| `commands/retrofit.md` | fills the `ai/` layout from code and existing docs, one category per commit, from `kit.mjs inventory` |
| `commands/memory-export.md` | moves auto-memory files into repo files |
| `commands/harvest.md` | in the kit clone: lands accepted `proposal` issues |
| `commands/usage.md` | runs `usage.mjs digest`, names the largest driver and the one change that cuts it |
| `commands/decisions.md` | prints the decider's decision log |
| `commands/jobs.md` | `jobs.mjs`: lists jobs or shows one job's commits and revert command |
| `commands/run-plan.md` | runs a multi-commit plan through `workflows/run-plan.js`; writes and closes the plan file with `plan.mjs` (`write`, `live`, `resume`, `close`) |
| `commands/continuous.md` | runs work to its end unattended: one ask, plan, retries failed committers, one report; state in `continuous.mjs` (`init`, `next`, `started`, `abandon`) |

### scripts/ (node and shell, run by hooks, commands and the pre-commit)

| File | Role |
|---|---|
| `scripts/kit.mjs` | dispatcher for `init`, `check`, `sync`, `unattended`, `uninstall`, `inventory`, `migrate`; re-exports what `kit-migrate.mjs` and the tests import |
| `scripts/kit/shared.mjs` | constants and helpers more than one command uses: `kit` (plugin root), `root` (git top of cwd), git and file readers, the shim and `check.sh` texts |
| `scripts/kit/sync.mjs` | `sync`: writes the generated copies in `ai/kit/`; `snapshotWarnings`, their drift check |
| `scripts/kit/check.mjs` | `check`: every warning and problem (`allWarnings`), also run by `init` |
| `scripts/kit/init.mjs` | `init`: `initFiles` wires the project, then sync and check |
| `scripts/kit/uninstall.mjs` | `uninstall [--purge]`: reverses `initFiles` |
| `scripts/kit/unattended.mjs` | `unattended`: rewrites `ai/kit/pre-commit.sh` to `$AI_KIT_RANGE`, writes `requires.txt`, runs sync |
| `scripts/kit/inventory.mjs` | `inventory`: read-only list of what a retrofit starts from |
| `scripts/kit-migrate.mjs` | 1.x repo to plugin |
| `scripts/check-comments.mjs` | comment rule (`docs/code-comments.md`); `--size`: blocks an edit to a code file over 40 KB unless it only moves lines |
| `scripts/check-docs.mjs` | doc rule on added lines (`docs/ai-docs.md`); `--wrap`: the kit clone's 120-character check |
| `scripts/check-specs.mjs` | screen spec links to the API, files, ids, index; warnings only |
| `scripts/usage.mjs` | `record`, `end`, `flush`, `digest`: token records |
| `scripts/lib/usage-collect.mjs` | reads session transcripts into per-agent token totals |
| `scripts/lib/usage-digest.mjs` | per-round record, prices, the fixed-size digest |
| `scripts/decider.mjs` | `sync` (log verdicts), `guard` (for `ask-guard.sh`), `report` |
| `scripts/jobs.mjs` | job listing and revert plan from the `Job:` trailer |
| `scripts/plan.mjs` | plan file `ai/plans/<job>.md`: write, status from commits, resume, close, live |
| `scripts/continuous.mjs` | next step of a continuous run, from its state file |
| `scripts/review-needed.sh` | prints `skip` for a commit with no code line, else `review` |
| `scripts/lib/state-dirs.mjs` | paths of the `claude-review`, `claude-usage`, `claude-decider` state folders; twin of `kit_state_dir` in `hooks/lib.sh`; test `scripts/state-dirs.test.mjs` |
| `scripts/lib/is-main.mjs` | the one "is this the entry script" check, symlink-safe |
| `scripts/lib/` | note: modules with no CLI; every CLI entry point stays in `scripts/` (commands, hooks and project copies name those paths) |
| `scripts/test-all.mjs` | kit clone only: runs every test suite in parallel |
| `scripts/*.test.mjs` | fixture tests, one per module (`handoffs.test.mjs` checks `docs/handoffs.md` against prompts, `spec.test.mjs` this file) |

### workflows/

| File | Role |
|---|---|
| `workflows/run-plan.js` | Workflow script: plan review, a committer per batch, a reviewer per commit with a code line, CONFIRMED fixes, a re-check, one more round |

### docs/ (read by agents on demand)

| File | Role |
|---|---|
| `docs/spec.md` | this file |
| `docs/ai-docs.md` | form of every doc under `ai/`: AI readers only, token-minimal |
| `docs/ai-layout.md` | the `ai/` layout, one template per doc type; §Runs without the plugin |
| `docs/code-comments.md` | the comment rule `check-comments.mjs` enforces |
| `docs/shared-checkout.md` | several sessions on one tree: staging, commit form, `Job:` trailer |
| `docs/plan-batching.md` | planning several items: batches, plan review, plan file, coordinator pipeline |
| `docs/handoffs.md` | what each step hands the next, on every route |
| `docs/owner-kinds.md` | the one list of what only the owner decides |
| `docs/kit-proposals.md` | filing and landing kit proposals |
| `docs/screen-specs.md` | screen and API specs when `ui.platforms` is set |
| `docs/superpowers/` | design specs and plans of the kit's own features |

### conventions/ and templates/

| File | Role |
|---|---|
| `conventions/general.md` | rules for every repo; read by committer and reviewer |
| `conventions/csharp.md`, `dart.md`, `go.md`, `nestjs.md`, `sql.md`, `typeorm.md`, `typescript.md` | per-language rules, applied when named in `config.json` `conventions` |
| `conventions/unattended.md` | rules for a run with no person watching and no plugin |
| `templates/ai-kit-project/` | starter `ai/kit/` files copied by `init` when missing: `config.json`, `pre-commit.sh`, `post-edit.sh`, `review-checklist.md`, `analysis-sources.md` |
| `templates/ai/` | one template per `ai/` doc type, never copied by `init`: `api.md`, `data.md`, `decisions.md`, `feature.md`, `notes.md`, `plan.md`, `requirement.md`, `screen.md` |

### Files the kit creates or edits in a project

The `claude-review`, `claude-usage` and `claude-decider` folders below are resolved by `kit_state_dir` (`hooks/lib.sh`)
and `scripts/lib/state-dirs.mjs`, never by a path built in a caller.

| File | Written by | Read by |
|---|---|---|
| `ai/kit/config.json` | `init` | hooks, checks |
| `ai/kit/pre-commit.sh`, `post-edit.sh` | `init` (template), the project | `githooks/pre-commit`, `post-edit-check.sh` |
| `ai/kit/review-checklist.md` | `init` (template), the project | reviewer, committer, business-analyst |
| `ai/kit/analysis-sources.md` | `init` (template), the project | business-analyst, decider, `kit.mjs` |
| `ai/kit/kit-proposals.md` | a session | `session-start.sh` note, then filed as issues |
| `ai/plans/<job>.md` | `plan.mjs` | `session-start.sh` note, `plan.mjs resume`, `continuous.mjs` |
| `ai/usage/<YYYY-MM>/<session>.jsonl` (`.2`, `.3` on each later flush) | `usage.mjs end` (from `kit-log.sh session-end`) and `usage.mjs flush --idle` (from `session-start.sh`) | `usage.mjs digest` |
| `ai/usage/decisions/<YYYY-MM>/*.jsonl` | `decider.mjs sync` (from `kit-log.sh subagent-stop`) | `/ai-kit:decisions` |
| `.githooks/pre-commit`, `.githooks/commit-msg` | `init` | git |
| `.claude/settings.json` (`autoMemoryEnabled: false`) | `init` | Claude Code, `kit.mjs check` |
| `.gitattributes` (LF rules for the shims and `ai/kit/*.sh`) | `init` | git |
| the pointer line in `CLAUDE.md` | `kit.mjs sync`, `init`, `unattended` | the unattended runner |
| `ai/kit/conventions/`, `checks/`, `check.sh`, `review-prompt.md`, `requires.txt` | `kit.mjs sync` (also run by `init` and `unattended`), only with `unattended: true` | runs without the plugin |
| `<git-common-dir>/ai-kit-root` | `init`, `session-start.sh` | the shims, to find the plugin |
| `<git-common-dir>/claude-usage/<session>.jsonl` | `usage.mjs record` | `usage.mjs end`, `flush` |
| `<git-dir>/claude-usage/<session>.json` | `usage.mjs record` (through `scripts/lib/usage-collect.mjs`) | `usage.mjs` (transcript read cache) |
| `<git-common-dir>/claude-usage/<session>.flushed`, lock files | `usage.mjs` | `usage.mjs` (flush marker, locks) |
| `<git-common-dir>/claude-decider/<session>.json` | `decider.mjs guard` | `decider.mjs guard` (which OWNER verdicts an ask already used) |
| `<git-dir>/claude-review/<session>` | `review-snapshot.sh`, `session-start.sh` (the review snapshot tree) | `review-before-stop.sh` |
| `<git-dir>/claude-review/<session>.reads`, `.handoff` | `handoff-nudge.sh` | `handoff-nudge.sh` (read count, note marks) |
| `<git-dir>/claude-review/continuous-<job>.json` | `continuous.mjs` | `continuous.mjs`, `/ai-kit:continuous` |
| `<git-dir>/claude-review/plan-<job>.args.json` | `plan.mjs resume` | the main session, for the Workflow (`commands/run-plan.md`, `commands/continuous.md`) |
| `<git-dir>/claude-review/continuous-<job>.json.args.json` | `continuous.mjs` | the main session, for the Workflow (`commands/continuous.md`) |

`<git-dir>` is the work tree's own git dir, `<git-common-dir>` the one shared by all worktrees.

## Processes

Each step names the file that does it.

### P1 Session start

1. `session-context.sh` and `session-start.sh` inject `CLAUDE.core.md`.
2. `session-start.sh` adds notes: unfiled proposals, plans not closed (the session goes on only on the user's word),
   auto-memory files, stale unattended copies.
3. `session-start.sh` writes `ai-kit-root`, records the review snapshot, flushes usage buffers idle over 6 hours.

### P2 One task

1. Summary before a UI, DB or business-rule change. A DB or business-rule change runs `business-analyst` first; a
   small job skips both.
2. A question for the owner goes to `decider` first. `ask-guard.sh` blocks AskUserQuestion until it returned OWNER;
   `decider.mjs guard` reads the verdict from the decider's own transcript.
3. A change over `review.skip_lines` code lines, or a new file, or a `review.always` path goes to `committer` batches;
   the main session edits only the rest.
4. Every Edit runs `post-edit-check.sh`. Every Bash line passes `bash-guard.sh`; every subagent launch passes
   `agent-model-guard.sh`; memory writes pass `memory-guard.sh`.
5. `review-snapshot.sh` records the work tree when the main session calls a review. Before the final reply
   `review-before-stop.sh` requires a review by `change-reviewer`, diffing against that snapshot (the one
   `session-start.sh` recorded when none). Findings on code just
   changed are fixed and re-checked once by the same reviewer; the reply then says "Review closed: re-checked once,
   no third pass". A user message "skip review" opts out.
6. The final reply is the numbered report (`CLAUDE.core.md` Delegation and report).
7. `kit-log.sh stop` records the round's tokens; `handoff-nudge.sh` adds notes when context or reads grow.

### P3 Plan of several items

1. The main session lists the items and batches them (`docs/plan-batching.md`) and writes `ai/plans/<job>.md`
   (`plan.mjs write`). A fresh `change-reviewer` reviews the plan before the first commit: `workflows/run-plan.js`
   runs it for two batches or more (skipped for one); the main session runs it when it coordinates itself.
2. Two batches or more: `/ai-kit:run-plan` runs `workflows/run-plan.js`. One batch, or no Workflow tool: the main
   session coordinates by the same rules. `/ai-kit:continuous` runs the same at any size for a user who leaves.
3. Per batch: a `committer` implements, verifies once and commits with the `Job:` and `Batch:` trailers;
   `review-needed.sh` says whether the commit has a code line; a fresh `change-reviewer` reviews it.
4. CONFIRMED findings go to a fix committer, then a narrow re-check; the workflow does one more round for what is left.
5. A batch counts as committed by its `Batch:` trailer (`plan.mjs status`, `resume`). The main session writes the
   one report from the batch reports (`docs/handoffs.md` §Back).

### P4 Commit

1. Stage named files (`bash-guard.sh` blocks a sweeping stage), read `git diff --cached --stat`, `git commit` with
   no paths.
2. `githooks/pre-commit` runs its checks (Files, githooks); a failure blocks with the fix and the bypass line.
3. `githooks/commit-msg` requires one `Job:` trailer.

### P5 Usage records

1. `kit-log.sh stop` runs `usage.mjs record`: it reads the session transcripts
   (`scripts/lib/usage-collect.mjs`) and appends the round's tokens to the buffer in the git common dir.
2. `kit-log.sh session-end` runs `usage.mjs end`: records the rest, writes new files under `ai/usage/`. A crashed
   session's buffer is written by `usage.mjs flush --idle` from `session-start.sh`. The next commit stages them.
3. `usage.mjs digest` (`scripts/lib/usage-digest.mjs`) reads them; `/ai-kit:usage` names the largest driver.

### P6 Decisions

1. `decider` returns DECIDED or OWNER verdict blocks.
2. `kit-log.sh subagent-stop` runs `decider.mjs sync`: it writes finished calls to `ai/usage/decisions/`.
   `/ai-kit:decisions` runs `decider.mjs report`.

### P6b Jobs and memory

1. `/ai-kit:jobs` runs `jobs.mjs`: lists jobs by the `Job:` trailer, or shows one job's commits, files, migrations
   and the revert command.
2. `/ai-kit:memory-export` moves auto-memory files into repo files; `session-start.sh` and `kit.mjs check` point to it.

### P7 Install and lifecycle

1. `/ai-kit:init`: creates missing `ai/kit/` files, writes the two shims, sets `core.hooksPath`, sets
   `autoMemoryEnabled: false` in `.claude/settings.json`, adds the LF rules to `.gitattributes`, then `check`.
2. `kit.mjs check` verifies the wiring; the pre-commit runs it when kit files are staged.
3. `/ai-kit:migrate`: a clean 1.x repo to the plugin. `/ai-kit:uninstall`: reverses `init`; `ai/kit/` stays unless
   `--purge`. `/ai-kit:retrofit`: fills the `ai/` layout.
4. `kit.mjs unattended` turns a repo on (sets `unattended: true`, rewrites `ai/kit/pre-commit.sh`, writes
   `requires.txt`, runs `sync`); `kit.mjs sync` writes the generated copies a run without the plugin reads.

### P8 Editing the kit

1. Cross-repo improvements arrive as `proposal` issues; `/ai-kit:harvest` lands the accepted ones.
2. In the clone `.githooks/pre-commit` runs the wrap check, and the handoff and run-plan tests when a route changes.
   Work on a branch, `node scripts/test-all.mjs`, review, bump `plugin.json`, add a `CHANGELOG.md`
   entry, add the new file to this spec, `git merge --ff-only`, tag `vX.Y.Z`, push `main` with the tag
   (`README.md` §Editing the kit).
