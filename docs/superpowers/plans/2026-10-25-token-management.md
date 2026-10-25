# Token Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every round's token usage in kit projects (repo JSONL), show a one-line summary each round, give
ai-kit a fixed-size digest to analyse, then land two levers (sonnet commit subagents, read discipline).

**Architecture:** A Stop hook calls `scripts/usage.mjs record`, which parses the session's transcripts
(incrementally), turns cumulative totals into a delta against the session's existing records, appends one JSON line
under `ai/usage/`, and prints a `systemMessage`. `usage.mjs digest` reduces records (or local transcripts, for a
baseline) to a token-minimal text that `/ai-kit:usage` reads. Pre-commit stages the records; the review gate ignores
them.

**Tech Stack:** bash 3.2+ hooks with `jq`, Node 22+ ES modules (no dependencies), git.

**Spec:** `docs/superpowers/specs/2026-10-25-token-management-design.md`

## Global Constraints

- Hooks run under macOS `/bin/bash` 3.2 and Linux bash 5; `jq` and Node 22+ as today.
- A recorder failure never blocks a stop: exit 0, one stderr line. Stop hook timeout 10 s; target under 300 ms per
  Stop on a 30 MB transcript with the cache.
- Nothing the recorder outputs enters the model's context (`systemMessage` only, verified in Task 1).
- Records: `ai/usage/<YYYY-MM>/<session-id>.jsonl`, month of the session's first transcript timestamp; one JSON line
  per Stop; deltas; no cost or price fields; `v: 1`.
- Prompt: masked, at most 1,000 characters; config `usage.prompts` `"full"` (default) | `"none"`;
  `usage.enabled` default `true`.
- Cost weights relative to a model's base input price: input 1, cache read 0.1, 5-minute write 1.25, 1-hour write 2,
  output 5; times `usage.prices[<model id prefix>]` (base input $ per MTok); an unpriced model is reported apart.
- Digest at most 3,000 tokens (12,000 characters) whatever the record count; form per `docs/ai-docs.md`.
- Kit repo rules: prose and shell comments wrap at 120 (`node scripts/check-wrap.mjs`), comments at most 2 lines,
  stage by name, `ai/kit/` files never overwritten, CHANGELOG line per change, version per README §Editing the kit.
- Tests follow the existing harness: `scripts/*.test.mjs` (temp repos, `ok   - ` / `FAIL - ` lines, `N passed, M
  failed`, exit 1 on a failure) and `hooks/*.test.sh` (same output).

## Review Focus

1. The last transcript line is half-written when the Stop hook runs: it is skipped, and the cache offset stays before
   it so the next Stop reads it whole (test in Task 3).
2. A session resumed in a new process, on another machine, or after the cache was deleted: no usage counted twice,
   because the delta subtracts what the session's file already holds (test in Task 4).
3. A subagent still running, or with no `.meta.json`: its usage so far is counted, role `other` without meta; its
   later usage lands in a later record (test in Task 3).
4. A prompt with Thai text and a secret, longer than 1,000 characters: the secret is masked before truncation and the
   cut never splits a character (test in Task 2).
5. A round whose only change is the recorder's own file: the Stop hook does not demand a review, and the reviewer
   brief does not show it (test in Task 6).

---

### Task 1: Verify the display channel

**Files:**
- Create: `docs/superpowers/plans/2026-10-25-token-management-notes.md` (findings, deleted in Task 8)

**Interfaces:**
- Produces: the answer Task 5 uses: `systemMessage` from a Stop hook is shown to the user and kept out of the
  model's context (yes/no), and whether hook stdout JSON from two Stop hooks in one group both apply.

- [ ] **Step 1:** Read the hooks reference (`https://code.claude.com/docs/en/hooks`, or the claude-code-guide agent)
  for the Stop hook output fields `systemMessage`, `suppressOutput`, and whether output reaches the model.
- [ ] **Step 2:** Live check in a throwaway repo with `ai/kit/` and a Stop hook that prints
  `{"systemMessage":"USAGE-PROBE"}`: run `claude -p "say ok" --plugin-dir <tmp plugin>`; then grep the session
  transcript for `USAGE-PROBE` and record where it appears (a `system` entry is fine; inside a later
  `message.content` sent to the model is not).
