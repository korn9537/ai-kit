# Docs for AI readers

- Reader: AI agents only; no human reads these.
- Scope: `ai/**/*.md`, every category in `docs/ai-layout.md`. Files outside `ai/` are not governed here.
- A doc the agent creates goes under `ai/`, in this form. Another place or form only when the user names it.
- Categories, file names, ids and format per type: `docs/ai-layout.md`; screen and API specs:
  `docs/screen-specs.md`.
- Human-read docs, mockups, design assets: outside `ai/`, never checked. A human-form doc the user asks for goes
  outside `ai/`.
- Applies to text you write. Restyling or splitting existing text is its own ask (split: move-only, own commit).
- Goal: fewest tokens that still prevent a wrong build.
- Enforced on added lines by `scripts/check-docs.mjs` (pre-commit, post-edit; tests: `scripts/check-docs.test.mjs`):
  emoji, bold, filler (fixed list; `~` before a digit, a year too; about, around, roughly, approximately before a
  number other than a year 1900-2099, `every <number>`, or (a) dozen, hundred, thousand), dates (only
  `YYYY-MM-DD`, `D Month YYYY` and `Month D, YYYY` are matched), Thai outside quotes or code, a code file pointer in the
  `a.ts:12` form (code spans included; other spellings unchecked). Scope: `docs.include`/`skip` in
  `ai/kit/config.json` (default `^ai/.*\.md$`).
  - Not checked: fenced blocks, frontmatter, code spans (except line pointers), a moved line (same text as a
    removed line of an in-scope doc, outside fences and frontmatter; one removed line excuses one added line, its
    own file first). Indented code is checked. Thai exempt in double or curly quotes and in table rows; dates
    exempt in quotes.
  - Edited line: not reported for a rule when one removed line of the same hunk, outside fences and frontmatter,
    already held at least as many of each fragment (bold: its text; Thai: a run; others: the match). A removed
    table row holds no Thai. Joining two old lines into one is reported.
  - An unchanged line that leaves a fence or frontmatter counts as added.
  - A file renamed from an out-of-scope path (`README.md` into `ai/`) is checked in full.

## Language

- English. Thai costs more tokens per fact.
- Thai only as product data (UI copy, l10n values): quoted beside its English key, `empty_state: "ยังไม่มีรายการ"`,
  or unquoted in a table cell (`| key | th | en |`).

## Shape

- Fragments, not sentences: drop articles, filler, hedges, politeness.
- 3+ parallel items → table or `key: value` lines. Rules → bullets. Prose only for a cause chain a list cannot hold.
- One fact, one place. Elsewhere a pointer (`→ ai/specs/x.md §3`, `→ D3`), never a copy.
- A pointer into code names the file and a symbol (`orders.service.ts` `approveOrder`), never a line number:
  code edits shift lines silently.
- Stable ids on rules, decisions, requirements, screens (`D3`, `REQ-3`, `S-2`) so pointers stay short.
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
