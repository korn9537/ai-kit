# ai-kit

A Claude Code plugin with a working framework: working rules, hooks that enforce them, a reviewer and an analyst
agent, a git pre-commit runner, and a comment check. This repo is both the plugin and its marketplace
(`korn9537`). It holds nothing project-specific. Each project keeps its own settings in `ai/kit/`, which the kit
reads and never overwrites; a project without `ai/kit/` is left alone, so the plugin is safe at user scope.

Requires `jq` (hooks) and Node 22+ (scripts).

## Layout

| Path                         | What                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| `.claude-plugin/`            | `plugin.json` (name, version) and `marketplace.json`                   |
| `CLAUDE.core.md`             | git and working conventions, the final-report format                   |
| `agents/`                    | `ai-kit:business-analyst`, `ai-kit:change-reviewer`                    |
| `hooks/`                     | Claude Code hooks (below), wired in `hooks/hooks.json`                 |
| `commands/`                  | `/ai-kit:init`, `/ai-kit:check`                                        |
| `githooks/pre-commit`        | git pre-commit runner, called by the project's `.githooks/pre-commit`  |
| `scripts/kit.mjs`            | `init` / `check` (§Commands)                                           |
| `scripts/check-comments.mjs` | comment rule check, run by pre-commit and post-edit                    |
| `docs/`                      | `code-comments.md`, `shared-checkout.md`                               |
| `conventions/`               | cross-repo coding rules: `general.md`, one per language                |
| `templates/ai-kit-project/`  | starter `ai/kit/` files, copied by `init` when missing                 |
| `CHANGELOG.md`               | one line per change; the version lives in `.claude-plugin/plugin.json` |

Hooks (each exits silently when the project has no `ai/kit/`):

- `session-start.sh` (SessionStart) injects `CLAUDE.core.md` with its paths pointing into the plugin, and writes
  the plugin path to `<git-common-dir>/ai-kit-root` for the pre-commit shim.
- `review-before-stop.sh` (Stop) blocks the final reply until `ai-kit:change-reviewer` has reviewed code edited
  since the last review. `review-snapshot.sh` (PostToolUse on Agent) records what was reviewed.
  Edits by a finished commit subagent count too; one still running is skipped. Also counted as a review: a
  user message starting with "skip review" or "ไม่ต้อง review", and, right after a re-check, a main-session reply
  with `Review closed: re-checked once` (not quoted).
- `handoff-nudge.sh` (UserPromptSubmit) adds a note once the context passes `handoff.max_context` tokens, asking
  for a "Next session" prompt when the task ends. It never blocks.
- `post-edit-check.sh` (PostToolUse on Edit/Write) runs the comment check, then `ai/kit/post-edit.sh`.
- `git-add-all-guard.sh` (PreToolUse on Bash) blocks `git add -A` and `git commit -a` (shared checkout).
- `build-while-dev-guard.sh` (PreToolUse on Bash) blocks a build while the dev port listens.

## Project settings (`ai/kit/`)

