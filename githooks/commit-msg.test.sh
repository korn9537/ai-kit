#!/usr/bin/env bash
# Tests for the commit-msg runner (one valid Job: trailer): message files, plus real commits through a temp hooks dir.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
PLUGIN="$PWD/.."
TMP="$(mktemp -d)" || exit 1
trap 'rm -rf "$TMP"' EXIT
REPO="$TMP/repo"
mkdir -p "$TMP/hooks" "$REPO"
printf '#!/bin/sh\nexec "%s/githooks/commit-msg" "$@"\n' "$PLUGIN" >"$TMP/hooks/commit-msg"
chmod +x "$TMP/hooks/commit-msg"
git -C "$REPO" init -q
git -C "$REPO" config user.name tester
git -C "$REPO" config user.email t@t
git -C "$REPO" config core.hooksPath "$TMP/hooks"

pass=0
fail=0
# check <desc> <actual> <expected>
check() {
  if [[ "$2" == "$3" ]]; then
    echo "ok   - $1"
    pass=$((pass + 1))
  else
    echo "FAIL - $1"
    printf '       want: %s\n       got:  %s\n' "$3" "$2"
    fail=$((fail + 1))
  fi
}
# msg <body> → exit code of the runner on that message
msg() {
  printf '%b' "$1" >"$TMP/msg"
  (cd "$REPO" && sh "$PLUGIN/githooks/commit-msg" "$TMP/msg" >/dev/null)
  echo $?
}

check "no trailer → blocked" "$(msg 'feat: x\n\nbody\n')" 1
check "valid Job → passes" "$(msg 'feat: x\n\nJob: 2026-01-05-invoice-export\n')" 0
check "Job before Co-Authored-By in one block → passes" \
  "$(msg 'feat: x\n\nJob: 2026-01-05-a\nCo-Authored-By: A <a@b>\n')" 0
check "Job and Co-Authored-By in their own paragraphs → passes" \
  "$(msg 'feat: x\n\nbody\n\nJob: 2026-01-05-a\n\nCo-Authored-By: A <a@b>\n')" 0
check "Job in its own paragraph twice → blocked" "$(msg 'feat: x\n\nJob: 2026-01-05-a\n\nJob: 2026-01-05-b\n')" 1
check "CRLF message → passes" "$(msg 'feat: x\r\n\r\nJob: 2026-01-05-a\r\n')" 0
check "a commented Job line → blocked" "$(msg 'feat: x\n\n# Job: 2026-01-05-a\n')" 1
check "free-text job → blocked" "$(msg 'feat: x\n\nJob: Invoice Export\n')" 1
check "two jobs → blocked" "$(msg 'feat: x\n\nJob: 2026-01-05-a\nJob: 2026-01-05-b\n')" 1
check "lowercase job: → blocked" "$(msg 'feat: x\n\njob: 2026-01-05-a\n')" 1
check "Job in the body, not the trailer block → blocked" \
  "$(msg 'feat: x\n\nJob: 2026-01-05-a\nmore text here\n')" 1
check "fixup! → passes" "$(msg 'fixup! feat: x\n')" 0

echo a >"$REPO/a.txt"
git -C "$REPO" add a.txt
git -C "$REPO" commit -qm "feat: a" >/dev/null 2>&1
check "real commit without Job → refused" "$(git -C "$REPO" rev-list --all --count 2>/dev/null || echo 0)" 0
git -C "$REPO" commit -qm "feat: a" -m "Job: 2026-01-05-a" >/dev/null 2>&1
check "real commit with Job → made" "$(git -C "$REPO" rev-list --count HEAD)" 1

git -C "$REPO" switch -qc side
echo b >"$REPO/b.txt"
git -C "$REPO" add b.txt
git -C "$REPO" commit -qm "feat: b" -m "Job: 2026-01-05-b" >/dev/null 2>&1
git -C "$REPO" switch -q -
echo c >"$REPO/c.txt"
git -C "$REPO" add c.txt
git -C "$REPO" commit -qm "feat: c" -m "Job: 2026-01-05-c" >/dev/null 2>&1
git -C "$REPO" merge -q --no-ff --no-edit side >/dev/null 2>&1
check "merge commit without Job → made" "$(git -C "$REPO" rev-list --count --merges HEAD)" 1

echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
