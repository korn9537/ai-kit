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
   resource with it. Show the plan (batches, their items, what waits for what), then go on; the user may correct it.
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

- One commit subagent edits the repo at a time. When it returns, send in one message: its commit's background
  reviewer (brief: read `git show <hash>`, not the work tree) and, unless the next batch waits on this one, the next
  batch's commit subagent.
- CONFIRMED fixes for a reviewed commit go to a `commit: fix <batch>` subagent once no commit subagent runs, then the
  one re-check.
