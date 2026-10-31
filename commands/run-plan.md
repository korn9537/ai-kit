---
description: Run a multi-commit plan as a workflow: a committer per batch, a reviewer per commit, fixes, one report
---

Run the plan through the Workflow tool, so the main session's context does not grow with each batch. Invoking this
command is the user's opt-in to that workflow.

1. **Plan** per `${CLAUDE_PLUGIN_ROOT}/docs/plan-batching.md` §Before the first edit, for $ARGUMENTS or the plan
   already agreed in this session. An owner decision open → ask, all in one message, and wait for the answers.
2. **Args**: one JSON value, not a string:
   - `request`: the user's request in their words.
   - `plugin`: `${CLAUDE_PLUGIN_ROOT}`.
   - `repo`: only when the repo is not the session's working directory.
   - `batches`, in plan order: `{id, title, brief, verify, waitsFor, heavy, alsoInScope}`. `brief` is the
     `ai-kit:committer` brief (§Coordinator pipeline): what to change, where (paths and lines already found), the
     decisions and requirements it follows. `verify` holds the project's verify commands for it. `waitsFor` lists
     the ids it needs. `heavy: true` when it touches a DB schema or migration, a calculation, a permission or a
     decision recorded as final. `alsoInScope` lists each item the main session added beyond the request.
3. **Run**: Workflow with `scriptPath` `${CLAUDE_PLUGIN_ROOT}/workflows/run-plan.js` and those `args`. While it
   runs, do not edit the repo; keep answering the user. Its progress is in the workflow view and in `git log`; the
   main session sees nothing of it until it ends, so say so when asked.
4. **Report** from its result, one final report (CLAUDE.core.md):
   - Checked, per batch: a skipped review as `review skipped, move-only or comment-only`; the CONFIRMED findings
     fixed and the re-check's findings; `Review closed: re-checked once, no third pass` only where `review` says
     re-checked once (plain text).
   - Git: every commit, fixes included.
   - Open: each `owner` decision, each `blockers` and `notes` item, each `blocked`, `partial` or `skipped` batch
     with its reason, each commit `not reviewed` or `not re-checked`, re-check findings left, each PLAUSIBLE
     finding. `waitsFor` sees the commit, not its review: name each batch that ran on one its review left
     `partial`.
   - After the owner answers: run this command again with the batches left.
5. No Workflow tool, or the call is refused → run the plan as coordinator per §Coordinator pipeline instead.
