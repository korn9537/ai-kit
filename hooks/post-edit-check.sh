#!/usr/bin/env bash
# PostToolUse guard (Edit/Write/MultiEdit, Bash; PostToolUseFailure Bash): runs the fast pre-commit checks that cover
# the edited file, so a violation is fixed while the file is open instead of at commit. Project checks:
# ai/kit/post-edit.sh. A Bash call writes files the tool input does not name (sed -i, python3, a heredoc): the
# PreToolUse run `post-edit-check.sh mark` touches a marker, claude-review/bash-<tool_use_id> in the kit state dir, and
# the post run checks every changed, added or untracked file in `git status` that is newer than it (cap 20, none
# under ai/usage or .git). Not checked after a Bash call that: ran in the background (PostToolUse fires at launch,
# before it writes), or starts with a git command that rewrites the work tree (checkout, pull, reset ...: it touches
# many files, and pre-existing violations would be blamed on it). Gaps: a file written in the same filesystem
# timestamp tick as the marker is missed; another session's write during the call is checked too.
set -uo pipefail
kit_plugin="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v jq >/dev/null 2>&1 || exit 0
mode="${1:-post}"
input="$(cat)"
IFS=$'\t' read -r tool_name tool_use_id cwd background < <(jq -r '[.tool_name // "", .tool_use_id // "", .cwd // "", (.tool_input.run_in_background // false | tostring)] | @tsv' <<<"$input" 2>/dev/null || true)

max_files=20 total=0
files=()
bash_call=0
marker=""

if [[ "$tool_name" == "Bash" ]]; then
  bash_call=1
  [[ "$tool_use_id" =~ ^[A-Za-z0-9_-]+$ && -n "$cwd" && -d "$cwd" ]] || exit 0
  root="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)" || exit 0
  # a project without ai/kit/ is not set up: write nothing
  [[ -d "$root/ai/kit" ]] || exit 0
  # shellcheck source=/dev/null
  set +u && . "$kit_plugin/hooks/lib.sh" && set -u
  state="$(kit_state_dir review "$root")" || exit 0
  marker="$state/bash-$tool_use_id"
  if [[ "$mode" == "mark" ]]; then
    mkdir -p "$state" 2>/dev/null || exit 0
    # a marker whose post run never came (interrupted call) goes after a day
    find "$state" -maxdepth 1 -name 'bash-*' -mtime +1 -delete 2>/dev/null || true
    touch "$marker" 2>/dev/null || true
    exit 0
  fi
  [[ -f "$marker" ]] || exit 0
  command="$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null || true)"
  rewrites='(checkout|switch|stash|pull|merge|rebase|reset|restore|cherry-pick|revert)'
  if [[ "$background" == "true" ]] ||
    sed 's/&&/;/g; s/||/;/g; s/[|&(]/;/g' <<<"$command" | tr '\n' ';' | tr ';' '\n' |
    grep -Eq "^[[:space:]]*git([[:space:]]+(-[cC][[:space:]]+[^[:space:]]+|--[^[:space:]]+))*[[:space:]]+$rewrites([[:space:]]|\$)"; then
    rm -f "$marker"
    exit 0
  fi
  cd "$root" || exit 0
  command -v node >/dev/null 2>&1 || exit 0
  skip_next=0
  # -z: names with spaces or newlines stay whole; a rename lists its old name next, skipped
  while IFS= read -r -d '' ent; do
    st="${ent:0:2}" p="${ent:3}"
    if [[ "$skip_next" == 1 ]]; then skip_next=0; continue; fi
    [[ "$st" == R* || "$st" == C* ]] && skip_next=1
    [[ "$st" == *D* ]] && continue
    case "$p" in ai/usage/* | .git/*) continue ;; esac
    [[ -f "$p" && "$p" -nt "$marker" ]] || continue
    total=$((total + 1))
    ((total <= max_files)) && files+=("$p")
  done < <(git status --porcelain -uall -z 2>/dev/null)
  rm -f "$marker"
  ((${#files[@]})) || exit 0
else
  file="$(jq -r '.tool_input.file_path // empty' <<<"$input" 2>/dev/null || true)"
  [[ -n "$file" && -f "$file" ]] || exit 0
  # physical folder: --show-toplevel resolves symlinks (/tmp -> /private/tmp), so a symlinked spelling never matches
  file="$(cd "$(dirname "$file")" && pwd -P)/${file##*/}" || exit 0

  # the checkout that holds the file (a worktree runs its own copy of the checks)
  root="$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null)" || exit 0
  rel="${file#"$root"/}"
  [[ "$rel" != "$file" ]] || exit 0
  cd "$root" || exit 0
  # no node: the checks cannot run; the pre-commit blocks loudly then
  command -v node >/dev/null 2>&1 || exit 0
  # a checkout without ai/kit/ is not set up; the kit's checks need only node, a project's may need its packages
  [[ -d ai/kit ]] || exit 0
  files=("$rel")
