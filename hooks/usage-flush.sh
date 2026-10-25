#!/usr/bin/env bash
# SessionEnd: move this session's buffered token records into new files under ai/usage/ (scripts/usage.mjs flush).
# Never blocks: any failure is one stderr line and exit 0.
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0
command -v node >/dev/null 2>&1 || exit 0
. "$(dirname "$0")/lib.sh"
input="$(cat)"
kit_root="$(kit_project_root "${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' <<<"$input")}")"
kit_config="$kit_root/ai/kit/config.json"
kit_enabled || exit 0
[[ "$(kit_conf '.usage.enabled | tostring' true)" == false ]] && exit 0
session="$(jq -r '.session_id // empty' <<<"$input")"
[[ -n "$session" ]] || exit 0

CLAUDE_PROJECT_DIR="$kit_root" node "$kit_plugin/scripts/usage.mjs" flush --session "$session" || exit 0