- [ ] **Step 3:** Write the answer in the notes file (two lines). If `systemMessage` would reach the model, Task 5
  prints nothing and the notes say so; the record is still written.

### Task 2: Prompt masking

**Files:**
- Create: `scripts/usage-mask.mjs`
- Test: `scripts/usage-mask.test.mjs`

**Interfaces:**
- Produces: `export function maskPrompt(text: string, max = 1000): string`

- [ ] **Step 1: Write the failing tests**

```js
eq("github token", maskPrompt("use ghp_abcdefghijklmnopqrstuvwxyz0123456789 now"), "use [masked] now");
eq("anthropic key", maskPrompt("sk-ant-api03-AbC_dEf-123456789012345678901234"), "[masked]");
eq("aws key", maskPrompt("AKIAIOSFODNN7EXAMPLE"), "[masked]");
eq("jwt", maskPrompt("t=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_abcDEF123"), "t=[masked]");
eq("assignment", maskPrompt("password=hunter2 and token: abc123"), "password=[masked] and token: [masked]");
eq("url creds", maskPrompt("postgres://dev:s3cret@db:5432/x"), "postgres://dev:[masked]@db:5432/x");
eq("pem", maskPrompt("-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----"), "[masked]");
eq("long hex", maskPrompt("id " + "a1".repeat(24)), "id [masked]");
eq("thai kept, cut by code point", [...maskPrompt("ก".repeat(1200))].length, 1000);
eq("mask before cut", maskPrompt("x".repeat(985) + " password=abcdefghijkl").includes("abcd"), false);
eq("plain text untouched", maskPrompt("แก้ราคา promotion ให้คิดฝั่ง server"), "แก้ราคา promotion ให้คิดฝั่ง server");
```

- [ ] **Step 2:** `node scripts/usage-mask.test.mjs` → FAIL (module missing).
- [ ] **Step 3:** Implement `maskPrompt`: apply the patterns of the spec's masking list in order (PEM block,
  `sk-`/`ghp_`/`gho_`/`github_pat_`/`xox[bp]-`/`AKIA[0-9A-Z]{16}` tokens, JWT `eyJ…\.…\.…`, `password|secret|token|
  api_key` followed by `=` or `:` and a value, URL userinfo password, base64/hex runs of 40+), then cut to `max` code
  points with `[...s].slice(0, max).join("")`.
- [ ] **Step 4:** `node scripts/usage-mask.test.mjs` → `11 passed, 0 failed`.
- [ ] **Step 5:** Commit `scripts/usage-mask.mjs scripts/usage-mask.test.mjs`.

### Task 3: Transcript collection

**Files:**
- Create: `scripts/usage-collect.mjs`
- Test: `scripts/usage-collect.test.mjs` (fixture transcripts written into a temp dir)

**Interfaces:**
- Consumes: none.
- Produces:
  - `export function collectSession(transcript: string, cache?: Cache): Session`
  - `Session = { firstTs: string, baseContext: number|null, agents: Record<string, Agent>,
    prompts: {round: number, ts: string, text: string}[], commits: {ts: string, hash: string}[] }`
  - `Agent = { id, role: "coordinator"|"commit"|"reviewer"|"ba"|"other", desc, model, calls, input, read, write_5m,
    write_1h, output, peak, tools: Record<string, number>, largest_result, findings?: {confirmed, plausible} }`;
    main session `id` is `"main"`, a subagent's id is its file name without `agent-` and `.jsonl`.
  - `export function roleOf(desc: string, type: string): Agent["role"]`
  - `export function loadCache(path: string): Cache`, `export function saveCache(path: string, c: Cache): void`
    (`Cache` is opaque to callers: per file byte offset plus the running `Agent` totals and message-id set).
  - `export function transcriptsDir(repoRoot: string): string` (`<CLAUDE_CONFIG_DIR|~/.claude>/projects/<slug>`,
    slug = main worktree path with each non-alphanumeric as `-`, as `hooks/lib.sh` `kit_memory_dir`).

