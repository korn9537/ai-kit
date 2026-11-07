#!/usr/bin/env bash
# Tests for bash-guard.sh: the build check uses a throwaway high port via CLAUDE_DEV_GUARD_PORT so it never touches
# the real :3000 (which may have a real dev server on it); the git add check pipes a command and reads the exit
# code (2 = blocked).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
GUARD="$PWD/bash-guard.sh"
TEST_PORT=39173
# a project with an empty ai/kit/ (hooks skip projects without it): the test covers the kit default config
NO_CONFIG="$(mktemp -d)"
mkdir -p "$NO_CONFIG/ai/kit"
NO_KIT="$(mktemp -d)"
# PATH dirs holding the hook's tools with lsof left out (netstat kept), and with no probe tool at all
NO_LSOF="$(mktemp -d)"
NO_PROBE="$(mktemp -d)"
STUBS="$(mktemp -d)"
REPO="$(mktemp -d)"
mkdir -p "$REPO/ai/kit" "$REPO/lib" "$REPO/apps/web"
trap 'rm -rf "$NO_CONFIG" "$NO_KIT" "$NO_LSOF" "$NO_PROBE" "$STUBS" "$REPO"' EXIT
for t in bash env jq grep sed tr cat dirname git uname awk; do
  ln -s "$(command -v "$t")" "$NO_LSOF/$t"
  ln -s "$(command -v "$t")" "$NO_PROBE/$t"
done
for t in netstat ss; do command -v "$t" >/dev/null && ln -s "$(command -v "$t")" "$NO_LSOF/$t"; done
# stub_path <name> <tool=script>...: the base tools (no lsof) plus canned probe tools, as a PATH
stub_path() {
  local d="$STUBS/$1" kv
  shift
  mkdir -p "$d"
  for kv in "$@"; do printf '#!/bin/sh\n%s\n' "${kv#*=}" >"$d/${kv%%=*}" && chmod +x "$d/${kv%%=*}"; done
  printf '%s:%s' "$d" "$NO_PROBE"
}
WIN_UNAME='uname=echo MINGW64_NT-10.0'
win_netstat() { printf 'netstat=[ "$1" = -ano ] && printf "  TCP    0.0.0.0:%s    %s    %s    1234\\r\\n"' "$1" "$2" "$3"; }

pass=0
fail=0

run_case() {
  local desc="$1" expected="$2" cmd="$3" extra_env="${4:-}"
  local payload actual
  actual=$(jq -n --arg cmd "$cmd" '{tool_name:"Bash", tool_input:{command:$cmd}}' |
    env -i PATH="${CASE_PATH:-$PATH}" CLAUDE_PROJECT_DIR="$NO_CONFIG" CLAUDE_DEV_GUARD_PORT="$TEST_PORT" $extra_env \
      "$GUARD" >/tmp/build-guard-out.$$ 2>/tmp/build-guard-err.$$; echo $?)
  if [[ "$actual" == "$expected" ]]; then
    echo "ok   - $desc"
    pass=$((pass + 1))
  else
    echo "FAIL - $desc (expected exit $expected, got $actual)"
    echo "       stderr: $(cat /tmp/build-guard-err.$$)"
    fail=$((fail + 1))
  fi
  rm -f /tmp/build-guard-out.$$ /tmp/build-guard-err.$$
}

# no listener on TEST_PORT yet
run_case "allow: pnpm build, nothing listening" 0 "pnpm build"
run_case "allow: unrelated command, nothing listening" 0 "pnpm typecheck"
run_case "allow: mention only, not invoked" 0 "echo 'do not run pnpm build while dev is up'"

# git_case <desc> <expected exit> <command>: the git add check, run in $REPO with the dev port closed
git_case() {
  local rc=0
  jq -n --arg c "$3" --arg d "$REPO" '{tool_name: "Bash", tool_input: {command: $c}, cwd: $d}' |
    CLAUDE_PROJECT_DIR="$REPO" CLAUDE_DEV_GUARD_PORT=39174 "$GUARD" >/dev/null 2>&1 || rc=$?
  if [[ "$rc" == "$2" ]]; then
    echo "ok   - $1"
    pass=$((pass + 1))
  else
    echo "FAIL - $1 (want exit $2, got $rc)"
    fail=$((fail + 1))
  fi
}

