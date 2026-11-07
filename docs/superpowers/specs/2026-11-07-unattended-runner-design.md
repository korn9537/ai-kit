# One framework, two runners: ai-kit under the brieflane worker — design

Reader: the session that builds this, started from `~/Work/brieflane` with `--add-dir ~/Work/ai-kit`. Status: settled
with the owner 2026-11-07. K1 to K6 are built in ai-kit 2.29.0; what is left is brieflane and §Pilot. Their calls are
in §Decided here and §Pilot settings.

## Goal

A repo set up with ai-kit works the same way when a person drives Claude and when the brieflane worker does. No third
framework, no process written twice. Turning a repo on for the worker is one command.

## Principle

ai-kit owns what good work is: rules, checks, the review role. A runner owns how a job moves: who is asked, when
to merge, what the output looks like. The interactive plugin and the worker are two runners of the same content.

The repo is the interface. `kit.mjs sync` writes files under `ai/kit/`; the worker reads them from the target branch,
each one switched on by its presence (decision 83: the trigger is a file, not a setting). The worker never imports
the kit, and the kit knows nothing about brieflane, so `docs/kit-proposals.md` §Cross-repo test still passes: any CI
job can use the same files.

## Today, stage by stage

| Stage      | Interactive runner         | Worker today                   | After this design                       |
| ---------- | -------------------------- | ------------------------------ | --------------------------------------- |
| Understand | `ai-kit:business-analyst`  | `analyze.tmpl`, own sources    | `analyze.tmpl` + `analysis-sources.md`  |
| Rules      | `CLAUDE.core.md`, conventions | `ai/kit/conventions/`, `system.tmpl` | + `unattended.md` in the snapshot |
| Decide     | `ai-kit:decider`, four kinds | asks the requester           | technical choices decided, business asked |
| Build      | `ai-kit:committer`         | `implement.tmpl`, `fix.tmpl`   | same + `Job:` trailer                   |
| Check      | pre-commit, post-edit      | `check.sh`, project checks only | + kit checks, + required tools         |
| Review     | `ai-kit:change-reviewer`   | none                           | new stage from `review-prompt.md`       |
| Report     | 8-item final report        | JSON schema per job            | unchanged: runner-owned                 |
| Trace      | `/ai-kit:jobs`             | `runs` table, `{KEY}:` subject | both                                    |

Facts behind the table, checked 2026-11-07:

- All 12 repos under `~/Work` with `ai/kit/` have `unattended` off, and every `ai/kit/pre-commit.sh` matches the
  pattern `check.sh` refuses (1 in piano-rush, 30 in rem-saas), so none could be gated today.
- `internal/` and `cmd/` read neither `ai/kit/review-checklist.md` nor `ai/kit/analysis-sources.md` at run time.
- `out="$(... | xargs -0 <missing tool> -l)"` followed by `[ -n "$out" ]` passes when the tool is missing. The gofmt
  check in brieflane's `ai/kit/pre-commit.sh` has this form, against `docs/worker.md` ("the gate fails for every
  brief"). Tested as a pattern only.
- `system.tmpl` tells a run to read every file in `ai/kit/conventions/`, so a new file there reaches every
  implement and fix run with no worker change.

## Changes in ai-kit

**K1. `kit.mjs unattended` (one command per repo).** Prints what blocks the repo, rewrites `git diff --cached` to
`git diff $AI_KIT_RANGE` in `ai/kit/pre-commit.sh`, sets `"unattended": true`, runs `sync`. `--dry-run` only prints.
Rewrite to the range, not to `changed`: `changed` is ACMR only, and pilot lines use `--diff-filter=ACMRD` and `=A`.
A line it cannot rewrite safely is listed, not guessed. A repo with anything listed stays off, because the worker
gates on `check.sh` as soon as it exists; `--force` passes a listed script, never a line it cannot rewrite. A
`--staged` flag, the scripts `pre-commit.sh` calls that read the index or cannot be followed, and an empty
`pre-commit.sh` are listed for a person (`docs/ai-layout.md` §Runs without the plugin). `check` warns on `--cached` in
every repo: one form for both runners.

**K2. Required tools.** `ai/kit/requires.txt`, one command per line. `sync` starts it once and a person owns it after.
`check.sh` exits 1 when it is missing, else runs `command -v` on each first and exits 1 naming what is missing. A plain
file because the worker user may have no `jq`. The name reaches the Worker card through the existing failure log
(decision 85), so the worker needs no change.

