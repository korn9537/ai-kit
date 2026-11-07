#!/usr/bin/env bash
# PreToolUse guard (Bash), two checks on the commands kit_split_cmd (lib.sh) cuts out of one command line:
# 1. a sweeping stage (`git add -A/-u/./<dir>/<glob>`, `git commit -a/./<dir>`): the checkout and index are shared
#    with other sessions, so it commits their work too (docs/shared-checkout.md in this plugin).
# 2. a build command (config build_guard.build_re, else a built-in list) while the dev port (build_guard.port)
#    listens: a build writes to the directory the dev server serves.
# Build escape hatch: prefix the command with ALLOW_BUILD_WHILE_DEV=1 when the port is unrelated.
# Fail closed: when the scan cannot follow the text (it ends inside a quote or heredoc, or a double quote holds $( ),
# the raw text, cut on ; && || | & ( ) backtick and newline with the quotes blanked, is checked as well, so a
# heredoc body or message naming `git add -A` there can block. The usual -m "$(cat <<'EOF' ...)" is followed, not raw.
# Known gaps (the text is not run, so these stay unseen): `xargs git add`, `bash -c "git add -A"`, `git add $(...)`,
# a heredoc fed to a shell (`bash <<E`), an attached -S key id ending in a value flag (`git commit -Sfoot -a`).
set -o pipefail

command -v jq >/dev/null 2>&1 || exit 0
. "$(dirname "$0")/lib.sh"
kit_enabled || exit 0

input="$(cat)"
[[ "$(jq -r '.tool_name // empty' <<<"$input" 2>/dev/null || true)" == "Bash" ]] || exit 0
cmd="$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null || true)"
[[ -n "$cmd" ]] || exit 0
cwd="$(jq -r '.cwd // empty' <<<"$input" 2>/dev/null || true)"
cd "${cwd:-${CLAUDE_PROJECT_DIR:-.}}" 2>/dev/null || true
cwd0="$PWD"

# the words of the segment being checked: t[0..n-1], i the one under the cursor
t=()
n=0
i=0

# strip_lead: i moves past env assignments, compound-command keywords and wrappers (time, env, sudo, nice, timeout)
strip_lead() {
  local w vals
  while ((i < n)); do
    w="${t[i]}"
    if [[ "$w" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      ((++i))
      continue
    fi
    case "$w" in
      then | do | else | if | elif | while | until | '!' | '{' | '}' | exec | nohup | builtin) ((++i)) ;;
      command)
        # command -p git runs git; command -v git only looks it up
        ((++i))
        while ((i < n)) && [[ "${t[i]}" == -p ]]; do ((++i)); done
        if ((i < n)) && [[ "${t[i]}" == -v || "${t[i]}" == -V ]]; then
          i=n
          return
        fi
        ;;
      time | env | sudo | nice | timeout)
        case "$w" in
          env) vals=" -u -C -S " ;;
          sudo) vals=" -u -g " ;;
          nice) vals=" -n " ;;
          timeout) vals=" -s -k " ;;
          *) vals=" " ;;
        esac
        ((++i))
        while ((i < n)) && [[ "${t[i]}" == -* ]]; do
          [[ "$vals" == *" ${t[i]} "* ]] && ((++i))
          ((++i))
        done
        if [[ "$w" == timeout && "${t[i]:-}" =~ ^[0-9.]+[smhd]?$ ]]; then ((++i)); fi
        ;;
      *) return ;;
    esac
  done
}

