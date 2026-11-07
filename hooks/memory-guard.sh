#!/usr/bin/env bash
# PreToolUse guard (Write|Edit|MultiEdit|NotebookEdit): auto-memory lives on one machine, so the team never
# sees it; project knowledge goes to repo files (CLAUDE.core.md §Working conventions, Project knowledge).
# No Bash branch: `init` sets autoMemoryEnabled false (kit.mjs checks it), and a command-text match cannot be made
# reliable (cd, rsync, scripts) and was quadratic on a long UTF-8 heredoc under bash 3.2.
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0
. "$(dirname "$0")/lib.sh"
kit_enabled || exit 0

input="$(cat)"
tool="$(jq -r '.tool_name // empty' <<<"$input" 2>/dev/null || true)"
# the config dir as lib.sh kit_memory_dir has it: ~/.claude, or CLAUDE_CONFIG_DIR
cfg='\.claude'
re_lit() { printf '%s' "$1" | sed 's/[][\.*^$+?(){}|]/\\&/g'; }
if [[ -n "${CLAUDE_CONFIG_DIR:-}" ]]; then
  c="$(kit_path "$CLAUDE_CONFIG_DIR")" && c="${c%/}"
  cfg="(\\.claude|$(re_lit "$c")"
  # Git Bash commands may spell C:/x as /c/x
  [[ "$c" =~ ^([A-Za-z]):(/.*)$ ]] && cfg+="|$(re_lit "/$(printf '%s' "${BASH_REMATCH[1]}" | tr A-Z a-z)${BASH_REMATCH[2]}")"
  cfg+=")"
fi
mem="$cfg"'/projects/[^/[:space:]]+/memory(/|$)'

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

cat >&2 <<EOF
Blocked: auto-memory (~/.claude/projects/*/memory/) is on this machine only; the team never sees it. Write the fact
to its repo target, same commit as the work (working conventions, Project knowledge): CLAUDE.md,
ai/kit/review-checklist.md, the decisions source, ai/notes.md, or a kit proposal.
EOF
exit 2
