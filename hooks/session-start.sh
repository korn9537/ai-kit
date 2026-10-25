#!/usr/bin/env bash
# SessionStart: records the plugin path for the git pre-commit shim (<git-common-dir>/ai-kit-root) and injects
# CLAUDE.core.md with its ai-kit/ paths made absolute (plain text without jq), and flushes other sessions' token
# buffers idle for 6 hours into ai/usage/. Silent without ai/kit/.
set -euo pipefail

. "$(dirname "$0")/lib.sh"
kit_enabled || exit 0

common="$(git -C "$kit_root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [[ -n "$common" && -d "$common" ]]; then printf '%s\n' "$kit_plugin" >"$common/ai-kit-root" || true; fi

# a session that ended without SessionEnd (crash, kill) left its buffer behind; never blocks, never prints
sid=""
if [[ ! -t 0 ]] && command -v jq >/dev/null 2>&1; then
  # each read waits 1 s at most (stdin left open by the caller), so the session id costs at most that
  input="" line="" rc=0
  while IFS= read -r -t 1 line; do input+="$line"$'\n'; done || rc=$?
  if ((rc < 128)); then input+="$line"; fi
  sid="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)"
fi
if command -v node >/dev/null 2>&1; then
  CLAUDE_PROJECT_DIR="$kit_root" node "$kit_plugin/scripts/usage.mjs" flush --idle ${sid:+--except "$sid"} >/dev/null 2>&1 || true
fi

rep="$kit_plugin/"
# sed, not ${core//…}: bash 3.2 (macOS) replaces in a UTF-8 string in quadratic time, 2 s for this file
core="$(sed "s|ai-kit/|$(printf '%s' "$rep" | sed 's/[|&\\]/\\&/g')|g" "$kit_plugin/CLAUDE.core.md")"
if [[ -s "$kit_root/ai/kit/kit-proposals.md" ]]; then
  core+=$'\n\n'"Unfiled kit proposals in ai/kit/kit-proposals.md: file them per ${rep}docs/kit-proposals.md §Filing, then remove each filed entry (delete the file when empty)."
fi
mem="$(kit_memory_dir)"
# MEMORY.md counts only when it holds more than index links (kit.mjs memoryFiles)
if [[ -n "$(find "$mem" -maxdepth 1 -name '*.md' ! -name MEMORY.md -print -quit 2>/dev/null)" ]] ||
  grep -qvE '^[[:space:]]*(#.*|[-*][[:space:]]+\[[^]]*\]\([^)]*\).*)?$' "$mem/MEMORY.md" 2>/dev/null; then
  core+=$'\n\n'"Local auto-memory files in $mem: run /ai-kit:memory-export to move them into the repo."
fi
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' "$core"
  exit 0
fi
jq -n --arg c "$core" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $c}}'
