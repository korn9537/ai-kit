#!/usr/bin/env bash
# Tests for ask-guard.sh and kit-log.sh subagent-stop: a throwaway repo and session transcript dir; each case checks
# that an AskUserQuestion is blocked (exit 2) or let through (exit 0) given the decider subagents the session holds.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
GUARD="$PWD/ask-guard.sh"
LOG="$PWD/kit-log.sh"
TMP="$(mktemp -d)" || exit 1
trap 'rm -rf "$TMP"' EXIT
TMP="$(cd "$TMP" && pwd -P)" || exit 1
REPO="$TMP/repo"
SUBS="$TMP/proj/s1/subagents"
pass=0
fail=0

mkdir -p "$REPO/ai/kit" "$SUBS"
git -C "$REPO" init -q

# agent <id> <verdict or ""> [touch time]: a decider subagent transcript ending in that verdict, on the question in
# $Q (default "Which order?")
agent() {
  echo '{"agentType":"ai-kit:decider"}' >"$SUBS/agent-$1.meta.json"
  if [[ -n "$2" ]]; then
    jq -cn --arg v "$2" '{type: "assistant", timestamp: "2026-10-27T03:04:05Z",
      message: {stop_reason: "end_turn", content: [{type: "text", text: ("Verdict: " + $v + "\nQuestion: " + $q + "\nChoice: pick-x\nConfidence: high")}]}}' --arg q "${Q:-Which order?}"
  else
    echo '{"type":"user","message":{"content":"brief"}}'
  fi >"$SUBS/agent-$1.jsonl"
  [[ -z "${3:-}" ]] || touch -t "$3" "$SUBS/agent-$1.jsonl"
}
hook_input() {
  jq -cn --arg t "$TMP/proj/s1.jsonl" --arg q "${1:-Which order?}" --arg q2 "${2:-}" \
    '{tool_name: "AskUserQuestion", session_id: "s1", transcript_path: $t,
      tool_input: {questions: ([{question: $q, header: "Order"}] + (if $q2 == "" then [] else [{question: $q2, header: "Other"}] end))}}'
}
# run_case <desc> <want exit> [question] [second question]
run_case() {
  local rc
  hook_input "${3:-}" "${4:-}" | env -i PATH="$PATH" HOME="$HOME" CLAUDE_PROJECT_DIR="$REPO" "$GUARD" >/dev/null 2>"$TMP/err"
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
  env -i PATH="$PATH" HOME="$HOME" CLAUDE_PROJECT_DIR="$REPO" "$LOG" subagent-stop >/dev/null 2>&1
if [[ "$(ls "$REPO"/.git/claude-decider/log/ 2>/dev/null | tr '\n' ' ')" == "s1.a1.jsonl s1.a2.jsonl s1.a3.jsonl " ]]; then
  echo "ok   - kit-log subagent-stop logged each decider call"
  pass=$((pass + 1))
else
  echo "FAIL - kit-log subagent-stop logged: $(ls "$REPO"/.git/claude-decider/log/ 2>&1)"
  fail=$((fail + 1))
fi

# per question: a verdict on A does not serve B; two questions pass only when both have an OWNER block
rm -f "$SUBS"/agent-*
rm -rf "$REPO"/.git/claude-decider
Q="Which database engine?" agent b1 OWNER
run_case "block: an OWNER verdict on question A does not serve question B" 2
says "the block names the missing verdict" "No verdict for"
says "the block quotes the question" "Which order"
run_case "pass: the question the OWNER verdict answered" 0 "Which database engine?"
run_case "block: that block is used up" 2 "Which database engine?"
Q="Which database engine?" agent b2 OWNER
Q="Which order?" agent b3 OWNER
run_case "pass: two questions each with an OWNER block" 0 "Which order?" "Which database engine?"
Q="Which order?" agent b4 OWNER
Q="Which cache layer?" agent b5 DECIDED
run_case "block: one of two questions matches a DECIDED block" 2 "Which order?" "Which cache layer?"
says "the block quotes the Choice" "pick-x"
run_case "pass: the OWNER block was kept when the ask was blocked" 0 "Which order?"
agent b6 ""
run_case "block: a running decider call gives wait, not a duplicate launch" 2 "Which colour scheme?"
says "the block says to wait" "wait for its result"

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
