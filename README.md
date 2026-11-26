# ai-kit

A Claude Code plugin with a working framework: working rules, hooks that enforce them, a reviewer and an analyst
agent, a git pre-commit runner, and comment and doc checks. This repo is both the plugin and its marketplace
(`korn9537`). It holds nothing project-specific. Each project keeps its own settings in `ai/kit/`, which the kit
reads and never overwrites; a project without `ai/kit/` is left alone, so the plugin is safe at user scope.

Requires `jq` (hooks) and Node 22+ (scripts). On Windows the hooks run under Git Bash (Git for Windows); the kit's
`.gitattributes` keeps every file at LF, so a `core.autocrlf` checkout of the plugin still runs.

## Layout

| Path                          | What                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `.claude-plugin/`             | `plugin.json` (name, version) and `marketplace.json`                                           |
| `CLAUDE.core.md`              | git, language and working conventions, the final-report format (summary, delegation: `skills/`) |
| `agents/`                     | `ai-kit:business-analyst`, `ai-kit:change-reviewer`, `ai-kit:committer`, `ai-kit:decider`, `ai-kit:doc-writer`, `ai-kit:explorer` |
| `hooks/`                      | Claude Code hooks (below), wired in `hooks/hooks.json`                                         |
| `skills/summarize/`           | `ai-kit:summarize`: the summary (and BA) before a UI, DB or business-rule change, loaded when needed |
| `skills/delegate/`            | `ai-kit:delegate`: the delegation rules (subagents, models, committers, plans), loaded when needed |
| `commands/`                   | `/ai-kit:init`, `/ai-kit:check`, `/ai-kit:harvest`, `/ai-kit:memory-export`, `/ai-kit:retrofit`, `/ai-kit:usage`, `/ai-kit:decisions`, `/ai-kit:jobs`, `/ai-kit:continuous` |
| `githooks/pre-commit`         | git pre-commit runner, called by the project's `.githooks/pre-commit`                          |
| `githooks/commit-msg`         | git commit-msg runner (one `Job:` trailer, `docs/shared-checkout.md` §Jobs), called by `.githooks/commit-msg` |
| `scripts/jobs.mjs`            | `/ai-kit:jobs`: lists jobs, or one job's commits, files, migrations and revert command |
| `scripts/kit.mjs`             | dispatcher for `init` / `check` / `sync` / `unattended` / `uninstall` / `inventory` (§Commands)  |
| `scripts/kit/*.mjs`           | one module per command (`init`, `check`, `sync`, `unattended`, `uninstall`, `inventory`) and `shared.mjs` |
| `scripts/usage.mjs`           | `record` (Stop hook) / `end` (SessionEnd: record, then flush) / `flush --idle` (SessionStart) / `refusal` (git hooks) / `digest` / `hooks` (§Commands), over `scripts/lib/usage-collect.mjs`, `scripts/lib/usage-digest.mjs` and `scripts/lib/hook-events.mjs` |
| `scripts/decider.mjs`         | `sync` (SubagentStop, Stop) / `guard` (`ask-guard.sh`) / `report` (`/ai-kit:decisions`) |
| `commands/usage.md`           | `/ai-kit:usage`: finds the largest token driver from the digest and the one change that cuts it |
| `commands/run-plan.md`        | `/ai-kit:run-plan`: runs a multi-commit plan as the `workflows/run-plan.js` workflow, one report; `plan` only writes the plan, `queue` runs the open plans one at a time |
| `commands/continuous.md`      | `/ai-kit:continuous`: runs work to its end with nobody watching: asks once, runs the plan, retries failed committers, one report |
| `scripts/continuous.mjs`      | the next step of a continuous run, from its state file     |
| `workflows/run-plan.js`       | Workflow script: a committer per batch, one reviewer for the whole job, fixes, one re-check, a second fix for what it leaves |
| `scripts/queue.mjs`           | the state of a `/ai-kit:continuous queue` run                   |
| `scripts/lib/workflow-run.mjs` | `readRun`, the run file of a workflow, shared by `continuous.mjs` and `plan.mjs` |
| `scripts/plan.mjs`            | the plan file `ai/plans/<job>.md`: write, status from the job's commits, resume, `queue`, close, `mark` / `unmark` (the run marker), `live` (a run-plan workflow's journal) |
| `scripts/lib/state-dirs.mjs`  | the `claude-review`, `claude-usage`, `claude-decider` state-folder paths (twin of `kit_state_dir` in `hooks/lib.sh`) and `claude-plan-run` (`planRunDir`, no shell twin) |
| `scripts/review-needed.sh`    | prints `skip` for a commit with no code line, else `review`; read by the run-plan workflow     |
| `docs/spec.md`                | what each kit file does and the processes that call them; the map a refactor starts from |
| `scripts/check-core-size.mjs` | each injected half of `CLAUDE.core.md` under the 10,000-character SessionStart cap; run by `.githooks/pre-commit` |
| `scripts/check-comments.mjs`  | comment rule check (`//`, `/* */`, `#`, Python docstrings), run by pre-commit and post-edit; `--size`: pre-commit blocks an edit to a code file over 40,000 characters at HEAD that is not a move-only split |
| `scripts/check-docs.mjs`      | doc rule check on added lines, run by pre-commit and post-edit; `--wrap`: kit clone only, added prose lines over 120 characters, run by `.githooks/pre-commit` |
| `scripts/check-specs.mjs`     | screen-spec links (API, screen files, ids, index), warnings only, run by pre-commit            |
| `docs/`                       | `hooks.md` (what each hook does), `ai-docs.md`, `code-comments.md`, `shared-checkout.md`, `kit-proposals.md`, `screen-specs.md`, `ai-layout.md`, `plan-batching.md`, `handoffs.md`, `owner-kinds.md` |
| `.github/ISSUE_TEMPLATE/`     | `proposal.md`: body of a kit proposal issue                                                    |
| `conventions/`                | cross-repo coding rules: `general.md`, one per language or framework (`python`, `react`, ...)  |
| `templates/ai-kit-project/`   | starter `ai/kit/` files, copied by `init` when missing                                         |
| `templates/ai/`               | one template per `ai/` doc type (`docs/ai-layout.md`); never copied by `init`                  |
| `CHANGELOG.md`                | one line per change; the version lives in `.claude-plugin/plugin.json`                         |

