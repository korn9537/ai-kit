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

- Each batch goes to a fresh background subagent (`general-purpose`, description `commit: <batch>`) that implements,
  verifies and commits it.
- Its brief says it is a commit subagent, must not launch a reviewer, and first reads the "Working conventions" of
  the plugin's `CLAUDE.core.md` (give its absolute path; a subagent does not get that text injected).
- It returns only hash, files, choices it made and open items (report items 6 and 7 only). An owner decision it hits
  comes back unanswered for the main session to ask.
- One commit subagent edits the repo at a time. The main session keeps talking with the user but does not edit the
  repo while one runs.
- When it returns, send in one message: that commit's background reviewer and, unless the next batch waits on this
  one, the next batch's commit subagent. Reviewer brief: read `git show <hash>`, not the work tree; name each item
  the main session added beyond the user's request, `also in scope: <item> (coordinator)`.
- CONFIRMED fixes for a reviewed commit go back to that commit's subagent by SendMessage (it holds the context;
  summary `commit: fix <batch>`; "review" appears nowhere in the summary, <batch> included) once no commit subagent
  runs, then the one re-check.
- The plan waits for the owner's go only when an owner decision is open; otherwise show the plan and go on. Every
  planned commit then runs to the end in one run with one report: never stop between commits to ask whether to
  continue; stop early only for an owner decision or a blocker.
- Exception: commits that share too much context to hand over (one large refactor) → say so and run in the main
  session.
