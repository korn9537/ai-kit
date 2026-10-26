#!/usr/bin/env bash
# UserPromptSubmit, and PostToolUse on Agent|Task|SendMessage (a coordinator gets no new prompt between batches): once
# the main session's context passes handoff.max_context tokens (ai/kit/config.json), add a note asking for a "Next
# session" prompt; a coordinator launches no new batch. Never blocks; repeats only every further 50k.
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0
. "$(dirname "$0")/lib.sh"
kit_enabled || exit 0
input="$(cat)"
transcript="$(jq -r '.transcript_path // empty' <<<"$input")"
session="$(jq -r '.session_id // empty' <<<"$input")"
[[ -n "$transcript" && -f "$transcript" && -n "$session" ]] || exit 0
event="$(jq -r '.hook_event_name // "UserPromptSubmit"' <<<"$input")"
[[ "$event" == UserPromptSubmit || "$event" == PostToolUse ]] || exit 0
# a subagent's own Agent or SendMessage call is no coordinator's
[[ "$event" == UserPromptSubmit || -z "$(jq -r '.agent_id // empty' <<<"$input")" ]] || exit 0

max="$(kit_conf '.handoff.max_context' 150000)"
# context = what the last main-session reply read: fresh input + cache reads + cache writes; the tail is enough
used="$(tail -n 2000 "$transcript" | jq -R 'fromjson? // empty | select(.type == "assistant" and .isSidechain != true)
  | .message.usage // empty | (.input_tokens // 0) + (.cache_read_input_tokens // 0) + (.cache_creation_input_tokens // 0)
  | select(. > 0)' 2>/dev/null | tail -n 1)"
[[ -n "$used" ]] || exit 0

project="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' <<<"$input")}"
[[ -n "$project" ]] && project="$(kit_project_root "$project")"
gitdir="$(git -C "$project" rev-parse --absolute-git-dir 2>/dev/null)" || exit 0
# one mark per event: a prompt's note must not silence the coordinator's
mark="$gitdir/claude-review/$session.handoff"
[[ "$event" == PostToolUse ]] && mark+=".coord"
# below the limit (again, after /compact): forget earlier nudges so the next crossing nudges
((used >= max)) || { rm -f "$mark"; exit 0; }
step=$(((used - max) / 50000))
[[ -f "$mark" && "$(cat "$mark")" -ge "$step" ]] && exit 0
mkdir -p "$gitdir/claude-review"
printf '%s\n' "$step" >"$mark"

note="This session's context is about $((used / 1000))k tokens. Do not stop or shorten work for it: finish the current task or plan. When it is done, end the final report with the \"Next session\" item (CLAUDE.core.md) so the user can continue in a fresh session: a paste-ready prompt in a code block holding the goal, the steps left, decisions made here and not in the repo, files to read first and open items; nothing the repo or git log already holds."
# a coordinator re-reads its whole context on each batch's notification: past the limit the plan goes on in a fresh one
[[ "$event" == PostToolUse ]] && note="This coordinator's context is about $((used / 1000))k tokens (handoff.max_context $((max / 1000))k), and every further batch re-reads it on each notification. Launch no new commit batch (a running batch's review, fix and re-check still go ahead): let the running subagents and their reviews finish, then end with the final report and its \"Next session\" item (CLAUDE.core.md): a paste-ready prompt in a code block holding the goal, the batches left in order with their briefs' essentials, decisions made here and not in the repo, files to read first and open items, so the plan continues in a fresh session."
jq -n --arg n "$note" --arg e "$event" '{hookSpecificOutput: {hookEventName: $e, additionalContext: $n}}'
