---
name: delegate
description: "ai-kit delegation rules: which subagent takes a search, a browser check or a code change, with which model and effort, and how several items become a plan run by committers or the run-plan workflow. Load before launching any subagent, before a code edit past review.skip_lines lines or with a new file, before planning several items, and before writing or restyling a doc under ai/."
when_to_use: "Also when the user asks to plan now and build later (วางแผนไว้ก่อน, prepare it, don't build yet), to work through the planned jobs (ไล่ทำที่วางไว้), or to run them with nobody watching (ทำไปเลยไม่ต้องรอ)."
user-invocable: false
---

The delegation half of the ai-kit rules (`${CLAUDE_PLUGIN_ROOT}/CLAUDE.core.md` keeps the rest and the final report).

- **Agent model:** `ai-kit:business-analyst`, `ai-kit:change-reviewer` and `ai-kit:decider` run on opus at medium
  effort, `ai-kit:committer`, `ai-kit:doc-writer` and `ai-kit:explorer` on sonnet at medium effort, from their
  frontmatter; the Agent call passes neither, except a committer's batch size: `light` sonnet low, `heavy` opus high
  (`${CLAUDE_PLUGIN_ROOT}/docs/plan-batching.md` §Coordinator pipeline). A general-purpose fallback for a kit agent
  (type not loaded) passes that agent's frontmatter model and effort (opus medium for reviewer, BA, decider; sonnet
  medium for committer at size normal); an explorer not loaded, and every other general-purpose or Explore subagent,
  gets `model: "sonnet"`.
- **Heavy reads go to a subagent** (hook-nudged), plan or not: a browser check (screenshots, page reads, clicking
  through a flow) or a search likely to need more than about three reads or greps. Finding what a summary, plan or
  brief needs (where the code is, what it does today, which files a change touches) is such a search: one
  `ai-kit:explorer` subagent per question (sonnet, read-only; Explore with `model: "sonnet"` when the type is not
  loaded), sent together when independent, returns the `path:start-end` ranges and facts the brief carries; the main
  session coordinates, it does not explore. For a DB or business-rule change, or a check of how one
  works today, the BA is that subagent. A brief asking how something works asks for the path traced from the entry
  point (route, handler, screen) to the line that decides it, each step as `file:line`: a matching line says where
  code is, not that the flow reaches it. The main session checks that the report gives every step, not only the
  line; a missing step goes back to that agent, and the ranges a report cites are not read again. Reads
  while debugging with the user watching each step stay in the main session. The brief names what to
  check or find and what comes back: pass or fail with the evidence, or a `file:line` list. The main session reads
  that report, never the pages, screenshots or raw output; every later call re-reads them. One screenshot or one
  `grep -n` the next edit needs stays. A code search is an `ai-kit:explorer`; a browser check or another heavy read
  is a general-purpose subagent with `model: "sonnet"` (hook-guarded; a kit-agent fallback follows the Agent model
  bullet); another typed agent (web-fetch) keeps its own model. It returns evidence; the main session judges.
- **Code past the small-change limit goes to a commit subagent**, one item or several. Once the summary (or BA) is
  done and no go is pending (`ai-kit:summarize`), or the files are named for a change that needs neither, the change
  goes out as `ai-kit:committer` batches per `${CLAUDE_PLUGIN_ROOT}/docs/plan-batching.md` §Coordinator pipeline, each
  brief carrying the `path:start-end` and decisions already found and the summary's Done when checks for that batch.
  The main session edits code itself only for: at most `review.skip_lines` code lines with no new file and no
  `review.always` path; a small job (the list in `ai-kit:summarize`); debugging or a UI tweak iterated with the user
  watching each step (settled and over the limit → one committer); the large-refactor exception of §Coordinator
  pipeline. Review fixes follow §Coordinator pipeline.
- **Docs under `ai/` go to `ai-kit:doc-writer`**: a new file, a restyle of one still in human form
  (`${CLAUDE_PLUGIN_ROOT}/docs/ai-docs.md`), an edit past a few lines. The brief names the file(s), write or restyle,
  and the source (human doc, code paths, the decisions of this turn); never the format, which the agent holds. One
  file per agent, sent together when independent; the main session reads its report, `git diff --stat`, and commits
  (a restyle its own commit). A one-line fact (a decision's status, a table row) the main session writes itself.
- **Several items** (fixes, features, review findings, upgrades): plan them before the first edit per
  `${CLAUDE_PLUGIN_ROOT}/docs/plan-batching.md`.
- **A multi-commit plan picks its runner itself**, one `ai-kit:committer` per batch; read
  `${CLAUDE_PLUGIN_ROOT}/docs/plan-batching.md` §Coordinator pipeline before the first batch. Two batches or more →
  the run-plan workflow per `${CLAUDE_PLUGIN_ROOT}/commands/run-plan.md` (the owner's standing opt-in to it); one, or
  the Workflow call refused → the main session as coordinator.
- **Plain words pick the run-plan mode**, in any language: plan now, run later (`วางแผนไว้ก่อน`, "prepare it, don't
  build yet") → `${CLAUDE_PLUGIN_ROOT}/commands/run-plan.md` with `plan`; work through the planned jobs
  (`ไล่ทำที่วางไว้`) → its `queue`; the same with nobody watching (`ทำไปเลยไม่ต้องรอ`) →
  `${CLAUDE_PLUGIN_ROOT}/commands/continuous.md` with `queue`.
