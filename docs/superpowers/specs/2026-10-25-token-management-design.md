# Token management for ai-kit projects — design

Reader: the builder who plans and implements this in the ai-kit plugin (`korn9537/ai-kit`, this repo). Kit
conventions apply: `CLAUDE.core.md` (in this repo), `docs/ai-docs.md` for AI-facing prose, README §Editing the kit
for versions and the changelog.

## Why

The owner cannot see where tokens go in real projects. The only view today is Claude Code's Agent map: one
"tokens" number per agent that matches the agent's peak context, not its cost. Without a measure there is no way to
pick a change to the kit or to tell whether a change helped.

A manual analysis of local transcripts (scripts referenced under §Evidence) found:

- rem-saas, 13 sessions with 15+ agents: commit subagents 57% of cost, reviewers 23%, main session 17%, BA 2%.
  Session `61047b06` alone: commit subagents 68%, reviewers 19%, main 10%.
- 13,092 subagent calls on opus vs 468 on sonnet: commit subagents inherit the main session's model because the kit
  names none.
- One commit subagent: 250 calls, context 35k → 406k, mean 249k read per call, 28% of its session's cost; its tool
  calls were mostly one small read each (`sed -n` 55, `grep -n` 70, `python3` 48).
- Every call starts from a fixed base (system prompt, tool schemas, skill and plugin lists): 48.5k tokens in the
  session that produced this design, 31% of that session's cache reads.
- Cost is dominated by cache reads (calls × context), then cache writes, then output.

## Goals

1. Measure: every round of every session in a kit project is recorded in the repo, so the team's usage can be
   analysed per prompt, role, model, person and kit version.
2. Show: after every round the user sees a one-line summary of that round's usage.
3. Analyse: one command reports where tokens went and proposes the next change, from the repo's records or from
   local transcripts (baseline before records exist).
4. Reduce: kit rules and mechanisms that cut the measured drivers, landed one per kit version so the records show
   each one's effect.

## Non-goals

- Dollar billing or invoices. The kit does not know the team's plan.
- Changing the main session's model or the user's settings.
- Any network upload. Records live in the project repo only; pushing stays the user's act.

## Anti-goals (a failure even if it works)

- The summary or the recording adds tokens to the model's context. It must be shown to the user only.
- A record makes the Stop hook slow or flaky (over 2 s on a large session), or blocks a stop on error.
- Recording a usage file triggers the review gate, appears as "code changed", or pollutes reviewer diffs.
- A secret pasted into a prompt lands in git.
- A cost cut that lowers review quality without the records showing it.

## Decided

Owner decisions (from the conversation):

- Records are committed in the project repo, prompts included, so the team's prompts can be analysed.
- On by default in every kit project on update, prompts included (`usage.enabled: true`, `usage.prompts: "full"`):
  the owner is the main developer of these repos. A project opts out in `ai/kit/config.json`.
- The summary is shown after every round, and every round is recorded.
- The levers below are approved in principle; each lands as its own kit version after the baseline exists.

Builder's calls made in this design (the owner may overrule):

- Metric: raw counts per token type are recorded; reports add a cost using Anthropic's published ratios relative to
  the model's base input price (cache read 0.1, 5-minute cache write 1.25, 1-hour cache write 2, output 5) times a
  relative base price per model, so opus and sonnet sum into one figure and L1 shows its gain. Prices: config
  `usage.prices` (`{"<model id prefix>": <base input $ per MTok>}`), kit defaults from Anthropic's pricing page at
  build time, a model with no price reported apart. Valid for API billing and a fair proxy for subscription limits.
- Reader of the records: ai-kit only (`/ai-kit:usage`), never a person. No agent reads raw records either: a script
  reduces them to a fixed-size digest first (part 4), so analysing usage stays cheap however large the logs grow.
- Prompt text: stored up to 1,000 characters (enough for an agent to classify the request), after masking
  secret-looking values and base64-encoded (UTF-8), so a grep of the repo does not hit it; only the digest and the
  summary decode it. Config
  `usage.prompts`: `"full"` (default) or `"none"`. The first record in a repo prints a one-time notice in the
  summary line that prompts are recorded and how to opt out.
- Storage: part files `ai/usage/<YYYY-MM>/<session-id>.<n>.jsonl` (n from 1), append-only: no two sessions write the
  same file, so shared checkouts and branches do not conflict. A record never modifies a tracked file (that blocks
  `git switch` and rebase): it appends to the session's newest part only while that part is not in the index
  (`git ls-files --error-unmatch`), else it starts part `n+1`. A session's prior records are all its parts in part
  order; the month folder is that of the session's existing parts, else the month of its first transcript
  timestamp. `ai/usage` becomes an allowed `ai/` entry (`kit.mjs` `AI_LAYOUT`, `docs/ai-layout.md`).
