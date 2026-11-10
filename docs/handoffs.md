# Handoffs

What each step hands the next, on every route. A route that sends less than its row is a bug;
`scripts/handoffs.test.mjs` checks the workflow prompts and the docs of the other routes against this file. Change a
row here and its test together.

## Before the work

| From → to | Carries |
|---|---|
| user → main | the request in their words |
| main → `business-analyst` | the request, what is known |
| BA → main | 8 sections (`agents/business-analyst.md`); 7 Done when, 8 Owner decisions with sources |
| main → user | the summary, item 6 Done when (CLAUDE.core.md, Summarize) |
| main → `decider` | the question, options, request, what is known; when BA ran, its Owner decisions item with sources |
| main → plan file | per batch `id, title, brief, accept, risks, tests, verify, waitsFor, alsoInScope` (`commands/run-plan.md` Args) |
| plan → plan reviewer | the request, per batch id, title, brief, Done when, risks, tests, also in scope, waits for (`plan-batching.md` §Plan review) |
| plan reviewer → committer | findings per batch id, in that batch's brief; CONFIRMED is part of the batch, PLAUSIBLE judged into `choices` |

`accept` is the summary's Done when checks for that batch; `risks` and `tests` are the plan's failure modes and the
tests that answer them. `plan.mjs write` and `continuous.mjs init` check a batch
with one function (`checkBatch`); `resumeArgs` and `continuous next` keep every field.

## Per batch

| To | Carries | Routes |
|---|---|---|
| committer | brief, Done when, risks, tests, plan review findings, verify, Job and Batch trailers, later batches | workflow `commitPrompt`; coordinator brief (`plan-batching.md`) |
| job reviewer | request, batch ids and titles, also in scope, Done when, tests and CONFIRMED plan findings owed, `git diff <first>^..<last> -- <job files> ':(exclude)ai/usage'`, this job's commits only | workflow `reviewPrompt`; coordinator; resume step 4 (`run-plan.md`); Stop hook (request, Done when, diff) |
| fix committer | the CONFIRMED findings, every batch's brief, Done when, risks, tests, plan findings, verify, Job trailer (no Batch) | workflow `fixPrompt`; coordinator: SendMessage to the batch's own committer, which holds the brief |
| fresh re-check | request, also in scope, Done when, the whole job range, the first findings | workflow `recheckPrompt` fresh; coordinator |
| narrow re-check | the fix commit, the findings, Done when | workflow `recheckPrompt`; coordinator (same reviewer by SendMessage) |

What each reads on its own: the committer reads the rules the reviewer checks (checklist, conventions the batch
touches) once; a fix committer and a narrow re-check read only the rule a finding names.

## Back

| From | Field | Effect |
|---|---|---|
| committer | `owner`, `blockers`, `unmet` | batch `partial`; a batch that waits on it does not start |
| committer | `choices` | report Decided |
| committer | `notes` | report Done (follow-ups) or Checked (verify results) |
| reviewer | CONFIRMED | fix round; left after the last re-check → Open |
| reviewer | PLAUSIBLE | main judges: applied → Decided, else Checked |
| plan reviewer | CONFIRMED | in the briefs of the batches it names; not met → the committer's `unmet`, batch `partial` |
| plan reviewer | PLAUSIBLE | the committer judges it into `choices`; main reports it under Checked |

## Report

Open holds only owner decisions and blocked work (CLAUDE.core.md report item 7): `owner`, `blockers`, `unmet`;
`blocked`, `skipped` and `partial` batches with why; the job review not done or not re-checked; CONFIRMED findings
left (`recheck`, `recheck2`, or `confirmed` when the fix agent made no commit); a CONFIRMED plan review finding a batch
did not meet (its `unmet`).
