# Shared checkout (git)

Reader: AI agents. Several sessions may share one working tree and one index. Which branch to commit on, and what a
push triggers, is in the project's CLAUDE.md (branch and deploy).

- Never switch branch; push only when asked.
- Split work into self-contained commits, one per batch of items that touch the same code, not one per item
  (`plan-batching.md`), and commit each as soon as its verification passes (verify once per commit), above all a
  contract change whose consumers break until both sides land.
- Stage named files only: never `git add -A`, `.`, a directory or a glob, never `git commit -a`
  (the ai-kit plugin's `hooks/bash-guard.sh` blocks them, also after `cd`, `git -C`, `&` or as `git stage`;
  quoted text and heredoc bodies are not read, unless the scan cannot follow them, as in a heredoc that may expand).
  Before `git add <file>` read `git diff <file>` for hunks that are not yours; before committing read
  `git diff --cached --stat`. Then `git commit` with no paths: `git commit -- <path>` commits the whole working-tree
  file, other hunks included, and leaves the token records behind.
- A partially staged file is safe: the ai-kit pre-commit formats only its staged blob and leaves the other hunks
  unstaged. To stage only your hunks of a file holding someone else's: `git apply --cached` of your hunks, or write
  your version's blob (`git hash-object -w` + `git update-index --cacheinfo`); confirm HEAD builds in a worktree.
- A generator that reads the whole tree (codegen, spec export) may pick up another session's work. If it does,
  commit its output through the blob procedure above.
- Every commit carries one job trailer (§Jobs).
- Work that changed or vanished unasked: suspect another session (`git log`, `git reflog`,
  `git log -S"<text>" --all`) before restoring anything. Revert only your own hunks, never `git checkout --` or
  `git restore` a whole file.

## Jobs

A job is one user request, however many batches and commits it takes. Every commit carries one trailer
`Job: <yyyy-mm-dd>-<slug>`, so a later session finds the whole job without guessing from subjects. The plugin's
`githooks/commit-msg`, run by the project's `.githooks/commit-msg` shim (`kit.mjs init` writes it), blocks a commit
without exactly one valid trailer; merges and `fixup!`/`squash!`/`amend!` commits pass. The shim skips the check
until a session or `init` has recorded the plugin path (a fresh clone, an old plugin version).

- The main session picks the id once, at the first commit of the request: that day's date and a 2–5 word slug
  naming the request (`2026-01-05-invoice-export`). It names the job in every committer brief (run-plan: the `job`
  arg). A fix brief that names the commit it fixes takes that commit's job; a committer whose brief names neither
  a job nor a commit it fixes stops and reports it, and never invents one. A session continuing a handed-off
  request reuses the id from the handoff prompt, or from the request's last commit
  (`git log -1 --format='%(trailers:key=Job,valueonly)' <hash>`); the "Next session" prompt names it.
- Same job: every batch of the request, its review-fix commits (copy the job of the commit being fixed:
  `git log -1 --format='%(trailers:key=Job,valueonly)' <hash>`), and output it regenerates. New job: a follow-up
  outside the request, and a later request on the same feature.
- Trailers go last, in one block: `Job: ...` on its own line, before `Co-Authored-By`.
- Find: `/ai-kit:jobs` lists jobs; `/ai-kit:jobs <id or part of it>` prints the job's commits, files, migrations
  (a default path heuristic, or `ai/kit/config.json` `jobs.migrations`, a regex on the path), later commits of
  other jobs on the same files, and the revert command. A job already reverted, in full or in part, is marked.
- Revert the whole job as one commit (`git revert --no-commit <hashes, newest first>`, then `git commit`) with its
  own `Job:` and a `Reverts-Job: <id>` trailer; never reset or force-push a shared branch. A plain `git revert` or
  `cherry-pick` (no `--no-commit`, or `--no-edit`) commits without the hook, so its commit carries no job. A
  migration the job added stays applied in each database: add one that undoes it in the revert job. Later commits
  of other jobs on the same files: resolve each conflict to keep their change.
- Commits older than the rule carry no job (`/ai-kit:jobs` skips them): find them with `git log --grep`,
  `git log -- <path>` and a date range.
