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
5. **Hot files** most items would touch (plan and state docs, decision log, roadmap, changelog, lockfile, generated
   clients): update once per batch, or once at the end of the plan, not once per item.

## While changing code

- **A bug or calculation fix covers its whole unit**: before committing, check every branch, column and caller of
  that function, query or report against the spec and fix every mismatch in the same commit. Fix one symptom, commit,
  then find the next one in the same unit: that is what this rule stops.
- **A mechanical change over many files** (rename, API migration, library upgrade): use the library's codemod or a
  script, not file-by-file edits. Several upgrades at once: list the breaking changes of all of them first, run each
  codemod (one commit each), then one manual pass per file for what is left of all of them and one typecheck.

## Coordinator pipeline

A multi-commit plan runs from the main session as coordinator, so its context stays small.

- Each batch goes to a fresh background `ai-kit:committer` subagent (description `commit: <batch>`) that
  implements, verifies and commits it. It starts at about 9k tokens of context against about 32k for
  `general-purpose`, and its own prompt carries the commit-subagent rules, read and verify-output discipline and
  report shape, so the brief holds only the batch. When that type is not loaded (plugin enabled mid-session), launch
  `general-purpose` with the same description, told first to read and follow `<plugin root>/agents/committer.md`.
- A batch is one commit. A sweep over many modules (one rule fixed everywhere, a lint backlog) is one batch per
  module or per about ten files, never one subagent for the whole sweep: its context grows with every file read.
- The Agent call passes no model or effort (the agent runs on sonnet); `model: "opus"` and `effort: "high"` when the
  batch touches a DB schema or migration, a calculation, a permission or a decision recorded as final (the
  reviewer and BA rule).
- The brief: the batch (what to change, where, the decisions and requirements it follows), its verify commands and
  anything the coordinator already found (paths, line numbers), so the subagent does not search for it again.
- It returns only hash, files, choices it made and open items. An owner decision it hits comes back unanswered for
  the main session to ask.
- One commit subagent edits the repo at a time. The main session keeps talking with the user but does not edit the
  repo while one runs.
- When it returns, send in one message: that commit's background reviewer and, unless the next batch waits on this
  one, the next batch's commit subagent. A commit that changes no code line (only moved blocks, comments, docs or
  `ai/usage`) gets no reviewer; `review-skip-guard.sh` blocks such a launch. Reviewer brief: read
  `git show <hash> -- . ':(exclude)ai/usage'`, not the work tree; name each item the main session added beyond the
  user's request, `also in scope: <item> (coordinator)`.
- CONFIRMED fixes for a reviewed commit go back to that commit's subagent by SendMessage (it holds the context;
  summary `commit: fix <batch>`; "review" appears nowhere in the summary, <batch> included) once no commit subagent
  runs, then the one re-check.
- The coordinator reads only what it needs to route a batch: `grep -n` and line ranges in a large doc
  (`ai/decisions.md`), never the whole file, and no code beyond what a brief must point at; the subagents read the
  code. Its context is re-read on every batch's notification, so all it reads is paid once per batch after it.
- Past `handoff.max_context` (default 150k) the coordinator launches no new batch: `handoff-nudge.sh` notes it on
  the next Agent or SendMessage call; the running batches finish, with their reviews, fixes and re-checks, and the
  final report's "Next session"
  item holds the batches left so the plan continues in a fresh session. This is the one stop the next bullet allows
  besides an owner decision or a blocker.
- The plan waits for the owner's go only when an owner decision is open; otherwise show the plan and go on. Every
  planned commit then runs to the end in one run with one report: never stop between commits to ask whether to
  continue; stop early only for an owner decision, a blocker or the context limit above.
- Exception: commits that share too much context to hand over (one large refactor) → say so and run in the main
  session.
