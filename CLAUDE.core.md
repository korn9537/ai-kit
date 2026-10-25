# AI working conventions (ai-kit)

Injected at session start by the ai-kit plugin in every project that has `ai/kit/`. Commands, stack rules, branch
and deploy live in the project's CLAUDE.md, its settings in `ai/kit/`; on a conflict the project's CLAUDE.md wins.

## Git

- The checkout and index may be shared with other sessions: stage named files only (hook-guarded), read
  `git diff --cached --stat` before committing, revert only your own hunks, push only when asked. Details:
  `ai-kit/docs/shared-checkout.md`.

## Language

- Reply to the user in Thai, the final report included. English stays: code, identifiers, commands, paths, quoted
  output, the report item labels, the Next-session prompt, and the phrase Review closed: re-checked once
  (hook-matched).
- Docs under `ai/`, code comments, commit messages, subagent briefs and their reports: English. A doc you create
  goes in its `ai/` category (`ai-kit/docs/ai-layout.md`), AI-only and token-minimal (`ai-kit/docs/ai-docs.md`);
  another place or form only when the user names it.

## Working conventions

- **The agent decides; the owner holds only four kinds of decision:** 1. money (price, purchase, paid service, added
  infra cost) · 2. irreversible or outward action (delete real data, production deploy, contact people) · 3. legal,
  privacy, consent · 4. changing a decision recorded as final (Confirmed, or the project's final status). Anything
  else inside the request: decide, act, report it under Decided; the owner may overrule later. Work outside the
  request goes to Open.
- **Summarize before a UI, DB or business-rule change** (also run BA when the user asks for it). Business rule =
  stage, SLA, permission, scope, calculation, or anything a user sees behave differently. For a DB or business-rule
  change, first run the read-only `ai-kit:business-analyst` agent and build the summary from its report; a UI-only
  change (layout, copy, style, no rule or data) is summarized by the main session without it: 1. Problem · 2.
  Recommendation (one, with rejected alternatives and why) · 3. How (files/endpoints) · 4. Affects (screens, data,
  other modules) · 5. Standard it sets or follows. Touches an owner decision → show the summary and wait for a go;
  otherwise show it and go on with the recommendation; BA assumptions go to Decided. A choice whose reasons must be
  kept → `ai/decisions.md` (or the decisions source `ai/kit/analysis-sources.md` names) with the default status, same
  commit. Small jobs (typo, copy, one style value on one screen, move-only refactor, docs) skip both; unsure →
  summarize.
- **Agent model:** `ai-kit:business-analyst` and `ai-kit:change-reviewer` run on sonnet at medium effort (agent
  frontmatter). Pass `model: "opus"` and `effort: "high"` when the change touches a DB schema or migration, a
  calculation, a permission, or a decision recorded as final; no other model or effort override.
- **Screen specs** when `ai/kit/config.json` sets `ui.platforms`: a screen change starts from its
  `ai/screens/S-<n>-*.md`; new screen: `ai/data/` entity → spec → API spec → API → screen; a screen without a
  spec gets one when next changed. Format: `ai-kit/docs/screen-specs.md`.
- **Conventions:** before writing code, read `ai-kit/conventions/general.md` and `ai-kit/conventions/<name>.md` for
  each language or framework in `ai/kit/config.json` `conventions` that the change touches. When summary item 5
  sets a standard: this repo only → `ai/kit/review-checklist.md` in the same commit; cross-repo → a `proposal` issue on
  korn9537/ai-kit, never an edit of the installed plugin. Also for a repeated review finding, a user correction or a
  kit gap. Filing is pre-approved; when, test, format, fallback: `ai-kit/docs/kit-proposals.md`.
- **Change only what was asked.** Name the files first and stay inside them; a wider change is one sentence the user
  may pick up. "Remove X" means remove it, not move or rename it; keeping any of it goes to Open, never into the
  change. "Every `<x>`" means every instance of that kind, including ones built a different way: list which changed
  and which did not.
- **Recommend, do not list.** Options come with a verdict, the reason and the one condition that would flip it; an
  anomaly found while checking: in scope → fix it; outside the request → Open, with its fix (file:line, cost).
- **Project knowledge lives in the repo, never in auto-memory** (`~/.claude/projects/*/memory/` is one machine
  only; `init` sets `"autoMemoryEnabled": false`, writes there are hook-guarded). Same commit as the work, `ai/`
  targets per `ai-kit/docs/ai-docs.md`: rule or correction for this repo → `CLAUDE.md` or
  `ai/kit/review-checklist.md`; holds in any repo → kit proposal (`ai-kit/docs/kit-proposals.md`); decision or
  constraint → `ai/decisions.md` (or the source `ai/kit/analysis-sources.md` names); reference (URL, dashboard,
  ticket, account name) → `ai/notes.md`, one `- R<n>: <what> → <where>` line each; personal preference of the
  user → tell them, their `~/.claude/CLAUDE.md` holds it.
- **Comments** are for AI readers: at most two lines, a constraint or a pointer, no history (`comments:check`,
  `ai-kit/docs/code-comments.md`).
- **A source file over 40 KB that you need to edit** is split first, move-only, in its own commit.
  A lint error the move surfaces is fixed in a follow-up commit, or its suppression names the real reason the rule
  does not apply; "moved verbatim" is no reason (pre-commit rejects it).
- **Verify once per commit**, right before it, only what changed, with the project's verify commands (CLAUDE.md).
  No unprompted tests.
- No build while the user's dev server runs: run the typecheck instead (hook-guarded).
- Independent reads, searches and checks go out together in one message.
- **Several items** (fixes, features, review findings, upgrades): before the first edit, inventory them, ask all
  owner questions at once, and batch items that touch the same file into one commit; a fix covers its whole unit; a
  mechanical sweep uses a codemod or script; hot files once per batch (`ai-kit/docs/plan-batching.md`).
- **A multi-commit plan runs from the main session as coordinator**, so its context stays small: each batch goes to a
  fresh background subagent (`general-purpose`, description `commit: <batch>`) that implements, verifies and commits
  it, then returns only hash, files, choices it made and open items (report items 6 and 7 only); an owner decision it
  hits comes back unanswered for the main session to ask. Its brief says it is a commit subagent, must not launch
  a reviewer, and first reads the "Working conventions" of `ai-kit/CLAUDE.core.md` (a subagent does not get this
  text). One commit subagent at a time; the main session keeps talking with the user but does not edit the repo
  while one runs. When it returns, the main session sends in one message that commit's background reviewer on its
  hash (reading `git show <hash>`, not the work tree; the brief names each item the main session added beyond the
  user's request, `also in scope: <item> (coordinator)`) and the next batch's commit subagent, unless that batch waits
  on this one; CONFIRMED fixes go back to that commit's own subagent by SendMessage (it holds the context; summary
  `commit: fix <batch>`, without the word review) once no commit subagent runs, then the one re-check. After the
  owner's go, every planned commit runs to the end in one run with one report: never stop between commits to ask
  whether to continue; stop early only for an owner decision or a blocker. A plan whose commits share too much
  context to hand over (one large refactor) says so and runs in the main session.
- No emoji in replies, docs or UI copy.
- **A finished task ends with this report** (drop a line that does not apply; a small job, one that skips the
  summary, reports Done, Checked and Git, plus Decided and Open when they hold anything):
  1. **Done** — what changed, 1–3 lines. 2. **Files** — links. 3. **Checked** — each command run and its result, the
     `ai-kit:change-reviewer` findings, and what was not checked. Any code change goes through it. Before the first
     review the Stop hook lets a change of at most `review.skip_lines` changed lines (default 10), with no new file
     and no `review.always` path, pass; a calculation, permission or final-decision change is reviewed anyway (in a
     commit subagent the coordinator launches it; the Stop hook enforces; a message starting with "skip review" or
     "ไม่ต้อง review" opts out); its findings on code you just changed are fixed and re-checked once by the same
     reviewer (fix diff only), with a fresh background reviewer per commit; re-check findings are fixed without a
     third pass unless CONFIRMED and about data or rule correctness, and the report then says, as plain text with no
     quotes or backticks: Review closed: re-checked once, no third pass. UI suggestions go to Decided (applied) or
     Open (outside the request). A finding seen a second time that a script could catch → propose a pre-commit check
     for it. 4. **Git** — commit hash or uncommitted; pushed or not. 5. **User sees** — what looks or behaves
     differently. 6. **Decided** — each choice the agent made that the owner might want otherwise: the choice,
     one-line reason, where recorded. 7. **Open** — only an owner decision (the four kinds above), work outside the
     request, or in-scope work that is blocked (with what blocks it), each with its proposed fix (file:line, cost)
     where one exists. In-scope and fixable → fix it before the report; a limit kept on purpose → note it in the
     code or doc. 8. **Next session** — only when the handoff hook flagged a large context: a paste-ready prompt in
     a code block (goal, steps left, decisions made here and not in the repo, files to read first, open items),
     nothing the repo or git log already holds.
