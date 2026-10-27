#!/usr/bin/env bash
# PreToolUse guard (Bash): a production build writes to the directory the user's dev server serves. Blocks a
# build command (config build_guard.build_re) while the dev port (build_guard.port) is listening.
#
# Escape hatch: prefix the command with ALLOW_BUILD_WHILE_DEV=1 when the port is unrelated.
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0
. "$(dirname "$0")/lib.sh"
kit_enabled || exit 0

input="$(cat)"
tool_name="$(jq -r '.tool_name // empty' <<<"$input" 2>/dev/null || true)"
[[ "$tool_name" == "Bash" ]] || exit 0

cmd="$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null || true)"
[[ -n "$cmd" ]] || exit 0

if [[ "$cmd" == *"ALLOW_BUILD_WHILE_DEV=1"* ]]; then
  exit 0
fi

default_re='^([[:space:]]*[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*((pnpm|npm|yarn)([[:space:]]+(--prefix|--cwd|--workspace|--filter|-C|-w|-F)(=|[[:space:]]+)[^[:space:]]+)*([[:space:]]+run)?[[:space:]]+build([[:space:]]|$)|(npx[[:space:]]+)?next[[:space:]]+build([[:space:]]|$)|turbo[[:space:]]+(run[[:space:]]+)?build([[:space:]]|$))'
build_cmd_re="$(kit_conf .build_guard.build_re "$default_re")"

matched=0
while IFS= read -r segment; do
  trimmed="${segment#"${segment%%[![:space:]]*}"}"
  if echo "$trimmed" | grep -qE "$build_cmd_re"; then
    matched=1
    break
  fi
done < <(printf '%s\n' "$cmd" | tr ';|' '\n' | sed -E 's/&&/\n/g')

[[ "$matched" == "1" ]] || exit 0

# CLAUDE_DEV_GUARD_PORT is for tests only.
port="${CLAUDE_DEV_GUARD_PORT:-$(kit_conf .build_guard.port 3000)}"
hint="$(kit_conf .build_guard.hint "A build writes where the dev server serves from and can stop it. Run the typecheck instead.")"

# Git Bash on Windows has no lsof: its netstat (-ano) marks a listener LISTENING, or by a 0.0.0.0:0 / [::]:0 peer
# when the state is localized. 0 listening, 1 not, 2 no probe tool.
listening() {
  local flags=-an out
  # output captured first: under pipefail a grep -q that quits early can SIGPIPE the writer and read as "not listening"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    out="$(ss -ltn 2>/dev/null || true)"
    grep -qE "[:.]$port[[:space:]]" <<<"$out"
  elif command -v netstat >/dev/null 2>&1; then
    [[ "$(uname -s 2>/dev/null)" =~ ^(MINGW|MSYS|CYGWIN) ]] && flags=-ano
    out="$(netstat "$flags" 2>/dev/null | grep -E "[:.]$port[[:space:]]" || true)"
    grep -qiE 'LISTEN|[[:space:]](0\.0\.0\.0:0|\[::\]:0)[[:space:]]' <<<"$out"
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
  else
    return 2
  fi
}

rc=0
listening || rc=$?
if ((rc == 2)); then
  jq -n --arg m "build-while-dev-guard: no lsof, ss, netstat or nc, so :$port was not checked" '{systemMessage: $m}'
  exit 0
fi
if ((rc == 0)); then
  cat >&2 <<EOF
Blocked: :$port is listening (the user's dev server).
$hint
If :$port is not this repo's dev server: ALLOW_BUILD_WHILE_DEV=1 <command>
EOF
  exit 2
fi

exit 0