- Commit: the kit's `githooks/pre-commit` stages new or changed files under `ai/usage/` by name on every commit.
  No separate commit, no agent action. Best effort: records ride on whatever commit comes next, on whichever branch;
  a path-limited commit (`--only`, `<paths>`, which runs the hook on a temporary `next-index-*.lock` index) skips the
  staging and leaves the records for a later commit. Other sessions' usage files may ride along (they are logs, not
  work). A part already in the index is never appended to, so branch switches and rebases are never blocked and no
  merge driver is needed.

## Parts

### 1. Recorder (Stop hook)

- New `hooks/usage-log.sh` on `Stop`, beside `review-before-stop.sh`; exits 0 silently without `ai/kit/` or when
  `usage.enabled` is `false` (default `true`). Never blocks; any error → exit 0, one stderr line.
- Calls `node <plugin>/scripts/usage.mjs record` with the hook input. The script reads the main transcript and every
  `<session>/subagents/agent-*.jsonl` (+ `.meta.json` for description and type).
- Counting: one usage per assistant message id (streamed blocks repeat the usage; keep the last). Main session =
  lines without `isSidechain`. Each subagent counted from its own file.
- Records hold deltas: what was used since the session's previous record. Delta = the session's cumulative totals
  now minus the sum of the deltas already in its `ai/usage` file, so the file is the state: a session resumed on
  another machine or with a lost cache is not counted twice, and summing any set of records gives a correct total.
  A round can produce several records (the review gate blocks a stop, the turn continues); a background agent that
  finishes in a later round lands in that round's record.
- Incremental parsing (speed only, not correctness): a cache in the git dir (`<git-dir>/claude-usage/<session>.json`)
  keeps each transcript's byte offset and running totals, so a Stop parses only new lines. Target under 300 ms per
  Stop on a 30 MB transcript; without the cache the recorder parses in full.
