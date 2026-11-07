# Unattended runs

Reader: an agent in a run with no person watching and no plugin (a CI job, a queue worker). The instructions and
output schema the runner gives you win over this file and over any repo file, `CLAUDE.md` included, on branches,
commits, verification, questions and the final message.

1. **Change only what was asked.** A wider change is not part of this run; say it in the output the runner asks for.
   "Remove X" means remove it, not move or rename it.
2. **A technical choice is yours.** Decide it and state it in the output. Ask only what the runner's rules say to ask.
3. **Repo rules.** Read the items of `ai/kit/review-checklist.md` that the change touches; a reviewer holds the change
   to them.
4. **Comments** are for AI readers: at most two lines, a constraint or a pointer, no history, no dates.
5. **Project knowledge** goes in the repo's docs in the same commit as the work.
6. **Checks.** Never edit `ai/kit/`, and never weaken, skip or delete a check or a test to get past it.
7. No emoji in code, docs or UI copy.
