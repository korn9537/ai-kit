---
description: Run a multi-commit plan as a workflow: a committer per batch, a reviewer per commit, fixes, one report
---

Run the plan through the Workflow tool, so the main session's context does not grow with each batch. Invoking this
command is the user's opt-in to that workflow.

$ARGUMENTS starting with `resume`: follow §Resume instead of steps 1 and 2.

1. **Plan** per `${CLAUDE_PLUGIN_ROOT}/docs/plan-batching.md` §Before the first edit, for $ARGUMENTS or the plan
   already agreed in this session. An owner decision open → ask, all in one message, and wait for the answers.
2. **Args**: one JSON value, not a string:
   - `request`: the user's request in their words.
   - `plugin`: `${CLAUDE_PLUGIN_ROOT}`.
   - `job`: the request's job id, one for the whole plan (`${CLAUDE_PLUGIN_ROOT}/docs/shared-checkout.md` §Jobs).
   - `repo`: only when the repo is not the session's working directory.
   - `batches`, in plan order: `{id, title, brief, verify, waitsFor, alsoInScope}`. `brief` is the
     `ai-kit:committer` brief (§Coordinator pipeline): what to change, where (`path:start-end` already found), the
     decisions and requirements it follows. `verify` holds the project's verify commands for it, leaving out what
     CLAUDE.md says the pre-commit runs. `waitsFor` lists
     the ids it needs. `alsoInScope` lists each item the main session added beyond the request.
3. **Run**: write the args to a temp file and run `node ${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs write <file>` from the
   project root (`plan-batching.md` §Plan file; a refusal names what to fix; a `shared` key in its output lists files
   two briefs name: merge those batches per §Plan file before going on). Then Workflow with `scriptPath`
   `${CLAUDE_PLUGIN_ROOT}/workflows/run-plan.js` and those `args`. While it runs, do not edit the repo; keep answering
   the user. Asked how it is going: run `node ${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs live <Transcript dir from
   the Workflow result>` and answer from its lines (one per batch id). A batch of `args` with no line is not started
   yet, or skipped because a batch it waits for was not committed in full. Tell the user a `⚠` line (an owner
   decision, a blocker, an agent with no transcript write for 15 minutes) before the run ends; the final report still
   comes from the result.
4. **Report** from its result, one final report (CLAUDE.core.md). First, when every batch has a commit and none would
   go under Open, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs close <job>` and list that commit under Git. A plan
   left open: Open says what §Plan file (Left work) needs, then `/ai-kit:run-plan resume <job>`.
   - Checked, per batch: a skipped review as `review skipped, move-only or comment-only`; the CONFIRMED findings
     fixed and the re-check's findings, `fix2` and `recheck2` when a second fix ran;
     `Review closed: re-checked once, no third pass` only where `review` says
     re-checked once (plain text).
   - Git: every commit, fixes included.
   - Open: each `owner` decision, each `blockers` and `notes` item, each `blocked`, `partial` or `skipped` batch
     with its reason, each commit `not reviewed` or `not re-checked`, re-check findings left, each PLAUSIBLE
     finding. `waitsFor` sees the commit, not its review: name each batch that ran on one its review left
     `partial`.
   - After the owner answers: run this command again with the batches left, each id with status `committed` out of
     their `waitsFor` (the workflow counts an id outside this run as not committed); a `partial` one per
     `plan-batching.md` §Plan file (Left work).
5. No Workflow tool, or the call is refused → run the plan as coordinator per §Coordinator pipeline instead.

## Resume

Goes on with a plan a lost or finished session left. From the project root run
`node ${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs resume [job]` (the job after `resume` in $ARGUMENTS; with none, the one
plan with batches left), then clear what it prints, in this order:

1. `continuousRunning` true, or another session may still run the plan → ask the user first: a second run commits
   every batch twice. Their word that it is over, on a continuous run: TaskStop its workflow if it lives in this
   session, then `node ${CLAUDE_PLUGIN_ROOT}/scripts/continuous.mjs abandon <continuousState>`.
2. `dirty`: edits in the tree, perhaps a dead committer's. Show them and wait: a committer would commit them with its
   batch.
3. `loose`: commits of the job with no `Batch` trailer. Review fixes are normal here; one that holds a batch's work
   means that batch would run twice, so read them against `left`.
4. `committed`: no review is recorded. A batch whose review this session did not see gets one `ai-kit:change-reviewer`
   on `git show <hash>`, findings as in **Report**.
5. `heldBy`: a left batch and the commits it waits on, whose end is not known. A blocker or owner decision the lost
   run reported is gone with it and a review cannot see one, so a clean review is not enough: show the user these
   batches and go on with them only on their word. A commit that is not clean gets a new batch per
   `plan-batching.md` §Plan file (Left work), and `resume` runs again.
6. `argsFile`: the args of the batches left, committed ids out of `waitsFor`. An owner's answer goes into its brief
   through `write` first, then `resume` again. Pass the file's content to the Workflow of **Run**, with no second
   `write`; add `repo` to it when the repo is not the session's working directory. No `argsFile`: nothing is left, go
   to the close in **Report**.
