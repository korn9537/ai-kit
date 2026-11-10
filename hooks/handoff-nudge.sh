#!/usr/bin/env bash
# UserPromptSubmit: once the main session's context passes handoff.max_context tokens (ai/kit/config.json), add a
# note asking for a "Next session" prompt after the task. Never stops a plan; never blocks;
# repeats only every further 50k.
# PostToolUse on Bash|Read|Grep|Glob: every handoff.max_reads reads or searches since the last prompt, past
# handoff.reads_from tokens, a note to send the search to a subagent (CLAUDE.core.md, heavy reads). max_reads 0: off.
# A Read with no range or a plain cat of a code file of handoff.big_read lines or more: a note to read a range, once
# per prompt in the main session and once per subagent. big_read 0: off.
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

# a read or search: Read, Grep, Glob, or a Bash line starting as one (after a cd or env settings); other Bash ends here
reading=""
case "$(jq -r '.tool_name // empty' <<<"$input")" in
  Bash | Read | Grep | Glob)
    jq -e '.tool_name != "Bash" or ((.tool_input.command // "")
      | sub("^\\s*cd\\s+(\"[^\"]*\"|\u0027[^\u0027]*\u0027|\\S+)\\s*(&&|;)\\s*"; "") | sub("^\\s*(\\w+=\\S*\\s+)+"; "")
      | gsub("\\s2>\\s*\\S+"; "")
      | test("^\\s*(grep|rg|find|awk|nl|ls|wc|head|tail|sed\\s+-[A-Za-z]*n[A-Za-z]*|cat\\s+[^<>]*$"
          + "|git\\s+(grep|show|log|diff|blame))(\\s|$)"))' \
      <<<"$input" >/dev/null 2>&1 || exit 0
    reading=1 ;;
esac
# a subagent's own Agent or SendMessage call is no coordinator's; its reads reach only the whole-file note
agent=""
[[ "$event" == UserPromptSubmit ]] || agent="$(jq -r '.agent_id // empty' <<<"$input")"
[[ -z "$agent" || -n "$reading" ]] || exit 0

project="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' <<<"$input")}"
[[ -n "$project" ]] && project="$(kit_project_root "$project")"
rdir="$(kit_state_dir review "$project")" || exit 0
reads="$rdir/$session.reads"
[[ "$event" == UserPromptSubmit ]] && rm -rf "$reads" "$reads".*

# context = what the last main-session reply read: fresh input + cache reads + cache writes; the tail is enough
context_used() {
  tail -n 2000 "$transcript" | jq -R 'fromjson? // empty | select(.type == "assistant" and .isSidechain != true)
  | .message.usage // empty | (.input_tokens // 0) + (.cache_read_input_tokens // 0) + (.cache_creation_input_tokens // 0)
  | select(. > 0)' 2>/dev/null | tail -n 1
}

if [[ -n "$reading" ]]; then
  mkdir -p "$rdir"
  # one byte per read: an append stays whole when parallel reads run this hook at once
  [[ -n "$agent" ]] || printf . >>"$reads"

  # the file taken whole, against the tool's cwd (it follows a cd); docs under ai/ are read whole on purpose
  whole="$(jq -r 'if .tool_name == "Read" and .tool_input.offset == null and .tool_input.limit == null
      then .tool_input.file_path // empty
    elif .tool_name == "Bash"
      then (.tool_input.command // ""
        | capture("^\\s*cat\\s+[\"\u0027]?(?<f>[^\\s<>|;&\"\u0027]+)[\"\u0027]?\\s*$")? | .f) // empty
    else empty end' <<<"$input" 2>/dev/null || true)"
  big="$(kit_conf '.handoff.big_read' 300)"
  if [[ -n "$whole" ]] && ((big > 0)); then
    whole="$(kit_path "$whole")"
    cwd="$(kit_path "$(jq -r '.cwd // empty' <<<"$input")")"
    [[ -d "$cwd" ]] || cwd="$project"
    [[ "$whole" == /* || "$whole" =~ ^[A-Za-z]:/ ]] || whole="$cwd/$whole"
    case "$whole" in
      "$project/ai/"*) ;;
      *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.cs | *.go | *.dart | *.py | *.rb | *.java | *.kt | *.swift | \
        *.rs | *.php | *.vue | *.svelte | *.c | *.cc | *.cpp | *.h | *.sql | *.sh)
        if [[ -f "$whole" ]] && (($(wc -l <"$whole") >= big)) && mkdir "$reads.big$agent" 2>/dev/null; then
          note="${whole##*/} is $(($(wc -l <"$whole"))) lines, read whole. Next time find the symbol with grep -n and read only its line range: all of it stays in every later call."
          jq -n --arg n "$note" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $n}}'
          exit 0
        fi ;;
    esac
  fi

  [[ -z "$agent" ]] || exit 0
  limit="$(kit_conf '.handoff.max_reads' 4)"
  ((limit > 0)) || exit 0
  count=$(($(wc -c <"$reads")))
  # a step is claimed, not tested by modulo: parallel hooks may all see one total, or skip a multiple
  step=$((count / limit))
  ((step > 0)) || exit 0
  mkdir "$reads.$step" 2>/dev/null || exit 0
  used="$(context_used)"
  [[ -n "$used" ]] && ((used >= $(kit_conf '.handoff.reads_from' 0))) || exit 0
  note="$count reads or searches since the last prompt in the main session at about $((used / 1000))k tokens of context; each result is paid again on every later call. Send the rest of this search to a subagent (Explore or general-purpose, with model \"sonnet\") that returns a file:line list, or put what is left to find in a committer's brief (CLAUDE.core.md, heavy reads). The one grep the next edit needs stays here."
  jq -n --arg n "$note" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $n}}'
  exit 0
fi

# a coordinator is never stopped by context: only a prompt gets the note
[[ "$event" == UserPromptSubmit ]] || exit 0
max="$(kit_conf '.handoff.max_context' 150000)"
used="$(context_used)"
[[ -n "$used" ]] || exit 0

mark="$rdir/$session.handoff"
# below the limit (again, after /compact): forget earlier nudges so the next crossing nudges
((used >= max)) || { rm -f "$mark"; exit 0; }
step=$(((used - max) / 50000))
[[ -f "$mark" && "$(cat "$mark")" -ge "$step" ]] && exit 0
mkdir -p "$rdir"
printf '%s\n' "$step" >"$mark"

note="This session's context is about $((used / 1000))k tokens. Do not stop or shorten work for it: finish the current task or plan. When it is done, end the final report with the \"Next session\" item (CLAUDE.core.md) so the user can continue in a fresh session: a paste-ready prompt in a code block holding the goal, the job id (docs/shared-checkout.md §Jobs), the steps left, decisions made here and not in the repo, files to read first and open items; nothing the repo or git log already holds."
jq -n --arg n "$note" --arg e "$event" '{hookSpecificOutput: {hookEventName: $e, additionalContext: $n}}'
