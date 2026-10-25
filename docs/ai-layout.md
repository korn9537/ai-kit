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

- Ids are never reused. A file-level id (`F`, `S`) is in the file's heading; an entry id (`D`, `REQ`, `R`, `I`) in
  the entry's heading or line. `T-<n>` is scoped to its plan and never pointed to from outside it.
- Nothing else under `ai/`. `kit.mjs check` warns on any other top-level entry, except a path `ui.api` or
  `ai/kit/analysis-sources.md` names.
- Outside `ai/`: human-read docs (customer requirements, meeting notes), generated files, history (git log).
  A doc under `ai/` points to its human source, never copies it.

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
  that finishes it.
- Notes: one `- R<n>: <what> → <where>` line each.
