# Changelog

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