**K3. Kit checks under `check.sh`.** `check-comments.mjs` and `check-docs.mjs` import Node builtins only, so `sync` can
copy them to `ai/kit/checks/` as generated files (about 30 KB a repo) and `check.sh` runs them. Both hard-code
`--cached`
in several places (`check-comments.mjs:207,229,238,283`, `check-docs.mjs:150,301`), so each needs a range mode first,
taking `--range=`. The 40 KB rule stays out of `check.sh`: a range cannot tell its move-only commit from the edit
after it, and a run cannot set `ALLOW_LARGE_EDIT`, so every brief on a large file would fail. The copies sit in
`ai/kit/checks/`, not `bin/`, which `.gitignore` drops in asw-sales-flow and brieflane.

**K4. `conventions/unattended.md`.** Always in the snapshot. Holds what a run needs from `CLAUDE.core.md` and
`general.md` lacks: change only what was asked; a technical choice is decided and stated, not asked; project knowledge
goes in repo docs in the same commit. It opens with: the runner's own rules and output schema win. It must not carry
report, subagent or AskUserQuestion rules.

**K5. `ai/kit/review-prompt.md`.** `sync` generates it from `agents/change-reviewer.md`: frontmatter dropped,
`${CLAUDE_PLUGIN_ROOT}/conventions/` becomes `ai/kit/conventions/`. One source for the review rules, so they cannot
drift. The agent's text says to run `git diff`; a generated line replaces that with the diff file the runner names.

**K6. Staleness.** `session-start.sh` adds one line when a repo's snapshot is stale. It stays a note: the tree still
changes only when someone runs `sync`.

## Changes in brieflane

**B1. `analyze.tmpl`.** One line: when `ai/kit/analysis-sources.md` exists, read the sources in its order; the code
says what the system does today. Analyze keeps its schema; the BA's section format does not apply.

**B2. `Job:` trailer.** `implement.tmpl` and `fix.tmpl` end the commit message with `Job: <yyyy-mm-dd>-<key>`: the
date the brief was created, the key in lower case, the same id for every run of a brief. WIP commits carry it too.
`/ai-kit:jobs` then lists a brief's commits and its revert command. Clones run no commit-msg hook, so nothing is
enforced; the worker can check the trailer with its other commit checks.

**B3. Review stage.** On when `git ls-tree origin/{target}` holds `ai/kit/review-prompt.md`; same shape as
`kitGated`.

- Place: last of the checks in `merge.go`, after the tagged-test check and before `rc.checksPassed = true`, so it
  runs only on work that already passes. Not rerun after a rebase at merge.
- Run: a new `claude -p`, no `--resume` (fresh eyes), permission `plan`, tools Read, Grep, Glob, the same isolation
  flags and generated settings as analyze.
- Input: the worker writes `git diff origin/{target}...HEAD` to `.brieflane/review/{KEY}.diff` and names the path; a
  diff inline could pass the 128 KiB argument limit. The prompt gives the brief and the checklist as the request.
- Output: new `schema_review.json`, `findings[{file, line, level, rule, fix}]`, `level` CONFIRMED or PLAUSIBLE.
- Back to Claude: every finding, CONFIRMED and PLAUSIBLE, returns as an `InvalidOutputError` with `Check: true`, so
  `CorrectCheck` and its delimiter treat them as data. The text is not cut to the 600-character tail. Claude fixes
  each one, or answers one it read and found not real with its reason, so a false PLAUSIBLE cannot loop.
- Rounds: review, fix, re-review, up to two fix rounds, on the review's own counter; it does not spend
  `maxCheckCorrections`. This goes past the kit's no-third-pass rule on purpose (§Decided here).
- A review run that fails, or returns invalid JSON after the schema retry, does not block: the run goes on and the
  result says it was not reviewed. Quota is the exception: `blocked: quota`, as any other run.
- Shown: rejected findings with their reasons, and anything left after the last round, go under
  "รายละเอียดทางเทคนิค".

The Claude runner lives on `Loop` and the checks on `Delivery`, so B3 has to pass the runner through; the
`Stages` interface is the seam to look at first. Record the stage as a new decision in `docs/decisions.md`, and
update `docs/worker.md` and `docs/ai-spec.md` §5.

## Decided here

- **Questions stay with the requester.** The kit's decider settles a reading of a requirement itself because the owner
  is the scarce resource. In brieflane the requester is there to answer, and "ask, do not guess business rules" is
  a product rule. Only technical questions change: K4 says decide them. No decider stage in the worker.
- **Every implement and fix run is reviewed, and every finding is fixed** (owner, 2026-11-07). No skip rule.
- **A finding left after the last round does not stop the merge** (owner, 2026-11-07). The worker merges into the
  project's target branch and shows the finding to the admin. Review never looks at what the target branch deploys
  to: the worker does not know, and that is the project's concern.
- **No manifest file.** Presence of each file is enough for one consumer, and it matches decision 83.
- **Version skew is safe both ways.** An old worker ignores new files; an old repo has none, so the stage is off.

## Not doing

- **Loading the plugin in worker runs.** It leaves `ai/usage/` files in the clone and its conversational rules
  conflict with schema-bound output (`docs/ai-layout.md`).
