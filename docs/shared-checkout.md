# Shared checkout (git)

Reader: AI agents. Several sessions may share one working tree and one index. Which branch to commit on, and what a
push triggers, is in the project's CLAUDE.md (branch and deploy).

- Never switch branch; push only when asked.
- Split work into self-contained commits, one per batch of items that touch the same code, not one per item
  (`plan-batching.md`), and commit each as soon as its verification passes (verify once per commit), above all a
  contract change whose consumers break until both sides land.
- Stage named files only: never `git add -A`, `.`, a directory or a glob, never `git commit -a`
  (the ai-kit plugin's `hooks/git-add-all-guard.sh` blocks them, also on a heredoc line that starts with such a command).
  Before `git add <file>` read `git diff <file>` for hunks that are not yours; before committing read
  `git diff --cached --stat`. Then `git commit` with no paths: `git commit -- <path>` commits the whole working-tree
  file, other hunks included, and leaves the token records behind.
- A partially staged file is safe: the ai-kit pre-commit formats only its staged blob and leaves the other hunks
  unstaged. To stage only your hunks of a file holding someone else's: `git apply --cached` of your hunks, or write
  your version's blob (`git hash-object -w` + `git update-index --cacheinfo`); confirm HEAD builds in a worktree.
- A generator that reads the whole tree (codegen, spec export) may pick up another session's work. If it does,
  commit its output through the blob procedure above.
- Work that changed or vanished unasked: suspect another session (`git log`, `git reflog`,
  `git log -S"<text>" --all`) before restoring anything. Revert only your own hunks, never `git checkout --` or
  `git restore` a whole file.
