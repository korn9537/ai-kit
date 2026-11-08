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
| main → plan file | per batch `id, title, brief, accept, verify, waitsFor, alsoInScope` (`commands/run-plan.md` Args) |

`accept` is the summary's Done when checks for that batch. `plan.mjs write` and `continuous.mjs init` check a batch
with one function (`checkBatch`); `resumeArgs` and `continuous next` keep every field.

## Per batch

| To | Carries | Routes |
|---|---|---|
| committer | brief, Done when, verify, Job and Batch trailers, later batches | workflow `commitPrompt`; coordinator brief (`plan-batching.md`) |
| first reviewer | request, batch id and title, also in scope, Done when, `git show <hash> -- . ':(exclude)ai/usage'` | workflow `reviewPrompt`; coordinator; resume step 4 (`run-plan.md`); Stop hook (request, Done when, diff) |
| fix committer | the CONFIRMED findings, brief, Done when, later batches, verify, Job trailer (no Batch) | workflow `fixPrompt`; coordinator: SendMessage to the batch's own committer, which holds the brief |
| fresh re-check | request, also in scope, Done when, both commits whole, the first findings | workflow `recheckPrompt` fresh; coordinator |
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

## Report

Open holds only owner decisions and blocked work (CLAUDE.core.md report item 7): `owner`, `blockers`, `unmet`;
`blocked`, `skipped` and `partial` batches with why; a commit not reviewed or not re-checked; CONFIRMED findings
left (`recheck`, `recheck2`, or `confirmed` when the fix agent made no commit).
