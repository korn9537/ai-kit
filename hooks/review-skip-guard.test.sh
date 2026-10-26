#!/usr/bin/env bash
# Tests for review-skip-guard.sh: a throwaway repo with move-only, comment-only and code commits; each case checks
# that a reviewer launch is blocked (exit 2) or let through (exit 0).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
HOOK="$PWD/review-skip-guard.sh"
NEEDED="$PWD/../scripts/review-needed.sh"
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
# reorder within one file: line 10 of a copy moved to its top
cp "$REPO/src/a.ts" "$REPO/src/r.ts"
commit pre-reorder >/dev/null
{ sed -n '10p' "$REPO/src/a.ts"; sed -n '1,9p' "$REPO/src/a.ts"; } >"$REPO/src/r.ts"
reorder="$(commit reorder)"
chmod +x "$REPO/src/b.ts"
mode="$(commit mode)"
: >"$REPO/src/empty.ts"
empty="$(commit empty)"
# a non-UTF-8 line before a code line must not hide it (BSD sed stops on an illegal byte)
printf 'caf\xe9\n' >"$REPO/src/l.txt"
echo "export const y = 2;" >>"$REPO/src/z.ts"
latin="$(commit latin)"

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
run_case "block: the hash in the description" 2 "$(rev "read git show of the commit" ai-kit:change-reviewer "Review $moved split")"
run_case "pass: a brief with no git show (a work-tree review naming an earlier commit)" 0 "$(rev "builds on $moved")"
run_case "pass: lines reordered within one file" 0 "$(rev "git show $reorder")"
run_case "pass: a Latin-1 line next to a code line" 0 "$(rev "git show $latin")"
run_case "pass: a mode change" 0 "$(rev "git show $mode")"
run_case "pass: an empty new file" 0 "$(rev "git show $empty")"
run_case "pass: a hash inside a longer hex word" 0 "$(rev "git show ${moved}0123456789abcdef0123456789abcdef0123")"
echo '{"review": {"always": "("}}' >"$REPO/ai/kit/config.json"
run_case "pass: an invalid review.always pattern counts as a match" 0 "$(rev "git show $moved")"
rm "$REPO/ai/kit/config.json"
run_case "pass: a commit with a code line" 0 "$(rev "git show $code")"
run_case "pass: a move-only commit named with a code commit" 0 "$(rev "git show $moved and $code")"
run_case "pass: a move under a review.always path" 0 "$(rev "git show $migration")"
run_case "pass: no commit named (a work-tree review)" 0 "$(rev "the changed files: src/a.ts")"
run_case "pass: a hex word that is no commit" 0 "$(rev "id deadbeef12")"
run_case "pass: not a reviewer" 0 "$(rev "git show $moved" ai-kit:committer "commit: review fixes")"
run_case "block: general-purpose review fallback" 2 "$(rev "git show $moved" general-purpose "review split")"

# scripts/review-needed.sh shares the check: skip for a move-only commit, review otherwise
needed() {
  local got
  got="$(cd "$REPO" && env -i PATH="$PATH" HOME="$HOME" bash "$NEEDED" "$3" 2>&1)"
  if [[ "$got" == "$2" ]]; then
    echo "ok   - $1"
    pass=$((pass + 1))
  else
    echo "FAIL - $1 (want $2, got $got)"
    fail=$((fail + 1))
  fi
}
needed "review-needed: a move-only commit" skip "$moved"
needed "review-needed: a code commit" review "$code"
needed "review-needed: a move under a review.always path" review "$migration"
needed "review-needed: no commit given" review ""
needed "review-needed: an unknown commit" review deadbeef12
rm -rf "$REPO/ai/kit"
run_case "pass: a project without ai/kit" 0 "$(rev "git show $moved")"

echo "$pass passed, $fail failed"
((fail == 0))
