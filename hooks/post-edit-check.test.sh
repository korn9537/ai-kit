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

# a Node project without node_modules (a fresh worktree): the kit's checks still run, the project's do not
echo '{}' >"$REPO/package.json"
echo '{"comments": {"include": "^src/c\\.ts$"}, "docs": {"include": "^$"}}' >"$REPO/ai/kit/config.json"
printf '// one\n// two\n// three\nconst c = 1;\n' >"$REPO/src/c.ts"
check "block: without node_modules the comment check still runs" 2 src/c.ts 'comments:check' 'run "a" - true'
check "pass: without node_modules post-edit.sh is skipped" 0 src/a.ts - 'run "a" - false'
rm "$REPO/package.json"

# Bash calls: PreToolUse `mark` touches a marker, the post run checks files newer than it
: >"$REPO/ai/kit/post-edit.sh"
echo '{"comments": {"include": "^src/.*\\.ts$"}, "docs": {"include": "^$"}}' >"$REPO/ai/kit/config.json"
BAD=$'// one\n// two\n// three\nconst c = 1;\n'
git -C "$REPO" add -A >/dev/null 2>&1
git -C "$REPO" -c user.email=t@t -c user.name=t commit -qm init >/dev/null 2>&1

# bash_hook <mode> <id> <command> [extra json]: runs the hook as a Bash tool event; sets $err and $rc
bash_hook() {
  local mode="$1" id="$2" cmd="$3" extra="${4:-}" arg="post"
  [[ -n "$extra" ]] || extra='{}'
  [[ "$mode" == mark ]] && arg=mark
  err="$(jq -n --arg id "$id" --arg c "$cmd" --arg cwd "$REPO" --argjson x "$extra" \
    '{tool_name: "Bash", tool_use_id: $id, cwd: $cwd, tool_input: ({command: $c} + $x)}' | "$HOOK" "$arg" 2>&1 >/dev/null)"
  rc=$?
}
# expect <desc> <expected exit> <stderr regex|->
expect() {
  if [[ "$rc" == "$2" ]] && { [[ "$3" == "-" && -z "$err" ]] || [[ "$3" != "-" && "$err" =~ $3 ]]; }; then
    echo "ok   - $1"
    pass=$((pass + 1))
  else
    echo "FAIL - $1 (expected exit $2, got $rc)"
    echo "       stderr: $err"
    fail=$((fail + 1))
  fi
}
MARKS="$(git -C "$REPO" rev-parse --absolute-git-dir)/claude-review"

printf '%s' "$BAD" >"$REPO/src/old.ts"
sleep 1.1
bash_hook mark b1 "sed -i x y"
expect "mark: silent" 0 -
[[ -f "$MARKS/bash-b1" ]] && { echo "ok   - mark: marker written"; pass=$((pass + 1)); } || { echo "FAIL - mark: no marker"; fail=$((fail + 1)); }
sleep 1.1
printf '%s' "$BAD" >"$REPO/src/new.ts"
bash_hook post b1 "sed -i x y"
expect "bash: a bad file written during the call is reported, naming it" 2 \
  '^Checks failing on src/new.ts, changed during this Bash call \(pre-commit will block these\):'
[[ "$err" != *src/old.ts* ]] && { echo "ok   - bash: a file older than the marker is not checked"; pass=$((pass + 1)); } || { echo "FAIL - old file checked"; fail=$((fail + 1)); }
[[ ! -f "$MARKS/bash-b1" ]] && { echo "ok   - bash: marker removed"; pass=$((pass + 1)); } || { echo "FAIL - marker kept"; fail=$((fail + 1)); }

bash_hook post nomark "sed -i x y"
expect "bash: no marker (Pre never ran) is silent" 0 -

bash_hook mark b2 "true"
bash_hook post b2 "true"
expect "bash: a call that writes nothing is silent" 0 -

bash_hook mark b3 "git checkout main"
sleep 1.1
printf '%s' "$BAD" >"$REPO/src/new.ts"
bash_hook post b3 "cd x && git -C y checkout main"
expect "bash: a work-tree-rewriting git command is not checked" 0 -
bash_hook mark b4 "sleep 5 &"
printf '%s' "$BAD" >"$REPO/src/new.ts"
bash_hook post b4 "sleep 5 &" '{"run_in_background": true}'
expect "bash: a background call is not checked" 0 -
[[ ! -f "$MARKS/bash-b4" ]] && { echo "ok   - bash: background call drops its marker"; pass=$((pass + 1)); } || { echo "FAIL - marker kept"; fail=$((fail + 1)); }

bash_hook mark b5 "gen"
sleep 1.1
for i in $(seq 23); do printf '%s' "$BAD" >"$REPO/src/g$i.ts"; done
bash_hook post b5 "gen"
expect "bash: more than 20 files says only 20 were checked" 2 'Only the first 20 of 2[3-5] changed files were checked'
rm -f "$REPO"/src/g*.ts "$REPO/src/new.ts" "$REPO/src/old.ts"

mkdir -p "$REPO/other"
bash_hook mark b6 "x"
err="$(jq -n --arg id b6 --arg cwd "$LINKS" '{tool_name: "Bash", tool_use_id: $id, cwd: $cwd, tool_input: {command: "x"}}' | "$HOOK" mark 2>&1)"
[[ -z "$err" && ! -e "$LINKS/ai" ]] && { echo "ok   - mark: outside a repo writes nothing"; pass=$((pass + 1)); } || { echo "FAIL - mark outside a repo"; fail=$((fail + 1)); }

echo
echo "$pass passed, $fail failed"
[[ "$fail" == "0" ]]
