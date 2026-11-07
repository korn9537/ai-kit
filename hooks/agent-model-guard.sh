#!/usr/bin/env bash
# PreToolUse guard (Agent|Task): a general-purpose subagent (subagent_type general-purpose, claude or missing) or an
# Explore without a model inherits the main session's model (opus), so the launch is blocked until it passes model
# "sonnet". Other typed agents (ai-kit:*, Plan, ...) and fork pass: they have their own model or inherit by design.
set -euo pipefail
command -v jq >/dev/null 2>&1 || exit 0
. "$(dirname "$0")/lib.sh"
kit_enabled || exit 0
input="$(cat)"
tool="$(jq -r '.tool_name // empty' <<<"$input" 2>/dev/null || true)"
[[ "$tool" == Agent || "$tool" == Task ]] || exit 0
jq -e '.tool_input | (.subagent_type // "") as $t | ((.model // "") | tostring) as $m
  | ($t == "" or $t == "general-purpose" or $t == "claude" or $t == "Explore") and $m == ""' <<<"$input" >/dev/null 2>&1 || exit 0

cat >&2 <<'EOT'
Blocked: a general-purpose or Explore subagent without a model inherits the main session's model (opus). Launch it again with
model "sonnet" (CLAUDE.core.md, Agent model). A fallback for a kit agent passes that agent's frontmatter model and
effort: for ai-kit:change-reviewer, business-analyst or decider model "opus", effort "medium"; for ai-kit:committer
model "sonnet", effort "medium"; any other general-purpose or Explore subagent model "sonnet".
EOT
exit 2