Hooks: each exits silently when the project has no `ai/kit/`. What each hook blocks, passes or notes, per event,
is in `docs/hooks.md`; the wiring is `hooks/hooks.json`.

## Project settings (`ai/kit/`)

| File                  | Read by                                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.json`         | hooks, `check-comments.mjs`, `check-docs.mjs`: `code_dirs`, `comments.include`/`skip`, `docs.include`/`skip`, `build_guard.port`/`build_re`/`hint`, `shared_checkout_doc`, `handoff.max_context`/`fresh_after`/`max_reads`/`reads_from`/`big_read`, `review.skip_lines`/`always`, `usage.enabled`/`prices`/`money`, `decider.enabled`/`always_owner`; agents and `kit.mjs check`: `conventions`; `check-specs.mjs`, agents: `ui`; `scripts/jobs.mjs`: `jobs.migrations`; `run-plan`: `committer.maxSize` (`light`, `normal`, `heavy`: no committer runs above it) |
| `pre-commit.sh`       | `githooks/pre-commit`: the project's checks, sourced after prettier                                                                                                                                                                         |
| `post-edit.sh`        | `hooks/post-edit-check.sh`: the project's per-file checks                                                                                                                                                                                   |
| `review-checklist.md` | `ai-kit:change-reviewer`, `ai-kit:committer`                                                                                                                                                                                                |
| `analysis-sources.md` | `ai-kit:business-analyst`                                                                                                                                                                                                                   |
| `check.sh`            | a project gate, with `unattended`: generated, `docs/ai-layout.md` §Runs without the plugin                                                                                                                                                  |
| `conventions/`        | runs without the plugin, with `unattended`: generated copies, same section                                                                                                                                                                  |
| `checks/`             | `check.sh`, with `unattended`: generated copies of the kit's comment and doc checks, same section                                                                                                                                           |
| `review-prompt.md`    | a pipeline's own review, with `unattended`: generated from `agents/change-reviewer.md`, same section                                                                                                                                        |
| `requires.txt`        | `check.sh`, with `unattended`: commands `pre-commit.sh` needs, one per line; `sync` starts it, then it is hand-kept                                                                                                                         |

`conventions` lists the language files in `conventions/` that apply to the project, without `.md` (e.g. `["go",
"sql"]`; default `[]`). `general.md` always applies; `check` fails on a name with no file. An exception for one
project goes in its `review-checklist.md`, with its reason. `unattended` (default `false`) turns on what runs without
the plugin read from the repo: `docs/ai-layout.md` §Runs without the plugin. `shared_checkout_doc` defaults to this
plugin's `docs/shared-checkout.md`. `review.skip_lines` defaults to 10 changed lines, + and − counted apart (0 reviews
every change); `review.always` (a JS-style regex) to migration, schema, auth, permission and policy paths and
`.sql`/`.prisma`. The skip applies only before the first review: a fix after a review always goes to its re-check.
The Stop hook asks for one reviewer over the whole job's range (`git diff <base>..HEAD`), launched once at the
job's last commit, not one per commit. A stop while the job's `plan.mjs` plan still has batches left (the last
commit's job, named by this session's own commit, committer brief or Workflow run) passes with no review while every
changed code path is one the plan names (`plan.mjs scope <job>`: paths, root files, directories, globs and
`<placeholder>` paths in its briefs, accept, risks, tests and alsoInScope) or a file the job's commits touched; an
edit outside that set is reviewed as usual, and the ask names it. After a Bash edit the changed paths are everything
changed in the checkout since the snapshot, so another session's file counts as outside.

`usage.enabled` (default `true`) turns the usage records off with `false`; `usage.endpoint` (default
`https://ai-kit-usage.maybix.com`, env `AI_KIT_USAGE_ENDPOINT` overrides) is the server they go to;
`usage.money` (default `true`)
set to `false` (a subscription, where dollars are not billed) shows the round and session summary in
input-equivalent tokens only; a model without a ratio entry counts at fallback ratios, so the figure is approximate. The
server stores every call, tool call, hook firing and commit of a session as plain rows, prompt and message text
included, so the kit's versions can be compared; it has no token and no allowlist, so anyone who can reach it can read
and write the data, and it keeps the newest 10 kit versions and at most 365 days. Projects are told apart by their
origin URL (`local/<folder>` without a remote), for `--project`. `usage.prices`
(`{"<model id prefix>": <base input $ per MTok>}`) overrides the kit's default prices; a model with no price is
reported apart. No commit carries usage. A repo that still has `ai/usage/` runs `node <plugin>/scripts/usage.mjs
migrate` once: it posts those files and, only when every post succeeded, stages their removal with `git rm`; commit
that. `check` warns about leftover `ai/usage/` files and about a session whose usage has not been sent for over a day
(file times only, no network).

