#!/usr/bin/env bash
# PostToolUse guard (Edit/Write/MultiEdit): runs the fast pre-commit checks that cover the edited file, so a
# violation is fixed while the file is open instead of at commit. Project checks: ai/kit/post-edit.sh.
set -uo pipefail
kit_plugin="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v jq >/dev/null 2>&1 || exit 0
input="$(cat)"
file="$(jq -r '.tool_input.file_path // empty' <<<"$input" 2>/dev/null || true)"
[[ -n "$file" && -f "$file" ]] || exit 0
# physical folder: --show-toplevel resolves symlinks (/tmp -> /private/tmp), so a symlinked spelling never matches
file="$(cd "$(dirname "$file")" && pwd -P)/${file##*/}" || exit 0

# the checkout that holds the file (a worktree runs its own copy of the checks)
root="$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null)" || exit 0
rel="${file#"$root"/}"
[[ "$rel" != "$file" ]] || exit 0
cd "$root" || exit 0
# a checkout without ai/kit/, or a Node project without installed packages, cannot run the checks
[[ -d ai/kit ]] || exit 0
[[ ! -f package.json || -d node_modules ]] || exit 0

# which checks cover the file (config include/skip, else the scripts' defaults): no node start for the rest
scope="$({ cat ai/kit/config.json 2>/dev/null || echo '{}'; } | jq -r --arg f "$rel" '
  . as $c | def hit($k; $i; $s): ($f | test($c[$k].include // $i)) and ($f | test($c[$k].skip // $s) | not);
  [if hit("comments"; "\\.(tsx?|jsx?|mjs|cs)$"; "(/generated/|/node_modules/|\\.d\\.ts$|\\.Designer\\.cs$)") then "comments" else empty end,
   if hit("docs"; "^ai/.*\\.md$"; "(^|/)README\\.md$|/(mockups|design)/") then "docs" else empty end] | join(" ")' \
  2>/dev/null || echo "comments docs")"

res_dir="$(mktemp -d)" || exit 0
trap 'rm -rf "$res_dir"' EXIT
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

# the script skips files outside config comments.include
[[ "$scope" == *comments* ]] && run "comments:check" - node "$kit_plugin/scripts/check-comments.mjs" --strict "$rel"
# lines added since HEAD, files in config docs.include only
[[ "$scope" == *docs* ]] && run "docs:check" - node "$kit_plugin/scripts/check-docs.mjs" --strict "$rel"
# shellcheck source=/dev/null
[[ -f ai/kit/post-edit.sh ]] && . ai/kit/post-edit.sh

# only the checks: a job post-edit.sh starts itself (a watcher) is not waited for
((${#pids[@]})) && wait "${pids[@]}"
# failures in the order the checks were started (file names sort by start index)
out=""
for f in "$res_dir"/*; do [[ -s "$f" ]] && out+="$(<"$f")"$'\n'; done
[[ -n "$out" ]] || exit 0
printf 'Checks failing on %s (pre-commit will block these):%s' "$rel" "$out" >&2
exit 2
