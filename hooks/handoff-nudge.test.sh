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
  OUT="$(jq -n --arg t "$T" --arg e "$1" '{transcript_path: $t, session_id: "s1", hook_event_name: $e, cwd: "x"}' |
    env -i PATH="$PATH" HOME="$HOME" CLAUDE_PROJECT_DIR="$REPO" "$HOOK" 2>&1)"
}

ctx 90000
run PostToolUse
check "below the limit: no note" "$(t test -z "$OUT")" "$OUT"
ctx 160000
run PostToolUse
check "coordinator past the limit: PostToolUse note says launch no new batch" \
  "$(t jq -e '.hookSpecificOutput.hookEventName == "PostToolUse" and (.hookSpecificOutput.additionalContext | test("Launch no new commit batch"))' <<<"$OUT")" "$OUT"
run PostToolUse
check "same step: no repeat" "$(t test -z "$OUT")" "$OUT"
ctx 215000
run UserPromptSubmit
check "50k further, on a prompt: the finish-the-task note under UserPromptSubmit" \
  "$(t jq -e '.hookSpecificOutput.hookEventName == "UserPromptSubmit" and (.hookSpecificOutput.additionalContext | test("Do not stop"))' <<<"$OUT")" "$OUT"
ctx 300000
run Stop
check "another event: nothing" "$(t test -z "$OUT")" "$OUT"

echo "$pass passed, $fail failed"
((fail == 0))
