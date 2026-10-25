# Code comments

Reader: AI agents only. A comment exists to stop the next agent from making a wrong edit. Nothing else.

## Keep (at most two lines, English, imperative)

- A constraint the code cannot show: `// PUT replaces the resource — send the slices this dialog hides`
- Why intentional-looking-wrong code is right: `// no FK: polymorphic ref_id`
- A pointer to the rule, not the rule: `// rule: ai/<doc>.md §3`
- Required by another standard: a measured contrast ratio beside a colour token

## Delete

- History: "used to", "was", "previously", "เคย", "ก่อนหน้านี้", dates, who asked → git log (the plugin's `scripts/check-comments.mjs` blocks dates and "owner-approved" in the files `comments.include` in `ai/kit/config.json` covers; write a format example as `YYYY-MM-DD`)
- Rationale that already lives in `ai/` or `CLAUDE.md` → replace with a pointer
- Restating the code, the identifier, or the type (`/// <summary>Gets the lead.</summary>`)
- Section banners, essays, examples, prose addressed to a human reader
- Commented-out code

## Rules

- Max 2 lines per block. Longer = it is a doc: move it to a doc under `ai/`, leave a pointer.

  ```ts
  // wrong (3 lines, history):
  // The board used to count in the browser, which broke paging when
  // the list grew past 50; we moved the count to the API in October.
  // Do not count here.
  // right:
  // counts come from GET /items/board — never count the loaded page
  ```

- An edit that makes a nearby comment false fixes or deletes it in the same edit.
- C# `///` XML docs are compiled (a broken `cref` or malformed XML fails the build); otherwise the same rules
  as `//`.
- One C# member, one `/// <summary>`: insert a new member above an existing summary, never between it and its
  member (the check blocks a second summary).
- Keep: license headers, `eslint-disable`/`#pragma`/`@ts-expect-error` with a short reason, Go directives
  (`//go:`, `//nolint`, `//line`), Dart `// ignore:`, generated files (a Go file with
  `// Code generated ... DO NOT EDIT.` in its header is skipped whole), vendored registry files (shadcn
  `components/ui/*`). The check reports a license header over 2 lines, and vendored files whose comments break
  these rules; exempt them with `comments.skip` in `ai/kit/config.json`.
