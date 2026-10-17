#!/usr/bin/env bash
# PostToolUse guard (Edit/Write/MultiEdit): runs the fast pre-commit checks that cover the edited file, so a
# violation is fixed while the file is open instead of at commit. Project checks: ai/kit/post-edit.sh.
set -uo pipefail
kit_plugin="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v jq >/dev/null 2>&1 || exit 0
input="$(cat)"
file="$(jq -r '.tool_input.file_path // empty' <<<"$input" 2>/dev/null || true)"
[[ -n "$file" && -f "$file" ]] || exit 0

# the checkout that holds the file (a worktree runs its own copy of the checks)
root="$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null)" || exit 0
rel="${file#"$root"/}"
[[ "$rel" != "$file" ]] || exit 0
cd "$root" || exit 0
# a checkout without ai/kit/, or a Node project without installed packages, cannot run the checks
[[ -d ai/kit ]] || exit 0
[[ ! -f package.json || -d node_modules ]] || exit 0

out=""
# run <label> <filter|-> <cmd...>: keep output only on failure; a filter keeps lines naming this file + the next one
run() {
  local label="$1" filter="$2"
  shift 2
  local res
  res="$("$@" 2>&1)" && return 0
  if [[ "$filter" != "-" ]]; then
    res="$(grep -F -A1 -- "$filter" <<<"$res" | grep -v '^--$' || true)"
    [[ -n "$res" ]] || return 0
  fi
  out+=$'\n'"[$label] (full output: $(printf '%q ' "$@"))"$'\n'"$res"$'\n'
}

# the script skips files outside config comments.include
run "comments:check" - node "$kit_plugin/scripts/check-comments.mjs" --strict "$rel"
# lines added since HEAD, files in config docs.include only
run "docs:check" - node "$kit_plugin/scripts/check-docs.mjs" --strict "$rel"
# shellcheck source=/dev/null
[[ -f ai/kit/post-edit.sh ]] && . ai/kit/post-edit.sh

[[ -n "$out" ]] || exit 0
printf 'Checks failing on %s (pre-commit will block these):%s' "$rel" "$out" >&2
exit 2