`decider.enabled` (default `true`) lets every AskUserQuestion through with `false`. `decider.always_owner` (a
case-insensitive jq (Oniguruma) regex over the questions and headers, default none) names topics this project
always decides itself, e.g. `"bundle id|store listing|privacy"`; an invalid pattern lets every ask through. The
decision log goes to the usage server: the decider writes questions and reasons only, each field capped at 500
characters, and never a secret or personal data (`agents/decider.md`).

`ui` (`{"platforms": ["web", "mobile"], "include": "<regex>", "api": "ai/api/"}`) turns on screen specs in
`ai/screens/` linked to the API spec: `docs/screen-specs.md`. Absent or `"platforms": []` = off; `check` warns
when the key is absent in a repo that looks like web or mobile, and when it is set without `ai/screens/index.md`.
With `ui.api` set, pre-commit also warns of a staged route (Next, NestJS, Express, FastAPI, Flask) with no entry in
the API spec; `"routes": false` inside `ui` turns that off.

## Commands

Run from the project root (or `/ai-kit:init` and `/ai-kit:check` inside Claude Code).

- `node <plugin>/scripts/kit.mjs init` creates the missing `ai/kit/` files from the templates (never overwrites),
  writes the `.githooks/pre-commit` and `.githooks/commit-msg` shims when missing (warns about
  any other hook there) and sets `core.hooksPath` to `.githooks` unless another path is set (warns), writes
  `<git-common-dir>/ai-kit-root` for the shim, adds `"autoMemoryEnabled": false` to `.claude/settings.json` when
  the key is absent, and appends `.githooks/* text eol=lf` and `ai/kit/*.sh text eol=lf` to `.gitattributes` when
  git does not already read those paths as LF (a Windows `core.autocrlf` checkout would give `sh` a CRLF shim).
