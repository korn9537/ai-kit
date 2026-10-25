#!/usr/bin/env bash
# Tests for session-start.sh: the session id is read from stdin with a bounded wait.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
HOOK="$PWD/session-start.sh"
TMP="$(mktemp -d)" || exit 1
trap 'rm -rf "$TMP"' EXIT
REPO="$(cd "$TMP" && pwd -P)" || exit 1
git -C "$REPO" init -q
mkdir -p "$REPO/ai/kit"
echo '{}' >"$REPO/ai/kit/config.json"
export CLAUDE_PROJECT_DIR="$REPO" CLAUDE_CONFIG_DIR="$TMP/claude-config"

pass=0
fail=0
# check <desc> <condition exit code> [detail]
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

bash "$HOOK" </dev/null >"$TMP/null.out" 2>/dev/null
check "output with /dev/null stdin is non-empty" "$([[ -s "$TMP/null.out" ]] && echo 0 || echo 1)"

mkfifo "$TMP/open.fifo"
exec 3<>"$TMP/open.fifo"
start=$SECONDS
bash "$HOOK" <"$TMP/open.fifo" >"$TMP/open.out" 2>/dev/null
elapsed=$((SECONDS - start))
exec 3>&-
check "stdin left open returns within 2 s" "$((elapsed <= 2 ? 0 : 1))" "took ${elapsed} s"
check "stdin left open gives the same output as /dev/null" "$(cmp -s "$TMP/null.out" "$TMP/open.out" && echo 0 || echo 1)"

printf '{"session_id":"abc"}' | bash "$HOOK" >"$TMP/json.out" 2>/dev/null
check "session id on stdin without a newline gives the same output" "$(cmp -s "$TMP/null.out" "$TMP/json.out" && echo 0 || echo 1)"

echo "$pass passed, $fail failed"
((fail == 0))
