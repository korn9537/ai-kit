---
description: Compare kit versions on the usage server, find the largest token driver in the newest ones and the one change that would cut it
---

Analyse token usage from the server's views and the digest, never from raw rows. The unit of comparison is the kit
version: the goal is to see which kit version cost more or less and why, not to account for one repo.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/usage.mjs" views v_kit_compare`. It lists the kit versions the server
   holds (the newest 10, at most a year back), every project together; add `--project` for this repo only, `--since
   YYYY-MM-DD` to start later. It prints nothing or fails → the server is unreachable or empty: say so under Open;
   `usage.mjs digest --baseline` still gives this machine's transcripts.
2. For the newest versions, find where the cost goes: `views v_kit_roles --kit <version>` (cost per role),
   `views v_tool_stats --kit <version>` (tools), `views v_hook_stats --kit <version>` (hook firings),
   `views v_repeat_reads --kit <version>` (files read again and again); `--kit` takes a version or a prefix with a
   trailing dot such as `2.49.`. Then `usage.mjs digest [--since YYYY-MM-DD] [--project]` for the fixed-size summary:
   cost per model, role and kit version, peak context, cost per commit, reviewer findings, outliers, refusals. Read
   only these outputs: never fetch or read raw rows or `ai/usage/` files.
3. Name the largest driver: the role with the biggest cost share in the newest versions, and what moved it against
   the older ones. Give its evidence: model, calls, peak context, tool mix, the agents behind it (outliers, costliest
   rounds); unpriced models apart.
4. Give the one change that would cut it, with the figure it should move (calls, peak, share). One change, not a
   list.
5. Where the change goes:
   - Holds in any repo (passes the cross-repo test) → a kit proposal per `${CLAUDE_PLUGIN_ROOT}/docs/kit-proposals.md`.
     Harvest lands it; the next comparison shows it by kit version.
   - This repo only → a line in `ai/kit/review-checklist.md`, or the project's settings (`usage.*`, `handoff.*`,
     `review.*` in `ai/kit/config.json`, `.claude/settings.json`).
6. To measure a kit change, run `usage.mjs digest --compare <old> <new>` (versions or prefixes such as `2.45`): both
   columns and the change in % per metric, refusals per commit included. Name cost per commit from the digest's
   `by commits per round` section and each kit row's `commit rounds cost/commit`, never from `all cost / commits`;
   `no-commit rounds` says how much cost that is. Say which version helped and which raised cost or lowered findings.
7. Before judging that a hook or rule can go, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/usage.mjs" views v_hook_stats`
   and `usage.mjs hooks [--since YYYY-MM-DD]` (this machine's transcripts): how often each hook fired (an older kit's
   changed hook text is undercounted).
8. End with the working-conventions report: files written under Files, the proposal or setting chosen under Decided,
   what the views could not show under Open.