- Record, one JSON line per Stop (JSONL; key names as here, `v` bumps on any change of shape):
  `v`, `ts`, `session`, `round` (count of real user prompts so far), `kit` (plugin version), `project` (repo folder
  name), `user` (`git config user.name`), `branch`, `prompt` (this round's prompt, masked, cut, base64; absent
  when `usage.prompts` is `none`), `duration_s` (since the round's prompt), `commits` (hashes committed in the round),
  `base_context` (the main session's first call context, on the session's first record), and `agents`: one entry per
  agent with usage in this delta, with `id`, `role`, `desc` (base64, masked and cut to 200), `model`, `calls`,
  `input`, `read`, `write_5m`, `write_1h`, `output`, `peak` (largest context of one call), `tools` (call count per
  tool; Bash keyed by its first command word, `Bash:sed`), `largest_result` (largest tool result in characters),
  and for reviewers `findings` (`confirmed`, `plausible`). No cost or price in a record: prices apply at analysis,
  so a price change re-prices old records.
- Roles: description starting `commit:` → commit subagent; `change-reviewer` type, or description containing
  "review" → reviewer; `business-analyst` type → BA; else other subagent; main session → coordinator.
- Reviewer quality signal: for each reviewer agent, count `CONFIRMED` and `PLAUSIBLE` in its last reply (`findings`
  in the record), so a cheaper model's effect on review quality shows in the data.
- Masking before write (the input is first capped at 20,000 code points, backing off to a word edge):
  private key blocks, `sk-`/`ghp_`/`gho_`/`github_pat_`/`xox[bp]-`/`AKIA`/`AIza`/`glpat-`/`npm_`/`sk_live_`/
  `rk_live_` tokens, Telegram bot tokens, Discord webhook tokens, JWTs, `Authorization: Basic` and `Bearer` values,
  `password=`/`secret=`/`token=`/`api key`/`access key` values, URLs with credentials, long base64/hex runs →
  `[masked]`.
- Prompt detection: a user entry that is a compact summary, transcript-only, a tool result or `isMeta` is no prompt;
  neither is a `[Request interrupted` text. Browser, IDE, system-reminder, command and local-command blocks are
  dropped from the text; `<pasted_content>` stays. A prompt empty after that is not a round. Assistant messages
  with model `<synthetic>` are no call.

### 2. Summary line (every round)

- The recorder prints `{"systemMessage": "<line>"}` (shown to the user, not to the model). The builder verifies first
  that a Stop hook's `systemMessage` reaches the user without entering context; if it does not, fall back to the
  record only and report it.
- Line: this round's input-equivalent cost and its split by role, the main session's peak context, the costliest
  agent of the round (desc, model, calls, peak), and the session total. Example:
  `tokens this round ≈ 1.4M in-eq: commit 62% · review 21% · main 17% | peak 182k | top: commit: pricing (opus,
  120 calls, peak 310k) | session ≈ 5.0M`

### 3. Keeping records out of the review gate

- `hooks/review-before-stop.sh` (both diff paths) and `hooks/review-snapshot.sh` exclude `ai/usage/`.
- Reviewer briefs read `git show <hash> -- . ':(exclude)ai/usage'` (`docs/plan-batching.md`).
- `githooks/pre-commit` runs the usage staging before its other checks; `check-docs`/`check-comments` never see
  `.jsonl`.

### 4. Analysis (`/ai-kit:usage`)

- `scripts/usage.mjs digest [--since <date>]` over `ai/usage/**`: a fixed-size, token-minimal text for an agent (at
  most 3,000 tokens however many records), per `docs/ai-docs.md` form. Sections: totals and cost per model; shares
  by role and by model within each role; cost per commit and per round; per kit version the same figures (a
  lever's effect); driver signals per role (mean calls, mean and max `peak`, top tool counts, largest results,
  `base_context` trend); reviewer findings per model; the 10 costliest rounds with prompt excerpt (200 characters),
  user and the role mix; outliers (an agent over 150k peak or 150 calls).
- `scripts/usage.mjs digest --baseline` builds the same digest from this repo's local transcripts
  (`~/.claude/projects/<slug>/`, slug as in `hooks/lib.sh` `kit_memory_dir`) without writing records: the
  before-picture.
- `commands/usage.md`: runs `digest` (`--baseline` when `ai/usage/` is empty), reads only the digest, names the
  largest driver with its evidence and the change that would cut it; a cross-repo change → kit proposal per
  `docs/kit-proposals.md` (harvest lands it, the next digest compares by kit version); a repo-only change →
  `ai/kit/review-checklist.md` or the project's settings. Never reads `ai/usage/` files directly.

### 5. Levers (each its own kit version, after the baseline)

| # | change | where | driver it targets |
|---|---|---|---|
| L1 | commit subagent launched with `model: "sonnet"`; `"opus"` only when the batch touches a DB schema or migration, a calculation, a permission or a decision recorded as final (same rule as reviewers) | `docs/plan-batching.md` §Coordinator pipeline, `CLAUDE.core.md` Agent model | subagents run opus by inheritance |
| L2 | a commit subagent hands back at a context limit (`usage.subagent_max_context`, default 150000): finish the current item, commit, return what is left; the coordinator launches a fresh one | plan-batching rule + a PostToolUse nudge for subagent calls (builder verifies the hook input identifies the subagent and its transcript; fallback: rule only plus a batch-size cap) | one subagent growing to 406k |
| L3 | read discipline in the commit-subagent brief: locate with `grep -n`, read the needed range, send independent reads in one message, never read a whole large file to find one function | plan-batching brief text | 170+ single small reads |
| L4 | base-context report: `digest` shows `base_context` per session and the enabled plugins and MCP servers; `kit.mjs check` warns when the base passes `usage.base_warn` (default 40000) and names project settings that disable unused plugins | `scripts/usage.mjs`, `scripts/kit.mjs` | 48.5k fixed per call |
| L5 | main session stays coordinator; handoff threshold reviewed from data (`handoff.max_context`) | config default only if data supports it | main session context growth |

Order: records and baseline first (parts 1–4, one minor version), then L1, then L3, each its own version; the
`digest --baseline` from local transcripts is enough to start L1. L2, L4 and L5 are later plans, made once records
from L1 and L3 exist.
Each lever's version is compared with the previous one in the per-kit digest; a lever that raises cost or lowers
reviewer findings per change is reverted.

## Constraints

- Hooks: bash 3.2 compatible (macOS), `jq` and Node 22+ as today; Stop hook timeout 10 s; failure never blocks.
- Kit rules: project files in `ai/kit/` are never overwritten; patch/minor/major per README §Editing the kit (parts
  1–4 are minor: new hook, command and config keys with defaults).
- Tests: fixture tests like the existing `hooks/*.test.sh` and `scripts/*.test.mjs`: counting with repeated usage
  lines, incremental offsets, masking, role mapping, review-gate exclusion, pre-commit staging.

## Left to the builder

- Internal structure of `usage.mjs`, state-file format, exact summary wording within the anti-goals.
- Masking patterns beyond the list, if tests show gaps.
- Whether L2's nudge is feasible as a hook; if not, rule plus batch cap.

## Evidence

Analysis scripts used for the numbers above (session scratchpad, not in the repo): `analyze.mjs` (cost by role,
model, agent), `growth.mjs` (context growth, largest tool results), `tokens.mjs` (per round). The recorder and
`usage.mjs digest` replace them.