| File                  | Read by                                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.json`         | hooks and `check-comments.mjs`: `code_dirs`, `comments.include`/`skip`, `build_guard.port`/`build_re`/`hint`, `shared_checkout_doc`, `handoff.max_context`; agents and `kit.mjs check`: `conventions` |
| `pre-commit.sh`       | `githooks/pre-commit`: the project's checks, sourced after prettier                                                                                                                                        |
| `post-edit.sh`        | `hooks/post-edit-check.sh`: the project's per-file checks                                                                                                                                                  |
| `review-checklist.md` | `ai-kit:change-reviewer`                                                                                                                                                                                   |
| `analysis-sources.md` | `ai-kit:business-analyst`                                                                                                                                                                                  |

`conventions` lists the language files in `conventions/` that apply to the project, without `.md` (e.g.
`["go", "sql"]`; default `[]`). `general.md` always applies; `check` fails on a name with no file. An exception
for one project goes in its `review-checklist.md`, with its reason. `shared_checkout_doc` defaults to this
plugin's `docs/shared-checkout.md`.

## Commands

Run from the project root (or `/ai-kit:init`, `/ai-kit:check` inside Claude Code).

- `node <plugin>/scripts/kit.mjs init` creates the missing `ai/kit/` files from the templates (never overwrites),
  writes the `.githooks/pre-commit` shim when missing (rewrites a 1.x shim; warns about any other hook there) and
  sets `core.hooksPath` to `.githooks` unless another path is set (warns), and writes `<git-common-dir>/ai-kit-root`
  for the shim.
- `node <plugin>/scripts/kit.mjs check` exits 1 when `ai/kit/config.json` is missing, malformed or not an object,
  when `conventions` is not an array or names a file `conventions/` lacks, when the shim is missing or not the kit
  shim, when `core.hooksPath` is not `.githooks`, when none of `.claude/settings.json`, `.claude/settings.local.json`
  or `~/.claude/settings.json` enables `ai-kit@korn9537` (the project file is recommended, so teammates get it),
  when `code_dirs` lists `ai-kit` or `shared_checkout_doc` names a missing file (1.x leftovers), when settings still
  run a hook from an in-repo `ai-kit/hooks/` copy, when `.claude/agents/` holds an old copy of a kit agent, or when
  `CLAUDE.md` still imports `@ai-kit/CLAUDE.core.md`. Each line names its fix. The pre-commit runner calls it when
  `ai/kit/config.json`, `.githooks/`, `.claude/settings.json`, `.claude/agents/` or `CLAUDE.md` are staged.

The shim reads the plugin path from `<git-common-dir>/ai-kit-root`, written by `init` and at each session start.
Until either has run on a machine, it prints a warning and runs only `ai/kit/pre-commit.sh`.

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

## Updating

With `autoUpdate` the marketplace refreshes at startup. By hand: `claude plugin marketplace update korn9537`, or
`/plugin` in Claude Code. A new version is picked up only when `version` in `plugin.json` changed.

## Editing the kit

Rule: anything shared lives here; anything about one project goes in its `ai/kit/`.

1. Clone `korn9537/ai-kit` and edit there, never the installed copy under `~/.claude/plugins/`.
2. Test in a project with `claude --plugin-dir /path/to/ai-kit`; run `claude plugin validate /path/to/ai-kit`
   and `bash hooks/build-while-dev-guard.test.sh`.
3. Bump `version` in `.claude-plugin/plugin.json` and add a `CHANGELOG.md` line: patch for a fix, minor for a new
   hook, check or config key with a default, major when a project must edit `ai/kit/`, `CLAUDE.md` or its
   settings to keep working.
4. Commit and push.

## Migrating a repo from 1.x

1. Delete `ai-kit/`, `.claude/agents/business-analyst.md` and `.claude/agents/change-reviewer.md`, every hook
   entry in `.claude/settings.json` that runs `ai-kit/hooks/...`, and the `@ai-kit/CLAUDE.core.md` line in
   `CLAUDE.md`.
2. Add the settings from §Install, open Claude Code and trust the folder.
3. Run `node <plugin>/scripts/kit.mjs init` (or `/ai-kit:init`) to rewrite the shim, then `check`.
4. In `ai/kit/config.json` drop `ai-kit` from `code_dirs`, and drop `shared_checkout_doc` if it named
   `ai-kit/docs/shared-checkout.md`.
5. Commit the deletions and changes together, staged by name.

Recommended skill, installed separately: `impeccable` (UI review; a project's `review-checklist.md` can call it).

## คู่มือภาษาไทย

ai-kit คือ plugin ของ Claude Code ที่รวมกฎการทำงานพร้อมตัวบังคับใช้ repo นี้เป็นทั้ง plugin และ marketplace
(`korn9537`) มีสองส่วน

- repo นี้ — ของกลาง ห้ามมีชื่อ path หรือคำเฉพาะของโปรเจกต์ใด
- `ai/kit/` ในแต่ละโปรเจกต์ — ค่าตั้ง, check ของโปรเจกต์, checklist ของ reviewer ไม่ก็อปข้ามโปรเจกต์
  โปรเจกต์ที่ไม่มี `ai/kit/` hook ทุกตัวจะไม่ทำอะไร

กฎการเขียนโค้ดที่ใช้ได้ทุกโปรเจกต์อยู่ใน `conventions/` (`general.md` ใช้เสมอ, ไฟล์ภาษาเลือกใน
`ai/kit/config.json` key `conventions` เช่น `["go", "sql"]` ถ้าชื่อไหนไม่มีไฟล์ หรือ config.json ไม่ใช่ JSON object
`check` จะไม่ผ่าน)
ข้อยกเว้นของโปรเจกต์เขียนใน `ai/kit/review-checklist.md` พร้อมเหตุผล

ต้องมี `jq` และ Node 22 ขึ้นไป

### ติดตั้งในโปรเจกต์

1. ใส่ `extraKnownMarketplaces` และ `enabledPlugins` ตามตัวอย่างใน §Install ลงใน `.claude/settings.json` แล้ว commit
2. เปิด Claude Code ใน repo แล้วกด trust โฟลเดอร์ จะมีให้ติดตั้ง marketplace และ plugin
3. ถ้าโปรเจกต์มี git pre-commit อยู่แล้ว ให้ย้าย check เหล่านั้นไปไว้ใน `ai/kit/pre-commit.sh` แล้วเอาของเดิมออก
   ถ้าเป็น `.githooks/pre-commit` ให้ลบไฟล์ ถ้าเป็น husky หรือ hooks path อื่น ให้เอาออกจาก script `prepare` ใน
   `package.json` แล้วสั่ง `git config core.hooksPath .githooks` — ระหว่างนี้ `init` จะไม่แตะ และ `check` จะไม่ผ่าน
4. สั่ง `/ai-kit:init` — สร้าง `ai/kit/` จาก template, ตั้ง git pre-commit shim, รัน `check` แล้วช่วยกรอก `ai/kit/`
   (รวมถึงเลือกภาษาใน `conventions`) และส่วนของโปรเจกต์ใน `CLAUDE.md` (โครงสร้าง, คำสั่ง, กฎของ stack, branch,
   วิธี verify)
   จากนั้นปิดแล้วเปิด session ของ Claude Code ใหม่ เพื่อให้ SessionStart hook ใส่กฎการทำงานเข้ามา
5. commit `ai/kit/`, `.githooks/pre-commit`, `.claude/settings.json`, `CLAUDE.md` โดย stage ทีละชื่อ

### อัปเดต

ถ้าตั้ง `autoUpdate` ไว้ จะอัปเดตเองตอนเปิด Claude Code หรือสั่ง `claude plugin marketplace update korn9537` หรือใช้
`/plugin` — จะได้เวอร์ชันใหม่ก็ต่อเมื่อเลข `version` ใน `plugin.json` เปลี่ยน

### แก้ kit

1. clone `korn9537/ai-kit` แล้วแก้ที่นั่น ห้ามแก้ตัวที่ติดตั้งอยู่ใน `~/.claude/plugins/`
2. ทดสอบในโปรเจกต์ด้วย `claude --plugin-dir /path/to/ai-kit` และรัน `claude plugin validate /path/to/ai-kit`
3. เพิ่มเลข `version` ใน `.claude-plugin/plugin.json` และเขียนหนึ่งบรรทัดใน `CHANGELOG.md`
   - patch (2.0.x) — แก้บั๊ก
   - minor (2.x.0) — เพิ่ม hook, check หรือ config key ที่มีค่า default
   - major (x.0.0) — โปรเจกต์ต้องแก้ `ai/kit/`, `CLAUDE.md` หรือ settings ถึงจะใช้ต่อได้
4. commit แล้ว push

### ย้าย repo จาก 1.x

1. ลบ `ai-kit/`, `.claude/agents/business-analyst.md`, `.claude/agents/change-reviewer.md`, รายการ hook ใน
   `.claude/settings.json` ที่เรียก `ai-kit/hooks/...` และบรรทัด `@ai-kit/CLAUDE.core.md` ใน `CLAUDE.md`
2. ใส่ settings ตาม §Install เปิด Claude Code แล้ว trust โฟลเดอร์
3. สั่ง `/ai-kit:init` (หรือ `node <plugin>/scripts/kit.mjs init`) เพื่อเขียน shim ใหม่ แล้วรัน `check`
4. ใน `ai/kit/config.json` เอา `ai-kit` ออกจาก `code_dirs` และเอา `shared_checkout_doc` ออกถ้าชี้ไปที่
   `ai-kit/docs/shared-checkout.md`
5. commit ทั้งหมดพร้อมกัน โดย stage ทีละชื่อ

### กฎข้อเดียวที่ต้องจำ

แก้ของกลางใน repo นี้เท่านั้น อะไรที่เป็นของโปรเจกต์ใส่ `ai/kit/`
