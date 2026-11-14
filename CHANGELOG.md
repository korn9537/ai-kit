# Changelog

## 2.50.0

Usage records no longer live in each repo. The hooks keep a local buffer under the git common dir, and at session
end (or, for a crashed session or a failed send, at a session start once that session has been idle 6 hours) a
detached `usage.mjs send` posts the session's call-level events, the refusals and the decider's decision log to one
usage server for all projects (`usage.endpoint` in `ai/kit/config.json`, default `https://ai-kit-usage.maybix.com`,
env `AI_KIT_USAGE_ENDPOINT` overrides). Nothing is written under `ai/usage/` any more, so the commits that carried
it are gone: `githooks/pre-commit` stops staging it. The server has no token and no allowlist and stores text
plainly, prompts and messages included; it keeps the newest 10 kit versions and at most a year, because the data is
for comparing kit versions, not for per-repo accounting. `usage.mjs digest` and `digest --compare` read the server
(every project; `--project` for this repo), the new `usage.mjs views <view>` prints its analysis views
(`v_kit_compare`, `v_kit_roles`, `v_tool_stats`, `v_hook_stats`, `v_repeat_reads` and more; the first four span
every project and take `--kit` only, so `views` refuses `--project` and `--since` on them), `/ai-kit:usage` now
starts from `v_kit_compare`, and `/ai-kit:decisions` reads the server plus the logs not sent yet. A session is sent
with its own worktree and commits, also when another worktree's session start sends it. The kit checks rows as the
server does and drops a line the server would refuse (logged in `send.log`, counted by `migrate`); a refusal or
decision file the server still refuses is kept as `<name>.rejected`, and a refused session is not sent again until
its transcript grows. `kit.mjs check` warns about files left under `ai/usage/`, about a session whose usage has not
been sent for over a day and about one the server refused, offline; it no longer warns about uncommitted records,
nor about a session whose transcript is gone. With `usage.enabled: false`, `migrate` refuses.

A project with an `ai/usage/` folder runs `node <plugin>/scripts/usage.mjs migrate` once: it posts the old files and,
only when every post succeeded, stages their removal; commit that. Nothing else. The `:(exclude)ai/usage` pathspecs
in the Stop hook, the run-plan workflow and `jobs.mjs`, `plan.mjs` and `continuous.mjs` stay for now, so the migrate
commit stays out of the review gate; they go in a later release.

## 2.49.2

