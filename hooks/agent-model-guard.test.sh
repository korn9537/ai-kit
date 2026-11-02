#!/usr/bin/env bash
# Tests for agent-model-guard.sh: each case checks that an Agent launch is blocked (exit 2) or let through (exit 0).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
HOOK="$PWD/agent-model-guard.sh"
TMP="$(mktemp -d)" || exit 1
trap 'rm -rf "$TMP"' EXIT
REPO="$(cd "$TMP" && pwd -P)" || exit 1
pass=0
fail=0
mkdir -p "$REPO/ai/kit"

# run_case <desc> <want exit> <tool_input json>
run_case() {
  local rc
  jq -n --argjson ti "$3" '{tool_name: "Agent", tool_input: $ti}' |
    env -i PATH="$PATH" HOME="$HOME" CLAUDE_PROJECT_DIR="$REPO" "$HOOK" >/dev/null 2>"$TMP/err"
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

run_case "block: general-purpose without model" 2 '{"subagent_type":"general-purpose","prompt":"x"}'
run_case "block: general-purpose with empty model" 2 '{"subagent_type":"general-purpose","model":"","prompt":"x"}'
run_case "block: claude without model" 2 '{"subagent_type":"claude","prompt":"x"}'
run_case "block: no subagent_type without model" 2 '{"description":"d","prompt":"x"}'
run_case "pass: general-purpose with model sonnet" 0 '{"subagent_type":"general-purpose","model":"sonnet","prompt":"x"}'
run_case "pass: no subagent_type with model" 0 '{"model":"sonnet","prompt":"x"}'
run_case "pass: ai-kit:committer" 0 '{"subagent_type":"ai-kit:committer","prompt":"x"}'
run_case "pass: Explore" 0 '{"subagent_type":"Explore","prompt":"x"}'
run_case "pass: Plan" 0 '{"subagent_type":"Plan","prompt":"x"}'
run_case "pass: fork" 0 '{"subagent_type":"fork","prompt":"x"}'
# the block message names the fallback models
echo '{"tool_name":"Agent","tool_input":{"subagent_type":"general-purpose","prompt":"x"}}' |
  env -i PATH="$PATH" HOME="$HOME" CLAUDE_PROJECT_DIR="$REPO" "$HOOK" >/dev/null 2>"$TMP/err"
if grep -q 'model "opus"' "$TMP/err" && grep -q 'ai-kit:committer' "$TMP/err"; then
  echo "ok   - block message names the opus fallback"
  pass=$((pass + 1))
else
  echo "FAIL - block message names the opus fallback"
  fail=$((fail + 1))
fi
rm -rf "$REPO/ai/kit"
run_case "pass: a project without ai/kit" 0 '{"subagent_type":"general-purpose","prompt":"x"}'

echo "$pass passed, $fail failed"
((fail == 0))
