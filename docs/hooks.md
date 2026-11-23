# ai-kit hooks

Reader: a person installing the kit, or an agent asked what a hook does. Which hooks run, on which event, and what
each one blocks, passes or notes. The wiring is `hooks/hooks.json`; each script carries the detail in its header;
`docs/spec.md` is the file map. Config keys named here live in the project's `ai/kit/config.json` (`README.md`
§Project settings).

Hooks (each exits silently when the project has no `ai/kit/`):

- `session-context.sh` and `session-start.sh` (SessionStart) each inject one half of `CLAUDE.core.md`, split at its
  Delegation and report heading, with paths pointing into the plugin: Claude Code replaces a string over 10,000
  characters with a 2,000-character preview. `session-start.sh` also writes
  the plugin path to `<git-common-dir>/ai-kit-root` for the pre-commit shim, records a new session's work tree as
  its review snapshot (`review-snapshot.sh --tree`), and asks for
  `/ai-kit:memory-export` while the repo's auto-memory dir holds files.
- `review-before-stop.sh` (Stop) blocks the final reply until `ai-kit:change-reviewer` has reviewed code edited
  since the last review. A review is an Agent call of that type (or a general-purpose one with "review" in its
  description, the fallback). `review-snapshot.sh` (PostToolUse on Agent, Task and SendMessage) records what was
  reviewed. Before the first
  review a small change passes without one: at most `review.skip_lines` changed code lines, no new file, no path
  matching `review.always` (such a path is reviewed regardless of size). A change of only `//` comments, one-line block
  comments or blank lines since the last review (or since the session began when none) passes too; a tool directive
  (`// @ts-ignore`, `// eslint-...`, `//go:build`, `//nolint`) is code. A Bash command counts as an edit when one of
  its simple commands (`kit_split_cmd`, the splitter `bash-guard.sh` uses) writes into the repo: a redirect, `tee`,
  `mv`, `cp` or `rm` target there or in a `code_dirs` folder, a relative one while the command's cwd is in the repo,
  `sed`/`perl -i`, or a formatter, fixer, codemod or patch. Text inside quotes (a commit message, a jq pattern) and
  writes naming only `.md` files do not count; a command the splitter cannot follow falls back to a raw-text match
  that errs toward counting. Edits by a finished
  commit subagent count too; one still running is skipped. Also counted as a review: a user message starting with
  "skip review" or "ไม่ต้อง review" after the last edit (earlier edits included), and, right after a re-check, a
  main-session reply with `Review closed: re-checked once` (not quoted). A block moved to another file counts as no
  change (`git diff --color-moved`, re-indenting allowed); a reorder or re-indent within one file still counts.
- `agent-model-guard.sh` (PreToolUse on Agent and Task) blocks a general-purpose subagent (type `general-purpose`,
  `claude` or none) or an `Explore` launched without a `model`, which would inherit the main session's opus; pass
  `sonnet`, except a fallback for a kit agent, which passes that agent's frontmatter model and effort (`opus` medium
  for the reviewer, business-analyst and decider, `sonnet` medium for the committer at size `normal`; `sonnet` low
  for `light`, `opus` high for `heavy`).
- `handoff-nudge.sh` (UserPromptSubmit) adds a note once the context passes `handoff.max_context` tokens: a "Next
  session" prompt when the task ends. From `handoff.fresh_after` (100000; 0 is off) tokens further on, once that note
  was given, a new prompt gets a note to open the reply by offering a fresh session or `/compact`. It never blocks and
  never stops a plan. PostToolUse on Bash, Read, Grep and Glob: every `handoff.max_reads` (4; 0 is off) reads or
  searches since the last prompt, once the context passes `handoff.reads_from` (0) tokens, a note to send the search
  to a subagent. A subagent's reads and Bash lines that do not start as a read do not count. A `Read` with no range or
  a plain `cat` of a code file of `handoff.big_read` (300; 0 is off) lines or more: a note to read a line range, once
  per prompt in the main session and once per subagent.
- `post-edit-check.sh` (PostToolUse on Edit/Write/MultiEdit/Bash) runs the comment and doc checks whose scope holds
  the file and the checks of `ai/kit/post-edit.sh`, all in parallel, and reports the failures in start order. In a
  Node project without `node_modules` (a fresh worktree) only the project's checks are skipped. It also runs after a
  Bash call (PostToolUse and PostToolUseFailure): a PreToolUse run of the same script touches a marker in the git
  dir's `claude-review/`, and the files `git status` lists as changed, added or untracked with a newer mtime (at most
  20, none under `ai/usage`) are checked and reported as changed during that call. Not checked after a call that ran
  in the background (the hook fires at launch, before the command writes) or that starts with a git command rewriting
  the work tree (checkout, switch, stash, pull, merge, rebase, reset, restore, cherry-pick, revert).
- `kit-log.sh stop` (Stop) appends each round's token use to a buffer in the git common dir
  (`<git-common-dir>/claude-usage/<session>.jsonl`, shared by all branches and worktrees) and shows a one-line
  summary to the user only; nothing under `ai/` changes during the session; it never blocks (the buffer
  lock is waited for at most 1.5 s, then the record is skipped with one stderr line).
