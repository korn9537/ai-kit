# Docs for AI readers

- Reader: AI agents only; no human reads these.
- Scope: Markdown docs (`CLAUDE.md`, `docs/**/*.md`, `ai/**/*.md`: spec, plan, task, decision, screen files) and
  OpenAPI / JSON Schema `description` fields.
- Exempt: `README.md`, mockups, design assets, any doc the project marks human-facing.
- Applies to text you write. Restyling or splitting existing text is its own ask (split: move-only, own commit).
- Goal: fewest tokens that still prevent a wrong build.
- Enforced on added lines by `scripts/check-docs.mjs` (pre-commit, post-edit): emoji, bold, filler (fixed list),
  dates, Thai outside quotes or code. Scope: `docs.include`/`skip` in `ai/kit/config.json`.

## Language

- English. Thai costs more tokens per fact.
- Thai only as product data (UI copy, l10n values): quoted beside its English key, `empty_state: "ยังไม่มีรายการ"`,
  or unquoted in a table cell (`| key | th | en |`).

## Shape

- Fragments, not sentences: drop articles, filler, hedges, politeness.
- 3+ parallel items → table or `key: value` lines. Rules → bullets. Prose only for a cause chain a list cannot hold.
- One fact, one place. Elsewhere a pointer (`→ docs/spec.md §3`, `→ D3`), never a copy.
- Stable ids on rules, decisions, screens, tasks (`D3`, `S-2`, `T-12`) so pointers stay short.
- Exact values: numbers, units, paths, names, enum strings. No "about", "etc.", "and so on": list all, or name
  the set ("every list endpoint").
- Imperative for rules: `Never X`, `X ≥ 44`. Symbols allowed: `→ ≥ ≤ · |`.
- File > 20 KB → propose a split by area (own ask, move-only commit); an index file keeps one line per part.

## Delete

- Intros, "this document describes", overviews that repeat the headings, closing summaries.
- History, dates, who asked or approved, discussion → git log. A decision keeps the chosen option and a one-line
  reason; rejected options only when a later agent would otherwise pick one.
- What code, a schema or a generated file already states → pointer.
- Examples for an unambiguous rule; emoji; bold for emphasis; decorative headings.

## Example

```md
wrong:
## Overview
This section describes how deleting an order should work. When a user deletes an order, we want to keep it
for a while so it can be restored. Please note that we decided on 2026-03-01 to keep deleted orders for
about a month, because support often gets restore requests.

right:
## Order delete
- Soft delete: set `deleted_at`; hidden from lists
- Restore window 30 days, then purge job (support restores)
```
