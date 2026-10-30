#!/usr/bin/env bash
# Tests for ask-guard.sh and decider-log.sh: a throwaway repo and session transcript dir; each case checks that an
# AskUserQuestion is blocked (exit 2) or let through (exit 0) given the decider subagents the session holds.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
GUARD="$PWD/ask-guard.sh"
LOG="$PWD/decider-log.sh"
TMP="$(mktemp -d)" || exit 1
trap 'rm -rf "$TMP"' EXIT
TMP="$(cd "$TMP" && pwd -P)" || exit 1
REPO="$TMP/repo"
SUBS="$TMP/proj/s1/subagents"
pass=0
fail=0

mkdir -p "$REPO/ai/kit" "$SUBS"
git -C "$REPO" init -q

# agent <id> <verdict or ""> [touch time]: a decider subagent transcript ending in that verdict
agent() {
  echo '{"agentType":"ai-kit:decider"}' >"$SUBS/agent-$1.meta.json"
  if [[ -n "$2" ]]; then
    jq -cn --arg v "$2" '{type: "assistant", timestamp: "2026-10-27T03:04:05Z",
      message: {stop_reason: "end_turn", content: [{type: "text", text: ("Verdict: " + $v + "\nQuestion: q\nChoice: c\nConfidence: high")}]}}'
  else
    echo '{"type":"user","message":{"content":"brief"}}'
  fi >"$SUBS/agent-$1.jsonl"
  [[ -z "${3:-}" ]] || touch -t "$3" "$SUBS/agent-$1.jsonl"
}
hook_input() {
  jq -cn --arg t "$TMP/proj/s1.jsonl" --arg q "${1:-Which order?}" \
    '{tool_name: "AskUserQuestion", session_id: "s1", transcript_path: $t, tool_input: {questions: [{question: $q, header: "Order"}]}}'
}
# run_case <desc> <want exit> [question]
run_case() {
  local rc
  hook_input "${3:-}" | env -i PATH="$PATH" HOME="$HOME" CLAUDE_PROJECT_DIR="$REPO" "$GUARD" >/dev/null 2>"$TMP/err"
  rc=$?
  if [[ "$rc" == "$2" ]]; then
    echo "ok   - $1"
    pass=$((pass + 1))
  else
    echo "FAIL - $1 (want exit $2, got $rc)"
    cat "$TMP/err"
    fail=$((fail + 1))
  fi
}
says() {
  if grep -q "$2" "$TMP/err"; then
    echo "ok   - $1"
    pass=$((pass + 1))
  else
    echo "FAIL - $1 (no '$2' in the message)"
    fail=$((fail + 1))
  fi
}

run_case "block: no decider call yet" 2
says "the block names the decider" "ai-kit:decider"
agent a1 DECIDED 202001010000
run_case "block: only a decider call older than 30 minutes" 2
agent a2 DECIDED
run_case "block: the decider decided it" 2
says "the block says to act on the Choice" "Act on its Choice"
agent a3 ""
run_case "block: the newest decider has no verdict yet" 2
says "the block says to wait" "wait for its result"
agent a3 OWNER
run_case "pass: the decider returned OWNER" 0
run_case "block: one OWNER call serves one ask" 2
hook_input | jq -c '.transcript_path = "'"$SUBS"'/agent-a3.jsonl"' |
  env -i PATH="$PATH" HOME="$HOME" CLAUDE_PROJECT_DIR="$REPO" "$LOG" >/dev/null 2>&1
if [[ "$(ls "$REPO"/ai/usage/decisions/2026-10/ 2>/dev/null | tr '\n' ' ')" == "s1.a1.jsonl s1.a2.jsonl s1.a3.jsonl " ]]; then
  echo "ok   - decider-log logged each decider call"
  pass=$((pass + 1))
else
  echo "FAIL - decider-log logged: $(ls "$REPO"/ai/usage/decisions/2026-10/ 2>&1)"
  fail=$((fail + 1))
fi

echo '{"decider": {"always_owner": "bundle id|privacy"}}' >"$REPO/ai/kit/config.json"
run_case "pass: a question matching decider.always_owner" 0 "What bundle ID should the app use?"
run_case "block: a question not matching decider.always_owner" 2
echo '{"decider": {"always_owner": "("}}' >"$REPO/ai/kit/config.json"
run_case "pass: an invalid decider.always_owner" 0
echo '{"decider": {"enabled": false}}' >"$REPO/ai/kit/config.json"
run_case "pass: decider.enabled false" 0
rm "$REPO/ai/kit/config.json"
rm -rf "$REPO/.git"
agent a4 OWNER
run_case "pass: OWNER outside a git repo" 0
run_case "pass: OWNER outside a git repo is never used up (no place to keep it)" 0
rm -rf "$REPO/ai/kit"
run_case "pass: a project without ai/kit" 0

echo "$pass passed, $fail failed"
((fail == 0))
