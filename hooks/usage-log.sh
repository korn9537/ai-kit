#!/usr/bin/env bash
# Stop: append this round's token usage to ai/usage/ and show a one-line summary to the user only (systemMessage).
# Never blocks: any failure is one stderr line and exit 0.
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0
command -v node >/dev/null 2>&1 || exit 0
. "$(dirname "$0")/lib.sh"
input="$(cat)"
# the hook's cwd, not ours, locates the project when CLAUDE_PROJECT_DIR is unset
kit_root="$(kit_project_root "${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' <<<"$input")}")"
kit_config="$kit_root/ai/kit/config.json"
kit_enabled || exit 0
# kit_conf reads false as empty, so test the stringified value
[[ "$(kit_conf '.usage.enabled | tostring' true)" == false ]] && exit 0

printf '%s' "$input" | node "$kit_plugin/scripts/usage.mjs" record || exit 0