# resolve <dir> <base>: base/dir, or dir when absolute, in REPLY
resolve() {
  if [[ "$1" == /* || "$1" =~ ^[A-Za-z]:/ ]]; then REPLY="$1"; else REPLY="$2/$1"; fi
}

# dir_sweeps <path> <base dir>: an existing directory that git add would walk: not a submodule (a .git inside, or a
# lone gitlink, mode 160000, in the index: add stages the pointer). The top of base's own repo holds a .git too, and
# adding that is a sweep
dir_sweeps() {
  local m top
  [[ -d "$1" ]] || return 1
  if [[ -e "$1/.git" ]]; then
    top="$(git -C "$2" rev-parse --show-toplevel 2>/dev/null || git -C "$cwd0" rev-parse --show-toplevel 2>/dev/null || true)"
    [[ -z "$top" || "$1" -ef "$top" ]]
    return
  fi
  m="$(git -C "${1%/*}" ls-files -s -- "${1##*/}" 2>/dev/null || true)"
  [[ "$m" == 160000* && "$m" != *$'\n'* ]] && return 1
  return 0
}

# path_sweeps <pathspec> <base dir>: more than a file by name: ., a directory, a trailing slash, a glob. A relative
# path is tried under the base and under the starting cwd: a cd or -C that failed, or a ~ the scan cannot follow,
# must not hide a directory of the project
path_sweeps() {
  case "$1" in
    . | ./ | :/ | */ | *\** | "") return 0 ;;
  esac
  if [[ "$1" == /* ]]; then
    dir_sweeps "$1" "$2"
    return
  fi
  dir_sweeps "$2/$1" "$2" && return 0
  [[ "$2" != "$cwd0" ]] && dir_sweeps "$cwd0/$1" "$cwd0"
}

# git_sweeps <dir>: t[i] is git; 0 when the command stages or commits more than named files
git_sweeps() {
  local base="$1" sub="" arg pre sweep=0 dry=0 dd=0
  ((++i))
  while ((i < n)); do
    case "${t[i]}" in
      -C | --work-tree)
        resolve "${t[i + 1]:-.}" "$base"
        base="$REPLY"
        ((i += 2))
        ;;
      -c | --git-dir | --namespace | --super-prefix | --config-env | --exec-path) ((i += 2)) ;;
      -*) ((++i)) ;;
      *) break ;;
    esac
  done
  sub="${t[i]:-}"
  case "$sub" in add | stage | commit) ;; *) return 1 ;; esac
  ((++i))
  for ((; i < n; i++)); do
    arg="${t[i]}"
    if [[ "$sub" == "commit" ]]; then
      if ((dd == 0)); then
        case "$arg" in
          --) dd=1; continue ;;
          -a | --all) return 0 ;;
          -m | -F | -C | -c | -t | --message | --file | --reuse-message | --reedit-message | --author | --date | --template | --cleanup | --trailer | --fixup | --squash | --pathspec-from-file)
            ((++i))
            continue
            ;;
          --*) continue ;;
          -[!-]*)
            [[ "${arg%%[mFCct]*}" == *a* ]] && return 0
            # the value is the next word only when the flag ends the cluster: -mfoot holds its own
            pre="${arg%%[mFCct]*}"
            ((${#pre} + 1 == ${#arg})) && ((++i))
            continue
            ;;
        esac
      fi
      path_sweeps "$arg" "$base" && return 0
    else
      if ((dd == 0)); then
        case "$arg" in
          --) dd=1; continue ;;
          -n | --dry-run) dry=1; continue ;;
          -A | --all | -u | --update | --no-ignore-removal) sweep=1; continue ;;
          --*) continue ;;
          -*)
            [[ "$arg" == *[Au]* ]] && sweep=1
            [[ "$arg" == *n* ]] && dry=1
            continue
            ;;
        esac
      fi
      path_sweeps "$arg" "$base" && sweep=1
    fi
  done
  ((sweep && !dry))
}

# build_words: 0 when the words from t[i] are a build: a package manager running a build script, or a build tool
build_words() {
  local w r="${t[i]##*/}" vals=" --prefix --cwd --workspace --filter --dir -C -w -F -p --package --registry --config "
  ((++i))
  case "$r" in
    npm | pnpm | yarn | bun | npx | pnpx | bunx) ;;
    turbo | next | vite | nuxt | nuxi | astro | nx | remix | ng | webpack | rspack | gatsby | svelte-kit) ;;
    *) return 1 ;;
  esac
  while ((i < n)); do
    w="${t[i]}"
    case "$w" in
      -*)
        [[ "$w" != *=* && "$vals" == *" $w "* ]] && ((++i))
        ((++i))
        continue
        ;;
      r)
        # npm r is uninstall; elsewhere r runs a script
        [[ "$r" == npm ]] && return 1
        ((++i))
        continue
        ;;
      run | run-script | workspace | workspaces | foreach | exec | dlx | x)
        # `yarn workspace <name> <script>`: the name is a word, not a script
        [[ "$w" == workspace ]] && ((++i))
        ((++i))
        if [[ "$w" == exec || "$w" == dlx || "$w" == x ]]; then
          while ((i < n)) && [[ "${t[i]}" == -* ]]; do ((++i)); done
          ((i < n)) || return 1
          build_words
          return
        fi
        continue
        ;;
      build | build:*) return 0 ;;
      *)
        # a tool run through the manager: pnpm turbo build, npx next build
        build_words
        return
        ;;
    esac
  done
  return 1
}

