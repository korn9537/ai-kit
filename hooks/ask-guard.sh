#!/usr/bin/env bash
# PreToolUse (AskUserQuestion): a question reaches the owner only after an ai-kit:decider call of this session
# returned OWNER within the last 30 minutes; one such call serves one ask (scripts/decider.mjs guard reads the
# decider's subagent transcript; decider-log.sh logs it). Otherwise the ask is blocked and the main session runs the
# decider. Gap: the verdict is matched per decider call, not per question. Off with config decider.enabled false; a
# question matching decider.always_owner (jq regex, case-insensitive) goes through, as does one when the pattern is
# invalid, node is missing or the guard errs.
set -euo pipefail
command -v jq >/dev/null 2>&1 || exit 0
command -v node >/dev/null 2>&1 || exit 0
. "$(dirname "$0")/lib.sh"
input="$(cat)"
kit_root="$(kit_project_root "${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' <<<"$input")}")"
kit_config="$kit_root/ai/kit/config.json"
kit_enabled || exit 0
[[ "$(jq -r '.tool_name // empty' <<<"$input" 2>/dev/null || true)" == AskUserQuestion ]] || exit 0
# kit_conf reads false as empty, so test the stringified value
[[ "$(kit_conf '.decider.enabled | tostring' true)" == false ]] && exit 0

always="$(kit_conf '.decider.always_owner' '')"
if [[ -n "$always" ]]; then
  rc=0
  jq -e --arg re "$always" '[.tool_input.questions[]? | .question // "", .header // ""] | join("\n") | test($re; "i")' \
    <<<"$input" >/dev/null 2>&1 || rc=$?
  ((rc == 1)) || exit 0
fi

state="$(printf '%s' "$input" | CLAUDE_PROJECT_DIR="$kit_root" node "$kit_plugin/scripts/decider.mjs" guard 2>/dev/null || true)"
case "$state" in
  decided)
    cat >&2 <<'MSG'
Blocked: the last ai-kit:decider call decided this (DECIDED), so it does not go to the owner. Act on its Choice and
list it under Decided in the final report. A different question, or facts the decider did not have: launch
ai-kit:decider again with them.
MSG
    ;;
  pending)
    cat >&2 <<'MSG'
Blocked: the last ai-kit:decider call has no Verdict lines yet. Still running → wait for its result. Finished
without them → launch it again and say its reply must be the Verdict blocks of its format.
MSG
    ;;
  none)
    cat >&2 <<'MSG'
Blocked: the agent decides; the owner holds only the four owner kinds (CLAUDE.core.md Working conventions). Launch
the ai-kit:decider agent first (subagent_type "ai-kit:decider"; model opus, effort high when the question touches a
DB schema, a calculation, a permission or a final decision) with each question, its options, the user's request in
their words and what you already know. Agent type not loaded (plugin enabled mid-session): general-purpose,
description containing "decider", told to follow the plugin's agents/decider.md. DECIDED: act on its Choice without
asking and list it under Decided. OWNER: ask again with its recommended option first, labelled "(Recommended)", and
its Reason in that option's description.
The project turns this off with "decider": {"enabled": false} in ai/kit/config.json.
MSG
    ;;
  *) exit 0 ;;
esac
exit 2
