#!/usr/bin/env bash
# SessionStart: records the plugin path for the git pre-commit shim (<git-common-dir>/ai-kit-root) and injects
# CLAUDE.core.md with its ai-kit/ paths made absolute (plain text without jq). Silent without ai/kit/.
set -euo pipefail

. "$(dirname "$0")/lib.sh"
kit_enabled || exit 0

common="$(git -C "$kit_root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [[ -n "$common" && -d "$common" ]]; then printf '%s\n' "$kit_plugin" >"$common/ai-kit-root" || true; fi

rep="$kit_plugin/"
core="$(cat "$kit_plugin/CLAUDE.core.md")"
core=${core//ai-kit\//"$rep"}
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' "$core"
  exit 0
fi
jq -n --arg c "$core" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $c}}'
