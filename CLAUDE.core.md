# AI working conventions (ai-kit)

Injected at session start by the ai-kit plugin in every project that has `ai/kit/`. Commands, stack rules, branch
and deploy live in the project's CLAUDE.md, its settings in `ai/kit/`; on a conflict about commands, stack, branch or
deploy the project's CLAUDE.md wins. The four owner decision kinds below never yield to it.

## Git

- The checkout and index may be shared with other sessions: stage named files only (hook-guarded), read
  `git diff --cached --stat` before committing, revert only your own hunks, push only when asked. `ai/usage/` holds
  kit-written token records: never edit, stage, revert or search them; the pre-commit adds them, so commit with
  `git add <files>` then `git commit` with no paths (`git commit -- <paths>` and `-o` leave them behind). Details:
  `ai-kit/docs/shared-checkout.md`.

## Language

- Reply to the user in Thai, the final report included. English stays: code, identifiers, commands, paths, quoted
  output, the report item labels, the Next-session prompt, and the Review closed phrase of report item 3
  (hook-matched, plain text).
- Docs under `ai/`, code comments, commit messages, subagent briefs and their reports: English. A doc you create
  goes in its `ai/` category (`ai-kit/docs/ai-layout.md`), AI-only and token-minimal (`ai-kit/docs/ai-docs.md`);
  another place or form only when the user names it.

## Working conventions

- **The agent decides; the owner holds only four kinds of decision:** 1. money (price, purchase, paid service, added
  infra cost; any change to an amount a customer pays, a bug fix toward the evident intent included) · 2.
  irreversible or outward action (delete real data, production deploy, contact people) · 3. legal, privacy,
  consent · 4. changing a decision recorded as final (Confirmed, or the project's final status). Anything else
  inside the request: decide, act, report it under Decided; the owner may overrule later. Work outside the request →
  Open.
- **Summarize before a UI, DB or business-rule change** (also run BA when the user asks for it). Business rule =
  stage, SLA, permission, scope, calculation, or anything a user sees behave differently. For a DB or business-rule
  change, first run the read-only `ai-kit:business-analyst` agent and build the summary from its report; a UI-only
  change (layout, copy, style: no change in what a user can do or what is decided for them, no rule or data) is
  summarized by the main session without it: 1. Problem · 2.
  Recommendation (one, with rejected alternatives and why) · 3. How (files/endpoints) · 4. Affects (screens, data,
  other modules) · 5. Standard it sets or follows. Touches an owner decision → show the summary and wait for a go;
  otherwise show it and go on with the recommendation; BA assumptions go to Decided. A choice whose reasons must be
  kept → `ai/decisions.md` (or the decisions source `ai/kit/analysis-sources.md` names) with the default status, same
  commit. Small jobs (typo, copy, one style value on one screen, move-only refactor, docs) skip both, except that
  a BA request by the user is always run; unsure → summarize.
- **Agent model:** `ai-kit:business-analyst` and `ai-kit:change-reviewer` run on sonnet at medium effort (agent
  frontmatter), commit subagents on sonnet via the Agent call. Pass `model: "opus"` and `effort: "high"` when the change
  touches a DB schema or migration, a calculation, a permission, or a decision recorded as final; no other model or
  effort override.
- **Screen specs** when `ai/kit/config.json` sets `ui.platforms`: a screen change starts from its spec; rules in
  `ai-kit/docs/screen-specs.md`.
- **Conventions:** before writing code, read `ai-kit/conventions/general.md` and `ai-kit/conventions/<name>.md` for
  each language or framework in `ai/kit/config.json` `conventions` that the change touches, and the files each of
  those says it adds to (`nestjs.md` adds to `typescript.md`). When summary item 5 sets a standard: this repo only →
  a check in `ai/kit/pre-commit.sh` when a script can catch it, else a line in `ai/kit/review-checklist.md`, in the
  same commit; cross-repo → a `proposal` issue on
  korn9537/ai-kit, never an edit of the installed plugin. Also for a repeated review finding, a user correction or a
  kit gap. Filing is pre-approved; when, test, format, fallback: `ai-kit/docs/kit-proposals.md`.
- **Change only what was asked.** Name the files first and stay inside them; a wider change → Open, one sentence.
  "Remove X" means remove it, not move or rename it; keeping any of it → Open, never into the change. "Every `<x>`"
  means every instance of that kind, including ones built a different way: list which changed and which did not.
- **Recommend, do not list.** Options come with a verdict, the reason and the one condition that would flip it; an
  anomaly found while checking: in scope → fix it; outside the request → Open.
- **Project knowledge lives in the repo, never in auto-memory** (one machine only; `init` sets
  `"autoMemoryEnabled": false`, writes are hook-guarded), in the same commit as the work. Where each kind goes:
  `ai-kit/docs/ai-layout.md` §Where a fact goes.
- **Comments** are for AI readers: at most two lines, a constraint or a pointer, no history
  (`ai-kit/scripts/check-comments.mjs`, `ai-kit/docs/code-comments.md`).
- **Verify once per commit**, right before it, only what changed, with the project's verify commands (CLAUDE.md).
  No unprompted tests.
- No build while the user's dev server runs: run the typecheck instead (hook-guarded for common JS
  build commands).
- Independent reads, searches and checks go out together in one message.
- **Several items** (fixes, features, review findings, upgrades): plan them before the first edit per
  `ai-kit/docs/plan-batching.md`.
- **A multi-commit plan runs from the main session as coordinator**, one commit subagent per batch; read
  `ai-kit/docs/plan-batching.md` §Coordinator pipeline before the first batch.
- No emoji in replies, docs or UI copy.
- **A finished task ends with this report** (drop a line that does not apply; a task that skips the
  summary reports Done, Checked and Git, plus Decided and Open when they hold anything):
  1. **Done** — what changed, 1–3 lines. 2. **Files** — links. 3. **Checked** — each command run and its result, the
     `ai-kit:change-reviewer` findings, and what was not checked. Any change outside `*.md` goes through it, except
     what the Stop hook lets pass (`ai-kit/README.md`, Stop: comment-only or small). For a calculation, permission or
     final-decision change, launch the reviewer yourself even when small. Findings on code you just changed are
     fixed and re-checked once by the same reviewer (fix diff only), with a fresh background reviewer per commit. No
     third pass: the report says, as plain text with no quotes or backticks, Review closed: re-checked once, no
     third pass. Exception: a CONFIRMED finding about data or rule correctness is fixed and then reviewed by a fresh
     reviewer. A user message starting with "skip review" or "ไม่ต้อง review" opts out. UI suggestions → Decided
     (applied) or Open. A finding seen a second time that a script could catch → say so in the proposal issue, or add
     the pre-commit check when it fails the cross-repo test (`ai-kit/docs/kit-proposals.md`).
     4. **Git** — commit hash or uncommitted; pushed or not. 5. **User sees** — what looks or behaves
     differently. 6. **Decided** — each choice the agent made that the owner might want otherwise: the choice,
     one-line reason, where recorded. 7. **Open** — only an owner decision (the four kinds above), work outside the
     request, or in-scope work that is blocked (with what blocks it), each with its proposed fix (file:line, cost)
     where one exists. In-scope and fixable → fix it before the report; a limit kept on purpose → note it in the
     code or doc. 8. **Next session** — only when the handoff hook asks; it says what to include.
