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
- Docs (except human-facing ones), code comments, commit messages, subagent briefs and their reports: English.
  Docs are for AI readers, token-minimal: `ai-kit/docs/ai-docs.md`.

## Working conventions

- **Summarize before a UI, DB or business-rule change** and wait for a go (also run BA when the user asks for it).
  Business rule = stage, SLA, permission, scope, calculation, or anything a user sees behave differently. First run
  the read-only `ai-kit:business-analyst` agent and build the summary from its report: 1. Problem
  · 2. Recommendation (one, with rejected alternatives and why) · 3. How (files/endpoints) · 4. Affects (screens,
  data, other modules) · 5. Standard it sets or follows. Small jobs (typo, copy, one style value on one screen, move-only refactor, docs)
  skip both; unsure → summarize.
- **Conventions:** before writing code, read `ai-kit/conventions/general.md` and `ai-kit/conventions/<lang>.md` for
  each language in `ai/kit/config.json` `conventions` that the change touches. When summary item 5 sets a standard and
  the user says go, the same commit records it where item 5 names (cross-repo `conventions/<lang>.md` in the ai-kit
  plugin repo, a version bump; this repo `ai/kit/review-checklist.md`; a choice whose reasons must be kept, the
  decisions source first in `ai/kit/analysis-sources.md`).
- **Change only what was asked.** Name the files first and stay inside them; a wider change is one sentence the user
  may pick up. "Remove X" means remove it, not move or rename it; keeping any of it is its own question, never folded
  into a plan that gets a "go ahead". "Every `<x>`" means every instance of that kind, including ones built a
  different way: list which changed and which did not.
- **Recommend, do not list.** Options come with a verdict, the reason and the one condition that would flip it; an
  anomaly found while checking comes with its fix (file:line, cost), still waiting for a go.
- **Comments** are for AI readers: at most two lines, a constraint or a pointer, no history (`comments:check`,
  `ai-kit/docs/code-comments.md`).
- **A source file over ~40 KB that you need to edit** is split first, move-only, in its own commit.
- **Verify once per commit**, right before it, only what changed, with the project's verify commands (CLAUDE.md).
  No unprompted tests.
- A build while the user's dev server runs: ask first (hook-guarded).
- **A multi-commit plan after a go runs from the main session as coordinator**, so its context stays small: each
  commit goes to a fresh background subagent (`general-purpose`, description `commit: <step>`) that implements,
  verifies and commits it, then returns only hash, files and open items (report item 6 only); an owner question
  it hits comes back unanswered for the main session to ask. Its brief says it is a commit subagent and must not launch a reviewer.
  One subagent at a time; the main session keeps talking with the user but does not edit the repo while one runs.
  When it returns, the main session launches that commit's background reviewer on its hash; CONFIRMED fixes go to
  a fresh `commit: fix <step>` subagent, then the one re-check; the next step starts after that. A plan whose
  commits share too much context to hand over (one large refactor) says so and runs in the main session.
- No emoji in replies, docs or UI copy.
- **A finished task ends with this report** (drop a line that does not apply):
  1. **Done** — what changed, 1–3 lines. 2. **Files** — links. 3. **Checked** — each command run and its result,
     the `ai-kit:change-reviewer` findings, and what was not checked. Any code change goes through it (in
     a commit subagent the coordinator launches it; the Stop hook enforces; a message starting with "skip review"
     or "ไม่ต้อง review" opts out); its findings on code you just changed are fixed and re-checked once by the same
     reviewer (fix diff only), with a fresh background reviewer per commit; re-check findings are fixed without a
     third pass unless CONFIRMED and about data or rule correctness, and the report then says, as plain text with no
     quotes or backticks: Review closed: re-checked once, no third pass. UI suggestions (an owner decision) go to
     Open. A finding seen a second time that a script could catch → propose a pre-commit check for it. 4. **Git** —
     commit hash or uncommitted; pushed or not. 5. **User sees** — what looks or behaves differently. 6. **Open** —
     only a decision the owner holds (business rule, an open spec question), work outside the request, or in-scope
     work that is blocked (with what blocks it), each with its proposed fix (file:line, cost) where one exists.
     In-scope and fixable → fix it before the report; a limit kept on purpose → note it in the code or doc. 7.
     **Next session** — only when the handoff hook flagged a large context: a paste-ready prompt in a code block
     (goal, steps left, decisions made here and not in the repo, files to read first, open items), nothing the
     repo or git log already holds.
