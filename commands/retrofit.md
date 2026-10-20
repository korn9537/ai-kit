---
description: Bring this project's docs into the ai/ layout from its code and existing docs, one category per commit
argument-hint: "[config|move|data|decisions|requirements|screens|api] [area]"
---

Retrofit the project's docs into `${CLAUDE_PLUGIN_ROOT}/docs/ai-layout.md`. Arguments: `$ARGUMENTS`.

Rules for every step:

- Never invent. Each line comes from the code or an existing doc; read it before writing the line. What neither
  states → an `open:` line in `ai/plans/retrofit.md`, never a guess.
- `data`, `screens`, `api` describe what exists: code wins over a doc that disagrees; list the stale doc under
  Decided. `requirements` and decisions with a final status say what must hold: a disagreement with the code → an
  `open:` line, neither side rewritten.
- Form: `${CLAUDE_PLUGIN_ROOT}/docs/ai-docs.md`; each new file starts from its template in
  `${CLAUDE_PLUGIN_ROOT}/templates/ai/`.
- A doc humans read stays outside `ai/`; the `ai/` file names it as `source:`, never copies it.
- One source per category: the commit that creates an `ai/` category file repoints its line in
  `ai/kit/analysis-sources.md` to the layout path. The old AI-facing file moves into `ai/` (`move`) or stays as the
  human `source:`; the plan says which.
- Each category is its own commit, run as a commit subagent per the multi-commit plan rule in the working
  conventions. A category over 15 files (entities, screens) splits into commits of at most 15.
- End with the working-conventions report: files written under Files, stale docs under Decided, open questions
  under Open.

## No argument: survey and plan

1. No `ai/kit/config.json` → run `/ai-kit:init` first.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/kit.mjs" inventory` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/kit.mjs" check`.
3. Verify each inventory group against the code: drop what is not a schema, screen, route or decision doc; add
   what the heuristics missed. Read `ai/kit/analysis-sources.md` for sources it already names.
4. Write `ai/plans/retrofit.md` from `${CLAUDE_PLUGIN_ROOT}/templates/ai/plan.md`: one task per category below that
   has work, in the table's order, each with its files and count; for each existing source, move or keep as
   `source:`; `open:` for each question for the owner.
5. Commit the plan alone, show it, stop. The user runs each category next.

## Categories, in order

| arg | does |
|---|---|
| `config` | `ai/kit/config.json`: `ui` (`docs/screen-specs.md` §Config, `include` from the inventory suggestion, `api` the API spec file or `ai/api/`), `docs.include` `^ai/.*\\.md$` when it still holds the old default; `ai/kit/analysis-sources.md` placeholder lines replaced by the layout paths |
| `move` | `ai/` entries outside the layout into their category, human-read docs out of `ai/`; move-only commit, then a second commit fixing links to moved files |
| `data` | one `ai/data/<entity>.md` per entity from the schema sources: `source`, `written by`, fields whose meaning the name does not give, states from enums and the code that changes them (with the role it checks), invariants `I<n>` from validation and constraints, relations from foreign keys, lifecycle from delete and retention code |
| `decisions` | `ai/decisions.md` from ADRs, decision docs and code comments that state a choice and its reason. Status: the source's final status (accepted, approved, Confirmed) → `Confirmed`; proposed, open or none → `Default`; list the mapping under Decided |
| `requirements` | `ai/requirements/<area>.md` only from an existing human source (`source:` points to it); none → skip |
| `screens` | `ai/screens/index.md`, one line per screen: `- <name> → <entry file> (no spec)` until its spec exists (`docs/screen-specs.md` §Screen spec); full `S-<n>` specs only for the `area` argument, or when the screen is next changed |
| `api` | when `ui.api` is an OpenAPI file: nothing. Else `ai/api/<area>.md` from the route files, one heading per endpoint |

## With an argument

1. Read `ai/plans/retrofit.md`; missing → run the survey first.
2. Do that category (`area` limits it to one folder, module or screen group). Mark its task `done` only when every
   file listed for it is covered; else `doing`, with the areas finished.
3. Run `kit.mjs check` and, for `screens` or `api`, `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-specs.mjs"`; fix
   what they name in the files you wrote.
4. Every task `done` → delete `ai/plans/retrofit.md` in the last commit.
