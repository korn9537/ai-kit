#!/usr/bin/env bash
# SessionStart: records the plugin path for the git pre-commit shim (<git-common-dir>/ai-kit-root) and injects
# CLAUDE.core.md with its ai-kit/ paths made absolute. Silent in a project without ai/kit/.
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0
. "$(dirname "$0")/lib.sh"
kit_enabled || exit 0

common="$(git -C "$kit_root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
[[ -n "$common" && -d "$common" ]] && printf '%s\n' "$kit_plugin" >"$common/ai-kit-root"

core="$(cat "$kit_plugin/CLAUDE.core.md")"
core="${core//ai-kit\//$kit_plugin/}"
jq -n --arg c "$core" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $c}}'
