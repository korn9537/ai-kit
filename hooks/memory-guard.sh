#!/usr/bin/env bash
# PreToolUse guard (Write|Edit|MultiEdit|NotebookEdit): auto-memory lives on one machine, so the team never
# sees it; project knowledge goes to repo files (CLAUDE.core.md §Working conventions, Project knowledge).
# Bash writes into that dir are blocked by bash-guard.sh (on the split, unquoted words, not a text match: that was
# quadratic on a long UTF-8 heredoc under bash 3.2); `init` also sets autoMemoryEnabled false (kit.mjs checks it).
# The regex and message are lib.sh kit_memory_re and kit_memory_msg.
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0
. "$(dirname "$0")/lib.sh"
kit_enabled || exit 0

input="$(cat)"
tool="$(jq -r '.tool_name // empty' <<<"$input" 2>/dev/null || true)"
mem="$(kit_memory_re)"

hit=0
case "$tool" in
  Write | Edit | MultiEdit | NotebookEdit)
    p="$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<<"$input" 2>/dev/null || true)"
    # Windows: C:\Users\x\.claude\projects\... as /
    p="$(kit_path "$p")"
    [[ "$p" =~ $mem ]] && hit=1
    ;;
esac
((hit)) || exit 0

kit_memory_msg >&2
exit 2
