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

snap="$REPO/.git/claude-review"
printf '{"session_id":"s2","source":"resume"}' | bash "$HOOK" >/dev/null 2>&1
check "a resumed session gets no review snapshot" "$([[ ! -f "$snap/s2" ]] && echo 0 || echo 1)"
printf '{"session_id":"s3","source":"startup"}' | bash "$HOOK" >/dev/null 2>&1
check "a new session gets a review snapshot" "$([[ -s "$snap/s3" ]] && echo 0 || echo 1)"
echo kept >"$snap/s3"
printf '{"session_id":"s3","source":"startup"}' | bash "$HOOK" >/dev/null 2>&1
check "an existing snapshot is kept" "$([[ "$(cat "$snap/s3")" == kept ]] && echo 0 || echo 1)"


# plans not closed are named; a hand-written plan is not
job=2026-11-05-demo
git -C "$REPO" -c user.email=t@e.c -c user.name=t commit -q --allow-empty -m base
mkdir -p "$REPO/ai/plans"
printf '# Plan x\n\n| T-1 x | todo | a |\n' >"$REPO/ai/plans/hand.md"
bash "$HOOK" </dev/null >"$TMP/hand.out"
check "a hand-written plan is not named" "$(grep -q 'not closed' "$TMP/hand.out" && echo 1 || echo 0)"
printf '{"job":"%s","plugin":"p","batches":[{"id":"a","title":"A","brief":"B"}]}' "$job" >"$TMP/args.json"
git -C "$REPO" config user.email t@e.c
git -C "$REPO" config user.name t
PLAN="$PWD/../scripts/plan.mjs"
(cd "$REPO" && node "$PLAN" write "$TMP/args.json" >/dev/null)
bash "$HOOK" </dev/null >"$TMP/plan.out"
check "an open plan is named with its status" "$(grep -q "$job: 0 of 1 batches committed; ready a" "$TMP/plan.out" && echo 0 || echo 1)"
echo "$pass passed, $fail failed"
((fail == 0))
