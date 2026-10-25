---
description: Find the largest token driver in this project's usage records and the one change that would cut it
---

Analyse token usage from the digest, never from the records.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/usage.mjs" digest` from the project root; add `--baseline` when `ai/usage/`
   holds no `.jsonl` (the digest then comes from this machine's transcripts and says so). `--since YYYY-MM-DD`
   limits it. Read only its output: never open, grep or cat `ai/usage/` files, they hold prompts and grow without
   bound.
2. Name the largest driver: the role or agent with the biggest cost share. Give its evidence from the digest: role,
   model, calls, peak context, tool mix, cost per agent; unpriced models apart.
3. Give the one change that would cut it, with the figure it should move (calls, peak, share). One change, not a
   list.
4. Where the change goes:
   - Holds in any repo (passes the cross-repo test) → a kit proposal per `${CLAUDE_PLUGIN_ROOT}/docs/kit-proposals.md`.
     Harvest lands it; the next digest compares by kit version.
   - This repo only → a line in `ai/kit/review-checklist.md`, or the project's settings (`usage.*`, `handoff.*`,
     `review.*` in `ai/kit/config.json`, `.claude/settings.json`).
5. The digest's by-kit section has more than one row → compare the versions: did cost per commit, peak or
   reviewer findings per review move the way the change meant? Say which version helped, which raised cost or
   lowered findings.
6. End with the working-conventions report: files written under Files, the proposal or setting chosen under Decided,
   what the digest could not show under Open.
