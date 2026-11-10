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
mkdir -p "$REPO/ai/kit" "$REPO/lib" "$REPO/apps/web" "$REPO/src" "$REPO/a&b" "$REPO/gm-sale-visit" "$REPO/sm2"
git -C "$REPO" init -q
echo "gitdir: ../.git/modules/gm" >"$REPO/gm-sale-visit/.git"
git -C "$REPO" update-index --add --cacheinfo 160000,0123456789012345678901234567890123456789,sm2
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
# the scan cannot follow the text: the raw text is checked as well
git_case "block: a quote inside a quoted \$( ), then git add -A" 2 'x="$(grep "it'"'"'s" f)" && git add -A'
git_case "block: git add -A inside a quoted \$( )" 2 'out="$(cd lib; git add -A; git status)"'
git_case "block: an escaped quote in a dollar-quote" 2 "echo \$'it\\'s' && git add -A"
git_case "block: a heredoc word that never closes" 2 'cat <<E"O"F
x
EOF
git add -A'
git_case "block: a heredoc closed by EOF)" 2 'x=$(cat <<EOF
hi
EOF) && git add -A'
git_case "pass: a quoted heredoc in \$( ) naming git add -A" 0 'git commit -m "$(cat <<'"'EOF'"'
git add -A was wrong
EOF
)"'
for m in 'fix: stop on `git add .`' 'docs: never `git add -A` here' 'fix: (git add .) in docs' 'say "git add ." here'; do
  git_case "pass: a quoted heredoc message: $m" 0 "git commit -m \"\$(cat <<'EOF'
$m
EOF
)\""
done
git_case "pass: a <<- quoted heredoc message" 0 "$(printf 'git commit -m "$(cat <<-%sEOF%s\n\tgit add .\n\tEOF\n)"' "'" "'")"
git_case "block: a command after the quoted heredoc in \$( )" 2 'git commit -m "$(cat <<'"'EOF'"'
x
EOF
git add -A)"'
git_case "block: a substitution before the quoted heredoc" 2 'git commit -m "$(git add -A) $(cat <<'"'EOF'"'
x
EOF
)"'
git_case "block: a quoted heredoc fed to a shell in \$( )" 2 'x="$(bash <<'"'E'"'
git add -A
E
)"'
for c in "bash -c" "sh -c" eval; do
  git_case "block: $c of a quoted heredoc" 2 "$c \"\$(cat <<'W'
git add -A
W
)\""
done
git_case "block: an escaped \$( does not open a heredoc" 2 'echo "\$(cat <<'"'W'"'
x"; git add -A; echo "
W
)"'
git_case "pass: gh pr create with a body naming git add ." 0 'gh pr create --body "$(cat <<'"'EOF'"'
never `git add .` here
EOF
)"'
git_case "block: an unquoted heredoc in \$( ) may run its body" 2 'git commit -m "$(cat <<EOF
$(git add -A)
EOF
)"'
git_case "block: a quoted heredoc that never closes" 2 'git commit -m "$(cat <<'"'EOF'"'
git add -A'
git_case "block: git commit after a quoted heredoc message" 2 'git commit -m "$(cat <<'"'EOF'"'
x
EOF
)" -a'
git_case "pass: a quoted \$( ) with no git add" 0 'git commit -m "$(cat <<'"'EOF'"'
fix the thing
EOF
)"'
git_case "pass: a -m message with a quote and no \$(" 0 "git commit -m \"it's fine\" lib/a.ts"
git_case "pass: a closed quoted heredoc naming git add -A" 0 "git commit -F - <<'EOF'
git add -A was wrong
EOF"
git_case "block: git add -A after \$((1<<3))" 2 'echo $((1<<3))
git add -A'
git_case "pass: \$((1<<3)) then a file by name" 0 'echo $((1<<3)); git add lib/a.ts'
# the directory a cd or -C could not follow is still the project's
git_case "block: a cd in a subshell ends with it" 2 "(cd apps); git add src"
git_case "pass: a subshell cd does not carry (web is not in the cwd)" 0 "(cd lib); git add web"
git_case "block: a cd in a subshell reaches its own commands" 2 "(cd apps && git add web)"
git_case "block: cd to a missing directory, then git add src" 2 "cd nonexistent || true; git add src"
git_case "block: git -C ~/x add src" 2 "git -C ~/x add src"
git_case "block: a quoted name holding & is a directory" 2 'git add "a&b"'
git_case "block: command -p git add -A" 2 "command -p git add -A"
git_case "pass: command -v git" 0 "command -v git"
git_case "pass: a directory holding .git is a submodule pointer" 0 "git add gm-sale-visit"
git_case "pass: a gitlink in the index is a submodule pointer" 0 "git add sm2"
git_case "block: the repo root by its absolute path" 2 "git add $REPO"
git_case "pass: a submodule by its absolute path under a -C the scan cannot resolve" 0 \
  "git -C \"\$R\" add $REPO/gm-sale-visit"
