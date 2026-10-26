#!/usr/bin/env bash
# Tests for review-skip-guard.sh: a throwaway repo with move-only, comment-only and code commits; each case checks
# that a reviewer launch is blocked (exit 2) or let through (exit 0).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
HOOK="$PWD/review-skip-guard.sh"
TMP="$(mktemp -d)" || exit 1
trap 'rm -rf "$TMP"' EXIT
REPO="$(cd "$TMP" && pwd -P)" || exit 1
pass=0
fail=0

git -C "$REPO" init -q
mkdir -p "$REPO/ai/kit" "$REPO/src/migrations"
for i in $(seq 1 30); do echo "export function f$i(x: number) { return x * $i + somethingLongEnough; }"; done >"$REPO/src/a.ts"
echo "// b" >"$REPO/src/b.ts"
cp "$REPO/src/a.ts" "$REPO/src/migrations/m.ts"
commit() { git -C "$REPO" add -A && git -C "$REPO" -c user.name=t -c user.email=t@t commit -qm "$1" && git -C "$REPO" log -1 --format=%h; }
commit base >/dev/null
# move f11..f30 into b.ts, re-indented
sed -n '11,30p' "$REPO/src/a.ts" | sed 's/^/  /' >>"$REPO/src/b.ts"
sed -i.bak '11,30d' "$REPO/src/a.ts" && rm "$REPO/src/a.ts.bak"
moved="$(commit moved)"
echo "// a note" >>"$REPO/src/a.ts"
comment="$(commit comment)"
echo "export const z = 1;" >>"$REPO/src/a.ts"
code="$(commit code)"
sed -n '1,20p' "$REPO/src/migrations/m.ts" >"$REPO/src/migrations/n.ts"
sed -i.bak '1,20d' "$REPO/src/migrations/m.ts" && rm "$REPO/src/migrations/m.ts.bak"
migration="$(commit migration)"

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
rev() { jq -cn --arg p "$1" --arg t "${2:-ai-kit:change-reviewer}" --arg d "${3:-Review}" '{subagent_type: $t, description: $d, prompt: $p}'; }

run_case "block: a move-only commit" 2 "$(rev "Read git show $moved")"
run_case "block: a comment-only commit" 2 "$(rev "git show $comment -- . ':(exclude)ai/usage'")"
run_case "block: the hash in the description" 2 "$(rev "the change" ai-kit:change-reviewer "Review $moved split")"
run_case "pass: a commit with a code line" 0 "$(rev "git show $code")"
run_case "pass: a move-only commit named with a code commit" 0 "$(rev "git show $moved and $code")"
run_case "pass: a move under a review.always path" 0 "$(rev "git show $migration")"
run_case "pass: no commit named (a work-tree review)" 0 "$(rev "the changed files: src/a.ts")"
run_case "pass: a hex word that is no commit" 0 "$(rev "id deadbeef12")"
run_case "pass: not a reviewer" 0 "$(rev "git show $moved" ai-kit:committer "commit: review fixes")"
run_case "block: general-purpose review fallback" 2 "$(rev "git show $moved" general-purpose "review split")"
rm -rf "$REPO/ai/kit"
run_case "pass: a project without ai/kit" 0 "$(rev "git show $moved")"

echo "$pass passed, $fail failed"
((fail == 0))