git_case "block: git add -A" 2 "git add -A"
git_case "block: git add ." 2 "git add ."
git_case "block: git add of a directory" 2 "git add lib"
git_case "block: git commit -am" 2 "git commit -am msg"
git_case "block: git add . inside a subshell" 2 "(cd lib && git add .)"
git_case "block: git add -A after then" 2 "if true; then git add -A; fi"
git_case "block: git add -A in a loop body" 2 "for f in x; do git add -u; done"
git_case "block: env git add -A" 2 "env git add -A"
git_case "block: sudo git add ." 2 "sudo git add ."
git_case "block: a group" 2 "{ git add --all; }"
git_case "block: env -i git add ." 2 "env -i git add ."
git_case "pass: files by name" 0 "git add lib/a.ts README.md"
git_case "pass: a file by name inside a subshell" 0 "(git add lib/a.ts)"
git_case "pass: git commit -m with an a in the message" 0 "git commit -m 'add all'"
git_case "pass: not git" 0 "echo git add -A >/dev/null; ls"
git_case "pass: git status" 0 "git status"
git_case "block: git stage ." 2 "git stage ."
git_case "block: git stage -A" 2 "git stage -A"
git_case "block: git commit . -m x" 2 "git commit . -m x"
git_case "block: git commit -m x lib/" 2 "git commit -m x lib/"
git_case "block: git commit -m x -- lib" 2 "git commit -m x -- lib"
git_case "block: after a single &" 2 "sleep 1 & git add -A"
git_case "block: --git-dir before add" 2 "git --git-dir .git add -A"
git_case "block: cd into a directory, then add it" 2 "cd apps && git add web"
git_case "block: -C into a directory, then add it" 2 "git -C apps add web"
git_case "block: a quoted glob with parentheses" 2 'git add "app/(auth)/*"'
git_case "block: git add -A after a heredoc" 2 "cat <<EOF
x
EOF
git add -A"
git_case "pass: git add -n ." 0 "git add -n ."
git_case "pass: git add --dry-run -A" 0 "git add --dry-run -A"
git_case "pass: a commit body line naming git add -A" 0 "git commit -m 'fix

git add -A was wrong'"
git_case "pass: git add -A inside a quoted string" 0 'echo "use; git add -A never"'
git_case "pass: git add -A in a heredoc body" 0 "git commit -F - <<EOF
git add -A was wrong
EOF"
git_case "pass: git add -A in a comment" 0 "git status # git add -A"
git_case "pass: web is no directory in lib/" 0 "cd lib && git add web"
git_case "pass: git commit of a file by name" 0 "git commit -m x lib/a.ts"
git_case "pass: git commit -m with a dot in the message" 0 "git commit -m ."
rm -rf "$REPO/ai"
git_case "pass: a project without ai/kit" 0 "git add -A"


# start a throwaway listener on the test port
python3 -m http.server "$TEST_PORT" --bind 127.0.0.1 >/tmp/build-guard-server.$$ 2>&1 &
server_pid=$!
for _ in $(seq 1 20); do
  lsof -nP -iTCP:"$TEST_PORT" -sTCP:LISTEN >/dev/null 2>&1 && break
  sleep 0.2
done

run_case "block: pnpm build while port is listening" 2 "pnpm build"
run_case "block: pnpm --filter web build while listening" 2 "pnpm --filter web build"
run_case "block: next build while listening" 2 "next build"
run_case "block: turbo run build while listening" 2 "turbo run build"
for c in "npm --prefix web run build" "npm -w web run build" "npm --workspace web run build" \
  "npm --workspace=web run build" "npm run build -w web" "pnpm -C web build" "yarn --cwd web build"; do
  run_case "block: $c while listening" 2 "$c"
done
if [[ -e "$NO_LSOF/netstat" || -e "$NO_LSOF/ss" ]]; then
  CASE_PATH="$NO_LSOF" run_case "block: no lsof, netstat or ss sees the listener" 2 "pnpm build"
