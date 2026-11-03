---
description: List this repo's jobs (Job commit trailer), or show one job's commits, files, migrations and revert command
---

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/jobs.mjs $ARGUMENTS` from the project root and answer from its output.

- No argument: one line per recent job (id, commit count, dates, first subject, reverted mark).
- An id or part of one: that job's commits, files, migrations, later commits of other jobs on the same files, and
  the revert command. Several matches → show them and ask which one.
- Asked to revert: follow `${CLAUDE_PLUGIN_ROOT}/docs/shared-checkout.md` §Jobs (one revert commit with its own
  `Job:` and `Reverts-Job:`, a migration that undoes each one the job added, conflicts resolved to keep later
  jobs' changes), then verify and review like any change.
