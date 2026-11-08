# Planning several items

Reader: AI agents. Applies when a request or plan holds more than one item (fixes, features, review findings,
upgrades). Goal: each file is read, verified and reviewed once per batch, not once per item.

## Before the first edit

1. **Inventory** in one pass (greps and reads sent together): each item → the files and functions it touches and the
   shared resources it needs (DB schema or migration, generated code, seed data, ports).
2. **Owner questions**: collect every owner decision (the four kinds) across all items and ask them in one message.
   An item waiting on an answer is skipped until answered, never built and then reverted.
3. **Batch**: items that touch the same file or function form one batch = one commit (one read, one verify, one
   review); the commit message names each item. A separate commit only for: a move-only split, a contract change
   (both sides in it), a migration or data change that may need its own revert.
4. **Order**: a batch waits for another only when it needs that batch's code, schema or output, or shares a file or
   resource with it. Show the plan (batches, their items, what waits for what). An owner decision open → wait
   for the owner's go; none → go on, the user may correct it.
5. **Plan file**: two batches or more, or any run of `/ai-kit:run-plan` or `/ai-kit:continuous` → `plan.mjs write`
   before the first batch (§Plan file). One batch in the main session: none.
6. **Hot files** most items would touch (plan and state docs, decision log, roadmap, changelog, lockfile, generated
   clients): update once per batch, or once at the end of the plan, not once per item.

## Plan file

A plan lives in `ai/plans/<job>.md`, so a lost session loses no batch. `scripts/plan.mjs` owns the file: the batches
sit in it, the status does not. A batch has a commit when a commit of the job carries its `Batch: <id>` trailer, so no
one updates a status and no two sessions edit it. All of it runs from the project root (the repo, when `repo` is set).

- **Write**: the args of `commands/run-plan.md` step 2 go to a temp file, then `plan.mjs write <file>` before the first
  batch. It refuses what would fail later (a wait on a batch planned after it or outside this run, a batch with a commit
  or with no title or brief), or a file that would not come back as the plan or has a line over 120 columns (a job over
  113 characters, a very long key; a line the plan's file already holds is not refused), and commits the plan. Its
  `shared` output lists paths two briefs of batches with no commit name (a path needs a slash and an extension, so a
  root file or an extensionless one is not seen): merge those batches (`write --replace`) unless step 3 allows the
  split or the brief only mentions the file. It also
  refuses while other files are staged: commit those first. Run again on the same job, it adds new batches and updates
  known ones by id. `--replace` also drops the batches with no commit that the args leave out, for a plan renamed or cut
  after a refusal. A text too long for one line is stored as `{ "lines": [...] }`, so the file fits a 120-column doc
  check; `parse` joins it back.
- **Status**: `plan.mjs status [job]`. A new session is told of every plan not closed; it says so to the user and
  goes on only on their word.
- **Resume**: `/ai-kit:run-plan resume [job]` (`commands/run-plan.md` §Resume).
- **Close**: `plan.mjs close <job>` deletes the plan in its own commit, once every batch has a commit and the report
  holds no batch under Open. Other Open items (notes, PLAUSIBLE findings) do not hold a plan open.
- **Left work**: a commit says the batch ran, not that it ended clean. What is left of a `partial` batch goes back in
  as a new batch id through `write`, with what waited for it now waiting for that id. An owner's answer goes into the
  brief of its `blocked` batch through `write`, same id. The owner giving up the rest: `close <job> --drop`.
- A reverted batch still counts as committed: say so under Open and add a new batch id for it.
- `/ai-kit:check` warns of a plan with nothing left. A plan written by hand (`templates/ai/plan.md`) keeps its status
  table and is the author's to update; the script only gives that warning.

## While changing code

- **A bug or calculation fix covers its whole unit**: before committing, check every branch, column and caller of
  that function, query or report against the spec and fix every mismatch in the same commit. Fix one symptom, commit,
  then find the next one in the same unit: that is what this rule stops.
- **A mechanical change over many files** (rename, API migration, library upgrade): use the library's codemod or a
  script, not file-by-file edits. Several upgrades at once: list the breaking changes of all of them first, run each
  codemod (one commit each), then one manual pass per file for what is left of all of them and one typecheck.

## Coordinator pipeline

A plan of two batches or more runs as the run-plan workflow (`/ai-kit:run-plan`, `workflows/run-plan.js`): a
script applies the rules below, so no batch report enters the main session's context, no agent's end wakes it (each
wake re-reads that context) and the plan runs to its end in one go, with no context limit to hand over at. The main
session plans, passes the batches as args, answers the user while it runs and writes the one report. One batch, no
Workflow tool, or the call refused: the main session is the coordinator and applies these rules itself, its context
kept small. The user naming a runner wins. `/ai-kit:continuous` runs the same workflow at any batch count for a user
who leaves: it tries failed committers again and writes the one report when nothing is left to run.

- Each batch goes to a fresh background `ai-kit:committer` subagent (description `commit: <batch>`) that
  implements, verifies and commits it. It starts at about 9k tokens of context against about 32k for
  `general-purpose`, and its own prompt carries the commit-subagent rules, read and verify-output discipline and
  report shape, so the brief holds only the batch. When that type is not loaded (plugin enabled mid-session), launch
  `general-purpose` (`model: "sonnet"`, `effort: "medium"`) with the same description, told first to read and
  follow `<plugin root>/agents/committer.md`.
- A batch is one commit. A sweep over many modules (one rule fixed everywhere, a lint backlog) is one batch per
  module or per about ten files, never one subagent for the whole sweep: its context grows with every file read.
- The Agent call passes no model or effort (the committer runs sonnet, medium effort from its frontmatter).
- The brief: the batch (what to change, where, the decisions and requirements it follows), its Done when checks
  (the summary's checks this batch must meet), its verify commands (not
  what CLAUDE.md says the pre-commit runs),
  the request's job id (`shared-checkout.md` §Jobs; one for the whole plan), the batch id for its `Batch: <id>`
  trailer (§Plan file; a fix commit has none) and anything the coordinator already found (`path:start-end`), so
  the subagent does not search for it again.
- It returns only hash, files, choices it made and open items. An owner decision it hits comes back unanswered for
  the main session to ask.
- One commit subagent edits the repo at a time. The main session keeps talking with the user but does not edit the
  repo while one runs.
- When it returns, send in one message: that commit's background reviewer and, unless the next batch waits on this
  one, the next batch's commit subagent. A commit that changes no code line (only moved blocks, comments, docs or
  `ai/usage`) gets no reviewer (`scripts/review-needed.sh <hash>` prints `skip` for it, as the run-plan
  workflow calls it). Reviewer brief: read
  `git show <hash> -- . ':(exclude)ai/usage'`, not the work tree; pass the batch's Done when checks; name each item
  the main session added beyond the user's request, `also in scope: <item> (coordinator)`.
