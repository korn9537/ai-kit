#!/usr/bin/env bash
# PostToolUse (Agent|Task|SendMessage): when the main session calls a review, record the work tree (untracked files
# too) as a git tree so review-before-stop.sh can tell whether only comments changed since. `--tree <dir>` only
# prints the current tree — the Stop hook builds its side the same way. Never touches the index or work tree.
set -euo pipefail

work_tree() {  # $1 = repo dir → tree id of every non-ignored file as it is on disk
  local gitdir tmp_index tree
  gitdir="$(git -C "$1" rev-parse --absolute-git-dir)"
  tmp_index="$(mktemp)"
  cp "$gitdir/index" "$tmp_index" 2>/dev/null || true
  tree="$(cd "$1" && GIT_INDEX_FILE="$tmp_index" git add -A . >/dev/null 2>&1 \
    && GIT_INDEX_FILE="$tmp_index" git write-tree)" || { rm -f "$tmp_index"; return 1; }
  rm -f "$tmp_index"
  printf '%s\n' "$tree"
}

if [[ "${1:-}" == "--tree" ]]; then
  work_tree "$2"
  exit
fi

command -v jq >/dev/null 2>&1 || exit 0
. "$(dirname "$0")/lib.sh"
kit_enabled || exit 0
input="$(cat)"
# A subagent's own calls are not the main session's review.
[[ -n "$(jq -r '.agent_id // empty' <<<"$input" 2>/dev/null || true)" ]] && exit 0
what="$(jq -r '[.tool_input.description, .tool_input.subagent_type, .tool_input.summary] | map(. // "") | join(" ")' \
  <<<"$input" 2>/dev/null || true)"
grep -qi review <<<"$what" || exit 0

session="$(jq -r '.session_id // empty' <<<"$input")"
project="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' <<<"$input")}"
[[ -n "$session" && -n "$project" ]] || exit 0

gitdir="$(git -C "$project" rev-parse --absolute-git-dir 2>/dev/null)" || exit 0
tree="$(work_tree "$project" 2>/dev/null)" || exit 0
mkdir -p "$gitdir/claude-review"
printf '%s\n' "$tree" >"$gitdir/claude-review/$session"