git_case "block: git -C the repo root, added by its absolute path" 2 "git -C $REPO add $REPO"
git_case "block: the repo root through its parent" 2 "git add ../${REPO##*/}"
git_case "block: the repo root as src/.." 2 "git add src/.."
git_case "block: an attached -m value, then -a" 2 "git commit -mfoot -a"
git_case "pass: an attached -m value, then a file" 0 "git commit -mfoot lib/a.ts"
git_case "pass: -sm takes the next word" 0 "git commit -sm . lib/a.ts"
git_case "block: a quoted name holding a semicolon, then a dot" 2 'git add "a;b" .'
# 500 quoted names with spaces: no fork per word
big="git add"
for i in $(seq 1 500); do big="$big \"lib/file $i.ts\""; done
start=$SECONDS
git_case "pass: a 10 KB git add of 500 quoted names" 0 "$big"
if ((SECONDS - start < 2)); then
  echo "ok   - a 10 KB git add of 500 quoted names takes under 2 s"
  pass=$((pass + 1))
else
  echo "FAIL - a 10 KB git add of 500 quoted names took $((SECONDS - start)) s"
  fail=$((fail + 1))
fi
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
run_case "allow: a backticked build in a quoted heredoc message while listening" 0 "git commit -m \"\$(cat <<'EOF'
fix: \`pnpm build\` failed on CI
EOF
)\""
# a config pattern is grep -E: \s \b \d mean what they mean there
for re in 'pnpm\s+build' '\bnext build\b' '^(pnpm|npm) build\b'; do
  jq -n --arg re "$re" '{build_guard: {build_re: $re}}' >"$NO_CONFIG/ai/kit/config.json"
  c="pnpm build"
  [[ "$re" == *next* ]] && c="next build"
  run_case "block: build_re $re while listening" 2 "$c"
done
rm -f "$NO_CONFIG/ai/kit/config.json"
for c in "(cd web && npm run build)" "npx turbo run build" "pnpm turbo build" "pnpm next build" "pnpm exec next build" \
  "pnpm -r build" "npm run build:prod" "npm run -s build" "pnpm --dir web build" "bun run build" "npx vite build" \
  "time npm run build" "env CI=1 npm run build" "timeout 60 npm run build" "yarn workspace web build" "sleep 1 & pnpm build" \
  "echo ok | pnpm build"; do
  run_case "block: $c while listening" 2 "$c"
done
run_case "allow: npm r build is an uninstall" 0 "npm r build"
run_case "block: pnpm r build while listening" 2 "pnpm r build"
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

# awk failing must not pass silently: the raw text is checked and a systemMessage says so
AWK_FAIL="$(stub_path awkfail "awk=exit 2")"
out="$(jq -n --arg d "$REPO" '{tool_name:"Bash", tool_input:{command:"echo hi"}, cwd:$d}' |
  env -i PATH="$AWK_FAIL" CLAUDE_PROJECT_DIR="$NO_CONFIG" bash "$GUARD" 2>/dev/null)"
if [[ "$out" == *"splitter failed"* ]]; then
  echo "ok   - warn: a failing awk says the command was checked raw"
  pass=$((pass + 1))
else
  echo "FAIL - warn: a failing awk says the command was checked raw (got: $out)"
  fail=$((fail + 1))
fi
rc=0
jq -n --arg d "$REPO" '{tool_name:"Bash", tool_input:{command:"echo hi; git add -A"}, cwd:$d}' |
  env -i PATH="$AWK_FAIL" CLAUDE_PROJECT_DIR="$NO_CONFIG" bash "$GUARD" >/dev/null 2>&1 || rc=$?
if [[ "$rc" == 2 ]]; then
  echo "ok   - block: a failing awk still blocks git add -A on the raw text"
  pass=$((pass + 1))
else
  echo "FAIL - block: a failing awk still blocks git add -A on the raw text (got exit $rc)"
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

mkdir -p "$REPO/ai/kit"
# xargs, sh -c, and git add with an argument the scan cannot read
git_case "block: xargs git add" 2 "git ls-files -m | xargs git add"
git_case "block: xargs -n1 git add" 2 "git ls-files -m | xargs -n 1 git add"
git_case "pass: xargs git add -n" 0 "git ls-files -m | xargs git add -n"
git_case "pass: xargs git add with a file named" 0 "xargs git add src/a.ts"
git_case "block: bash -c git add -A" 2 'bash -c "git add -A"'
git_case "block: sh -c git add ." 2 "sh -c 'git add .'"
git_case "block: sudo zsh -lc git add -A" 2 "sudo zsh -lc 'git add -A'"
git_case "pass: bash -c git add a file" 0 'bash -c "git add src/a.ts"'
git_case "block: bash -c with two commands" 2 "bash -c 'echo hi; git add -A'"
git_case "block: nested sh -c, two levels" 2 "sh -c \"bash -c 'git add -A'\""
deep="git add -A"
for _ in 1 2 3 4 5; do deep="sh -c $(printf '%q' "$deep")"; done
git_case "block: nested sh -c, past the depth cap" 2 "$deep"
deep="git add src/a.ts"
for _ in 1 2 3 4 5; do deep="sh -c $(printf '%q' "$deep")"; done
git_case "pass: nested sh -c, past the depth cap, a named file" 0 "$deep"
git_case "pass: nested sh -c with a file" 0 "sh -c \"bash -c 'git add src/a.ts'\""
git_case "block: git add \$(...)" 2 'git add $(git ls-files -m)'
git_case "block: git add backticks" 2 'git add `git ls-files -m`'
git_case "block: git add \$(...) after a file" 2 'git add src/a.ts $(git ls-files -m)'
git_case "pass: git add -n \$(...)" 0 'git add -n $(git ls-files -m)'
git_case "pass: commit message naming xargs git add" 0 'git commit -m "docs: xargs git add and bash -c git add -A are blocked"'
git_case "pass: echo of backticks" 0 'echo `date` > /dev/null'
git_case "block: git add \$(...) in a double quote, raw pass" 2 'echo "$(date)"; git add -A'
git_case "block: bash -c in a double quote with \$(...), raw words" 2 'bash -c "git add -A $(date)"'

# the auto-memory dir: a write through Bash
FAKE_HOME="$(mktemp -d)"
trap 'rm -rf "$NO_CONFIG" "$NO_KIT" "$NO_LSOF" "$NO_PROBE" "$STUBS" "$REPO" "$FAKE_HOME"' EXIT
# mem_case <desc> <expected exit> <command> [extra env]
mem_case() {
  local rc=0
  jq -n --arg c "$3" --arg d "$REPO" '{tool_name: "Bash", tool_input: {command: $c}, cwd: $d}' |
    env HOME="$FAKE_HOME" CLAUDE_PROJECT_DIR="$REPO" CLAUDE_DEV_GUARD_PORT=39174 ${4:+"$4"} "$GUARD" >/dev/null 2>&1 || rc=$?
  if [[ "$rc" == "$2" ]]; then
    echo "ok   - $1"
    pass=$((pass + 1))
  else
    echo "FAIL - $1 (want exit $2, got $rc)"
    fail=$((fail + 1))
  fi
}
M='~/.claude/projects/p/memory'
mem_case "block: redirect into the memory dir" 2 "echo x > $M/a.md"
mem_case "block: append into the memory dir" 2 "echo x >> $M/a.md"
mem_case "block: attached redirect target" 2 "echo x >$M/a.md"
mem_case "block: fd redirect" 2 "echo x 2>$M/a.md"
mem_case "block: tee into the memory dir" 2 "echo x | tee $M/a.md"
mem_case "block: cp into the memory dir" 2 "cp notes.md $M/"
mem_case "block: mv into the memory dir" 2 "mv notes.md $M/a.md"
mem_case "block: sed -i in the memory dir" 2 "sed -i 's/a/b/' $M/a.md"
mem_case "block: perl -pi in the memory dir" 2 "perl -pi -e 's/a/b/' $M/a.md"
mem_case "block: mkdir in the memory dir" 2 "mkdir -p $M/sub"
mem_case "block: touch in the memory dir" 2 "touch $M/a.md"
mem_case "block: \$HOME spelling" 2 'echo x > $HOME/.claude/projects/p/memory/a.md'
mem_case "block: \${HOME} spelling" 2 'echo x > ${HOME}/.claude/projects/p/memory/a.md'
mem_case "block: absolute spelling" 2 "echo x > $FAKE_HOME/.claude/projects/p/memory/a.md"
mem_case "block: inside sh -c" 2 "sh -c 'echo x > $M/a.md'"
mem_case "block: \$CLAUDE_CONFIG_DIR spelling" 2 'echo x > $CLAUDE_CONFIG_DIR/projects/p/memory/a.md' CLAUDE_CONFIG_DIR=/opt/cfg
mem_case "block: \${CLAUDE_CONFIG_DIR} spelling" 2 'tee ${CLAUDE_CONFIG_DIR}/projects/p/memory/a.md' CLAUDE_CONFIG_DIR=/opt/cfg
mem_case "block: literal CLAUDE_CONFIG_DIR path" 2 'cp a /opt/cfg/projects/p/memory/a.md' CLAUDE_CONFIG_DIR=/opt/cfg
mem_case "pass: write elsewhere under ~/.claude" 0 'echo x > ~/.claude/settings.local.json'
mem_case "pass: a plan under ~/.claude/projects" 0 'echo x > ~/.claude/projects/p/notes.md'
mem_case "pass: read of the memory dir" 0 "cat $M/a.md"
mem_case "pass: cp out of the memory dir" 0 "cp $M/a.md /tmp/a.md"
mem_case "pass: sed without -i" 0 "sed 's/a/b/' $M/a.md"
mem_case "pass: commit message naming the memory dir" 0 "git commit -m 'do not write > $M/a.md'"
mem_case "pass: heredoc body naming the memory dir" 0 "cat > notes.txt <<'EOF'
echo x > $M/a.md
EOF"
mem_case "pass: heredoc body, \$( in quotes (raw pass)" 0 "echo \"\$(date)\" > out.txt <<'EOF'
echo x > $M/a.md
EOF"

echo
echo "$pass passed, $fail failed"
[[ "$fail" == "0" ]]
