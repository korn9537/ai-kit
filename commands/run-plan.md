---
description: Run a multi-commit plan as a workflow: a committer per batch, one reviewer for the whole job, fixes, one report
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
   - `batches`, in plan order: `{id, title, brief, accept, risks, tests, verify, waitsFor, alsoInScope}`. `brief` is the
     `ai-kit:committer` brief (§Coordinator pipeline): what to change, where (`path:start-end` already found), the
     decisions and requirements it follows. `accept` lists the checks of the summary's Done when that this batch must
     meet, one string each, never empty (`plan.mjs write` refuses a batch with none; no summary was shown → write the
     checks the batch's result must pass); the committer builds to them and the job's one reviewer checks them first.
     `verify` holds the project's verify commands for it, leaving out what CLAUDE.md says the pre-commit runs.
     `risks` and `tests` are set per `plan-batching.md` §Plan review, never empty. `waitsFor` lists the ids it needs.
     `alsoInScope` lists each item the main session added beyond the request.
     Optional `size` (`light`, `normal` or `heavy`; absent is `normal`) is the committer's model and effort, set per
     `plan-batching.md` §Before the first edit.
   - `maxSize`: `light`, `normal` or `heavy`, only when `ai/kit/config.json` `committer.maxSize` is set; no committer
     call runs above it.
3. **Run**: write the args to a temp file and run `node ${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs write <file>` from the
   project root (`plan-batching.md` §Plan file; a refusal names what to fix; a `shared` key in its output lists files
   two briefs name: merge those batches per §Plan file before going on). Then Workflow with `scriptPath`
   `${CLAUDE_PLUGIN_ROOT}/workflows/run-plan.js` and those `args`. While it runs, do not edit the repo; keep answering
   the user. Asked how it is going: run `node ${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs live <Transcript dir from the
   Workflow result>` and answer from its lines (one per batch id, and a `job` line for the review). A batch of `args`
   with no line is not started yet, or skipped because a batch it waits for was not committed in full. Tell the user
   a `⚠` line (an owner decision, a blocker, an agent with no transcript write for 15 minutes) before the run ends;
   the final report still comes from the result.
4. **Report** from its result, one final report (CLAUDE.core.md). First, when every batch has a commit and none would
   go under Open, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs close <job>` and list that commit under Git. A plan
   left open: Open says what §Plan file (Left work) needs, then `/ai-kit:run-plan resume <job>`.
   Each field of the result has one place (CLAUDE.core.md report items; `docs/handoffs.md` §Report):
   - Done: follow-ups among the `notes` (of the batch, and of the job review's `fix` and `fix2`).
   - Checked: the `review` of the result is the one review of the whole job (not per batch; `null` when no batch
     was committed): a skipped review as
     `review skipped, move-only or comment-only`; the CONFIRMED findings fixed and the re-check's findings, `fix2` and
     `recheck2` when a second fix ran; each PLAUSIBLE finding with your judgement (applied → Decided too); verify
     results among the `notes` of the batches; `Review closed: re-checked once, no third pass` only where its
     `review` says re-checked once (plain text).
   - Plan review: each `planReview` finding with the batch it named; a CONFIRMED one the batch did not
     meet (its `unmet`) is Open,
     a PLAUSIBLE one is judged by you (applied → Decided too), under Checked. `not reviewed` → say so under Checked.
   - Git: every commit, fixes included.
   - Decided: each `choices` item (of the batch, and of the job review's `fix` and `fix2`).
   - Open: each `owner` decision, each `blockers` and `unmet` item; each `blocked` or `skipped` batch with its
     `reason`; each `partial` batch with what made it so (`owner`, `blockers`, `unmet`, or a `review` of
     `not reviewed: no agent reported this commit`); the job review when
     `not reviewed` or `not re-checked`, or `partial`; the CONFIRMED findings left: those of the last of `recheck`
     and `recheck2` of the job review, or its `confirmed` where its `review` is `CONFIRMED findings left unfixed`.
   - After the owner answers: §Resume, with the answer in the batch's brief per `plan-batching.md` §Plan file
     (Left work).
5. No Workflow tool, the call is refused, or it fails to start (for example the script cannot be read) → run the plan as
   coordinator per §Coordinator pipeline instead, with no stop to ask: the plan file already holds the batches.

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
4. `committed`: no review is recorded. The job's commits whose review this session did not see get one
   `ai-kit:change-reviewer` over all of them, with the brief the workflow's review gets (`docs/handoffs.md`), from the
   plan file: the request, the batches' ids and titles, their `alsoInScope` items and `accept` as `Done when`, and
   `git diff <first commit>^..<last commit> -- <the files those commits touched> ':(exclude)ai/usage'`, only
   the hunks of this job's commits. Findings as in **Report**.
5. `heldBy`: a left batch and the commits it waits on, whose end is not known. A blocker or owner decision the lost
   run reported is gone with it and a review cannot see one, so a clean review is not enough: show the user these
   batches and go on with them only on their word. A commit that is not clean gets a new batch per
   `plan-batching.md` §Plan file (Left work), and `resume` runs again.
6. `argsFile`: the args of the batches left, committed ids out of `waitsFor`. An owner's answer goes into its brief
   through `write` first, then `resume` again. Pass the file's content to the Workflow of **Run**, with no second
   `write`; add `repo` to it when the repo is not the session's working directory. No `argsFile`: nothing is left, go
   to the close in **Report**.