- `node <plugin>/scripts/kit.mjs check` exits 1 when `ai/kit/config.json` is missing, malformed or not an object,
  when `conventions` is not an array or names a file `conventions/` lacks, when the `.githooks/pre-commit` shim is
  missing or not the kit shim, when `core.hooksPath` is not `.githooks`, when none of `.claude/settings.json`,
  `.claude/settings.local.json` or `~/.claude/settings.json` enables `ai-kit@korn9537` (the project file is
  recommended, so teammates get it), when `shared_checkout_doc` names a missing file or
  `.claude/agents/` holds an old copy of a kit agent. Each line names its fix. It warns (`!`, exit unchanged)
  when auto-memory is not off (no `autoMemoryEnabled: false` in the highest scope that sets it, or
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=0`) or the repo's auto-memory dir holds files (`/ai-kit:memory-export`), and
  when the shim or `ai/kit/*.sh` has no `eol=lf` attribute, and when `.githooks/commit-msg` is missing or not the
  kit shim.
  The pre-commit runner calls it when `ai/kit/config.json`, `.githooks/`, `.claude/settings.json`,
  `.claude/agents/` or `CLAUDE.md` are staged.
- `node <plugin>/scripts/kit.mjs sync`, with `"unattended": true` in `ai/kit/config.json`, writes `ai/kit/conventions/`,
  `ai/kit/checks/`, `ai/kit/review-prompt.md`, `ai/kit/check.sh` and the `CLAUDE.md` pointer (`docs/ai-layout.md` §Runs
  without the plugin); `init` runs it too, and `check` warns of a stale, hand-edited, ignored or missing copy. Off, it
  writes nothing.
- `node <plugin>/scripts/kit.mjs unattended` turns a repo on: same section. `--dry-run` writes nothing and exits 1 when
  the repo is not ready; `--force` passes a listed script, an index read or an empty `pre-commit.sh`, never a staged
  line.
- `node <plugin>/scripts/kit.mjs uninstall` reverses what `init` wrote: the `.githooks/pre-commit` and
  `.githooks/commit-msg` shims (only when still the ai-kit shim; a project's own hook there is left and named),
  `core.hooksPath` (only when nothing else is left in `.githooks/`), the `CLAUDE.md` pointer line, the
  `<git-common-dir>/ai-kit-root` marker, and `ai-kit@korn9537` in `.claude/settings.json`'s or
  `.claude/settings.local.json`'s `enabledPlugins` (never `~/.claude/settings.json`, the user's own scope).
  `ai/kit/` is left in place — it is the project's own filled-in content, not generated wiring — unless `--purge`
  is given. What it could not safely touch is printed with `!` and exits 1 (§Uninstall).
- `node <plugin>/scripts/kit.mjs inventory` (read-only) lists what a retrofit starts from: `ai/` entries outside
  the layout, schema sources, screen files with a `ui.include` suggestion, API spec and route files, decision docs
  and other `.md` outside `ai/`, grouped by folder. `/ai-kit:retrofit` (`commands/retrofit.md`) uses it to plan,
  then fills the `ai/` layout one category per commit, only from the code and existing docs.

- `node <plugin>/scripts/usage.mjs digest [--since YYYY-MM-DD] [--baseline]` (read-only) prints a fixed-size text
  digest of every project's records on the usage server (`--project`: this repo's only): cost per model, role and kit
  version, driver signals, cost per commit by commits per round (0, 1, 2-3, 4-7, 8+; commits are the hashes seen in
  this repo's transcripts), reviewer findings, the costliest rounds, outliers, and the commits the git hooks refused,
  per rule and per kit (`## refusals`). `--baseline` builds it from this machine's local transcripts instead, before
  any record is sent.
- `node <plugin>/scripts/usage.mjs views <view> [--kit <version|prefix.>] [--project] [--since YYYY-MM-DD]`
  (read-only) prints one of the server's analysis views as a table: `v_kit_compare` (kit versions side by side),
  `v_kit_roles`, `v_tool_stats`, `v_hook_stats`, `v_repeat_reads`, `v_session_cost`, `v_round_cost`, `v_agent_cost`,
  `v_call_cost`, `v_daily`. `/ai-kit:usage` starts from `v_kit_compare`.
- `node <plugin>/scripts/usage.mjs migrate` posts this repo's old `ai/usage/**` to the server and stages its removal.
- `node <plugin>/scripts/usage.mjs send [--session <id>]...` posts sessions now (what the hooks start detached),
  then the refusal buffer and the decider logs.
- `node <plugin>/scripts/usage.mjs digest --compare <kitA> <kitB>` (read-only) prints two kit versions side by side
  from the same records: sessions, rounds, cost per round and per commit, main-session peak, Read+Grep per round,
  committer calls per commit, reviewer findings per review, refusals per commit, and the change in %. A prefix such as
  `2.45` covers all its patches; a version with no records is named. Use it to measure a kit change.
- `node <plugin>/scripts/usage.mjs refusal <rule-id>` is called by `githooks/pre-commit` and `githooks/commit-msg` when
  they refuse a commit (ids as in `scripts/lib/hook-events.mjs`, e.g. `pre-commit.comments`, `commit-msg.job`): it
  appends `{v, ts, rule, kit, branch}` to `<git-common-dir>/claude-usage/refusals/buffer.log` and never fails the hook
  (a lock held over 1.5 s skips the record; node missing skips it too). The next `usage.mjs send` posts the buffer to
  the server; `usage.enabled: false` records nothing.
  `/ai-kit:usage` (`commands/usage.md`) runs it and names the largest driver with the one change that cuts it.
- `node <plugin>/scripts/usage.mjs hooks [--since YYYY-MM-DD]` (read-only) counts each kit hook's firings (main
  and subagent, sessions, kit versions) from this machine's transcripts of the project; counts only, no message text.
  A kit whose hook text differed from the current table is undercounted: `no firing` is not proof a hook is unused.
  `record` is the Stop hook's entry point, not run by hand.

The shim reads the plugin path from `<git-common-dir>/ai-kit-root`, written by `init` and at each session start.
Until either has run on a machine, it prints a warning and runs only `ai/kit/pre-commit.sh`. A recorded version that
a plugin update removed falls to the newest `x.y.z` beside it. The `commit-msg` shim with no path warns and lets the
message through unchecked.

## Install in a project

1. Add to the committed `.claude/settings.json`:

   ```json
   {
     "extraKnownMarketplaces": {
       "korn9537": { "source": { "source": "github", "repo": "korn9537/ai-kit" }, "autoUpdate": true }
     },
     "enabledPlugins": { "ai-kit@korn9537": true }
   }
   ```

2. Open Claude Code in the repo and trust the folder; it offers to install the marketplace and plugin.
3. An existing git pre-commit: move its checks into `ai/kit/pre-commit.sh`, then remove the old hook. For
   `.githooks/pre-commit`, delete the file. For husky or another hooks path, drop it from the `prepare` script in
   `package.json` and run `git config core.hooksPath .githooks`. Until then `init` leaves it alone and `check`
   fails.
4. Run `/ai-kit:init`: it creates `ai/kit/`, the shim and `core.hooksPath`, runs `check`, then helps fill
   `ai/kit/` (code folders, comment-check scope, dev port, `conventions`, the project's checks, checklist,
   analysis sources) and the project part of `CLAUDE.md` (layout, commands, stack rules, branch and deploy,
   verify commands).
   Then restart the Claude Code session so the SessionStart hook injects the working conventions.
5. Commit `ai/kit/`, `.githooks/pre-commit`, `.claude/settings.json` and `CLAUDE.md`, staged by name.

## Uninstall

Run `/ai-kit:uninstall`, or `node <plugin>/scripts/kit.mjs uninstall` from the project root. It reverses step 3-5
above: the `.githooks/pre-commit`/`commit-msg` shims, `core.hooksPath` when nothing else needs it, the `CLAUDE.md`
pointer line, and `ai-kit@korn9537` in `.claude/settings.json`'s or `.claude/settings.local.json`'s
`enabledPlugins` (never `~/.claude/settings.json`, which is the user's own scope — remove the plugin there by
hand, or just stop enabling it per project). `ai/kit/` — the project's own filled-in config, checks and
conventions — is left in place; add `--purge` to delete it too. Commit what changed, then remove the
`extraKnownMarketplaces`/`enabledPlugins` block from `.claude/settings.json` if no other project in this
checkout still needs the marketplace, and restart the Claude Code session.

## Updating

With `autoUpdate` the marketplace refreshes at startup. By hand: `claude plugin marketplace update korn9537`, or
`/plugin` in Claude Code. A new version is picked up only when `version` in `plugin.json` changed.

## Editing the kit

Rule: anything shared lives here; anything about one project goes in its `ai/kit/`.

1. Clone `korn9537/ai-kit` and edit there, never the installed copy under `~/.claude/plugins/`. Run
   `git config core.hooksPath .githooks` once for the clone's pre-commit: the line wrap check, and on the kit's own
   code the comment and file-size checks it runs for every project.
2. Test in a project with `claude --plugin-dir /path/to/ai-kit`; run `claude plugin validate /path/to/ai-kit`
   (no tests, no CI).
3. A new, renamed or removed file of the kit is named in `docs/spec.md` in the same commit, and a changed process is
   changed there.
4. Bump `version` in `.claude-plugin/plugin.json` and add a `CHANGELOG.md` line: patch for a fix, minor for a new
   hook, command, check or config key with a default, major when a project must edit `ai/kit/`, `CLAUDE.md` or its
   settings to keep working.
5. Work on a branch: `main` is the release, since every project with `autoUpdate` installs from it. Merge with
   `git merge --ff-only` once the review leaves no CONFIRMED finding open, or `CHANGELOG.md` names the ones left.
   Tag the version commit `vX.Y.Z` and push `main` with the tag; a bad release is reverted on `main`.

Improvements found in projects arrive as GitHub issues labelled `proposal` (`docs/kit-proposals.md`): a project
session files one when it sets a standard that passes the cross-repo test, sees a review finding twice, is corrected
by the user in a way that holds in any repo, or hits a kit gap. Run `/ai-kit:harvest` in this clone: it shows one
table to accept, merge, reject or leave each for the owner, and edits after your go; accepted ones land in one
commit that closes them on push, and reach every project through `autoUpdate`.

Recommended skill, installed separately: `impeccable` (UI review; a project's `review-checklist.md` can call it).

## คู่มือภาษาไทย

ai-kit คือ plugin ของ Claude Code ที่รวมกฎการทำงานพร้อมตัวบังคับใช้ repo นี้เป็นทั้ง plugin และ marketplace
(`korn9537`) มีสองส่วน

- repo นี้ — ของกลาง ห้ามมีชื่อ path หรือคำเฉพาะของโปรเจกต์ใด
- `ai/kit/` ในแต่ละโปรเจกต์ — ค่าตั้ง, check ของโปรเจกต์, checklist ของ reviewer ไม่ก็อปข้ามโปรเจกต์
  โปรเจกต์ที่ไม่มี `ai/kit/` hook ทุกตัวจะไม่ทำอะไร

agent ตัดสินใจเองทุกเรื่อง ยกเว้น 4 เรื่องที่ต้องถามเจ้าของ: เงิน, การกระทำที่ย้อนกลับไม่ได้หรือออกไปข้างนอก,
กฎหมาย ความเป็นส่วนตัว consent และการเปลี่ยน decision ที่ Confirmed แล้ว เรื่องที่ตัดสินใจเองแจ้งในรายงานหัวข้อ Decided

Claude ตอบเป็นภาษาไทย (ชื่อหัวข้อในรายงานและ prompt สำหรับ session ถัดไปยังเป็นภาษาอังกฤษ) เอกสารใน `ai/` comment
และ commit message เขียนภาษาอังกฤษแบบให้ AI อ่านอย่างเดียว ใช้ token น้อยที่สุด เอกสารที่ agent สร้างใหม่อยู่ใน `ai/`
เสมอ ยกเว้น user ระบุที่อื่นหรือรูปแบบอื่น ไฟล์นอก `ai/` kit ไม่ยุ่ง รายละเอียดดู `docs/ai-docs.md` — pre-commit ตรวจเฉพาะบรรทัดที่เพิ่มใหม่
ด้วย `scripts/check-docs.mjs` ปิดได้ด้วย `"docs": { "include": "^$" }` ใน `ai/kit/config.json`

กฎการเขียนโค้ดที่ใช้ได้ทุกโปรเจกต์อยู่ใน `conventions/` (`general.md` ใช้เสมอ, ไฟล์ภาษาเลือกใน
`ai/kit/config.json` key `conventions` เช่น `["go", "sql"]` หรือ framework เช่น `["typescript", "nestjs", "typeorm"]`
(มีไฟล์ `python`, `java`, `flutter` ด้วย; `react` ต่อจาก `typescript`, `flutter` ต่อจาก `dart`,
`efcore` ต่อจาก `csharp` และ `sql`;
`ui` กฎหน้าจอ web, mobile, tablet สำหรับโปรเจกต์ที่ตั้ง `ui.platforms`)
ถ้าชื่อไหนไม่มีไฟล์ หรือ config.json ไม่ใช่ JSON object
`check` จะไม่ผ่าน)
ข้อยกเว้นของโปรเจกต์เขียนใน `ai/kit/review-checklist.md` พร้อมเหตุผล

โปรเจกต์ที่มีหน้าจอ (web, mobile) ตั้ง `"ui"` ใน `ai/kit/config.json` แล้วเขียน screen spec ไว้ที่ `ai/screens/`
ไฟล์ละหน้าจอ (`S-<n>-<slug>.md`) ผูกกับ API spec (`ui.api`) — ลำดับงานคือ data (`ai/data/`) → screen spec → API spec → API → หน้าจอ
หนึ่งหน้าจออ่านข้อมูลจาก server read เดียว ห้ามหน้าจอดึงหลาย API มารวมเอง รายละเอียดใน `docs/screen-specs.md`
pre-commit เตือน (ไม่ block) ด้วย `scripts/check-specs.mjs` หน้าจอเดิมที่ยังไม่มี spec ให้เขียนเมื่อแก้หน้านั้นครั้งถัดไป
นอกจากนี้เตือนเมื่อมี API route (Next, NestJS, Express/Fastify, FastAPI/Flask) ที่ไม่มีใน API spec ปิดได้ด้วย
`ui.routes: false` ใช้กับ repo ที่มีแต่ backend ได้ถ้าตั้ง `ui.api`

เอกสารใน `ai/` มีหมวดตายตัว (decisions, requirements, data ไฟล์ละ entity, specs, screens, api, plans, notes) แต่ละหมวดมี
ชื่อไฟล์ id และ format ของตัวเอง template อยู่ใน `templates/ai/` รายละเอียดใน `docs/ai-layout.md` — `ai/data/` เป็นฐานที่
screen spec และ API spec ชี้ถึง ของที่ไม่อยู่ในหมวด `check` จะเตือนให้ย้ายเมื่อแก้ครั้งถัดไป

โปรเจกต์เดิมใช้ `/ai-kit:retrofit` — ไม่ใส่ argument จะสำรวจ (`kit.mjs inventory`) แล้วเขียนแผนที่ `ai/plans/retrofit.md`
จากนั้นสั่งทีละหมวด (`config`, `move`, `data`, `decisions`, `requirements`, `screens`, `api`) หมวดละ commit เขียนจากโค้ดและเอกสาร
ที่มีอยู่เท่านั้น ส่วนที่หาที่มาไม่ได้ลงเป็นคำถามในแผน decision ที่ต้นทางมีสถานะ final อยู่แล้วเป็น `Confirmed` ที่เหลือเป็น `Default`

kit บันทึกการใช้ token ของทุก round (ค่า default เปิดอยู่) ระหว่าง session เก็บไว้ใน `.git` ก่อน
แล้วส่งขึ้น usage server กลางตอน session จบ (ส่งไม่สำเร็จจะลองใหม่ตอนเริ่ม session ใดก็ได้
หลัง session นั้นเงียบไปเกิน 6 ชั่วโมง) ไม่เขียนอะไรลง repo และไม่มี commit เพิ่ม
เก็บข้อความ prompt แบบเต็ม server ไม่มี token และไม่มี allowlist เก็บ kit version ล่าสุด 10 ตัว
และไม่เกิน 365 วัน เป้าหมายคือเทียบ kit version เพื่อปรับ kit ไม่ใช่คิดเงินรายโปรเจกต์
สรุปหนึ่งบรรทัดแสดงให้ผู้ใช้เห็นอย่างเดียว ปิดทั้งหมดด้วย `"usage": { "enabled": false }`
ใน `ai/kit/config.json` สั่ง `/ai-kit:usage` เพื่อเทียบ kit version และดูว่าอะไรใช้ token มากที่สุด
repo ที่ยังมี `ai/usage/` เก่า รัน `usage.mjs migrate` ครั้งเดียวแล้ว commit การลบที่ stage ไว้
commit ที่ถูก pre-commit ปฏิเสธส่งขึ้น server เช่นกัน digest มีหัวข้อ refusals และเทียบสอง kit version ได้ด้วย
`digest --compare <kitA> <kitB>` หรือ `usage.mjs views v_kit_compare`

การเขียนไฟล์ผ่าน Bash ก็ถูกตรวจหลังแก้ (comment, docs) เหมือนการใช้ Edit ยกเว้นคำสั่ง git ที่แตะ work tree และ
การเรียกแบบ background

ต้องมี `jq` และ Node 22 ขึ้นไป

### ติดตั้งในโปรเจกต์

1. ใส่ `extraKnownMarketplaces` และ `enabledPlugins` ตามตัวอย่างใน §Install in a project
   ลงใน `.claude/settings.json` แล้ว commit
2. เปิด Claude Code ใน repo แล้วกด trust โฟลเดอร์ จะมีให้ติดตั้ง marketplace และ plugin
3. ถ้าโปรเจกต์มี git pre-commit อยู่แล้ว ให้ย้าย check เหล่านั้นไปไว้ใน `ai/kit/pre-commit.sh` แล้วเอาของเดิมออก
   ถ้าเป็น `.githooks/pre-commit` ให้ลบไฟล์ ถ้าเป็น husky หรือ hooks path อื่น ให้เอาออกจาก script `prepare` ใน
   `package.json` แล้วสั่ง `git config core.hooksPath .githooks` — ระหว่างนี้ `init` จะไม่แตะ และ `check` จะไม่ผ่าน
4. สั่ง `/ai-kit:init` — สร้าง `ai/kit/` จาก template, ตั้ง git pre-commit shim, รัน `check` แล้วช่วยกรอก `ai/kit/`
   (รวมถึงเลือกภาษาใน `conventions`) และส่วนของโปรเจกต์ใน `CLAUDE.md` (โครงสร้าง, คำสั่ง, กฎของ stack, branch,
   วิธี verify)
   จากนั้นปิดแล้วเปิด session ของ Claude Code ใหม่ เพื่อให้ SessionStart hook ใส่กฎการทำงานเข้ามา
5. commit `ai/kit/`, `.githooks/pre-commit`, `.claude/settings.json`, `CLAUDE.md` โดย stage ทีละชื่อ

### เลิกใช้

สั่ง `/ai-kit:uninstall` หรือ `node <plugin>/scripts/kit.mjs uninstall` จาก root ของโปรเจกต์ — ย้อนข้อ 3-5 ข้างบน:
ลบ shim `.githooks/pre-commit`/`commit-msg` (เฉพาะที่ยังเป็น shim ของ ai-kit เท่านั้น), เอา `core.hooksPath` ออก
(เฉพาะเมื่อไม่มีอะไรเหลือใน `.githooks/`), ลบบรรทัด pointer ใน `CLAUDE.md`, และลบ `ai-kit@korn9537` ออกจาก
`enabledPlugins` ใน `.claude/settings.json` หรือ `.claude/settings.local.json` (ไม่แตะ `~/.claude/settings.json`
ซึ่งเป็น scope ของผู้ใช้เอง — ถ้าจะเลิกใช้ที่ scope นั้นต้องแก้เอง) ส่วน `ai/kit/` (config, checks, conventions ที่
กรอกไว้) จะเก็บไว้ไม่ลบ ใส่ `--purge` ถ้าต้องการลบด้วย สิ่งที่ลบให้ไม่ได้ (hook ที่ไม่ใช่ของ ai-kit, `core.hooksPath`
ที่ยังมี hook อื่นใช้อยู่) จะพิมพ์ด้วย `!` ให้ไปแก้เอง แล้ว commit สิ่งที่เปลี่ยน จากนั้นปิดแล้วเปิด session ของ
Claude Code ใหม่

### อัปเดต

ถ้าตั้ง `autoUpdate` ไว้ จะอัปเดตเองตอนเปิด Claude Code หรือสั่ง `claude plugin marketplace update korn9537` หรือใช้
`/plugin` — จะได้เวอร์ชันใหม่ก็ต่อเมื่อเลข `version` ใน `plugin.json` เปลี่ยน

### แก้ kit

1. clone `korn9537/ai-kit` แล้วแก้ที่นั่น ห้ามแก้ตัวที่ติดตั้งอยู่ใน `~/.claude/plugins/` สั่ง
   `git config core.hooksPath .githooks` ครั้งเดียว pre-commit ของ clone จะตรวจความยาวบรรทัดของเอกสาร และตรวจ
   comment กับขนาดไฟล์ 40,000 ตัวอักษรของ code ใน kit ด้วยกฎเดียวกับที่ใช้กับทุกโปรเจกต์
2. ทดสอบในโปรเจกต์ด้วย `claude --plugin-dir /path/to/ai-kit` และรัน `claude plugin validate /path/to/ai-kit`
   (ไม่มี test ไม่มี CI)
3. เพิ่มเลข `version` ใน `.claude-plugin/plugin.json` และเขียนหนึ่งบรรทัดใน `CHANGELOG.md`
   - patch (2.0.x) — แก้บั๊ก
   - minor (2.x.0) — เพิ่ม hook, command, check หรือ config key ที่มีค่า default
   - major (x.0.0) — โปรเจกต์ต้องแก้ `ai/kit/`, `CLAUDE.md` หรือ settings ถึงจะใช้ต่อได้
4. ทำงานบน branch: `main` คือ release เพราะทุกโปรเจกต์ที่ตั้ง `autoUpdate` ติดตั้งจาก `main` merge ด้วย
   `git merge --ff-only` เมื่อ review ไม่มี finding CONFIRMED ค้าง หรือ `CHANGELOG.md` ระบุข้อที่ค้างไว้
   ใส่ tag `vX.Y.Z` ที่ commit ที่เปลี่ยน version แล้ว push `main` พร้อม tag release ที่เสียให้ revert บน `main`

กฎหรือข้อบกพร่องที่เจอระหว่างทำงานในโปรเจกต์ agent จะเปิดเป็น GitHub issue label `proposal` ใน repo นี้
(เกณฑ์และรูปแบบอยู่ใน `docs/kit-proposals.md`: ต้องเขียนกฎได้โดยไม่อ้างชื่อโปรเจกต์ code หรือ path จริง ไม่อย่างนั้นลง
`ai/kit/review-checklist.md` ของโปรเจกต์แทน) จากนั้นสั่ง `/ai-kit:harvest` ใน clone นี้ agent จะแสดงตาราง
ว่ารับ รวม ปฏิเสธ หรือส่งให้เจ้าของตัดสินแต่ละข้อ แล้วรอให้สั่งก่อนแก้ไฟล์
ข้อที่รับจะอยู่ใน commit เดียวที่ปิด issue ตอน push แล้วไปถึงทุกโปรเจกต์ผ่าน `autoUpdate`

### กฎข้อเดียวที่ต้องจำ

แก้ของกลางใน repo นี้เท่านั้น อะไรที่เป็นของโปรเจกต์ใส่ `ai/kit/`
