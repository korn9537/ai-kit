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

# a path-limited commit runs the hook with a temporary index: staging there would corrupt the real index (MM, D)
echo '{"n":3}' >>"$REPO/ai/usage/2030-01/s 1.jsonl"
echo '{"n":4}' >"$REPO/ai/usage/2030-01/s 2.jsonl"
echo more >>"$REPO/a.txt"
git -C "$REPO" commit -qm "path-limited" -- a.txt 2>&1
check "path-limited commit carries only its path" "$(files)" "a.txt "
check "path-limited commit leaves ai/usage out of the index (no MM, no D)" \
  "$(git -C "$REPO" status --porcelain -- ai/usage | cut -c1-2 | sort | tr '\n' ' ')" " M ?? "
echo e >"$REPO/e.txt"
git -C "$REPO" add e.txt
git -C "$REPO" commit -qm "later" 2>&1
check "the records wait for a later commit, which carries them" "$(files)" "ai/usage/2030-01/s 1.jsonl ai/usage/2030-01/s 2.jsonl e.txt "

# the "moved verbatim" lint-reason check reads code, not records
printf '%s\n' '{"prompt":"// eslint-disable-next-line x -- moved verbatim"}' >"$REPO/ai/usage/2030-01/s 3.jsonl"
echo f >"$REPO/f.txt"
git -C "$REPO" add f.txt
git -C "$REPO" commit -qm "record that quotes the phrase" 2>&1
check "a record quoting 'moved verbatim' does not block the commit" "$(files)" "ai/usage/2030-01/s 3.jsonl f.txt "

echo "$pass passed, $fail failed"
((fail == 0))