- [ ] **Step 1: Write the failing tests** (each builds JSONL lines by hand)

```js
eq("streamed blocks counted once, last usage wins", s.agents.main.output, 30);   // same message.id, output 10 then 30
eq("main excludes sidechain lines", s.agents.main.calls, 2);
eq("token fields", pick(s.agents.main, "input read write_5m write_1h"),
  {input: 3, read: 900, write_5m: 0, write_1h: 50});
eq("peak = largest input+read+writes of one call", s.agents.main.peak, 953);
eq("base context = first main call", s.baseContext, 120);
eq("tools: Bash by first word after a leading cd", s.agents.main.tools, {"Bash:sed": 1, "Bash:git": 1, Read: 1});
eq("largest tool result in chars", s.agents.main.largest_result, 5000);
eq("prompts: real user text only", s.prompts.map((p) => p.text), ["first ask", "second ask"]); // skips tool_result,
// isMeta, <system-reminder>, <task-notification>
eq("commit hashes from git commit output", s.commits.map((c) => c.hash), ["a1b2c3d"]); // "[main a1b2c3d] msg"
eq("subagent role from meta", s.agents.x1.role, "commit");                       // description "commit: foo"
eq("reviewer findings from its last reply", s.agents.x2.findings, {confirmed: 2, plausible: 1});
eq("no meta → other, still counted", [s.agents.x3.role, s.agents.x3.calls], ["other", 1]);
eq("half-written last line skipped", s2.agents.main.calls, 2);                   // file ends mid-JSON
eq("cache: second run reads only appended lines, same totals", [s3.agents.main.calls, bytesRead3 < size], [3, true]);
eq("roleOf", ["commit: x", "Review y", ""].map((d, i) => roleOf(d, ["", "", "ai-kit:business-analyst"][i])),
  ["commit", "reviewer", "ba"]);
```

- [ ] **Step 2:** `node scripts/usage-collect.test.mjs` → FAIL.
- [ ] **Step 3:** Implement. Read each file from its cached offset to the last `\n` only (Review Focus 1); parse each
  line with try/catch; usage keyed by `message.id`, keep the last; a role from `.meta.json`
  (`description`, `agentType`) via `roleOf` (`^\s*commit:` → commit; `change-reviewer` type or `review` in the
  description → reviewer; `business-analyst` type → ba; else other). Prompt test as in
  the design session: `type: "user"`, not `isMeta`/`isSidechain`, text content (string or text blocks), no
  `tool_result`, not starting with `<system-reminder`, `<task-notification`, `<local-command`, `<command-`.
  Commits: Bash tool_result text matching `^\[[^\]\n]+ ([0-9a-f]{7,40})\]` in any agent. Findings: count
  `CONFIRMED` and `PLAUSIBLE` words in the reviewer's last assistant text.
- [ ] **Step 4:** `node scripts/usage-collect.test.mjs` → `15 passed, 0 failed`.
- [ ] **Step 5:** Commit the two files.

### Task 4: Record building and summary line

**Files:**
- Create: `scripts/usage-record.mjs`
- Test: `scripts/usage-record.test.mjs`

