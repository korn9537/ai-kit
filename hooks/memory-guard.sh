#!/usr/bin/env bash
# PreToolUse guard (Write|Edit|MultiEdit|NotebookEdit|Bash): auto-memory lives on one machine, so the team never
# sees it; project knowledge goes to repo files (CLAUDE.core.md §Working conventions, Project knowledge).
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0
. "$(dirname "$0")/lib.sh"
kit_enabled || exit 0

input="$(cat)"
tool="$(jq -r '.tool_name // empty' <<<"$input" 2>/dev/null || true)"
# the config dir as lib.sh kit_memory_dir has it: ~/.claude, or CLAUDE_CONFIG_DIR
cfg='\.claude'
[[ -n "${CLAUDE_CONFIG_DIR:-}" ]] && cfg="(\\.claude|$(printf '%s' "${CLAUDE_CONFIG_DIR%/}" | sed 's/[][\.*^$+?(){}|]/\\&/g'))"
mem="$cfg"'/projects/[^/[:space:]]+/memory(/|$)'

hit=0
case "$tool" in
  Write | Edit | MultiEdit | NotebookEdit)
    p="$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<<"$input" 2>/dev/null || true)"
    [[ "$p" =~ $mem ]] && hit=1
    ;;
  Bash)
    cmd="$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null || true)"
    [[ "$cmd" == */projects/*/memory* ]] || exit 0
    # writes only: a redirect into the dir, or tee/sed -i/cp/mv/install/ln on it in command position; read and rm
    # stay allowed. Not caught: perl -pi, touch, scripts, a quoted | before the path, a write after do/then/xargs/
    # find -exec (Write/Edit are the usual route).
    nl=$'\n'
    mem="$cfg"'/projects/[^/[:space:]]+/memory([/[:space:]"'\'';&|]|$)'
    path="$cfg"'/projects/[^/[:space:]]+/memory(/[^[:space:];&|]*)?'
    cmdpos='(^|[;&|(`'"$nl"'])[[:space:]]*(sudo[[:space:]]+)?'
    arg="[^;&|$nl]*"
    w='>>?[[:space:]]*["'\'']?[^[:space:]]*'"$mem"
    t="$cmdpos"'tee[[:space:]]'"$arg$mem"
    s="$cmdpos"'sed([[:space:]]+-[^[:space:]]+)*[[:space:]]+-([A-Za-z]*i|-in-place)'"$arg$mem"
    c="$cmdpos"'(cp|mv|install|ln)[[:space:]]'"$arg"'('"$path"'["'\'']?([[:space:]]+[0-9]*>'"$arg"')?[[:space:]]*($|[;&|'"$nl"'])|-t[[:space:]]*["'\'']?[^[:space:]]*'"$mem"')'
    if [[ "$cmd" =~ $w || "$cmd" =~ $t || "$cmd" =~ $s || "$cmd" =~ $c ]]; then hit=1; fi
    ;;
esac
((hit)) || exit 0

cat >&2 <<EOF
Blocked: auto-memory (~/.claude/projects/*/memory/) is on this machine only; the team never sees it. Write the fact
to its repo target, same commit as the work (working conventions, Project knowledge): CLAUDE.md,
ai/kit/review-checklist.md, the decisions source, ai/notes.md, or a kit proposal.
EOF
exit 2
