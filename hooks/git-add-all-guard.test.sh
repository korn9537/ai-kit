#!/usr/bin/env bash
# Tests for git-add-all-guard.sh: each case pipes a Bash command and checks the exit code (2 = blocked).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
HOOK="$PWD/git-add-all-guard.sh"
REPO="$(mktemp -d)" || exit 1
trap 'rm -rf "$REPO"' EXIT
mkdir -p "$REPO/ai/kit" "$REPO/lib"

pass=0
fail=0
# run_case <desc> <expected exit> <command>
run_case() {
  local rc=0
  jq -n --arg c "$3" --arg d "$REPO" '{tool_name: "Bash", tool_input: {command: $c}, cwd: $d}' |
    CLAUDE_PROJECT_DIR="$REPO" "$HOOK" >/dev/null 2>&1 || rc=$?
  if [[ "$rc" == "$2" ]]; then
    echo "ok   - $1"
    pass=$((pass + 1))
  else
    echo "FAIL - $1 (want exit $2, got $rc)"
    fail=$((fail + 1))
  fi
}

run_case "block: git add -A" 2 "git add -A"
run_case "block: git add ." 2 "git add ."
run_case "block: git add of a directory" 2 "git add lib"
run_case "block: git commit -am" 2 "git commit -am msg"
run_case "block: git add . inside a subshell" 2 "(cd lib && git add .)"
run_case "block: git add -A after then" 2 "if true; then git add -A; fi"
run_case "block: git add -A in a loop body" 2 "for f in x; do git add -u; done"
run_case "block: env git add -A" 2 "env git add -A"
run_case "block: sudo git add ." 2 "sudo git add ."
run_case "block: a group" 2 "{ git add --all; }"
run_case "block: env -i git add ." 2 "env -i git add ."
run_case "pass: files by name" 0 "git add lib/a.ts README.md"
run_case "pass: a file by name inside a subshell" 0 "(git add lib/a.ts)"
run_case "pass: git commit -m with an a in the message" 0 "git commit -m 'add all'"
run_case "pass: not git" 0 "echo git add -A >/dev/null; ls"
run_case "pass: git status" 0 "git status"
rm -rf "$REPO/ai"
run_case "pass: a project without ai/kit" 0 "git add -A"

echo "$pass passed, $fail failed"
((fail == 0))