build_re="$(kit_conf .build_guard.build_re "")"
build=0

# scan <split|raw>: check the lines on stdin; split = kit_split_cmd output, raw = the command cut without quote handling
scan() {
  local seg j rest idx
  wd="$cwd0"
  wd_stack=()
  while IFS= read -r seg; do
    if [[ "$seg" == $'\006'* ]]; then
      case "${seg#?}" in
        "(") wd_stack+=("$wd") ;;
        ")")
          if ((${#wd_stack[@]})); then
            idx=$((${#wd_stack[@]} - 1))
            wd="${wd_stack[idx]}"
            unset "wd_stack[idx]"
          fi
          ;;
      esac
      continue
    fi
    t=()
    if [[ "$1" == split ]]; then IFS=$'\037' read -r -a t <<<"$seg"; else read -r -a t <<<"$seg"; fi
    n=${#t[@]}
    i=0
    strip_lead
    ((i < n)) || continue
    case "${t[i]##*/}" in
      cd)
        for ((j = i + 1; j < n; j++)); do
          [[ "${t[j]}" == -* ]] && continue
          if [[ "${t[j]}" != "~"* && "${t[j]}" != *'$'* && "${t[j]}" != - ]]; then
            resolve "${t[j]}" "$wd"
            [[ -d "$REPLY" ]] && wd="$REPLY"
          fi
          break
        done
        ;;
      git)
        if git_sweeps "$wd"; then
          cat >&2 <<EOF
Blocked: a sweeping stage (git add -A/-u/./a directory/a glob, git commit -a or with such a path). Other sessions
share this working tree and index, so it would commit their work. Stage your files by name, read
\`git diff --cached --stat\`, then commit ($(kit_conf .shared_checkout_doc "$kit_plugin/docs/shared-checkout.md")).
EOF
          exit 2
        fi
        ;;
      *)
        if [[ -n "$build_re" ]]; then
          rest="${t[*]:i}"
          # grep, not =~: bash on macOS reads \s \b \d in a config pattern as plain letters
          grep -qE -- "$build_re" <<<"$rest" && build=1
        else
          build_words && build=1
        fi
        ;;
    esac
  done
}

# the splitter ends with a \006ok or \006raw line; without one awk failed, and the raw text is checked instead
split_out="$(printf '%s\n' "$cmd" | kit_split_cmd)"
raw=0
case "$split_out" in
  *$'\006ok') ;;
  *$'\006raw') raw=1 ;;
  *)
    raw=1
    jq -n '{systemMessage: "bash-guard: the command splitter failed, so the raw text of the command was checked"}'
    ;;
esac
scan split <<<"$split_out"
if ((raw)); then
  # ; & | ( ) and backtick start a new line, both quote characters become spaces
  scan raw <<<"$(printf '%s\n' "$cmd" | LC_ALL=C tr $';&|()`"\'' $'\n\n\n\n\n\n  ')"
fi

[[ "$build" == "1" ]] || exit 0
[[ "$cmd" == *"ALLOW_BUILD_WHILE_DEV=1"* ]] && exit 0

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
  jq -n --arg m "bash-guard: no lsof, ss, netstat or nc, so :$port was not checked" '{systemMessage: $m}'
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