fi
CASE_PATH="$NO_PROBE" run_case "allow: no probe tool at all" 0 "pnpm build"
run_case "allow: a commit message naming npm run build while listening" 0 "git commit -m \"fix

npm run build passes\""
run_case "allow: a build named in a heredoc while listening" 0 "cat <<EOF
npm run build
EOF"
for c in "(cd web && npm run build)" "npx turbo run build" "pnpm turbo build" "pnpm next build" "pnpm exec next build" \
  "pnpm -r build" "npm run build:prod" "npm run -s build" "pnpm --dir web build" "bun run build" "npx vite build" \
  "time npm run build" "env CI=1 npm run build" "timeout 60 npm run build" "yarn workspace web build" "sleep 1 & pnpm build" \
  "echo ok | pnpm build"; do
  run_case "block: $c while listening" 2 "$c"
done
run_case "allow: unrelated command while listening" 0 "pnpm lint"
run_case "allow: escape hatch while listening" 0 "ALLOW_BUILD_WHILE_DEV=1 pnpm build"
run_case "allow: project without ai/kit/ while listening" 0 "pnpm build" "CLAUDE_PROJECT_DIR=$NO_KIT"

kill "$server_pid" >/dev/null 2>&1
wait "$server_pid" 2>/dev/null
rm -f /tmp/build-guard-server.$$

CASE_PATH="$NO_LSOF" run_case "allow: no lsof, nothing listening" 0 "pnpm build"
# canned probe output: the Windows netstat -ano branch, its localized state, ss and nc
CASE_PATH="$(stub_path win "$WIN_UNAME" "$(win_netstat "$TEST_PORT" 0.0.0.0:0 LISTENING)")" \
  run_case "block: Windows netstat -ano LISTENING" 2 "pnpm build"
CASE_PATH="$(stub_path winl "$WIN_UNAME" "$(win_netstat "$TEST_PORT" 0.0.0.0:0 ABHOEREN)")" \
  run_case "block: Windows netstat with a localized state" 2 "pnpm build"
CASE_PATH="$(stub_path wino "$WIN_UNAME" "$(win_netstat 1$TEST_PORT 0.0.0.0:0 LISTENING)")" \
  run_case "allow: Windows netstat, another port listening" 0 "pnpm build"
CASE_PATH="$(stub_path ss "ss=echo 'LISTEN 0 128 127.0.0.1:$TEST_PORT 0.0.0.0:*'")" \
  run_case "block: ss lists the port" 2 "pnpm build"
CASE_PATH="$(stub_path nc "nc=exit 0")" run_case "block: nc connects" 2 "pnpm build"
CASE_PATH="$(stub_path nc1 "nc=exit 1")" run_case "allow: nc refused" 0 "pnpm build"
out="$(jq -n '{tool_name:"Bash", tool_input:{command:"pnpm build"}}' |
  env -i PATH="$NO_PROBE" CLAUDE_PROJECT_DIR="$NO_CONFIG" CLAUDE_DEV_GUARD_PORT="$TEST_PORT" bash "$GUARD" 2>/dev/null)"
if [[ "$out" == *"was not checked"* ]]; then
  echo "ok   - warn: no probe tool says the port was not checked"
  pass=$((pass + 1))
else
  echo "FAIL - warn: no probe tool says the port was not checked (got: $out)"
  fail=$((fail + 1))
fi

# a 24 KB Thai heredoc: the splitter must not go quadratic (bash 3.2 ${var//} did, 14 s)
thai="$(printf 'ทดสอบข้อความภาษาไทยยาวมาก %.0s' $(seq 1 600))"
start=$SECONDS
git_case "pass: a 24 KB Thai heredoc" 0 "git commit -F - <<EOF
$thai
EOF"
if ((SECONDS - start < 2)); then
  echo "ok   - a 24 KB Thai heredoc takes under 2 s"
  pass=$((pass + 1))
else
  echo "FAIL - a 24 KB Thai heredoc took $((SECONDS - start)) s"
  fail=$((fail + 1))
fi

echo
echo "$pass passed, $fail failed"
[[ "$fail" == "0" ]]
