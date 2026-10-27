#!/usr/bin/env bash
# Tests for build-while-dev-guard.sh — uses a throwaway high port via CLAUDE_DEV_GUARD_PORT
# so it never touches the real :3000 (which may have a real dev server on it).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
GUARD=./build-while-dev-guard.sh
TEST_PORT=39173
# a project with an empty ai/kit/ (hooks skip projects without it): the test covers the kit default config
NO_CONFIG="$(mktemp -d)"
mkdir -p "$NO_CONFIG/ai/kit"
NO_KIT="$(mktemp -d)"
# PATH dirs holding the hook's tools with lsof left out (netstat kept), and with no probe tool at all
NO_LSOF="$(mktemp -d)"
NO_PROBE="$(mktemp -d)"
STUBS="$(mktemp -d)"
trap 'rm -rf "$NO_CONFIG" "$NO_KIT" "$NO_LSOF" "$NO_PROBE" "$STUBS"' EXIT
for t in bash env jq grep sed tr cat dirname git uname; do
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
  payload="$(jq -n --arg cmd "$cmd" '{tool_name:"Bash", tool_input:{command:$cmd}}')"
  actual=$(env -i PATH="${CASE_PATH:-$PATH}" CLAUDE_PROJECT_DIR="$NO_CONFIG" CLAUDE_DEV_GUARD_PORT="$TEST_PORT" $extra_env \
    bash -c "echo '$payload' | \"$GUARD\"" >/tmp/build-guard-out.$$ 2>/tmp/build-guard-err.$$; echo $?)
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

echo
echo "$pass passed, $fail failed"
[[ "$fail" == "0" ]]
