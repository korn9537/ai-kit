#!/usr/bin/env bash
# Tests for post-edit-check.sh: project checks from ai/kit/post-edit.sh run in parallel, failures are reported in
# start order, a filter keeps only lines naming the file, and a passing edit stays silent.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
HOOK="$PWD/post-edit-check.sh"
# physical path: the hook matches the file against git's toplevel, which resolves /var -> /private/var
REPO="$(cd "$(mktemp -d)" && pwd -P)"
LINKS="$(mktemp -d)"
ln -s "$REPO" "$LINKS/repo"
trap 'rm -rf "$REPO" "$LINKS"' EXIT
git -C "$REPO" init -q
mkdir -p "$REPO/ai/kit" "$REPO/src"
echo '{"comments": {"include": "^$"}, "docs": {"include": "^$"}}' >"$REPO/ai/kit/config.json"
echo 'x' >"$REPO/src/a.ts"
echo 'x' >"$REPO/src/b.ts"

pass=0
fail=0

# check <desc> <expected exit> <file> <stderr regex|-> <post-edit.sh body>
check() {
  local desc="$1" expected="$2" file="$3" want="$4"
  printf '%s\n' "$5" >"$REPO/ai/kit/post-edit.sh"
  local err rc
  [[ "$file" == /* ]] || file="$REPO/$file"
  err="$(jq -n --arg f "$file" '{tool_input: {file_path: $f}}' | "$HOOK" 2>&1 >/dev/null)"
  rc=$?
  if [[ "$rc" == "$expected" ]] && { [[ "$want" == "-" && -z "$err" ]] || [[ "$want" != "-" && "$err" =~ $want ]]; }; then
    echo "ok   - $desc"
    pass=$((pass + 1))
  else
    echo "FAIL - $desc (expected exit $expected, got $rc)"
    echo "       stderr: $err"
    fail=$((fail + 1))
  fi
}

check "pass: every check passes, silent" 0 src/a.ts - 'run "one" - true
run "two" - true'

# anchored: the passing check started first leaves nothing in the report
check "block: only the failing check is reported, with its label" 2 src/a.ts \
  $'^Checks failing on src/a.ts \\(pre-commit will block these\\):\n\\[bad\\] \\(full output: sh -c' \
  'run "good" - true
run "bad" - sh -c "echo broken; exit 1"'

check "block: runs inside subshells report their failures, in start order" 2 src/a.ts \
  '\[s1\][^[]*broken.*\[s2\][^[]*broken.*\[t\][^[]*broken' \
  '( cd src && run "s1" - sh -c "echo broken; exit 1" )
( run "s2" - sh -c "echo broken; exit 1" )
run "t" - sh -c "echo broken; exit 1"'

# the first check is the slowest: the report keeps start order, not finish order
check "block: failures in start order" 2 src/a.ts $'\\[slow\\][^[]*late.*\\[fast\\][^[]*early' \
  'run "slow" - sh -c "sleep 0.5; echo late; exit 1"
run "fast" - sh -c "echo early; exit 1"'

check "block: a file reached through a symlinked folder is checked" 2 "$LINKS/repo/src/a.ts" \
  '^Checks failing on src/a.ts .*\[bad\]' 'run "bad" - false'

check "pass: a failure naming only other files is filtered out" 0 src/a.ts - \
  'run "lint" "src/a.ts" sh -c "echo src/b.ts: bad; exit 1"'

check "block: a filtered failure naming the file keeps that line" 2 src/a.ts 'src/a.ts: bad' \
  'run "lint" "src/a.ts" sh -c "echo src/b.ts: other; echo src/a.ts: bad; exit 1"'

# each check marks its start, then passes only once all three have started: in sequence the first one fails
check "pass: checks run in parallel" 0 src/a.ts - \
  'both='"'"'touch "$1"; for _ in $(seq 50); do [ -f m.a ] && [ -f m.b ] && [ -f m.c ] && exit 0; sleep 0.1; done; exit 1'"'"'
run "a" - sh -c "$both" _ m.a
run "b" - sh -c "$both" _ m.b
run "c" - sh -c "$both" _ m.c'
rm -f "$REPO"/m.?

start=$SECONDS
check "pass: a job post-edit.sh starts itself is not waited for" 0 src/a.ts - \
  'sleep 20 >/dev/null 2>&1 &
run "a" - true'
if ((SECONDS - start < 10)); then
  echo "ok   - the hook returned in $((SECONDS - start)) s"
  pass=$((pass + 1))
else
  echo "FAIL - the hook waited $((SECONDS - start)) s for the watcher"
  fail=$((fail + 1))
fi

echo
echo "$pass passed, $fail failed"
[[ "$fail" == "0" ]]
