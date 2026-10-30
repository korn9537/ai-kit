#!/usr/bin/env bash
# PreToolUse guard (Bash): the checkout and index are shared with other sessions, so a sweeping stage
# (`git add -A/-u/./<dir>/<glob>`, `git commit -a`) commits their work too (docs/shared-checkout.md in this plugin).
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0
. "$(dirname "$0")/lib.sh"
kit_enabled || exit 0

input="$(cat)"
[[ "$(jq -r '.tool_name // empty' <<<"$input" 2>/dev/null || true)" == "Bash" ]] || exit 0
cmd="$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null || true)"
[[ -n "$cmd" ]] || exit 0
[[ "$cmd" == *git* ]] || exit 0
cwd="$(jq -r '.cwd // empty' <<<"$input" 2>/dev/null || true)"
cd "${cwd:-${CLAUDE_PROJECT_DIR:-.}}" 2>/dev/null || true

# a subshell or group opener, a compound-command keyword or a wrapper in front of git leaves git the command
lead_re='^[[:space:]]*([({!]|(then|do|else|if|elif|while|until|time|env|command|sudo|exec|nohup)[[:space:]]|-[A-Za-z-]+[[:space:]])(.*)$'

sweeping() {
  local s="$1" prev=""
  while [[ "$s" != "$prev" ]]; do
    prev="$s"
    [[ "$s" =~ $lead_re ]] && s="${BASH_REMATCH[3]}"
  done
  set -- "$s"
  [[ "$1" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*git([[:space:]]|$) ]] || return 1
  local -a t=()
  local tok toks
  # xargs splits honouring quotes without running anything; an unbalanced quote falls back to whitespace.
  if toks="$(xargs printf '%s\n' <<<"$1" 2>/dev/null)"; then
    while IFS= read -r tok; do t+=("$tok"); done <<<"$toks"
  else
    read -r -a t <<<"$1"
  fi
  local i=0 n=${#t[@]}
  while ((i < n)) && [[ "${t[i]}" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; do ((i++)); done
  ((i < n)) && [[ "${t[i]}" == "git" ]] || return 1
  ((i++))
  while ((i < n)); do
    case "${t[i]}" in
      -C | -c) ((i += 2)) ;;
      -*) ((i++)) ;;
      *) break ;;
    esac
  done
  local sub="${t[i]:-}"
  ((i++))
  local seen_dd=0 arg
  for ((; i < n; i++)); do
    # the closer of a subshell or group: `(cd lib && git add .)`
    arg="${t[i]%%[)\}]*}"
    [[ -n "$arg" ]] || continue
    if [[ "$sub" == "add" ]]; then
      if ((seen_dd == 0)); then
        case "$arg" in
          --) seen_dd=1; continue ;;
          -A | --all | -u | --update | --no-ignore-removal) return 0 ;;
          --*) continue ;;
          -*[Au]*) return 0 ;;
          -*) continue ;;
        esac
      fi
      arg="${arg%\"}"; arg="${arg#\"}"; arg="${arg%\'}"; arg="${arg#\'}"
      [[ "$arg" == "." || "$arg" == ./ || "$arg" == :/ || "$arg" == */ || "$arg" == *\** ]] && return 0
      [[ -d "$arg" ]] && return 0
    elif [[ "$sub" == "commit" ]]; then
      case "$arg" in
        --) return 1 ;;
        -a | --all) return 0 ;;
        -m | -F | -C | -c | --message | --file | --reuse-message | --reedit-message | --author | --date) ((i++)) ;;
        --*) ;;
        -[!-]*)
          [[ "${arg%%[mFCc]*}" == *a* ]] && return 0
          [[ "${arg: -1}" =~ [mFCc] ]] && ((i++))
          ;;
      esac
    else
      return 1
    fi
  done
  return 1
}

while IFS= read -r segment; do
  if sweeping "$segment"; then
    cat >&2 <<EOF
Blocked: a sweeping stage (git add -A/-u/./a directory/a glob, git commit -a). Other sessions share this working
tree and index, so it would commit their work. Stage your files by name, read \`git diff --cached --stat\`, then
commit ($(kit_conf .shared_checkout_doc "$kit_plugin/docs/shared-checkout.md")).
EOF
    exit 2
  fi
done < <(printf '%s\n' "$cmd" | tr ';|' '\n' | sed -E 's/&&/\n/g')
exit 0