**Interfaces:**
- Consumes: `Session`, `Agent` (Task 3); `maskPrompt` (Task 2).
- Produces:
  - `export function buildRecord(session: Session, prior: Rec[], ctx: Ctx): Rec | null` — `null` when no agent has a
    non-zero delta. `Ctx = {now: Date, kit, project, user, branch, prompts: "full"|"none"}`.
  - `Rec` = the spec's record: `v, ts, session, round, kit, project, user, branch, prompt?, duration_s, commits,
    base_context?, agents: AgentDelta[]`; `AgentDelta` = `Agent` fields with token/call/tool counts as deltas,
    `peak` and `largest_result` as the max seen in this delta's calls (cumulative max when not derivable), `findings`
    when present.
  - `export function weight(a: AgentDelta, prices: Record<string, number>): number | null` (cost in $, `null` when
    the model is unpriced) and `export const DEFAULT_PRICES` (model id prefix → base input $/MTok, from Anthropic's
    pricing page at build time; leave a model out rather than guess).
  - `export function summaryLine(rec: Rec, sessionRecs: Rec[], prices, firstInRepo: boolean): string`

- [ ] **Step 1: Write the failing tests**

```js
eq("first record = whole session", r1.agents.find((a) => a.id === "main").read, 900);
eq("delta subtracts prior records", r2.agents.find((a) => a.id === "main").read, 400);   // cumulative 1300
eq("nothing new → null", buildRecord(sameSession, [r1, r2], ctx), null);
eq("resume after cache loss: no double count", sum(all.map(readOf)), 1300);              // Review Focus 2
eq("round = number of prompts so far", r2.round, 2);
eq("prompt masked and cut", r1.prompt, maskPrompt(session.prompts[0].text));
eq("prompts none → no prompt key", "prompt" in buildRecord(s, [], {...ctx, prompts: "none"}), false);
eq("commits only in this round", r2.commits, ["a1b2c3d"]);
eq("duration from the round's prompt", r2.duration_s, 90);
eq("base_context only on the first record", ["base_context" in r1, "base_context" in r2], [true, false]);
eq("no cost fields", JSON.stringify(r1).includes("cost"), false);
eq("weight", weight({model: "claude-x-1", input: 1e6, read: 1e6, write_5m: 0, write_1h: 0, output: 1e5},
  {"claude-x": 2}), 2 * (1 + 0.1 + 0.5));