- **A new repo or process layer.** Everything above lands in the two existing repos.
- **Porting `committer`, `run-plan` or `continuous`.** The worker's loop already does their job for one brief.
- **For now:** usage records from worker runs, filing kit proposals from repeated worker findings,
  and letting a run call `check.sh` itself, which would save correction rounds but is unproved inside the sandbox.

## Known hole, kept

A run can still edit a script that `check.sh` calls when it sits outside `ai/kit/`, or the Makefile (`docs/worker.md`
§Safety). K3 narrows it for the kit checks only. A protected-paths list in config can follow the pilot.

## Order

1. K2, K1, K4: the repo can be turned on and the gate can be trusted. Release ai-kit.
2. B1, B2 and §Pilot: one real brief end to end, per `docs/worker.md` §First real run.
3. K5 then B3: review, measured on the pilot.
4. K3, K6.

Commits stay per repo and share one `Job:` id. The ai-kit release lands first. Until the plugin is updated, test with
`node ~/Work/ai-kit/scripts/kit.mjs`. Edits to ai-kit are outside the review hook of a brieflane session: launch
`ai-kit:change-reviewer` by hand for them.

## Pilot: asw-sales-flow, target branch `dev`

The owner's choice, 2026-11-07. Worktree `~/Work/asw-sales-flow-dev`. Read from `origin/dev`; nothing below has run.

| # | Blocker | Evidence | Fix | Where |
| - | ------- | -------- | --- | ----- |
| 1 | `check.sh` refuses the repo | 27 `git diff --cached` lines, 2 `--staged` calls | K1 rewrites the lines | asw `dev` |
| 2 | Called scripts read the index | `check-writes`, `check-invalidates`, `check-migration-index`, `lib/check-docs/spec-docs` | Read `AI_KIT_RANGE`, by hand | asw `dev` |
| 3 | No Playwright at the repo root | Worker runs at the clone root (`playwright.go:343`); only `apps/web` has the dependency and config | Root `playwright.config.ts`, see below | asw `dev` |
| 4 | Base URL name differs | Worker sets `BASE_URL`; asw reads `E2E_BASE_URL` | Same root config | asw `dev` |
| 5 | No `version_url` | Nothing found in `apps/api/src/Api`, `apps/web/src/app/api` or the Dockerfiles | `/version` serving the deployed commit | asw `dev` |
| 6 | No single `test_command` | Root `package.json` has no `test` or `typecheck` script | Compose one, see below | Project settings |
| 7 | Project allow list may widen a run | `.claude/settings.json` allows `Bash(curl *)`, `Bash(python -)`, `Bash(node -e ' *)`; `--setting-sources project` reads it, `Settings()` denies none | See below | brieflane |

**3 and 4.** A root config that spreads `apps/web/playwright.config.ts`, sets `testDir` to `apps/web/e2e/brieflane` and
`baseURL` from `BASE_URL`, plus `@playwright/test` at the root. The project's `e2e_dir` is the same folder.
`test-results/` then sits at the root, where the worker collects evidence. A separate folder also keeps the existing
`apps/web/e2e/uat` specs out of a regression run, which has no `--grep`. Chosen over a working-directory field in
brieflane, which needs a migration, API and screen 11 changes for one repo; add that field when a second monorepo
comes.

**6.** Start with `dotnet test apps/api/tests/UnitTests/UnitTests.csproj && pnpm --filter web typecheck`. Integration
tests need a database the worker user may not reach. `docs/worker.md` shows an exact `sh a.sh && sh b.sh` entry working.

**7.** Whether these entries add to `--allowedTools` is not checked. Test it first: a run asked to use `curl`, with the
generated settings. If it runs, the worker adds deny rules for them, or the binding preflight refuses a repo whose
`.claude/settings.json` allows Bash beyond the run's list. The project hook `db-remote-guard.sh` also runs in worker
runs, on a machine that may lack what it needs.

**CLAUDE.md conflicts.** It says commit on `uat` with no branch switch, and no Playwright as routine verification.
Both contradict a worker run. K4's opening line covers them; confirm in the first run.

**Gate tools.** `pre-commit.sh` calls `node` and installed packages only, so `requires.txt` is short, and no dotnet is
needed for the gate. `dotnet`, `pnpm` and `node` are still needed for `install_command` and `test_command`.

## Pilot settings (owner, 2026-11-07)

- `dev` deploys to `https://dev-salesflow.aswservice.com`; `version_url` is that host's `/version` once blocker 5 lands.
- `dev` has a user and password login, so the worker's test accounts work there.
- The worker runs on the owner's Mac under the owner's own macOS user, with their Claude login and git credentials. No
  dedicated user: the owner's call, against `docs/worker.md` §First real run and §Safety. Code the worker runs outside
  the sandbox can reach everything that user can.