A fix in `/ai-kit:run-plan` and `/ai-kit:continuous` runs at the size of the batches its CONFIRMED findings fall in
(the batch whose commit holds the file, else a batch never built whose brief names it, else `normal`), not at the
heaviest batch of the job: one finding in a `normal` batch's file no longer starts an opus, effort high committer
because another batch was `heavy` (#54, in part). Usage records take a subagent's effort from its own requests, so a
workflow committer at `heavy` shows `high`, not its frontmatter's `medium`. Records written before stay as they
are, and an agent whose transcript the collector had already read before the update keeps the old value.
No project needs to edit anything.

## 2.49.1

`/ai-kit:run-plan` and `/ai-kit:continuous` start again: Workflow now refuses a `scriptPath` outside the folders the
session can read, and the commands pointed it at the plugin cache. `plan.mjs write`, `plan.mjs resume` and the `run`
step of `continuous.mjs next` copy `workflows/run-plan.js` to `.claude/ai-kit/run-plan.js` below the command's
cwd, which the Bash tool keeps inside the session (a worktree's `.git` and a git top above the session lie outside it
too), and print it as `script`; the commands pass that path. `**/.claude/ai-kit/` goes into `.git/info/exclude`,
so git status and the kit's dirty checks do not see the copy. No project needs to edit anything.

## 2.49.0

New `conventions/ui.md`: UI rules for web, mobile and tablet screens (status and feedback, double submission,
labels, validation on submit, error messages, destructive actions, contrast, accessible names, motion, Thai text and
dates, keyboard and reflow on web, touch targets, safe areas and layout by window width), each with its WCAG,
GOV.UK, NN/g, Apple or Android source. A project with screens adds `"ui"` to `conventions` in `ai/kit/config.json`
(and runs `kit.mjs sync` when `unattended` is on); nothing changes for a project that does not.

## 2.48.0

A batch has an optional `size`, `light`, `normal` (default) or `heavy`, and `/ai-kit:run-plan` runs its committer at it:
`light` on sonnet at low effort, `normal` as before (sonnet, medium), `heavy` on opus at high effort; never xhigh or
max. Heavy is for code-level difficulty only (live data, transactions, concurrency, idempotency): a business rule that
the BA report settles stays normal. A fix after review runs at the highest size of the job's committed batches,
partial included (heavy for a data or rule finding), a second fix one tier up. `committer.maxSize` in
`ai/kit/config.json` clamps every committer call. The plan review checks each size. Plans and configs with no size or
`maxSize` run as before. In the main session a fix sent by SendMessage keeps the batch's size.

## 2.47.2

`githooks/commit-msg` checks the `Job:` trailer only on commits made under Claude Code (`CLAUDECODE=1`, which it sets
in the shells of sessions and subagents). A person committing by hand from VS Code or a terminal is no longer refused:
since 2.23 every manual commit in a project with the shim needed a `Job:` line. A manual commit without one is not
listed by `/ai-kit:jobs`. No project needs to edit anything; the shim calls the updated runner.

## 2.47.1

README's evals paragraph says what a run costs on each sign-in: on a subscription (Pro, Max) a `claude plugin eval`
session uses the plan's usage limits with no charge beyond it; only with `ANTHROPIC_API_KEY` is it billed per token,
which `--max-cost-usd` caps. 2.47.0 said every run "costs money". It also says the command is early access: on an
account without it, it prints "`plugin eval` is currently in early access", exits 1 and runs nothing, as the first
run of the decider cases did. No project needs to edit anything.

## 2.47.0

The post-edit checks (comment and docs rules) also run on files a Bash call wrote (`>`, `>>`, `tee`, `sed -i`, `cp`,
`mv`), and `PostToolUseFailure` is wired too. They skip git work-tree commands and background calls. CHANGELOG 2.46.1
counted 49 committers that met the comment rule only at the commit because they wrote through Bash, where no post-edit
check ran.

bash-guard sees `xargs git add` (also `-I{}`), `sh -c` and `bash -c` (also `-c --`), `git add $(...)` and backticks,
and Bash writes into the auto-memory directory (`>`, `>>`, `>|`, `tee`, `cp`, `mv`, `sed -i`). The README listed these
as not seen; each was a way round the sweep-add and memory rules.

ask-guard matches the decider verdict per question, not per call: a call with several questions needed one verdict
for all of them. Thai is matched by character bigrams, and the state file is locked against two writers.

review-before-stop reviews a mid-plan edit outside the open plan's files (`plan.mjs scope`). 2.45.0 named this as a
gap: an edit made while a plan was open, but outside its files, was never reviewed.

Usage: a refused commit leaves a refusal record in `ai/usage/refusals/`, so refusals are counted across machines and
not only from local transcripts. The digest has a refusals section, and `digest --compare <kitA> <kitB>` sets two kit
versions side by side, so a rule change can be judged by its effect.

`check-specs` warns (never blocks) of an API route with no entry in the API spec: Next, NestJS, Express/Fastify,
FastAPI and Flask. `ui.routes: false` turns it off. It works for backend-only repos that set `ui.api`.

New conventions: `python`, `react` (adds to `typescript`), `flutter` (adds to `dart`) and `java`.

`evals/` holds a suite for the agents (the decider, the reviewer, the business analyst): 5 cases, with an offline
grader tested by `scripts/evals.test.mjs`. Running it costs money, so it is not part of `test-all`; the first paid run
confirms the trace name of the Agent/Task tool. No project needs to edit anything; `ui.routes` defaults on where
`ui.api` is set.

## 2.46.2

A request to check, verify or explain how a business rule or data behaves today runs `ai-kit:business-analyst`, not
an Explore subagent: its answer decides the change that follows (`CLAUDE.core.md`, summary rule and heavy reads).
A brief asking how something works asks for the path from the entry point to the deciding line, each step as
`file:line`, and the main session checks that path, not only that the line exists. In asw-sales-flow a check of the
booth questionnaire went to Explore, which found a lock on `question.id === ownerKey` and reported that the sales QR
locks through it; the sales QR never reaches that line, and the plan built on it proposed a column that already
existed. No project needs to edit anything.

## 2.46.1

The committer edits code with the Edit tool, and runs `check-comments.mjs --strict` and `check-docs.mjs --strict` on
any file it wrote through Bash before staging. In 5 days 49 committers hit the pre-commit comment rule (59 refused
commits in brieflane and asw-sales-flow); every one had edited through Bash (python3, sed), which the post-edit check
never sees, so the rule was first met at the commit. No project needs to edit anything.

## 2.46.0

The main session coordinates and does not explore: finding what a summary, plan or brief needs (where the code is,
what it does, which files a change touches) goes to an Explore subagent (sonnet) that returns a `file:line` list, one
per question, sent together when independent (`CLAUDE.core.md`, heavy reads: about three reads, was five). The read
nudge comes sooner: `handoff.max_reads` 4 (was 5), `handoff.reads_from` 0 (was 100k; the base context alone is about
57k). In 5 days the main session's context peaked at 165k to 210k on average and handed off 43 and 45 times in
brieflane and asw-sales-flow, with most of its reads its own greps and file reads. Set either key in
`ai/kit/config.json` to keep the old pace.

## 2.45.1

`githooks/commit-msg` reads the `Job:` line from any paragraph made only of `Key: value` lines, as `scripts/jobs.mjs`
does, not from `git interpret-trailers`. A blank line between `Job:` and `Co-Authored-By` hid the job from git's
trailer block, and the hook refused the commit: in 5 days that was 89 committer retries in brieflane and 77 in
asw-sales-flow, each a fresh commit attempt. Comment lines (any `core.commentChar`), CRLF and the `git commit -v`
diff are handled; the subject paragraph and a `Job:` line in prose still are none. `docs/shared-checkout.md` and the
committer read a commit's job from the body (`git log -1 --format=%b <hash> | grep '^Job: '`), not `%(trailers)`,
and the committer writes one trailer block with no blank line inside. Projects with the shim get it on the next
commit; a repo with its own copy of the hook (not the shim) keeps the old check until it is replaced.

## 2.45.0

The Stop hook no longer asks for a review mid-job: when the last commit's job has a `plan.mjs` plan with batches left
and the session itself named that job (its own `git commit` or committer brief carries the exact `Job:` trailer, or
its Workflow run has that job), the stop passes, and the job's one review comes after its last batch. Another
session's open plan does not count, nor the id seen in `git log` output. Gap: until that plan is finished or closed,
an unrelated edit at such a stop passes too. A job with no plan file is
reviewed at each stop with new code, as before. No project needs to edit anything.

## 2.44.0

`plan.mjs write` refuses a batch whose `accept` is missing or empty: the job's one review checks every batch against
its Done when checks, and a batch with none left it only the request to go by. A plan file written before 2.44.0 still
resumes without them. No project needs to edit anything.

## 2.43.1

The git shims' version fallback (issue #50) keeps only `x.y.z` folders that hold the hook before taking the highest:
a newer folder still unpacking, or a partial cache, no longer wins and skips the plugin hook (commit-msg left the
Job trailer unchecked) while an older complete version is on disk. `kit.mjs check` reports each project's shim as
older; run `/ai-kit:init` (or `node <plugin>/scripts/kit.mjs init`) to rewrite it.

## 2.43.0

Review is once per job (issue #51): the Stop hook asks for one fresh `ai-kit:change-reviewer` over the whole job's
range (`git diff <base>..HEAD`), launched when the job's last commit is made, not one per commit. The BA's Done when
checks give the reviewer the intended result, so one end-of-job review costs less wall time than several overlapping
ones. The run-plan workflow does the same: it commits every batch, then one reviewer reads
`git diff <first commit>^..HEAD` of the job, with one fix and re-check round as before and one more for what is left;
the result holds it as `review`, no longer per batch. `/ai-kit:continuous` keeps each run's as `reviews`; a retry run
reviews the commits it made, and a commit no agent reported is listed as not reviewed. The range is limited to the
files the job's commits touched and to their hunks, since other sessions commit to the same checkout. A batch id
`job` is refused (it names the job review). No config, no project edit.

## 2.42.0

`CLAUDE.core.md` gains **Read, do not guess**: a fact the code, docs or git history can settle is checked and cited
(`path:line`) before the answer, not stated from memory or left as "I guess"; only what the repo cannot show may be a
marked assumption, and a recommendation resting on an unchecked fact (above all one that deletes data) waits for the
check. Seen in a reply that recommended deleting a local `.isar` database while guessing whether any notifications
existed only on the device. A fact outside the repo (library, API, standard, law, platform rule) is looked up on the
web and cited by URL. `ai-kit:business-analyst` gains WebSearch and WebFetch and the same rule: outside facts and
comparable practice come from the web, each claim may cite a URL, and an Owner decisions assumption is only for what
neither the repo nor the web can settle, with what was searched. No project needs to edit anything.

## 2.41.0

`conventions/nestjs.md` item 4 (issue #47): every mutating handler (POST, PUT, PATCH, DELETE) declares its access rule
through a project decorator (a required permission, admin-only, or a no-check with a written reason), a metadata test
enforces it with a baseline list that only shrinks, and the permission guard is attached per controller after the
authentication guard, never globally. Projects with `nestjs` in `conventions` get it on the next sync.

## 2.40.0

`usage.mjs digest` gains `## by commits per round`, and per kit the cost per commit over commit rounds only and the
share of cost in rounds with no seen commit. `all cost / commits` divided all cost by the commits seen in one
project's transcripts: in asw-sales-flow it read $0.85 for 2.22.0 against $2.60 for 2.36.0, while the share of cost
in no-commit rounds rose from 40% to 73% and the commit-round figure showed no rise ($0.83 to $0.70). A commit counts
in the earliest round that saw it. New `usage.mjs hooks [--since]` counts each kit hook's firings from the local
transcripts (no hook changed; the table is `scripts/lib/hook-events.mjs`, and a test fails when a hook message it
matches is renamed). No project needs to edit anything.

## 2.39.0

`/ai-kit:migrate`, `kit.mjs migrate` and the 1.x checks of `check` and `init` are removed because no repo is on 1.x:
`check` no longer reports `code_dirs` listing `ai-kit`, a 1.x shim, in-repo `ai-kit/hooks/` entries in settings or a
`@ai-kit/CLAUDE.core.md` import, and `init` no longer rewrites a 1.x shim. A repo still on 1.x migrates with an
earlier plugin (2.38.1) or by deleting `ai-kit/`, its hooks in settings and the `@ai-kit` import by hand. No project
needs to edit anything.

## 2.38.1

Refactor, no behavior change. One helper for the `claude-review`, `claude-usage` and `claude-decider` folders
(`kit_state_dir` in `hooks/lib.sh`, `scripts/lib/state-dirs.mjs`). `scripts/kit.mjs` is split into one module per
command under `scripts/kit/`; the dispatcher and the CLI path are unchanged. `is-main`, `usage-collect` and
`usage-digest` moved to `scripts/lib/`. No project needs to edit anything.

## 2.38.0

New `docs/spec.md`: what each kit file does (hooks, git hooks, agents, commands, scripts, workflow, docs,
conventions, templates, files the kit creates in a project) and eight processes (session start, one task, a plan of
several items, commit, usage records, decisions, install, editing the kit), each step naming its file.
`scripts/spec.test.mjs` fails when a kit file is not named there or the spec names a path that does not exist.
`docs/why.md` and `scripts/why.test.mjs` are removed: a table of why each rule exists did not say what a file does,
and 62 of its 153 rows had no recorded reason. Its text stays in git (2.37.1). README §Editing the kit step 3 now
asks for the spec instead of a why row. No project needs to edit anything.

## 2.37.1

`docs/why.md`: the 1.x history in asw-sales-flow and solo-training was searched for the reasons git here lacks
(`asw <hash>`, `solo <hash>`). 4 problem cells filled from a quoted source (review-closed phrase, push only when
asked, re-check by the same reviewer, build escape), 62 of 153 still "not recorded"; 34 rows gain a `1.x first
seen` commit. Most 1.x commits state no reason. No project needs to edit anything.

## 2.37.0

New `docs/why.md`: one row per hook behavior, rule of `CLAUDE.core.md` and agent, with the problem it answered, the
version and commit that added it, and its source (CHANGELOG, commit message, issue). Recovered from history, nothing
filled by reasoning: 66 of 153 rows give no recorded problem, mostly behavior from before 2.0.0, where git
history starts.
Read it before removing or loosening one. `scripts/why.test.mjs` fails when a script wired in `hooks/hooks.json`, a
file in `githooks/` or an agent has no row of its own. No project needs to edit anything.

## 2.36.2

`kit.mjs check` treats an absolute `core.hooksPath` that resolves to the repo's own `.githooks` as wired (it
compares real paths); another directory is named with `.githooks` and the one command that fixes it. The warning that
`ai/kit/pre-commit.sh` reads the staged diff names the file, line and matched command, and says why it matters.
Closes #48, #49.

## 2.36.1

No context stop: past `handoff.max_context` a coordinator is no longer told to launch no new batch; the "Next session"
note stays, on prompts only. `/ai-kit:run-plan` runs the plan as coordinator when the Workflow call fails to start
as well as when it is refused.

## 2.36.0

A plan is reviewed before its first commit. A review of the code kept finding what the plan could have known: a deploy
landing under a running test, a doc claim the code does not make true, a test no batch owned. Each batch now carries
`risks` (how it can fail) and `tests` (what answers each risk); `plan.mjs write` and `continuous.mjs init` refuse a
batch without them. The run-plan workflow starts with a plan review (one `change-reviewer`, reading the plan and the
code the batches touch) and puts its findings into the briefs of the batches they name; the report lists them. A plan
written for the workflow before 2.36.0 needs `risks` and `tests` added to its batches (`plan.mjs write` names them).

## 2.35.0

New command, `kit.mjs uninstall` (`/ai-kit:uninstall`), reverses what `init` wrote: the `.githooks/` shims (only
when still the ai-kit shim), `core.hooksPath` (only when nothing else is left in `.githooks/`), the `CLAUDE.md`
pointer line, the `ai-kit-root` marker, and `ai-kit@korn9537` in the project's own `enabledPlugins` — never
`~/.claude/settings.json`. `ai/kit/` stays unless `--purge`. Anything it could not safely touch is printed and
left for the user.

## 2.34.0

What each step hands the next is now one table, `docs/handoffs.md`, and `scripts/handoffs.test.mjs` checks the
workflow prompts and the other routes' docs against it; this clone's pre-commit runs it when a route changes. An audit
of 2.33.1 found five lost handoffs, a rule set re-read up to six times per batch, and the owner kinds written three
times and drifting. A repo with `unattended` on runs `kit.mjs sync` and commits; no other project needs to edit
anything.

- The committer reports an unmet Done when check in `unmet`, which marks the batch partial and holds what waits on
  it; before, it fell into `notes` and the batch counted as committed.
- A fix committer gets the batch's brief and the later batches; a narrow re-check gets Done when. A resumed commit's
  reviewer gets the request, scope, Done when and the `ai/usage` exclusion.
- The run-plan report routes `choices` to Decided, notes to Done or Checked and PLAUSIBLE findings to Checked; Open
  lists `unmet` and the findings of a fix agent that made no commit. One way on after an owner answers: resume.
- Fewer reads: the committer reads only the core sections it needs; committer and reviewer read the conventions the
  change touches, as CLAUDE.core.md says; a fix committer and a narrow re-check read only the rule a finding names.
- `docs/owner-kinds.md` is the one list of owner kinds; CLAUDE.core.md, the BA, the decider, the committer and
  `ask-guard.sh` point to it. The decider takes the BA's Owner decisions item and its sources as its research.
- `continuous.mjs init` checks each batch with `plan.mjs`'s `checkBatch`, title, brief and `accept` included.

## 2.33.1

A plugin update that removed the version a repo recorded in `<git-common-dir>/ai-kit-root` left the shims on their
fallback until Claude Code opened there: `pre-commit` ran only `ai/kit/pre-commit.sh`, and `commit-msg` passed every
message silently. Both shims now take the newest `x.y.z` beside the recorded path, and `commit-msg` warns when it finds
none. `kit.mjs check` names the older shim; `kit.mjs init` rewrites it.

## 2.33.0

The result a change must reach is set before the work, and the committer reads the rules the reviewer grades against.
Of 745 CONFIRMED findings in 333 first reviews, about 34% cited the project checklist and 17% the kit conventions
(keyword count, approximate), yet committers read the checklist in 15% of runs against 63% for reviewers. A repo with
`unattended` on runs `kit.mjs sync` and commits; no other project needs to edit anything.

- The BA report gains section 7, **Done when**: checks a reviewer can confirm, the gaps of section 4 answered, what
  stays unchanged and what is out of scope. Owner decisions move to section 8. The summary gains item 6, Done when.
- A batch takes `accept`, a list of checks (`plan.mjs write` refuses anything else). `run-plan.js` passes it as
  `Done when:` to the committer, the reviewer and a fresh re-check; the coordinator and Stop-hook briefs say the same.
- The committer reads `ai/kit/review-checklist.md` and the conventions before its first edit, and reports under Open a
  check it could not meet.
- The reviewer checks the Done when list first, and leaves out a preference, a refactor or wider scope that breaks no
  request, check, rule, screen spec or correctness.

## 2.32.0

CONFIRMED findings no longer stop at the report: 70 of 78 fresh reviews left some, 209 in all. No project needs to edit
anything.

- In `run-plan.js`, a re-check that leaves CONFIRMED findings gets one more fix and a re-check of it. An open owner
  decision holds it, and what is left then goes under Open. A first fix whose agent failed gets no second try, and a
  coordinator keeps its one re-check: the Stop hook closes the review there.

## 2.31.1

The `LSP` tool comes out of the kit agents and the rules, which go back to `grep -n` and a line range. Right after a
server starts, references came back incomplete with no error (3 of 135 on rem-saas), a server took about 1 GB, and no
saving was measured. The whole-file note and `path:start-end` stay. A repo with `unattended` on runs `kit.mjs sync` and
commits; no other project needs to edit anything.

- `agent-model-guard.sh` also blocks an `Explore` with no `model`: it inherits the session's opus.

## 2.31.0

Agents read less: whole files were 43.5% of what was read, searches only 21%. A repo with `unattended` on runs
`kit.mjs sync` and commits; no other project needs to edit anything.

- The four kit agents and the main session may use the `LSP` tool, loaded through `ToolSearch`, to find a symbol before
  opening a file, and fall back to `grep -n`. Needs an LSP plugin (`typescript-lsp`, `gopls-lsp`, `csharp-lsp`). Probed
  on Claude Code 2.1.318: a subagent got the tool in 6 of 6 runs; on 2.1.234 in about half.
- `handoff-nudge.sh` notes a `Read` with no range or a plain `cat` of a code file of `handoff.big_read` lines or more
  (default 300, 0 is off), once per prompt in the main session and once per subagent.
- Briefs and the business analyst's sources name `path:start-end`, so the next agent reads only that range.

## 2.30.0

Less work on the main session, from a measure of four projects' transcripts: searches there were 25% of its cost, and
turns woken by a finished agent 33%. No project needs to edit anything.

- `handoff-nudge.sh` also runs on PostToolUse of Bash, Read, Grep and Glob: every `handoff.max_reads` (default 5, 0 is
  off) reads or searches since the last prompt, past `handoff.reads_from` (default 100k) tokens of context, a note to
  send the search to a subagent. It never blocks.
- A plan of two batches or more now runs as the run-plan workflow; it was four. `docs/plan-batching.md`,
  `CLAUDE.core.md`. The user naming a runner still wins.
- `plan.mjs write` lists in `shared` the paths two briefs name, so batches that would read the same lines get merged.
  `/ai-kit:run-plan` and `/ai-kit:continuous` act on it.
- A committer verifies once before the commit and does not run by hand what CLAUDE.md says the pre-commit runs; a
  brief's `verify` leaves those commands out.

## 2.29.0

Runs without the plugin get the same rules, checks and review material as a session. A project edits nothing to keep
working; a repo with `unattended` on runs `kit.mjs sync` and commits.

- `kit.mjs unattended [--dry-run] [--force]` turns a repo on: rewrites `git diff --cached` to `git diff $AI_KIT_RANGE`
  in `ai/kit/pre-commit.sh`, sets the key, runs `sync`. A `--staged` flag, a script that reads the index or cannot be
  followed, or an empty `pre-commit.sh` leaves the repo off and is listed, since a gate acts on `check.sh` as soon as
  it exists. `--force` passes all of these but a line it cannot rewrite.
- `sync` starts `ai/kit/requires.txt` once. `ai/kit/check.sh` stops when it is missing or names a command this machine
  lacks (a check on `$(tool)` output otherwise passes without the tool), and runs the kit's comment and doc checks
  from generated copies in `ai/kit/checks/`.
  The 40 KB rule stays out: a range cannot tell its move-only commit from the edit after it.
- `check-comments.mjs` and `check-docs.mjs` take `--range=<a...b>`.
- `sync` also writes `conventions/unattended.md` (session rules a run needs) and `ai/kit/review-prompt.md`, generated
  from `agents/change-reviewer.md`, for a pipeline's own review.
- `check` names a generated file that git ignores, a missing `requires.txt`, and, with `unattended` off, a
  `pre-commit.sh` that reads the staged diff. `session-start.sh` adds a note when generated files are out of date.

## 2.28.0

From a review of every hook and script. No project needs to edit anything.

- Session start: Claude Code keeps only a 2,000-character preview of a hook string over 10,000 characters, and the
  injected `CLAUDE.core.md` was over 12,000. `session-context.sh` and `session-start.sh` now inject one half each,
  split at the new Delegation and report heading; nothing was cut.
- Fewer files. Hooks: `bash-guard.sh` replaces `build-while-dev-guard.sh` and `git-add-all-guard.sh`; `kit-log.sh`
  replaces `usage-log.sh`, `usage-flush.sh` and `decider-log.sh`; `review-skip-guard.sh` is gone, coordinators call
  `scripts/review-needed.sh`. Scripts: `usage-flush.mjs` is in `usage.mjs`, `usage-record.mjs` in `usage-digest.mjs`,
  `check-wrap.mjs` is `check-docs.mjs --wrap`, `check-size.mjs` is `check-comments.mjs --size`, `unattended.mjs` is in
  `kit.mjs`, `run-plan-status.mjs` is `plan.mjs live`; `migrate` moved to `kit-migrate.mjs`, with a first test.
- `bash-guard.sh`: one splitter that drops quoted text and heredoc bodies, so a commit message naming a build no longer
  blocks, in `-m "$(cat <<'EOF' ...)"` too, and many missed forms now do (`git stage .`, `git commit . -m x`,
  `(cd web && npm run build)`, `pnpm turbo build`). When the scan loses the quotes it also checks the raw text.
  `memory-guard.sh` keeps Write and Edit only: its Bash branch took 14 s on a Thai heredoc, past its timeout.
- Stop hook: a preview agent or a denied reviewer no longer counts as a review; more Bash writes count; a read-only
  command does not. One moved line is no longer a move: a run needs three code lines.
- `continuous.mjs`: a failed `git log` stops the run instead of committing a batch twice, and three in a row close it.
  State is written atomically. `plan.mjs` refuses staged files outside cwd and finds its root from a subdirectory.
  `run-plan.js` keeps a fix agent's owner questions and blockers.
- Usage: a lock with a short wait and a dead-holder break makes flush and record safe to run at once (four parallel
  flushes cost about 2.6x), records dedupe on session and ts, and SessionEnd records before it flushes.
- Checks: `--staged` reads the index, `--size` sees renames, the history rule passes present-tense comments such as
  `used to build`, and fences, frontmatter and template literals parse correctly.
- `jobs.mjs` reads non-ASCII paths and body trailers. `kit.mjs` honours `CLAUDE_CONFIG_DIR` and repairs a
  non-executable shim. Every CLI runs through a symlink (`is-main.mjs`, with a test that greps for the old guard).

## 2.27.3

- `scripts/plan.mjs`: `write` lets through only the wide lines a plan's file already holds, not every line of an
  existing plan, so a new wide key is refused there too and a job that cannot be renamed still is not.
- `usage-record.test.mjs`: three hashes share a prefix and the count must be above 0, so a change that bypasses the
  counted comparison fails. A quadratic copy of the whole list is still out of its sight.

## 2.27.2

- `scripts/plan.mjs`: a string wraps by where it really sits, indent and escaped key included, so nesting or a long key
  keeps its line within 120 columns. `write` refuses a plan that would not parse back and a field shaped `{ lines }`,
  instead of committing a plan that `status` skips or changing the field. A new plan with a line still over 120 (a job
  over 113 characters, a key over about 109) is refused too; a plan already in the repo stays writable.
- Tests: `unattended.test.mjs` compares what the index stages and its flags, not its file, whose stat cache any
  `git status` may refresh. `usage-record.test.mjs` counts the comparisons `uniqueCommits` makes instead of timing it:
  every timing failed under load. `uniqueCommits` takes the comparison as an optional argument for that.

## 2.27.1

- `conventions/typeorm.md` item 2: every migration has a unique timestamp; a duplicate that has run is renumbered and
  its `up()` is safe to run again (#44).
- `scripts/plan.mjs`: a text too long for one line is written as `{ "lines": [...] }` and `parse` joins it, so a plan
  file fits a 120-column doc check; every long string in the plan, not only `brief`. Plans already written still parse
  (#45).
- `conventions/nestjs.md` item 3: a handler on a nested route reads the parent param and scopes its lookup by it (#46).

## 2.27.0

- `$AI_KIT_RANGE` (`docs/ai-layout.md` §Runs without the plugin): a project check on the diff itself passes it to
  `git diff`, `--cached` in a commit and `<base-ref>...HEAD` in `ai/kit/check.sh`; it is exported, so a called script
  reads it too. `changed` gives names only and `xargs` cannot call a shell function, so a check on added lines had no
  way to run under `check.sh`. `check.sh` now refuses a diff of the index and `--staged`, not every `--cached`, and a
  base ref with a space. Each project moves over by hand: `diff --cached` becomes `diff $AI_KIT_RANGE`, then `init`;
  all 11 projects on this machine are still refused until then. Left open: a script `pre-commit.sh` calls that reads
  the index itself finds nothing and passes, and no check can see it; neither `--cached` on a second line nor one held
  in a variable is caught; nothing refuses a check that writes the index, the doc tells it to skip itself.

## 2.26.0

- Runs without the plugin (`scripts/unattended.mjs`, `docs/ai-layout.md` §Runs without the plugin): `"unattended": true`
  in `ai/kit/config.json`, off by default, gives a `claude -p` run the conventions snapshot, a `CLAUDE.md` pointer and
  `ai/kit/check.sh <base-ref>`; `/ai-kit:check` warns of a stale or hand-edited copy and nothing refreshes it on its
  own. `check.sh` passes files through `AI_KIT_FILES` and never touches HEAD or the index; each runner defines
  `changed`, which the pre-commit template gates on. Left out: a reviewer prompt in the snapshot, a pipeline writes
  its own (#43). Left open: `check.sh` refuses any `--cached` or `--staged` in code, `git rm --cached` included, and
  a project on an older shim needs `init` once, which `check` names.

## 2.25.1

- `scripts/check-size.mjs`: the `partial` a C# split adds to its class line no longer needs `ALLOW_LARGE_EDIT=1`; the
  line must equal one removed from the same file, once per removed line (#42). Left open: with two files over 40 KB
  in one commit a removed line can pay in both, as moved lines already could; an attribute on the class's own line
  is not read as a modifier, so that split still needs the escape.
- `conventions/general.md` item 15: a request type declares only what the caller decides (#41).
- `conventions/nestjs.md` item 2: `@Cron` names its `timeZone`; replicas claim `(job, slot)` by scheduled time (#40).

## 2.25.0

- Plan files (`scripts/plan.mjs`, `docs/plan-batching.md` §Plan file): a plan of two batches or more is committed to
  `ai/plans/<job>.md` before its first batch, so a lost session loses no batch. Until now a plan lived in the chat and
  the workflow's args; 8 of 10 projects had never held a plan file. The file holds the batches, the status comes from
  the job's commits by their `Batch:` trailer, so no one keeps it up to date and two sessions never edit it.
  `write` refuses what would fail later and adds to a plan on a second run; `close` deletes it in its own commit.
- `/ai-kit:run-plan resume [job]`: the batches left go back to the workflow, with what the lost run left shown first
  (edits in the tree, commits with no batch, a continuous run still going, commits with no recorded review). A batch
  waiting on a commit of unknown end is held until that commit's review is clean.
- `hooks/session-start.sh` names each plan not closed, with its status; the session goes on only on the user's word.
- `/ai-kit:check` warns of a plan with nothing left, the hand-written ones included.
- `agents/committer.md`, the coordinator brief: the `Batch:` trailer holds outside the workflow too, so a plan of two
  or three batches has a status.
- `scripts/continuous.mjs`: a commit of the plan file is not a commit with no batch, which would stop the retries,
  and neither is a fix commit from before a resume. `abandon <state>` clears a run known to be over, which `init`
  refused for good after a lost session. `readRepo` reports a failed log instead of reading it as no commits.

## 2.24.0

- `/ai-kit:continuous` (`commands/continuous.md`, `scripts/continuous.mjs`): work runs to its end with nobody watching.
  It asks every owner decision at the start, runs the run-plan workflow at any batch count, keeps the Mac awake and
  checks every 30 minutes from a session cron. A batch whose committer returned nothing runs again, up to six times an
  hour apart so a usage limit can reset, with the batches that waited for it; a batch with a commit, an owner decision
  or a reported blocker does not. Before a retry, the edits a dead committer left are stashed under a named entry when
  the tree was clean at the start; otherwise new edits hold the retry. The commit check rests on the trailer
  below, so a commit of the job with no such trailer stops the retries. A failed reviewer or fixer is reported, not
  retried. State lives in `<git dir>/claude-review/continuous-<job>.json`; the script reads the workflow's run file
  itself, and a run with nothing moving for two hours ends with a report.
- `workflows/run-plan.js`: the committer is told to add a `Batch: <id>` trailer, how `continuous.mjs` finds a commit
  whose agent died before reporting it.
- `commands/run-plan.md`: a re-run with the batches left drops committed ids from `waitsFor`; the workflow counted
  them as not committed and skipped every batch that named one.

## 2.23.0

- Jobs (#39): every commit carries one `Job: <yyyy-mm-dd>-<slug>` trailer, one id per user request shared by all its
  batches and review fixes, so a later session finds and reverts the whole request. `githooks/commit-msg` enforces it
  through a `.githooks/commit-msg` shim that `kit.mjs init` writes (`check` warns while it is missing); `/ai-kit:jobs`
  (`scripts/jobs.mjs`) lists jobs, or one job's commits, files, migrations (a default path heuristic, or
  `jobs.migrations` in `ai/kit/config.json`), later commits of other jobs on the same files and the revert command.
  run-plan takes a `job` arg and puts it in every committer and fix prompt; rules in `docs/shared-checkout.md` §Jobs.

## 2.22.1

- Core: while the design is still under discussion (the request asks how something would work, the user answered
  the last summary with a question, objection or correction, or the design changed since they saw it), the summary
  ends the turn and no code is edited or sent to a committer until the user says to build (#37).
- `review-before-stop.sh`: after a `cd` into the repo, a `>` or `|` inside quotes (a grep pattern `"x =>"`, a commit
  message `<a@b>`) no longer counts as a repo write, and a quoted `/tmp` target passes; the false write had turned
  on the whole-tree diff, so a stopped committer's leftover edits blocked every stop (seen in #38).

## 2.22.0

- Usage records each agent's `effort` (the launching call's, else the agent frontmatter's) and a `decider` role; the
  digest `## reviews` section splits by model and effort (`opus medium: N reviews, ...`).
- Agents run on their frontmatter, no per-call override: `business-analyst`, `change-reviewer` and `decider` on opus
  at medium effort, `committer` on sonnet at medium effort. The committer works from a complete brief (BA and decider
  made the judgment calls) and its reviewer checks the commit, so it stays on sonnet; the three that judge run on
  opus always. Measured on usage digests of rem-saas and asw-sales-flow (2026-10-25..11-02): commit subagents are
  43% / 17% of cost, mostly opus; opus vs sonnet reviews had similar confirmed findings per review (0.3-0.4 vs
  0.4-0.5) at 6-8x the cost per review; Opus 5.5 benchmarks show a small medium-vs-high gap. The per-batch `heavy`
  flag of `run-plan` and the "unsure → opus" rule are gone.
- `hooks/agent-model-guard.sh` (PreToolUse on Agent and Task) blocks a general-purpose subagent launched without a
  `model`; typed agents (ai-kit:*, Explore, Plan, ...) and fork pass. The block message and the README name the
  fallback models (opus medium for the reviewer, business-analyst and decider; sonnet medium for the committer).
- A general-purpose fallback for a kit agent (type not loaded) passes that agent's frontmatter model and effort: opus
  medium for the reviewer and decider, sonnet medium for the committer; the model guard message says so.
- Open holds only owner decisions and blocked in-scope work. Work outside the request that needs no decision is a
  follow-up commit with its own review after the requested one; the agent cleans up what it created for the task;
  a pre-existing backlog is not reported; offers and suggestions in a reply go to the decider. Reason: the owner had
  to say "continue" for Open items that needed no decision.

## 2.21.1

- `conventions/general.md` 7: a filter or sort on a derived field uses the one rule that derives it, never a restated
  copy on raw columns; other values are a 400 (#27).
- `conventions/general.md` 9: the server rejects every write rule itself (locked field, state gate, frozen
  record), not only permissions, each lock tested through the endpoint (#28).
- `conventions/general.md` 14: forwarding headers are read only from a configured trusted-proxy CIDR list (#29).
- `workflows/run-plan.js`: a fix commit keeps a leading task id first (`T-12a: y` → `T-12a: fix y`) (#30).
- `workflows/run-plan.js`, `agents/committer.md`: the committer prompt lists the later batches, and work planned
  for one of them is a note, never a blocker that skips it (#31).
- `conventions/sql.md` 13: counters are taken with one upsert on a unique key, never read-add-save or `max + 1`
  (#32).
- `conventions/dart.md` 5: a commit with a golden PNG names its `--update-goldens` command in the body; the
  proposed commit-msg hook is left out (#33).

## 2.21.0

- `scripts/usage-collect.mjs`: reviewer findings returned through `StructuredOutput` (the run-plan REVIEW schema)
  count toward the digest's confirmed/plausible per review; before, only text verdicts counted, so workflow reviews
  showed near zero. Records written before this version keep the old count (#34).
- `CLAUDE.core.md` Agent model: the opus rule splits by role. A committer goes to opus only when its batch itself
  writes a schema change or migration, a calculation, an access rule or row filter, or a final decision (unsure →
  sonnet); the reviewer, BA and decider keep the wider rule plus a `review.always` path match (unsure → opus). A
  general-purpose heavy-read subagent runs on sonnet. run-plan takes `heavy: "review"` for an opus reviewer over a
  sonnet committer (#35).
- `CLAUDE.core.md`: code past `review.skip_lines` goes to a commit subagent even for one item; the main session
  edits only small changes, small jobs, debugging or UI tweaks iterated with the user, and the large-refactor
  exception. `docs/plan-batching.md`: past `handoff.max_context` the one item just asked for still goes to one
  committer (#36).

## 2.20.0

- `scripts/run-plan-status.mjs`: live status of a run-plan workflow from its `journal.jsonl`, one line per batch
  id (commit hash, review findings, fix, re-check, owner decisions and blockers, an agent with no transcript write
  for 15 minutes); `/ai-kit:run-plan` runs it when the user asks how the plan is going, instead of saying the main
  session sees nothing until the workflow ends.
- `workflows/run-plan.js`: agent labels carry the batch id (`commit: [b1] title`, `commit: [b1 fix] title`,
  `review: [b1] title`, `review: [b1 recheck] title`), so a title starting `fix` or `recheck` is not read as a
  fix or re-check step.
- Not yet tried: a full `/ai-kit:run-plan` run with the new labels (tested with fixtures and a one-agent workflow),
  and Windows (the Git Bash path mapping has a unit test only).

## 2.19.2

- `CLAUDE.core.md`: heavy reads (browser checks, searches past about five reads) go to a subagent in any session;
  the main session reads its report; pointer from `docs/plan-batching.md` §Coordinator pipeline (#26).

## 2.19.1

- `workflows/run-plan.js`: a committer reports `blockers` and `notes` instead of `open`; only an owner decision or
  a blocker holds the batches that wait on a commit, notes go to the report's Open (#25).
- `workflows/run-plan.js`: a fix commit keeps the scope of the batch title's type (`feat(x): y` → `fix(x): y`), no
  doubled `fix: feat(x):` subject (#24).
- `conventions/sql.md` item 12: a versioned row stores its series id, and the version counts per series (#23).
- `conventions/general.md` item 13: a number shown beside its limit comes from the function that enforces it (#22).
- `conventions/general.md` item 13: thresholds are compared with the unrounded value (#21).

## 2.19.0

Review gaps closed: relative Bash writes, regex characters in the repo path, pruned snapshots, tool directives and
sweeping stages in subshells no longer get past the hooks.

- `review-before-stop.sh`: a Bash redirect, `tee`, `mv`, `cp` or `rm` on a relative path counts as a repo write when
  the transcript line's `cwd` is in the repo; the repo path and `code_dirs` are escaped in full for the regex (a `(`
  in the path no longer turns the check off); a snapshot tree `git gc` pruned is judged as no snapshot instead of
  failing open.
- `lib.sh` `kit_code_lines`: a tool directive written as a `//` comment (`@ts-`, `eslint-`, `prettier-ignore`,
  `biome-ignore`, `deno-lint-ignore`, `go:`, `+build`, `nolint`) is code, so it is reviewed and its commit review is
  not blocked.
- `git-add-all-guard.sh`: a sweeping stage inside `( )` or `{ }`, after `then`/`do`/`else`/`if`/`while`, or behind
  `env`/`command`/`sudo`/`exec`/`nohup`/`time` is blocked; new `hooks/git-add-all-guard.test.sh`.
- `workflows/run-plan.js`: a re-check that still reports a CONFIRMED finding leaves the batch `partial` with an open
  item, not reported as re-checked.
- `decider.mjs`: on SubagentStop the verdict is logged from the hook's `agent_id` and `last_assistant_message`; a
  decider still running is not logged (finished = a handback or an `end_turn` reply), the file is created with `wx`;
  a general-purpose call whose description names the decider counts when the type is not loaded, and the ask-guard
  block says so.
- `post-edit-check.sh`: without `node_modules` only `ai/kit/post-edit.sh` is skipped; the comment and doc checks run.
- `memory-guard.sh` honours `CLAUDE_CONFIG_DIR`; `session-start.sh` kills the snapshot job's whole process tree at its
  time limit and `review-snapshot.sh` removes its temp index when killed.

Windows (Git Bash):

- New `.gitattributes` (`* text=auto eol=lf`): a `core.autocrlf` checkout of the plugin no longer gives bash CRLF
  scripts (`$'\r': command not found`).
- `kit.mjs init` appends `.githooks/* text eol=lf` and `ai/kit/*.sh text eol=lf` to the project's `.gitattributes`
  when git does not read them as LF; `check` warns when missing. New `scripts/kit-init.test.mjs`.
- `kit_project_root` (`lib.sh`, through the new `kit_path`), `decider.mjs` and `usage.mjs` read a backslash path
  (`C:\repo\sub`), and under Git Bash a `/c/repo` one, as `C:/repo`, so a session opened in a subfolder finds
  `ai/kit/` instead of skipping every hook; `review-before-stop.sh` compares paths with `/` and an
  upper-case drive letter; `memory-guard.sh` matches `C:\...\.claude\projects\...\memory` and a Windows
  `CLAUDE_CONFIG_DIR`. New `hooks/memory-guard.test.sh`.
- `session-start.sh` finds the snapshot job's children with Git Bash's `ps` when there is no `pgrep` (a status letter
  before the PID, apart or glued, is skipped).

## 2.18.0

Questions no longer stop the session for the owner unless they are one of the four owner kinds: a decider agent
answers the rest and every verdict is logged as a report.

- New `ai-kit:decider` agent (`agents/decider.md`): researches code, `ai/` docs, git history and the web, replies
  per question with `Verdict: DECIDED | OWNER`, kind, choice, reason, confidence, undo and sources.
- New `hooks/ask-guard.sh` (PreToolUse on AskUserQuestion): blocks the ask until a decider call returned OWNER in
  the last 30 minutes, one ask per call; the verdict is read from the decider's subagent transcript, so background
  calls count; `decider.enabled` and `decider.always_owner` in `ai/kit/config.json`.
- New `hooks/decider-log.sh` (SubagentStop, Stop) and `scripts/decider.mjs`: each decider call's verdicts go to
  `ai/usage/decisions/<YYYY-MM>/<session>.<agent id>.jsonl`, written once, committed with `ai/usage`;
  `/ai-kit:decisions` (`commands/decisions.md`) prints it as a report, low confidence first. `usage-digest.mjs`
  skips `decisions/`.
- `CLAUDE.core.md`: a question to the owner, in a tool or in a reply, goes to the decider first.

## 2.17.0

Windows and subfolder builds are guarded, Python comments are checked, and the 40 KB split rule is enforced.

- `build-while-dev-guard.sh`: without `lsof` (Git Bash on Windows) the port is probed with `ss`, `netstat` or `nc`;
  with none the build runs with a one-line warning instead of silently (#18).
- `build-while-dev-guard.sh`: the default `build_re` matches `--prefix`, `-C`, `--cwd`, `-w` and `--workspace`
  before `run`/`build`, as `--filter` (#19).
- `check-comments.mjs`: `#` comments in py/sh/rb/yaml and Python docstrings are checked; a `*` line counts as a
  comment only inside `/* */`, so `*args` lines are code; new `check-comments.test.mjs` (#20).
- New `scripts/check-size.mjs`, run by pre-commit: an edit to a code file over 40 KB at HEAD is blocked unless it
  only moves lines out (plus imports); escape `ALLOW_LARGE_EDIT=1`. The `split-deferred:` message line the issue
  asked for cannot work: pre-commit runs before the message exists (#17).
- `review-before-stop.sh`: a new session starts with a review snapshot (`session-start.sh`), so a Bash write is
  judged by the code lines changed since, not by the file names in its command or other sessions' earlier work;
  the snapshot diff is limited to the session's edited paths unless a Bash write is among them (#16).
- `githooks/pre-commit`: in a path-limited commit (`git commit -- <paths>`, `-o`) prettier's output is staged in the
  real index too, so it no longer keeps the unformatted copy; `docs/shared-checkout.md` says to commit with no
  paths, as core does (#15).
- Review fixes: `check-size.mjs` skips a merge, cherry-pick or revert, takes a C# `using` statement or a `require()`
  call as code, and ends an open import at its hunk; the port probes read their output before grep (no SIGPIPE
  miss under pipefail); `check-comments.mjs` opens no heredoc on a `(( ))` shift, reads no `/*` inside a JS/TS
  template literal as a comment and limits a never-closed `/*` to its own line; probe tests use canned
  `netstat -ano`, `ss` and `nc` output.

## 2.16.0

A multi-commit plan no longer stops at the coordinator's context limit for the user to start a fresh session: it
runs as a workflow, whose batch reports stay out of the main session's context.

- New `/ai-kit:run-plan` (`commands/run-plan.md`) and `workflows/run-plan.js`: the main session plans and passes the
  batches as Workflow args; the script runs one `ai-kit:committer` per batch, one at a time in plan order, a
  `ai-kit:change-reviewer` per commit beside the next batch, a fresh committer for CONFIRMED findings
  (`fix: <batch>` commit) and one re-check (a whole fresh review after a data or rule fix). An owner decision or a
  blocker stops only the batches that wait on it. `CLAUDE.core.md` and `docs/plan-batching.md` pick it for four
  batches or more; fewer, or no Workflow tool, keep the main-session coordinator.
- `scripts/review-needed.sh` and `hooks/lib.sh` `kit_review_skippable`: the no-code-line test of
  `review-skip-guard.sh`, shared with the workflow (a workflow agent is no Agent call, so the guard never sees it).
- `usage-collect.mjs` also reads workflow agents (`<session>/subagents/workflows/<run>/agent-*.jsonl`).
- `review-skip-guard.sh`: a short hash of digits only counts as a commit too; it was dropped, so a code commit with
  such a hash went unseen and the review of a move-only commit named with it was blocked.

## 2.15.1

- The Stop summary line shows the session's input-equivalent tokens next to its cost:
  `session ≈ $4.61 (in-eq 1.2M)`. A line over 200 code points drops the round's in-eq first, the session's last.
- `usage.money: false` in `ai/kit/config.json` (a subscription, where dollars are not billed) shows the round and
  the session in input-equivalent tokens only: `tokens this round ≈ in-eq 79k: ...` and `session ≈ in-eq 1.2M`.

## 2.15.0

Levers 3 and 4 from the first project trial: the coordinator's context grew from 88k to 250k over one 24-commit plan
(30% of the cost), and move-only commits were still reviewed.

- `handoff-nudge.sh` also runs on PostToolUse for Agent, Task and SendMessage: a coordinator gets no user prompt
  between batches, so the UserPromptSubmit note never fired. Past `handoff.max_context` its note says to launch no
  new batch and to hand the batches left to a fresh session through the "Next session" item.
- `docs/plan-batching.md`: the coordinator reads large docs by `grep -n` and line range only (one whole read of
  `ai/decisions.md` cost 11k tokens on every later call), stops launching batches at the context limit, and gives no
  reviewer to a commit that changes no code line.
- New `review-skip-guard.sh` (PreToolUse on Agent and Task): blocks a commit review (a brief with `git show`) whose
  named commits change no code line; a mode change, an empty new file, a merge, a root commit or a `review.always`
  path (old or new name; an invalid pattern counts as a match) is reviewed as usual.
- `hooks/lib.sh` `kit_code_lines`: the changed code lines without lines moved to another file
  (`git diff --color-moved`; re-indenting allowed across files, while a reorder or re-indent within one file
  counts), byte-safe on non-UTF-8 text, independent of `diff.noprefix` and external diff drivers, and a failing
  `git diff` prints a line so it never reads as no change. `review-before-stop.sh` uses it, so splitting a file no
  longer needs a review for the moved code.
- `handoff-nudge.sh` keeps a separate mark for the coordinator note and skips a subagent's own calls.

## 2.14.0

Commit subagents get their own agent type (lever L2 from the first project trial: commit subagents were 40% of a
session's cost, each starting at about 35k tokens of context as `general-purpose` and growing to 199k on one sweep).

- New `ai-kit:committer` (`agents/committer.md`: Read, Edit, Write, Grep, Glob, Bash; sonnet): starts at about 9k
  tokens of context against about 32k for `general-purpose` (measured in one headless run). Its prompt carries the
  commit-subagent rules, read discipline, verify-output discipline (`tail` a passing run, rerun only the failing test,
  filter a whole-app lint to the changed files), the commit form (`git add <files>`, `git commit` with no paths) and
  the four-item report, so the coordinator's brief holds only the batch.
- `docs/plan-batching.md` §Coordinator pipeline launches `ai-kit:committer`; a batch is one commit, and a sweep over
  many modules is one batch per module or about ten files.
- `review-before-stop.sh` counts a finished `ai-kit:committer`'s edits by its agent type too, not only a `commit:`
  description; the usage records give it the commit role the same way.

## 2.13.4

Fixes from the first project trial (rem-saas) of the token records.

- `commits` was empty when commits ran as `git commit -q` (no `[branch hash]` line to read): a record also takes the
  commits on HEAD since the previous record (the first record: since the round's prompt), spelled as git log
  abbreviates them. A commit another session makes on the same HEAD in that time counts too. Hashes that are
  prefixes of one another are one commit, in records and in the digest.
- Bash tool keys skip leading assignments (arrays too), `env`, `(` or `{` and a command substitution's `NAME=$(`,
  keep a path's basename and key a function definition as `Bash:function`, so no scratchpad, plugin-cache or file
  path lands in a record.
- Records never reached a commit when every commit was path-limited (`git commit -- <paths>`, which the pre-commit
  cannot stage into): `CLAUDE.core.md` says to commit with `git add <files>` then `git commit` with no paths, and
  `check`, `init` and `migrate` warn about record files uncommitted for over a day.

## 2.13.3

Whole-branch review fixes for the token records.

- Records never modify a tracked file (it blocked `git switch`, merge and rebase): the Stop hook appends to a buffer
  `<git-common-dir>/claude-usage/<session>.jsonl` (shared by all branches and worktrees, the session's state) and
  writes nothing under `ai/usage/`; `usage.mjs flush` (new `hooks/usage-flush.sh` on SessionEnd; the SessionStart hook
  flushes other sessions' buffers idle over 6 hours) writes the not-yet-flushed records to a new file
  `ai/usage/<YYYY-MM>/<session>.jsonl`, or `.2.jsonl`, `.3`, ... after a resume, never touching an existing file. A
  buffer lost on this machine is seeded from the session's files in `ai/usage/`.
- `init`, `check` and `migrate` no longer write or ask for `ai/usage/** merge=union` in `.gitattributes`.
- No prompt text is stored anywhere: a record carries `prompt_chars` (length in code points of the round's cleaned
  prompt, on the round's first record) instead of `prompt`; `usage.prompts`, the first-record notice and
  `scripts/usage-mask.mjs` are removed. An agent's `desc` is stored base64 (UTF-8, cut to 200). The digest's costliest
  rounds show session, round, prompt length and role mix, no excerpt; `--baseline` reads prompt lengths only. The
  transcript cache is version 2 (version 1 kept prompt text and is rebuilt).
- Prompt detection skips compact summaries, transcript-only entries and `[Request interrupted` texts, and drops
  browser, IDE, system-reminder, command and local-command blocks; `<pasted_content>` stays; an empty result is no
  round.
- `githooks/pre-commit` skips staging `ai/usage/` in a path-limited commit (temporary index), which left `MM` and
  `D` entries; its "moved verbatim" check skips `ai/usage`.
- `scripts/test-all.mjs`: one command runs every hook, githook and script test plus `check-wrap.mjs` in parallel,
  one line per suite, full output only for a failing one.
- `hooks/session-start.sh` reads the session id from stdin with a 1 s bounded wait per read, so a caller that leaves
  stdin open no longer hangs the hook (`hooks/session-start.test.sh`).
- Review gate block message and `agents/change-reviewer.md`: the brief reads diffs and commits with
  `-- . ':(exclude)ai/usage'`; the reviewer skips `ai/usage/`.
- Summary label `context` is now `peak`; the digest's unpriced total reads through `fmtTok`.
- `CLAUDE.core.md` Git bullet: `ai/usage/` holds kit-written token records, never edit, stage, revert or search them
  (`wc -c` 7840 -> 7955 bytes).
- Assistant messages with model `<synthetic>` are no call (no usage, model or base context).
- `digest --since` that leaves no record prints `no records since <date>`; `commands/usage.md` step 1 covers it.
- 2.13.2 entry corrected: it said `CLAUDE.core.md` was unchanged, but its Agent model bullet changed.

## 2.13.2

- Read discipline for commit subagents: `docs/plan-batching.md` §Coordinator pipeline has the brief say to locate
  with `grep -n` (several patterns in one call), read only the needed line range, send independent reads and
  searches in one message, never read a whole large file to find one symbol and never one `sed -n` per call when
  several ranges are known. Measured driver: one commit subagent ran 250 calls reading code one small `sed -n` or
  `grep -n` per call. Core changed too: see the next bullet.
- Fix: a risky commit batch gets `model: "opus"` and `effort: "high"` (the reviewer and BA rule), sonnet with no
  effort override otherwise; core Agent model bullet says commit subagents get sonnet via the Agent call
  (`wc -c CLAUDE.core.md` 7832 -> 7840 bytes).

## 2.13.1

- Commit subagents run on sonnet: `docs/plan-batching.md` §Coordinator pipeline has the coordinator pass
  `model: "sonnet"` on the Agent call, `"opus"` when the batch touches a DB schema or migration, a calculation, a
  permission or a decision recorded as final (the reviewer and BA rule). `CLAUDE.core.md` Agent model bullet names
  commit subagents in one clause: `wc -c` 7791 → 7832 bytes. Measured driver: commit subagents were 52-57% of
  token cost, nearly all on opus; read the effect in the digest's `by kit` section.

## 2.13.0

- Token records: `hooks/usage-log.sh` (Stop) runs `scripts/usage.mjs record`, which appends each round's per-agent
  token deltas to `ai/usage/<YYYY-MM>/<session>.jsonl` (prompts masked and cut to 1,000 characters). Config
  `usage.enabled` (default `true`), `usage.prompts` (`"full"` default | `"none"`), `usage.prices`.
- Summary: every round prints one line (share by role, context, costliest agent, session total) to the user only,
  never to the model; the first record in a repo adds a one-time notice of what is recorded and how to opt out.
- Records in git, out of the review gate: `githooks/pre-commit` stages `ai/usage/` by name, `init` adds
  `ai/usage/** merge=union` to `.gitattributes`, `kit.mjs` allows `ai/usage` in the `ai/` layout, and
  the Stop hook's diffs (with or without a snapshot) exclude `ai/usage`.
- `scripts/usage.mjs digest [--since] [--baseline]` and `/ai-kit:usage`: a fixed-size digest (cost per model, role,
  kit version with reviewer findings per review; driver signals; costliest rounds; outliers) and the one change
  that cuts the largest driver. `--baseline` reads local transcripts before any record exists.

## 2.12.3

- `CLAUDE.core.md`: review gate wording matches the Stop hook (`review.always` path reviewed regardless of size; a
  calculation, permission or final-decision change gets a reviewer launched by hand; "skip review" covers earlier
  edits; any change outside `*.md` goes through review except what the hook lets pass); no third pass after the
  re-check, except a CONFIRMED data or rule correctness finding, which gets a fresh reviewer; the fix summary holds
  no word review anywhere; a multi-commit plan waits for the owner's go only when an owner decision is open; project
  CLAUDE.md wins on commands, stack, branch and deploy, never over the four owner kinds; UI-only defined, a user's BA
  request overrides the small-job skip; conventions files also read what they add to; this-repo standard goes to
  `pre-commit.sh` when a script can catch it; build guard and comment-check pointers corrected.
- `docs/kit-proposals.md`, `docs/plan-batching.md`, `docs/ai-docs.md`, `docs/ai-layout.md`,
  `docs/code-comments.md`, `docs/shared-checkout.md`: same rules and corrections (dates matched, `comments.skip`
  for license headers and vendored files, Decision `rule` one line).
- `agents/business-analyst.md`, `agents/change-reviewer.md`: owner kinds listed without the core pointer; reviewer
  description names the per-commit launch; BA item 5 uses the pre-commit short form.
- `commands/check.md`, `commands/init.md`, `commands/retrofit.md`, `commands/harvest.md`,
  `commands/memory-export.md`: `check` fixes every problem and each warning unless it needs an owner decision, `init`
  runs that procedure; the retrofit `config` row no longer mentions `analysis-sources.md`; retrofit reports carry
  the plan's new `open:` lines; harvest follows core and reviews the staged diff; memory dir printed only when it
  holds files.
- `README.md`, `scripts/kit.mjs`: hook bullets corrected; "§Install" citations name "Install in a project".
- `templates/ai-kit-project/config.json`: `comments.include` no longer lists `py` (the check reads `//` and `/* */`).

- `CLAUDE.core.md` 11019 -> 7793 bytes (injected every session): text moved to where it is needed, duplicates removed,
  no rule dropped. Coordinator pipeline in full in `docs/plan-batching.md` (core keeps a pointer; `commands/retrofit.md`
  points there); the 40 KB split rule is `conventions/general.md` item 12 (typescript, csharp, nestjs keep the how);
  the Stop hook mechanics stay in `README.md` (core keeps what the agent does); the Project knowledge target map is
  `docs/ai-layout.md` §Where a fact goes (`commands/memory-export.md` reads it there); screen specs and several
  items are one line plus a pointer (`docs/screen-specs.md` gained "a screen change starts from its spec"); "work
  outside the request" is defined once, in report item 7; the Next session content list is in the
  `hooks/handoff-nudge.sh` note.
- `CLAUDE.core.md`: the Language bullet no longer writes the Review closed phrase in a code span (the hook ignores a
  phrase preceded by a backtick or quote); it names the phrase of report item 3, which stays plain text.
- `conventions/*.md`: the "review-checklist wins" sentence is only in `general.md`, the others say "Adds to".
- `docs/ai-docs.md`: dropped the line repeating core's rule for where a doc goes; human-doc lines folded into one.
- `commands/harvest.md`: framework placement points to `docs/kit-proposals.md` §Cross-repo test (which now says to
  create the file when missing). `templates/ai-kit-project/review-checklist.md`: items 2 and 3 dropped (the reviewer
  already checks CLAUDE.md hard rules and `general.md` item 4). `README.md` Stop bullet: "skip review" covers earlier
  edits. `githooks/pre-commit`: comment points to `general.md` item 12.

## 2.12.2

- `hooks/session-start.sh`: makes the core paths absolute with `sed`; bash 3.2 (macOS) took 2 s for the
  `${core//...}` replacement on the UTF-8 text, now 0.05 s for the whole hook. Same output.
- `hooks/post-edit-check.sh`: `run` starts each check in the background and the hook waits for all, so an edit
  waits for the slowest check, not the sum; failures are still reported in start order, same format. A `run`
  inside a subshell (`( cd x && run ... )`) runs in the foreground and its failure now blocks (was: lost); a job
  `post-edit.sh` starts itself is not waited for. A file reached through a symlinked folder (`/tmp` ->
  `/private/tmp`) is checked (was: skipped). Tests: `hooks/post-edit-check.test.sh`.
- `templates/ai-kit-project/post-edit.sh`: the example calls `node_modules/.bin/eslint`, not `npx` (0.2-1 s per
  edit), and says checks run in parallel, a subshell `run` in the foreground.

## 2.12.1

- `/ai-kit:harvest`: shows the owner one decision table and waits for a go before editing; a proposal that changes
  the owner kinds, a review gate or what the agent decides alone goes to Open; the author name no longer counts as
  owner approval (sessions file under the owner's account). Before accepting: framework rules go in their own
  `conventions/<name>.md`, a proposed script must catch the failure in the evidence, existing hooks and commands
  count as duplicates. Lands only what the issue proposes, with fresh neutral examples; a partial accept is
  commented on the issue.

## 2.12.0

- `githooks/pre-commit`: a partially staged file gets only its index blob formatted by prettier, its other hunks
  stay unstaged (was: the whole file re-staged); `docs/shared-checkout.md` updated (#2).
- `githooks/pre-commit`: blocks an added `eslint-disable ... -- moved verbatim`; `CLAUDE.core.md` 40 KB split rule
  says a suppression names the real reason (#8).
- `docs/ai-docs.md`, `scripts/check-docs.mjs`: a pointer into code names a file and symbol, never a line number;
  an added `a.ts:12` in an `ai/` doc is reported, code spans included (#1).
- `CLAUDE.core.md`: an approved multi-commit plan runs to the end without asking between commits (#4); a reviewer
  brief names items the coordinator added beyond the request, `also in scope`, which `change-reviewer` counts as
  asked (#14; running fix subagents in parallel not taken: shared index).
- Framework convention files: `conventions/nestjs.md` (splitting a provider over 40 KB, #3; `typescript.md` item 11
  points to it), `conventions/typeorm.md` (guard nullable where values, #9; rule only, no lint script). Listed in
  `conventions` like a language; `docs/kit-proposals.md` cross-repo test covers frameworks.
- `conventions/typescript.md`: every value a `queryFn` reads is in its `queryKey` (#11); item 12 lint baseline
  (`js.configs.recommended`, `no-floating-promises` in server code, TanStack `exhaustive-deps`) (#10, #11).
- `conventions/sql.md` item 11: user-typed search uses `ILIKE`, LIKE input escaped through one helper (#6).
- Owner decision kind 1 (money) covers any change to an amount a customer pays, a bug fix included;
  `business-analyst` lists it under Owner decisions, never as assumed (#13).
- `githooks/pre-commit`: no `ai/kit/config.json: No such file` error in a repo without `ai/kit/`.

## 2.11.0

- `ai-kit:business-analyst` and `ai-kit:change-reviewer` default to sonnet at medium effort (was opus, high). The
  caller passes `model: "opus"` and `effort: "high"` when the change touches a DB schema or migration, a calculation,
  a permission, or a decision recorded as final (`CLAUDE.core.md` "Agent model"; the Stop hook's reason says the
  same).
- BA runs for DB and business-rule changes only; a UI-only change (layout, copy, style) is summarized by the main
  session. A small job's final report holds Done, Checked and Git, plus Decided and Open when they hold anything.
- `review-before-stop.sh`: a change of at most `review.skip_lines` changed code lines (default 10), with no new file
  and no path matching `review.always` (migrations, schema, auth, permission, policy, `.sql`, `.prisma`), passes
  without a review. A review is an Agent of type `ai-kit:change-reviewer`, or a general-purpose one with "review" in
  its description (an Explore agent named "review ..." no longer counts). The block reason names only the next step
  for the review state (none, reviewed, re-checked). Without a snapshot the diff covers only the paths this session
  edited, so another session's work in a shared checkout is not counted. `open("x")` reads and `sed -i` on `/tmp`
  no longer count as repo writes; a codemod, a formatter run with `--fix`/`--write`, and `mv`/`cp`/`rm` on a repo path
  do. `cd <root>` now matches the root without its trailing slash. The small-change pass applies only before the first
  review (fixes always go to the re-check), and a commit batch whose description holds "review" is not taken for a
  review. Test: `hooks/review-before-stop.test.sh`.
- Coordinator pipeline: CONFIRMED fixes go back to the commit's own subagent by SendMessage instead of a fresh
  `commit: fix` subagent; a commit subagent's brief has it read `CLAUDE.core.md` "Working conventions" first.
- Kit clone only: `.githooks/pre-commit` runs `scripts/check-wrap.mjs`, which blocks added prose lines over 120
  characters in `*.md` and `*.sh`; enable with `git config core.hooksPath .githooks`.
- `post-edit-check.sh` starts `node` only for the checks whose include/skip scope holds the edited file.
  `handoff-nudge.sh` reads the transcript tail only.

## 2.10.0

- `docs/plan-batching.md`: a request or plan with several items starts with one inventory pass (item → files,
  functions, shared resources), asks all owner questions at once, and batches items that touch the same file into one
  commit; separate commits only for move-only splits, contract changes and revertable migrations. A bug or
  calculation fix covers its whole unit before the commit; a mechanical sweep over many files uses a codemod or
  script; hot files (plan, decision log, roadmap, lockfile) are updated once per batch.
- Coordinator pipeline (`CLAUDE.core.md`): when a commit subagent returns, its reviewer (reading `git show <hash>`)
  and the next independent batch's commit subagent start in the same message; still one commit subagent editing
  the repo at a time. Fix subagents run once no commit subagent runs.
- Independent reads, searches and checks go out in one message.
- `docs/shared-checkout.md`: self-contained commits are per batch of code, not per item.

## 2.9.0

- `/ai-kit:retrofit` (`commands/retrofit.md`): brings an existing project into the `ai/` layout. No argument →
  survey and `ai/plans/retrofit.md`; then one category per run and commit (`config`, `move`, `data`,
  `decisions`, `requirements`, `screens`, `api`), written only from the code and existing docs; unknowns become
  open questions; an extracted decision keeps a final source status as `Confirmed`, else `Default`.
- `kit.mjs check` UI detection also looks at tracked top-level folders and `packages/*` (e.g. `mobile/`), skipping
  `docs/`, `website/`, `examples/`: a project without a `ui` key may see the detection warning for the first time.
- `docs/screen-specs.md`: an index line without a spec yet, `- <name> → <entry file> (no spec)`.
- `kit.mjs inventory` (read-only): `ai/` entries outside the layout, schema sources, screen files with a
  `ui.include` suggestion, API spec and route files, decision docs, other `.md` outside `ai/`. Test:
  `scripts/kit-inventory.test.mjs`.

## 2.8.0

- Screen specs for web and mobile projects (`docs/screen-specs.md`): config key `ui` (`platforms`, `include`,
  `api`); one file per screen in `ai/screens/` linked to the API spec; order data → spec → API spec → API → screen;
  existing screens get a spec when next changed.
- `conventions/general.md` item 11: one screen = one server read, the client only formats; item 6: a business
  state change is its own command.
- `scripts/check-specs.mjs` (pre-commit, warnings only): endpoints missing from `ui.api` (`.md` folder, OpenAPI
  JSON or YAML), more than one read, duplicate ids, index drift, a new screen file no spec lists; `--map` prints
  the reverse map. Tests: `scripts/check-specs.test.mjs`.
- `kit.mjs check`: problem on a malformed `ui`; warns when a web or mobile repo has no `ui` key, or `ui.platforms`
  is set without `ai/screens/index.md`. Core rule, BA and reviewer read the screen specs when `ui.platforms` is set.
- `ai/` layout (`docs/ai-layout.md`): fixed categories (decisions, requirements, data per entity, feature specs,
  screens, API, plans, notes), file names, ids and a format per type; one template each in `templates/ai/` (not
  copied by `init`). `ai/data/` is the base that screen and API specs point to. `analysis-sources.md` template
  and BA fallback use these paths; `kit.mjs check` warns on any other top-level entry under `ai/`.
- AI-only doc scope narrowed to `ai/**/*.md`: files outside `ai/` are not governed; a doc the agent creates goes
  under `ai/` unless the user names another place or form. `check-docs.mjs` default and template `docs.include`:
  `^ai/.*\.md$` (existing projects keep their `docs.include`; `check` warns while it equals the old template value).

## 2.7.0

- Project knowledge lives in the repo, never in auto-memory (one machine only, the team never sees it):
  `CLAUDE.core.md` rule with the target per kind of fact; references go to `ai/notes.md`.
- `hooks/memory-guard.sh` (PreToolUse on Write/Edit/MultiEdit/NotebookEdit/Bash): blocks writes into
  `~/.claude/projects/*/memory/`, names the repo file instead.
- `kit.mjs init` adds `"autoMemoryEnabled": false` to `.claude/settings.json` (existing projects: rerun init);
  `init` and `check` warn, never fail, on auto-memory on or memory files left; `hooks/session-start.sh` asks for
  the export while files are left.
- `/ai-kit:memory-export` (`commands/memory-export.md`): moves each memory file to its repo target, then deletes
  the local copy.

## 2.6.0

- Kit proposals: a project session files a GitHub issue labelled `proposal` on korn9537/ai-kit for a cross-repo
  standard, a review finding seen twice, a user correction that holds in any repo, or a kit gap; never an edit of
  the installed plugin (the old core rule pointed there, which an update overwrites). `docs/kit-proposals.md`: when
  to file, the cross-repo test, search before filing, fallback file `ai/kit/kit-proposals.md` without `gh`.
  `.github/ISSUE_TEMPLATE/proposal.md`: the issue body.
- `/ai-kit:harvest` (`commands/harvest.md`): in the ai-kit clone, accept, merge or reject open proposals; accepted
  ones land in one commit with `Closes #<n>`.
- `CLAUDE.core.md` Conventions and `agents/business-analyst.md` item 5 point to the issue route.
- `hooks/session-start.sh`: asks for filing when `ai/kit/kit-proposals.md` is not empty.

## 2.5.4

- `scripts/check-docs.mjs`: one removed line excuses only one added copy as a move, a copy in its own file first
  (a line removed once and added three times reported two hits less than it should). HEAD versions are read with
  one `git cat-file --batch` instead of one `git show` per changed doc. The filler rule also reports `~` before a
  digit and about, around, roughly, approximately before (a) dozen, hundred or thousand; a year 1900-2099 after
  them passes.
- `scripts/check-docs.test.mjs`: fixture tests (temp git repos) for check-docs.
- `CLAUDE.core.md`, `conventions/csharp.md`, `conventions/typescript.md`: "over 40 KB" (was "~40 KB");
  the commit-subagent paragraph in `CLAUDE.core.md` rewrapped. README lists the test.

## 2.5.3

- MIT `LICENSE`; `plugin.json` names it.

## 2.5.2

- `scripts/check-docs.mjs`: the filler rule also reports a vague quantity (`about`, `around`, `roughly`,
  `approximately` before a number or `every <number>`), per ai-docs.md "Exact values".

## 2.5.1

- `scripts/check-docs.mjs`: a rule hit on an edited line is skipped when one removed line of the same hunk,
  outside fences and frontmatter, already held at least as many of each fragment the rule matches (bold text,
  Thai runs); a task-status flip on a bold line passes, a new or repeated fragment is still reported. An
  unchanged line leaving a fence or frontmatter is now checked, and a file renamed from an out-of-scope path
  (for example `README.md` into `docs/`) is checked in full; a line moved in from an out-of-scope file is no longer skipped as a move.

## 2.5.0

- `CLAUDE.core.md`: the agent decides; the owner holds only money, irreversible or outward actions,
  legal/privacy/consent, and changing a Confirmed decision. The BA summary waits for a go only on those; other
  choices go to a new report item 6 Decided (Open is 7, Next session 8). `business-analyst` asks only owner
  questions, else states an assumption (reported under Decided). `/ai-kit:check` and `/ai-kit:init` apply the
  named fixes, asking only before deleting an untracked hook or file or editing settings outside the repo;
  `/ai-kit:migrate` writes review-by-hand wording itself. Commit subagents return their choices too. A build while
  the dev server runs is not asked about: run the typecheck (default and template hints say so; a project hint
  in `ai/kit/config.json` is kept). The analysis-sources template names status labels.

## 2.4.1

- `CLAUDE.core.md` report item 6: Open holds only owner decisions, out-of-scope work and blocked in-scope work;
  in-scope fixable items are fixed before the report, kept limits go in code or docs. Commit subagents return
  item-6 items only.
- Paths with `"`, `\`, control or non-ASCII characters are no longer skipped: `check-docs.mjs` reads C-quoted diff
  headers, `check-comments.mjs` lists files with `-z`, `review-before-stop.sh` and the pre-commit kit-check trigger
  use `core.quotePath=false` (a comment-only edit to such a file no longer asks for a review).

## 2.4.0

- `scripts/check-docs.mjs`, run by pre-commit and post-edit: added lines of docs in `docs.include` (default
  `CLAUDE.md`, `docs/**/*.md`, `ai/**/*.md`; `docs.skip` drops READMEs, mockups, design) fail on emoji, bold, filler,
  dates, Thai outside quotes or code (allowed in table rows). Skips fences, code spans, frontmatter, moved lines
  (renames, splits), merges, cherry-picks and reverts; quotes exempt Thai and dates; runs before prettier. Off:
  `include: "^$"`. `ai/kit/` templates drop bold labels.

## 2.3.0

- `CLAUDE.core.md` §Language: reply to the user in Thai; docs, comments, commits and subagent briefs in English.
  New `docs/ai-docs.md`: docs are for AI readers only, token-minimal; when a review runs, `change-reviewer` also
  checks touched docs against it.

## 2.2.0

- `conventions/dart.md` §4: user-facing strings go through gen-l10n `AppLocalizations`, never a literal in a
  widget; ARB files keep the same keys; dates and numbers through one locale-aware helper.

## 2.1.0

- `kit.mjs migrate` (and `/ai-kit:migrate`) migrates a 1.x repo in one step: deletes `ai-kit/` and the old agent
  copies, drops the kit hooks and enables the plugin in `.claude/settings.json`, removes the `@ai-kit` import,
  cleans `ai/kit/` (config and known header lines), then runs `init` and `check`. Refuses on a dirty tree, or when
  `ai-kit/` is not the tracked 1.x copy. Deletes only files git tracks, after all writes; lists edited agent copies
  and any `ai-kit/` file the plugin lacks with a `git show HEAD:<path>` hint; keeps an existing marketplace entry and an
  explicit `false` for the plugin.

## 2.0.0

- Ships as a Claude Code plugin in its own repo (`korn9537/ai-kit`), which is also the `korn9537` marketplace.
  Projects enable `ai-kit@korn9537` in `.claude/settings.json` instead of copying `ai-kit/` (README §Migrating).
- Hooks are wired in `hooks/hooks.json` with `${CLAUDE_PLUGIN_ROOT}`; `settings.hooks.json` is gone. Every hook
  exits silently in a project without `ai/kit/`.
- New `session-start.sh` injects `CLAUDE.core.md` (replaces the `@ai-kit/CLAUDE.core.md` import; plain text without
  `jq`) and records the plugin path in `<git-common-dir>/ai-kit-root` for the pre-commit shim, as `init` does. Hooks
  use the git toplevel of the project dir, so a session started in a subdirectory still finds `ai/kit/`.
- Agents are `ai-kit:change-reviewer` and `ai-kit:business-analyst`, read from the plugin; `.claude/agents/` copies
  must go.
- `sync.mjs` is replaced by `scripts/kit.mjs init|check` and the `/ai-kit:init`, `/ai-kit:check` commands; no
  `install` or `collect`. `check` also fails when the plugin is enabled in no settings scope or 1.x leftovers remain
  (including `code_dirs` `ai-kit` and a missing `shared_checkout_doc`).
- The `.githooks/pre-commit` shim finds the kit through `ai-kit-root`; without it, it warns and runs only
  `ai/kit/pre-commit.sh`.
- `shared_checkout_doc` defaults to the plugin's `docs/shared-checkout.md`; templates drop `ai-kit` from
  `code_dirs`. `VERSION` is gone: `version` in `.claude-plugin/plugin.json` is the only source.

## 1.4.1

- `post-edit-check.sh` runs in a repo with no `package.json`; `node_modules` is required only when one exists.

## 1.4.0

- Conventions for `csharp` and `typescript`. `general.md` gains one save = one write (upload first, bulk), paged
  lists, no read in a loop, server-side authorization, no committed secrets, 24px targets (44pt in `dart.md`);
  `sql.md` gains names, enum strings, FKs, unique names, concurrent indexes, three-step NOT NULL, idempotent imports,
  DDL via migrations. Moved out: `/v1`, the UUID v7 column default, problem+json `code`, the append-only trigger.
- `sync.mjs check` reports an `ai/kit/config.json` that is malformed or not a JSON object instead of throwing.

## 1.3.0

- Cross-repo coding rules in `conventions/` (`general.md` plus one file per language), chosen by config
  `conventions` (default `[]`); read by both agents and `CLAUDE.core.md`, checked by `sync.mjs check`.

## 1.2.2

- The closing phrase is shown without backticks where the model is told to write it (`CLAUDE.core.md`, the
  `review-before-stop.sh` block message), since the hook does not count a backticked phrase. Code spans in kit
  Markdown stay on one line, so prettier in a project's pre-commit does not reflow them.

## 1.2.1

- A commit subagent never launches its own reviewer (it doubled every review). `review-before-stop.sh` counts
  `Review closed: re-checked once` (not quoted) in a main-session reply right after a re-check as a review. It also
  reads the reply being stopped from the hook input (`last_assistant_message`), which may not be in the transcript yet.

## 1.2.0

- Multi-commit plans run with the main session as coordinator and one fresh background subagent per commit
  (`CLAUDE.core.md`); `review-before-stop.sh` counts a finished subagent's edits and asks for a fresh background
  reviewer per commit with one re-check.
- `handoff-nudge.sh` (UserPromptSubmit) and report item 7 "Next session"; config `handoff.max_context`.

## 1.1.0

- `check-comments.mjs`: Go and Dart support. Go directives and Dart `// ignore:` lines do not count as comments,
  `_test.go`/`_test.dart` files are exempt from the dated check, and Go files marked
  `// Code generated ... DO NOT EDIT.` are skipped.

## 1.0.0

- First portable release: `CLAUDE.core.md`, agents `business-analyst` and
  `change-reviewer`, hooks (review-before-stop, review-snapshot, post-edit-check, git-add-all-guard,
  build-while-dev-guard), pre-commit runner, `check-comments.mjs`, `sync.mjs` install/check/collect, `ai/kit/`
  templates.