eq("unpriced model", weight({model: "other"}, {}), null);
match("summary line", summaryLine(r2, [r1, r2], prices, false), /^tokens this round .* \| context \d+k \| top: /);
match("first-in-repo notice", summaryLine(r1, [r1], prices, true), /prompts are recorded in ai\/usage.*"none"/);
```

- [ ] **Step 2:** `node scripts/usage-record.test.mjs` → FAIL.
- [ ] **Step 3:** Implement. Delta per agent = cumulative now minus the sum of that agent's fields in `prior`; `tools`
  subtract per key and drop zeros. Summary format (one line, under 200 characters):
  `tokens this round ≈ $<x> (in-eq <n>): commit 62% · review 21% · main 17% | context <k>k | top: <desc> (<model
  short>, <calls> calls, peak <k>k) | session ≈ $<y>`; unpriced models shown as `<n> tok unpriced`. Notice when
  `firstInRepo`: `· prompts are recorded in ai/usage/ (set "usage": {"prompts": "none"} in ai/kit/config.json to
  stop)`.
- [ ] **Step 4:** `node scripts/usage-record.test.mjs` → `16 passed, 0 failed`.
- [ ] **Step 5:** Commit the two files.

### Task 5: Recorder CLI and Stop hook

**Files:**
- Create: `scripts/usage.mjs` (CLI: `record`; `digest` added in Task 7), `hooks/usage-log.sh`,
  `hooks/usage-log.test.sh`
- Modify: `hooks/hooks.json` (Stop: add the hook after `review-before-stop.sh`, timeout 10)

**Interfaces:**
- Consumes: Tasks 2–4; Task 1's answer.
- Produces: `node scripts/usage.mjs record` reads Stop hook JSON on stdin (`session_id`, `transcript_path`, `cwd`),
  appends to `<root>/ai/usage/<YYYY-MM>/<session>.jsonl`, prints `{"systemMessage": "<line>"}` (or nothing, per
  Task 1), exit 0 always. Cache file `<git-dir>/claude-usage/<session>.json`.

- [ ] **Step 1: Write the failing hook tests** (`hooks/usage-log.test.sh`, fixture repo + hand-built transcript,
  harness as `hooks/review-before-stop.test.sh`)
  - `record: first stop writes one line under ai/usage/<YYYY-MM>/<session>.jsonl` (jq `.v == 1`)
  - `record: second stop with nothing new writes nothing`
  - `record: stdout is {"systemMessage": ...} and exit 0`
  - `skip: no ai/kit/ → no file, exit 0`
  - `skip: "usage": {"enabled": false} → no file`
  - `skip: unreadable transcript → exit 0, one stderr line`
  - `prompts none → record has no prompt key`
- [ ] **Step 2:** `bash hooks/usage-log.test.sh` → FAIL.
- [ ] **Step 3:** Implement `usage-log.sh` (source `lib.sh`, `kit_enabled || exit 0`, `kit_conf '.usage.enabled'`,
  exec `node "$kit_plugin/scripts/usage.mjs" record`, `|| exit 0`). `usage.mjs record`: root via `kit_project_root`
  logic (git toplevel of `CLAUDE_PROJECT_DIR`/`cwd`), config `usage.*`, `kit` from `.claude-plugin/plugin.json`,
  `user` from `git config user.name`, `branch` from `git rev-parse --abbrev-ref HEAD`, `project` = root folder name,
  prior records = the session file's lines, `firstInRepo` = `ai/usage/` absent before this write. Wrap everything in
  try/catch → one stderr line, exit 0.
- [ ] **Step 4:** `bash hooks/usage-log.test.sh` → all pass; time one run on the largest local transcript
  (`ls -S ~/.claude/projects/*/*.jsonl | head -1`) twice: second run under 300 ms.
- [ ] **Step 5:** Commit the five files.

### Task 6: Records in git, out of the review gate

**Files:**
- Modify: `githooks/pre-commit` (stage records first), `hooks/review-before-stop.sh` (`code_since` and the
  `--name-only` diffs: add `':(exclude)ai/usage'`), `scripts/kit.mjs` (`AI_LAYOUT` gains `usage`; `initFiles` adds
  `ai/usage/** merge=union` to `.gitattributes` when missing; `check` warning when missing), `docs/ai-layout.md`
  (row: `ai/usage/<YYYY-MM>/<session>.jsonl` · token records, written by the kit · never edited by hand),
  `docs/plan-batching.md` (reviewer brief: `git show <hash> -- . ':(exclude)ai/usage'`)
- Test: `hooks/review-before-stop.test.sh` (new cases), `githooks/pre-commit.test.sh` (new),
  `scripts/kit-inventory.test.mjs` (layout case)

**Interfaces:**
- Consumes: the record path from Task 5.

- [ ] **Step 1: Write the failing tests**
  - review-before-stop: `pass: only ai/usage changed since the snapshot` and `pass: only ai/usage changed, no
    snapshot` (Review Focus 5)
  - pre-commit: `commit of a.txt also carries the new ai/usage file`; `an unchanged ai/usage file is not re-added`;
    `no ai/usage dir → commit unaffected`
  - kit-inventory: `ai/usage is not reported outside the layout`
- [ ] **Step 2:** Run the three test files → the new cases FAIL.
- [ ] **Step 3:** Implement. Pre-commit, before the backslash check: list `git ls-files -m -o --exclude-standard -z
  -- ai/usage` and `git --literal-pathspecs add --` them by name (POSIX sh). `init`: append the attribute line with
  the file's EOL; never rewrite other lines.
- [ ] **Step 4:** All `hooks/*.test.sh`, `githooks/pre-commit.test.sh`, `scripts/*.test.mjs` pass.
- [ ] **Step 5:** Commit.

### Task 7: Digest

**Files:**
- Create: `scripts/usage-digest.mjs`, `scripts/usage-digest.test.mjs`
- Modify: `scripts/usage.mjs` (`digest [--since YYYY-MM-DD] [--baseline]`)

**Interfaces:**
- Consumes: `Rec` (Task 4), `weight`/`DEFAULT_PRICES` (Task 4), `collectSession`/`transcriptsDir` (Task 3),
  `buildRecord` (baseline turns each local session into records in memory, prompts `full`, never written).
- Produces: `export function digest(recs: Rec[], prices): string`

- [ ] **Step 1: Write the failing tests**

```js
eq("empty", digest([], P), "no usage records");
const SECTIONS = ["totals", "by role", "per commit", "by kit", "drivers", "reviews", "costliest rounds", "outliers"];
eq("sections in order", [...d.matchAll(/^## (.+)$/gm)].map((m) => m[1]), SECTIONS);
match("role share and model within role", d, /commit 6\d% \(opus 9\d%, sonnet \d+%\)/);
match("cost per commit", d, /per commit ≈ \$\d/);
match("by kit compares versions", d, /2\.13\.0 .*\n2\.13\.1 /);
match("drivers name tool mix", d, /commit: .*Bash:sed \d+/);
match("reviews per model", d, /opus: \d+ reviews, [\d.]+ confirmed\/review/);
match("costliest rounds with prompt excerpt ≤ 200 chars", d, /^- \$[\d.]+ r\d+ \w+: .{1,200}$/m);
match("outliers over 150k peak or 150 calls", d, /peak 406k|250 calls/);
eq("bounded size", digest(tenThousandRecs, P).length <= 12000, true);
match("unpriced model reported apart", digest(withUnknownModel, P), /unpriced: \d+ tok/);
```

- [ ] **Step 2:** `node scripts/usage-digest.test.mjs` → FAIL.
- [ ] **Step 3:** Implement; fragments not prose (`docs/ai-docs.md`); every list capped (10 rounds, 5 drivers per
  role, 10 kit versions, 10 outliers) so size stays bounded.
- [ ] **Step 4:** Tests pass; run `node scripts/usage.mjs digest --baseline` from `~/Work/rem-saas` (read-only) and
  check: under 12,000 characters, commit share near the 57% found in the design.
- [ ] **Step 5:** Commit.

### Task 8: Command, docs, release 2.13.0

**Files:**
- Create: `commands/usage.md`
- Modify: `README.md` (Layout rows for the new scripts/hook/command; Hooks list; Project settings: `usage.enabled`,
  `usage.prompts`, `usage.prices`; Commands; Thai section one paragraph), `CHANGELOG.md` (`## 2.13.0`),
  `.claude-plugin/plugin.json` (2.13.0)
- Delete: `docs/superpowers/plans/2026-10-25-token-management-notes.md`

- [ ] **Step 1:** Write `commands/usage.md` per the spec part 4: run `digest` (`--baseline` when `ai/usage/` is
  empty), read only its output, never `ai/usage/` files; name the largest driver with its evidence and the change
  that cuts it; cross-repo → kit proposal per `${CLAUDE_PLUGIN_ROOT}/docs/kit-proposals.md`; repo-only →
  `ai/kit/review-checklist.md` or project settings; end with the working-conventions report.
- [ ] **Step 2:** README, CHANGELOG, version; `node scripts/check-wrap.mjs`; `claude plugin validate .`; all tests.
- [ ] **Step 3:** Commit.

### Task 9: L1 — commit subagents on sonnet (2.13.1)

**Files:**
- Modify: `docs/plan-batching.md` §Coordinator pipeline, `CLAUDE.core.md` Agent model bullet, `CHANGELOG.md`,
  `.claude-plugin/plugin.json`

- [ ] **Step 1:** Coordinator pipeline: a commit subagent is launched with `model: "sonnet"`; `"opus"` only when its
  batch touches a DB schema or migration, a calculation, a permission or a decision recorded as final. Core Agent
  model bullet: name commit subagents beside BA and reviewer under the same rule, no added length beyond one clause
  (`wc -c CLAUDE.core.md` before and after in the CHANGELOG line).
- [ ] **Step 2:** check-wrap, tests, commit. The effect is read later from the digest's `by kit` section.

### Task 10: L3 — read discipline for commit subagents (2.13.2)

**Files:**
- Modify: `docs/plan-batching.md` (commit subagent brief), `CHANGELOG.md`, `.claude-plugin/plugin.json`

- [ ] **Step 1:** Brief rule: locate with `grep -n` (several patterns in one call), read only the needed line range,
  send independent reads and searches in one message, never read a whole large file to find one symbol, never one
  `sed -n` per call when several ranges are known.
- [ ] **Step 2:** check-wrap, commit.