- CONFIRMED fixes for a reviewed commit go back to that commit's subagent by SendMessage (it holds the context;
  summary `commit: fix <batch>`; "review" appears nowhere in the summary, <batch> included) once no commit subagent
  runs, then the one re-check. The workflow cannot message an agent again: a fresh committer gets the commit and
  its findings and makes a fix commit (`feat(x): y` → `fix(x): y`, `T-12a: y` → `T-12a: fix y`, an untyped
  title → `fix: <batch>`); a fresh reviewer re-checks the fix commit only, or reviews both commits whole, with
  the batch's Done when checks, when a finding was about data or rule correctness. The fix brief carries those checks
  too. In the workflow, CONFIRMED findings that re-check leaves get one more
  fix and re-check, unless an owner decision is open; what is left then goes under Open.
- The coordinator reads only what it needs to route a batch: `grep -n` and line ranges in a large doc
  (`ai/decisions.md`), never the whole file, and no code beyond what a brief must point at; the subagents read the
  code. Its context is re-read on every batch's notification, so all it reads is paid once per batch after it.
  A browser check or a broad search goes to a subagent, as in any session (CLAUDE.core.md, heavy reads).
- Main session as coordinator only: past `handoff.max_context` (default 150k) it launches no new batch;
  `handoff-nudge.sh` notes it on the next Agent or SendMessage call. The running batches finish, with their
  reviews, fixes and re-checks, and the final report's "Next session" item holds the batches left so the plan
  continues in a fresh session. This is the one stop the next bullet allows besides an owner decision or a blocker.
  The limit stops new plan batches; the one item the user just asked for still goes to one committer. The prompt
  names the job: the plan file holds the batches left.
- The plan waits for the owner's go only when an owner decision is open; otherwise show the plan and go on. Every
  planned commit then runs to the end in one run with one report: never stop between commits to ask whether to
  continue; stop early only for an owner decision, a blocker or the context limit above.
- After the last batch, before the final report: close the plan per §Plan file and name that commit under Git.
- Exception: commits that share too much context to hand over (one large refactor) → say so and run in the main
  session.