- `kit-log.sh session-end` (SessionEnd) first records what came after the last Stop, then starts a detached
  `usage.mjs send`, which posts the session's call-level events to the usage server (`usage.endpoint`, default
  `https://ai-kit-usage.maybix.com`; the transcripts are the source, the server upserts, so a resumed session or a
  second send adds nothing twice). `session-start.sh` does the same for other sessions idle over 6 hours (a crashed
  session or a failed send): it only starts the detached send, which waits at most 1.5 s for the buffer lock to take
  the refusal buffer and otherwise leaves it for the next send; a send's errors go to
  `<git-common-dir>/claude-usage/send.log`. Nothing is written under `ai/usage/` and no commit carries usage.
- `ask-guard.sh` (PreToolUse on AskUserQuestion) blocks a question to the owner until an `ai-kit:decider` call of
  the session returned OWNER for it in the last 30 minutes. Each asked question (`question` and `header`) is matched
  to a verdict block's `Question:` line by word overlap (stop words dropped; Thai and other unspaced scripts compared
  by character bigrams; at least half of the shorter side shared). A block serves one question once (the used blocks,
  `<call id>#<index>`, are kept in `<git-common-dir>/claude-decider/<session>.json` under a lock; an older
  `{used:[ids]}` file still spends whole calls). A question matching a DECIDED block → the block quotes the
  decider's Choice to act on; matching no block → says which question has no verdict, to ask the decider about it;
  the newest call with no verdict lines yet → to wait. The verdict is read from the decider's own subagent transcript
  (`<session>/subagents/agent-<id>.jsonl`), so a background call works as a foreground one. A general-purpose call
  whose description names the decider counts too (the type not loaded). Off with `decider.enabled: false`; a
  question matching `decider.always_owner` goes through, and so does every ask when node is missing or the guard
  errs.
- `kit-log.sh subagent-stop` (SubagentStop, Stop) logs each finished decider call's verdict blocks once, in
  `<git-common-dir>/claude-decider/log/<session>.<agent id>.jsonl` until `usage.mjs send` posts it to the usage
  server, on SubagentStop from the hook's `last_assistant_message`; a call still running is not logged.
  `/ai-kit:decisions` prints the server's log of this project plus the files not sent yet as a report.
- `memory-guard.sh` (PreToolUse on Write/Edit/MultiEdit/NotebookEdit) blocks writes into
  `~/.claude/projects/*/memory/` (or under `CLAUDE_CONFIG_DIR`) and names the repo file to use instead. Bash writes into
  that dir are blocked by `bash-guard.sh`; `init` also sets `autoMemoryEnabled` false (`kit.mjs check` verifies it).
- `bash-guard.sh` (PreToolUse on Bash) cuts the command into simple commands (`;`, `&&`, `||`, `|`, `&`, newline,
  parentheses; quoted text, comments and heredoc bodies are dropped, so a commit message that names a command
  does not block). When the scan cannot follow the text (it ends inside a quote or heredoc, or a double quote holds
  `$(`), it checks the raw text as well, cut on `;`, `&&`, `||`, `|`, `&`, parentheses, backtick and newline: a
  heredoc body or message there that names `git add -A` can block. It runs four checks:
  - blocks `git add`/`git stage` of `-A`, `-u`, `.`, a directory or a glob, and `git commit -a` or with such a path
    (shared checkout), also inside a subshell or group, after `then`/`do`/`else`, behind `env`/`command`/`sudo`,
    after `cd` or `git -C` (the directory is resolved there, and a relative path is also tried in the starting
    directory; a submodule pointer passes); `git add -n` passes. Also blocked: `xargs git add` naming no file,
    `bash`/`sh`/`zsh -c "git add -A"` (the script is scanned, three levels deep, then the raw text), and `git add`
    with an argument from `$(...)` or backticks (unreadable, so a sweep). Not seen: a heredoc fed to a shell, `eval`.
  - blocks a build command while the dev port listens: `build_guard.build_re` when set, else `pnpm`/`npm`/`yarn`/`bun`
    running a `build` or `build:*` script (options such as `--filter`, `-C`, `--dir`, `-w`, `-r`, `-s`; `run`,
    `exec`, `workspace`) and `next`/`turbo`/`vite`/`nuxt`/`nx`/`ng`... `build`, also behind `npx`, `time`, `env`,
    `timeout`. It probes the port with `lsof`, else `ss`, `netstat` (Git Bash on Windows) or `nc`; with none it lets
    the build run and says the port was not checked. `ALLOW_BUILD_WHILE_DEV=1 <command>` skips this check.
  - blocks a write into the auto-memory dir through Bash (same regex as `memory-guard.sh`, `kit_memory_re` in
    `hooks/lib.sh`): a `>`/`>>` target, `tee`, `cp`/`mv`/`install`/`ln` into it, `sed -i`, `perl -i`, `mkdir`, `touch`,
    with a leading `~`, `$HOME` and `$CLAUDE_CONFIG_DIR` expanded. Quoted text and heredoc bodies are not matched.
  - blocks a whole test suite: `dotnet test` with no `--filter`; `go test` of `./...`; `pnpm`/`npm`/`yarn`/`bun`
    `test` or `test:*`, `vitest`, `jest`, `mocha`, `pytest` (also `python -m pytest`), `rspec`, `phpunit`, `cargo
    test`, `flutter`/`dart test`, `playwright test` with no path, name or `-k`/`-t`/`--grep`/`--filter`; `gradle`/
    `mvn` `test` with no `--tests`/`-Dtest`. Also behind `npx`, `pnpm exec` and in `bash -c`. Only what the change
    touches and affects is tested. `ALLOW_FULL_SUITE=1 <command>` skips this check, for when the owner asked.

