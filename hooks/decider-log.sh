#!/usr/bin/env bash
# SubagentStop and Stop: each finished ai-kit:decider call of the session is logged once to ai/usage/decisions/
# (scripts/decider.mjs sync reads its subagent transcript). Never blocks: any failure is one stderr line and exit 0.
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0
command -v node >/dev/null 2>&1 || exit 0
. "$(dirname "$0")/lib.sh"
input="$(cat)"
kit_root="$(kit_project_root "${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' <<<"$input")}")"
kit_enabled || exit 0

printf '%s' "$input" | CLAUDE_PROJECT_DIR="$kit_root" node "$kit_plugin/scripts/decider.mjs" sync || exit 0
