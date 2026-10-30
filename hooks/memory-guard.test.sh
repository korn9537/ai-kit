#!/usr/bin/env bash
# Tests for memory-guard.sh: writes into the auto-memory dir are blocked (exit 2), with POSIX and Windows paths and
# under CLAUDE_CONFIG_DIR; reads and other paths pass.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
HOOK="$PWD/memory-guard.sh"
REPO="$(mktemp -d)" || exit 1
trap 'rm -rf "$REPO"' EXIT
mkdir -p "$REPO/ai/kit" "$REPO/sub" && git -C "$REPO" init -q

pass=0
fail=0
# run_case <desc> <expected exit> <tool> <path or command> [CLAUDE_CONFIG_DIR]
run_case() {
  local rc=0
  jq -n --arg t "$3" --arg v "$4" '{tool_name: $t, tool_input: {file_path: $v, command: $v}}' |
    env -u CLAUDE_CONFIG_DIR CLAUDE_PROJECT_DIR="${PD:-$REPO}" ${5:+CLAUDE_CONFIG_DIR="$5"} "$HOOK" >/dev/null 2>&1 || rc=$?
  if [[ "$rc" == "$2" ]]; then
    echo "ok   - $1"
    pass=$((pass + 1))
  else
    echo "FAIL - $1 (want exit $2, got $rc)"
    fail=$((fail + 1))
  fi
}

run_case "block: Write into ~/.claude/projects/*/memory" 2 Write "/home/u/.claude/projects/-r/memory/a.md"
run_case "block: Write with a Windows path" 2 Write 'C:\Users\u\.claude\projects\C--r\memory\a.md'
run_case "block: a redirect with a Windows path" 2 Bash 'echo x > C:\Users\u\.claude\projects\C--r\memory\a.md'
run_case "block: Write under CLAUDE_CONFIG_DIR" 2 Write "/cfg/my.dir/projects/-r/memory/a.md" /cfg/my.dir
run_case "block: Write under a Windows CLAUDE_CONFIG_DIR" 2 Write 'D:\cfg\projects\D--r\memory\a.md' 'D:\cfg\'
run_case "pass: reading the memory dir" 0 Bash "cat /home/u/.claude/projects/-r/memory/a.md"
run_case "pass: a path that only looks like the config dir" 0 Write "/cfg/myxdir/projects/-r/memory/a.md" /cfg/my.dir
run_case "pass: a repo file" 0 Write "$REPO/ai/notes.md"
# a session opened in a subfolder, spelled with backslashes (Windows): the kit still finds ai/kit at the root
PD="${REPO//\//\\}\\sub" run_case "block: project dir as a Windows subfolder path" 2 Write "/home/u/.claude/projects/-r/memory/a.md"

# lib.sh kit_path: Git Bash (OSTYPE msys) spells C:/x as /c/x; elsewhere /c/x is a real POSIX path
path_case() {
  local got
  got="$(OSTYPE="$1" bash -c '. ./lib.sh; OSTYPE="$0"; kit_path "$1"' "$1" "$2")"
  if [[ "$got" == "$3" ]]; then
    echo "ok   - kit_path ($1) $2"
    pass=$((pass + 1))
  else
    echo "FAIL - kit_path ($1) $2: got $got, want $3"
    fail=$((fail + 1))
  fi
}
path_case msys /c/Users/u/repo C:/Users/u/repo
path_case msys 'C:\Users\u\repo' C:/Users/u/repo
path_case msys /tmp/x /tmp/x
path_case darwin /c/Users/u/repo /c/Users/u/repo

echo "$pass passed, $fail failed"
((fail == 0))
