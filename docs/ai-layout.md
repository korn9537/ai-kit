# ai/ layout

Reader: agents writing or looking up project docs. Style for every file: `docs/ai-docs.md`. A template per type in
the plugin's `templates/ai/`; copy it when creating the first file of a type.

## Categories

| path | holds | id | template |
|---|---|---|---|
| `ai/kit/` | kit settings (`README.md` §Project settings) | — | `templates/ai-kit-project/` |
| `ai/decisions.md` | decisions with status | `D<n>` | `decisions.md` |
| `ai/requirements/<area>.md` | requirements, distilled from the human source | `REQ-<n>` | `requirement.md` |
| `ai/data/<entity>.md` | one table or entity: meaning, states, invariants, relations, lifecycle | — | `data.md` |
| `ai/specs/F-<n>-<slug>.md` | behavior without a screen: job, integration, import, report, webhook | `F-<n>` | `feature.md` |
| `ai/screens/S-<n>-<slug>.md` | one screen (`docs/screen-specs.md`) | `S-<n>` | `screen.md` |
| `ai/api/<area>.md` | API contract, when the repo has no OpenAPI file | — | `api.md` |
| `ai/plans/<slug>.md` | a multi-commit plan in progress; deleted when done | `T-<n>` | `plan.md` |
| `ai/notes.md` | references: URL, dashboard, ticket, account name | `R<n>` | `notes.md` |
| `ai/usage/<YYYY-MM>/<session>[.<n>].jsonl` | token records, written by the kit (flushed once per session, never edited); not a doc | — | — |
| `ai/usage/decisions/<YYYY-MM>/<session>.<agent>.jsonl` | `ai-kit:decider` verdicts, one file per call, written once by the kit; not a doc | — | — |

- Ids are never reused. A file-level id (`F`, `S`) is in the file's heading; an entry id (`D`, `REQ`, `R`, `I`) in
  the entry's heading or line. `T-<n>` is scoped to its plan and never pointed to from outside it.
- Nothing else under `ai/`. `kit.mjs check` warns on any other top-level entry, except a path `ui.api` or
  `ai/kit/analysis-sources.md` names.
- Outside `ai/`: human-read docs (customer requirements, meeting notes), generated files, history (git log).
  A doc under `ai/` points to its human source, never copies it.

## Runs without the plugin

For a project with `claude -p` runs that do not load the plugin (a CI job, a queue worker), opted in with
`"unattended": true` in `ai/kit/config.json`, default off. The plugin stays the source of the rules.

- `kit.mjs sync` (and `init`) writes `ai/kit/conventions/` (`general.md`, the `conventions` files, what each adds to),
  `ai/kit/check.sh`, and one line in `CLAUDE.md` that sends the run to `ai/kit/conventions/` before it writes code.
  All generated, never edited; commit them. `sync` replaces a hand-edited copy still in the list; it leaves a file
  with no generated header, and a hand-edited copy no longer in the list, and says so.
- `kit.mjs check` warns of a missing, stale or hand-edited copy; nothing refreshes them on its own, so the tree only
  changes when someone runs `sync`. Stale means the text differs, so a kit release that leaves a file alone is silent.
- A gate runs `sh ai/kit/check.sh <base-ref>` before merging: `ai/kit/pre-commit.sh` on the files changed since the
  merge base, exit 1 on a failure. It reads HEAD and the index and changes neither.
- `ai/kit/pre-commit.sh` gates each check on `changed`, which every runner defines: staged files in a commit, the
  range in `check.sh`, passed through `AI_KIT_FILES`. `check.sh` refuses a script with `--cached` or `--staged` in its
  code, and one that does not parse. A script it calls that reads staged files itself sees none there: pass it the
  output of `changed`.
- `check.sh` runs the project's checks only, on committed files, and prints how many it covered. The kit's own
  (comments, docs, 40 KB) live in the plugin.
- A path starting `ai-kit/` inside a copy is a plugin doc, not in the repo.
- Turning `unattended` off stops the warnings only: delete the copies, `check.sh` and the `CLAUDE.md` line by hand.
- Not carried over: plugin hooks, agents, the Job trailer, `CLAUDE.core.md`. Enabling the plugin at project level is
  not the way to get them: such a run leaves `ai/usage/` records in the clone, and its conversational rules conflict
  with a run that returns schema-bound output. A pipeline writes its own review prompt and reads
  `ai/kit/review-checklist.md` and `ai/kit/conventions/` from the repo.

## Where a fact goes

Project knowledge lives in the repo, never in auto-memory; same commit as the work.

- rule or correction for this repo → `CLAUDE.md` or `ai/kit/review-checklist.md`
- holds in any repo → kit proposal (`docs/kit-proposals.md`)
- decision or constraint → `ai/decisions.md` (or the source `ai/kit/analysis-sources.md` names)
- reference (URL, dashboard, ticket, account name) → `ai/notes.md`, one `- R<n>` line each (Per type)
- personal preference of the user → tell them; their `~/.claude/CLAUDE.md` holds it

## Order and links

- New feature: data → screen or feature spec → API spec → API → screen or job.
- A spec names the requirement it serves (`reqs: REQ-3`) and the entities it touches (`data: → ai/data/order.md`);
  never the reverse, so one fact lives in one place.
- `ai/data/` is the base: API and screen specs point to its states and rules instead of restating them.
- A decision that changes a rule in another file: the rule is edited there, the decision keeps why.
- `analysis-sources.md` overrides a path only for a project that keeps a category elsewhere; a line naming no
  path falls back to this table.

## Per type

- Decision: `status` (`Confirmed` final, `Default` until the owner confirms) · `rule` one line, a pointer when the
  rule lives in another file · `why` one line · `rejected` only when a later agent would otherwise pick it. Superseded →
  `status: Superseded by D<n>`, rule kept.
- Requirement: `source` (human doc path or ticket) · `need` · `acceptance` as bullets a test can check.
- Data: `source` (migration or model path; columns live there, never listed here) · `written by` (the module
  that owns writes; readers are not listed) · fields only where the meaning is not obvious from the name (enum
  values, units, what null means) · states with who moves them · invariants `I<n>` · relations as pointers ·
  lifecycle (soft delete, retention, purge, PII).
- Feature: `trigger` · `input` · steps · `output` · `errors` and retry · `data` touched · `reqs`.
- Plan: goal · tasks `T-<n>` with status `todo | doing | done` and files · open questions. Deleted in the commit
  that finishes it. A multi-commit plan is `ai/plans/<job>.md`, written by `scripts/plan.mjs`: batches in place of
  tasks, status from the job's commits, deleted in a commit of its own (`plan-batching.md` §Plan file).
- Notes: one `- R<n>: <what> → <where>` line each.
