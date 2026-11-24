---
name: summarize
description: "ai-kit summary before a UI, DB or business-rule change: when the business-analyst runs, the six summary items, when to wait for the user's go, where a kept choice is recorded, which small jobs skip it. Load before the first edit of such a change, and when the user asks for BA or how a business rule or data behaves today."
when_to_use: "Business rule = stage, SLA, permission, scope, calculation, or anything a user sees behave differently. Also when the user asks how something would work or be built, or answers a summary with a question, objection or correction."
user-invocable: false
---

The summary rule of the ai-kit working conventions (`${CLAUDE_PLUGIN_ROOT}/CLAUDE.core.md` keeps a pointer to it).

- **Summarize before a UI, DB or business-rule change** (also run BA when the user asks for it). Business rule =
  stage, SLA, permission, scope, calculation, or anything a user sees behave differently. For a DB or business-rule
  change, first run the read-only `ai-kit:business-analyst` agent and build the summary from its report. A request to
  check, verify or explain how a business rule or data behaves today runs the BA too, change or not: its answer
  decides the change that follows. A UI-only change (layout, copy, style: no change in what a user can do or what is
  decided for them, no rule or data) is summarized by the main session without it: 1. Problem · 2.
  Recommendation (one, with rejected alternatives and why) · 3. How (files/endpoints) · 4. Affects (screens, data,
  other modules) · 5. Standard it sets or follows · 6. Done when (checks a reviewer can confirm; the BA's section, if
  run). Touches an owner decision → show the summary and wait for a go.
  The design is still under discussion (the request asks how something would work or be built, not to change it;
  the user answered the last summary with a question, objection or correction to the design; or the design changed
  since they saw it) → show the summary or design, end the turn, and edit no code and launch no committer until
  the user says to build; that go is not put to the decider, and a debugging or UI tweak iterated with the user
  watching is not held by it. Otherwise show it and go on with the recommendation; BA assumptions go to Decided. A
  choice whose reasons must be kept → `ai/decisions.md` (or the decisions source `ai/kit/analysis-sources.md` names)
  with the default status, same commit. Small jobs (typo, copy, one style value on one screen, move-only refactor,
  docs) skip both, except that a BA request by the user is always run; unsure → summarize.
