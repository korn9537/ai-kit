#!/usr/bin/env bash
# Tests for handoff-nudge.sh: a transcript whose last main reply read a given context; checks the note, its event
# name and that it repeats only every further 50k.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
HOOK="$PWD/handoff-nudge.sh"
TMP="$(mktemp -d)" || exit 1
trap 'rm -rf "$TMP"' EXIT
REPO="$(cd "$TMP" && pwd -P)" || exit 1
git -C "$REPO" init -q
mkdir -p "$REPO/ai/kit"
pass=0
fail=0
check() {
  if [[ "$2" == 0 ]]; then
    echo "ok   - $1"
    pass=$((pass + 1))
  else
    echo "FAIL - $1"
    [[ -z "${3:-}" ]] || echo "       $3"
    fail=$((fail + 1))
  fi
}
t() { if "$@" >/dev/null 2>&1; then echo 0; else echo 1; fi; }
T="$REPO/.git/t.jsonl"
# ctx <tokens>: the last main reply read that much context
ctx() { jq -cn --argjson n "$1" '{type: "assistant", message: {usage: {input_tokens: 0, cache_read_input_tokens: $n, cache_creation_input_tokens: 0}}}' >>"$T"; }
# run <event> → stdout in $OUT
run() {
  OUT="$(jq -n --arg t "$T" --arg e "$1" --arg a "${2:-}" '{transcript_path: $t, session_id: "s1", hook_event_name: $e,
    cwd: "x"} + (if $a == "" then {} else {agent_id: $a} end)' |
    env -i PATH="$PATH" HOME="$HOME" CLAUDE_PROJECT_DIR="$REPO" "$HOOK" 2>&1)"
}

ctx 90000
run PostToolUse
check "below the limit: no note" "$(t test -z "$OUT")" "$OUT"
ctx 160000
run PostToolUse sub1
check "a subagent's own Agent call: nothing" "$(t test -z "$OUT")" "$OUT"
run UserPromptSubmit
check "a prompt past the limit: the finish-the-task note" "$(t jq -e '.hookSpecificOutput.additionalContext | test("Do not stop")' <<<"$OUT")" "$OUT"
run PostToolUse
check "coordinator past the limit: PostToolUse note says launch no new batch" \
  "$(t jq -e '.hookSpecificOutput.hookEventName == "PostToolUse" and (.hookSpecificOutput.additionalContext | test("Launch no new commit batch"))' <<<"$OUT")" "$OUT"
run PostToolUse
check "same step: no repeat" "$(t test -z "$OUT")" "$OUT"
ctx 215000
run UserPromptSubmit
check "50k further, on a prompt: the note again under UserPromptSubmit" \
  "$(t jq -e '.hookSpecificOutput.hookEventName == "UserPromptSubmit" and (.hookSpecificOutput.additionalContext | test("Do not stop"))' <<<"$OUT")" "$OUT"
ctx 300000
run Stop
check "another event: nothing" "$(t test -z "$OUT")" "$OUT"

# read <tool> [command] → one PostToolUse of that tool, stdout in $OUT
read_tool() {
  OUT="$(jq -n --arg t "$T" --arg n "$1" --arg c "${2:-}" --arg a "${3:-}" '{transcript_path: $t, session_id: "s2",
    hook_event_name: "PostToolUse", tool_name: $n, tool_input: {command: $c}, cwd: "x"}
    + (if $a == "" then {} else {agent_id: $a} end)' |
    env -i PATH="$PATH" HOME="$HOME" CLAUDE_PROJECT_DIR="$REPO" "$HOOK" 2>&1)"
}
prompt2() {
  jq -n --arg t "$T" '{transcript_path: $t, session_id: "s2", hook_event_name: "UserPromptSubmit", cwd: "x"}' |
    env -i PATH="$PATH" HOME="$HOME" CLAUDE_PROJECT_DIR="$REPO" "$HOOK" >/dev/null 2>&1
}
COUNT="$REPO/.git/claude-review/s2.reads"
counted() { [[ "$(cat "$COUNT" 2>/dev/null)" == "$1" ]]; }

ctx 120000
for i in 1 2 3 4; do read_tool Bash "grep -n x src/a.ts"; done
check "four reads: no note yet" "$(t test -z "$OUT")" "$OUT"
read_tool Read
check "the fifth read past reads_from: the subagent note" \
  "$(t jq -e '.hookSpecificOutput.hookEventName == "PostToolUse" and (.hookSpecificOutput.additionalContext | test("Send the rest of this search"))' <<<"$OUT")" "$OUT"
read_tool Grep
check "the sixth: no repeat until the next five" "$(t test -z "$OUT")" "$OUT"
for cmd in "git status" "cat > a.txt" "sed -i s/a/b/ f" "pnpm test" "cat <<X"; do read_tool Bash "$cmd"; done
check "a Bash line that is no read is not counted" "$(t counted 6)" "$(cat "$COUNT")"
read_tool Bash "cd src && sed -n '1,9p' a.ts"
check "a read after a cd is counted" "$(t counted 7)" "$(cat "$COUNT")"
read_tool Read "" sub1
check "a subagent's read is not counted" "$(t counted 7)" "$(cat "$COUNT")"
prompt2
check "a new prompt starts the count again" "$(t test ! -f "$COUNT")"
ctx 60000
for i in 1 2 3 4 5; do read_tool Read; done
check "below reads_from: counted, no note" "$(t test -z "$OUT")" "$OUT"
prompt2
ctx 120000
echo '{"handoff": {"max_reads": 0}}' >"$REPO/ai/kit/config.json"
for i in 1 2 3 4 5; do read_tool Read; done
check "max_reads 0: off" "$(t test -z "$OUT")" "$OUT"
rm -f "$REPO/ai/kit/config.json"

echo "$pass passed, $fail failed"
((fail == 0))
