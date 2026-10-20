# Screen and API specs

Reader: agents changing a screen or the API behind it, in a repo whose `ai/kit/config.json` sets `ui.platforms`.
Style: `docs/ai-docs.md`. Checked by `scripts/check-specs.mjs` (pre-commit, warnings only).

## Config

```json
"ui": { "platforms": ["web", "mobile"], "include": "^app/.*/page\\.tsx$", "api": "ai/api/" }
```

- `platforms`: `web`, `mobile`. Absent or `[]` = off. `"ui": { "platforms": [] }` = decided no UI, silences the
  detection warning of `kit.mjs check`.
- `include`: regex of screen entry files (page, route, screen widget), root-relative; not components. Default `^$`.
- `api`: the API's source of truth. An OpenAPI file (`.json`, `.yaml`, `.yml`) when the repo has one, else a
  folder of `.md` files (default `ai/api/`). Missing (API in another repo) → link check skipped with one warning;
  point it at a local checkout of that repo's spec to check links.

## Order

- New screen: `docs/ai-layout.md` §Order and links. The API's reads are shaped by the screen; rules and states
  come from `ai/data/`.
- Existing screen without a spec: write it when the screen is next changed, not before.
- Behavior change → spec changes in the same commit (`conventions/general.md` item 4).

## Screen spec

- One file per screen: `ai/screens/S-<n>-<slug>.md`, heading `# S-<n> <name>`. Ids never reused.
- `ai/screens/index.md`: one line per screen, `- S-<n> <name> → S-<n>-<slug>.md`.
- One screen shared by web and mobile = one file; `web:` / `mobile:` lines only for what differs.
- Template: `templates/ai/screen.md`.

Keys, one line each (repeat a key to continue it), items split by ` · `:

| key | holds |
|---|---|
| `platforms` | `web`, `mobile` |
| `reqs` | requirement ids it serves: `REQ-<n>` |
| `data` | entities it shows or changes: `→ ai/data/<entity>.md` |
| `roles` | who opens it; per-action roles go on the action |
| `files` | screen entry files, root-relative; a path ending in `/` covers the folder |
| `reads` | the one server read that composes the screen's data |
| `lookups` | cached reference reads: options, master data |
| `loads` | parts loaded on their own: dashboard widget, tab opened on demand, sub-list with its own paging |
| `actions` | `<action> → <command>`; one business state change = one command |
| `fields` | shown fields ← response fields; client formats only, never computes; meaning lives in `ai/data/` |
| `states` | loading · empty · error, each with its copy key or behavior |
| `nav` | `<trigger> → S-<n>` |
| `web` | route and query params, breakpoints, browser back and refresh |
| `mobile` | deep link, push entry, tab or stack, Android back, offline and weak network, OS permissions and denial |

- Endpoint syntax: `METHOD /path`, params as `{name}`. A read without an HTTP endpoint (server component,
  loader, GraphQL query) is named as the code names it.
- `reads` lists one item. A second read is either a `lookups` or `loads` item, or a defect.
- UI copy: a `| key | th | en |` table under `## Copy`.

## API spec

- `ui.api` folder: one file per area, `ai/api/<area>.md`; each endpoint a heading `## METHOD /path`.
- Per endpoint: roles, request (params, body, limits), response fields, errors, state transition for a command.
- Never list the screens that use an endpoint: the link lives in the screen spec. Reverse map:
  `node <plugin>/scripts/check-specs.mjs --map`.
- Template: `templates/ai/api.md`.

## Check

`scripts/check-specs.mjs`, warnings (`!`) only. Pre-commit runs it when a file under `ai/screens/`, the `ui.api`
source or a file matching `ui.include` is staged. Reports:

- an endpoint in `reads`, `lookups`, `loads` or `actions` missing from `ui.api`
- `reads` with more than one item
- a duplicate `S-<n>`, a file name or heading not in the `S-<n>` form
- `index.md` missing, or out of step with the files
- an added file matching `ui.include` that no spec lists under `files`
