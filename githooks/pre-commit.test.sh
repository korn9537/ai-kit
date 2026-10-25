#!/usr/bin/env bash
# Tests for the pre-commit runner's ai/usage staging: a throwaway repo, real commits through a temp hooks dir.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
PLUGIN="$PWD/.."
TMP="$(mktemp -d)" || exit 1
trap 'rm -rf "$TMP"' EXIT
REPO="$TMP/repo"
mkdir -p "$TMP/hooks" "$REPO"
printf '#!/bin/sh\nexec "%s/githooks/pre-commit" "$@"\n' "$PLUGIN" >"$TMP/hooks/pre-commit"
chmod +x "$TMP/hooks/pre-commit"

git -C "$REPO" init -q
git -C "$REPO" config user.name tester
git -C "$REPO" config user.email t@t
git -C "$REPO" config core.hooksPath "$TMP/hooks"
echo base >"$REPO/base.txt"
git -C "$REPO" add -A
git -C "$REPO" commit -qm base

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
files() { git -C "$REPO" show --name-only --format= HEAD | tr '\n' ' '; }

echo a >"$REPO/a.txt"
git -C "$REPO" add a.txt
git -C "$REPO" commit -qm "no usage dir" 2>&1
check "no ai/usage dir → commit unaffected" "$(files)" "a.txt "

mkdir -p "$REPO/ai/usage/2030-01"
echo '{"n":1}' >"$REPO/ai/usage/2030-01/s 1.jsonl"
echo b >"$REPO/b.txt"
git -C "$REPO" add b.txt
git -C "$REPO" commit -qm "with usage" 2>&1
check "commit of b.txt also carries the new ai/usage file" "$(files)" "ai/usage/2030-01/s 1.jsonl b.txt "

echo c >"$REPO/c.txt"
git -C "$REPO" add c.txt
git -C "$REPO" commit -qm "unchanged usage" 2>&1
check "an unchanged ai/usage file is not re-added" "$(files)" "c.txt "

echo '{"n":2}' >>"$REPO/ai/usage/2030-01/s 1.jsonl"
echo d >"$REPO/d.txt"
git -C "$REPO" add d.txt
git -C "$REPO" commit -qm "grown usage" 2>&1
check "an appended ai/usage file rides along" "$(files)" "ai/usage/2030-01/s 1.jsonl d.txt "

echo "$pass passed, $fail failed"
((fail == 0))