fi

base_dir="$(mktemp -d)" || exit 0
trap 'rm -rf "$base_dir"' EXIT
res_dir="$base_dir"
pids=()
# run <label> <filter|-> <cmd...>: keeps output only on failure; a filter keeps lines naming this file + the next one.
# Called from this shell it runs in the background (the edit waits for the slowest check, not the sum); from a
# subshell (`( cd x && run ... )`, a pipe) in the foreground, since this shell cannot wait for that subshell's jobs.
run() {
  # start index in a file, not a variable: a subshell's increment must reach the next run too
  local i=0 to
  [[ -f "$res_dir/.n" ]] && i="$(<"$res_dir/.n")"
  printf '%s\n' "$((i + 1))" >"$res_dir/.n"
  to="$res_dir/$(printf '%04d' "$i")"
  if ((BASH_SUBSHELL)); then
    run_to "$to" "$@"
  else
    run_to "$to" "$@" &
    pids+=("$!")
  fi
}
run_to() {
  local to="$1" label="$2" filter="$3" res
  shift 3
  res="$("$@" 2>&1)" && return 0
  if [[ "$filter" != "-" ]]; then
    res="$(grep -F -A1 -- "$filter" <<<"$res" | grep -v '^--$' || true)"
    [[ -n "$res" ]] || return 0
  fi
  printf '\n[%s] (full output: %s)\n%s\n' "$label" "$(printf '%q ' "$@")" "$res" >"$to"
}

# check_file <n>: starts the checks for $rel, their results in the folder of file n
check_file() {
  # which checks cover the file (config include/skip, else the scripts' defaults): no node start for the rest
  local scope
  res_dir="$base_dir/$1"
  mkdir -p "$res_dir"
  scope="$({ cat ai/kit/config.json 2>/dev/null || echo '{}'; } | jq -r --arg f "$rel" '
    . as $c | def hit($k; $i; $s): ($f | test($c[$k].include // $i)) and ($f | test($c[$k].skip // $s) | not);
    [if hit("comments"; "\\.(tsx?|jsx?|mjs|cs)$"; "(/generated/|/node_modules/|\\.d\\.ts$|\\.Designer\\.cs$)") then "comments" else empty end,
     if hit("docs"; "^ai/.*\\.md$"; "(^|/)README\\.md$|/(mockups|design)/") then "docs" else empty end] | join(" ")' \
    2>/dev/null || echo "comments docs")"
  # the script skips files outside config comments.include
  [[ "$scope" == *comments* ]] && run "comments:check" - node "$kit_plugin/scripts/check-comments.mjs" --strict "$rel"
  # lines added since HEAD, files in config docs.include only
  [[ "$scope" == *docs* ]] && run "docs:check" - node "$kit_plugin/scripts/check-docs.mjs" --strict "$rel"
  # shellcheck source=/dev/null
  [[ -f ai/kit/post-edit.sh && (! -f package.json || -d node_modules) ]] && . ai/kit/post-edit.sh
  return 0
}

n=0
for rel in "${files[@]}"; do
  n=$((n + 1))
  check_file "$n"
done

# only the checks: a job post-edit.sh starts itself (a watcher) is not waited for
((${#pids[@]})) && wait "${pids[@]}"
# failures per file, in the order the checks were started (file names sort by start index)
report=""
n=0
for rel in "${files[@]}"; do
  n=$((n + 1))
  out=""
  for f in "$base_dir/$n"/0*; do [[ -s "$f" ]] && out+="$(<"$f")"$'\n'; done
  [[ -n "$out" ]] || continue
  if ((bash_call)); then
    report+="$(printf 'Checks failing on %s, changed during this Bash call (pre-commit will block these):%s' "$rel" "$out")"$'\n'
  else
    report+="$(printf 'Checks failing on %s (pre-commit will block these):%s' "$rel" "$out")"
  fi
done
[[ -n "$report" ]] || exit 0
((bash_call && total > max_files)) && report+="Only the first $max_files of $total changed files were checked."$'\n'
printf '%s' "$report" >&2
exit 2
