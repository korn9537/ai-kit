#!/usr/bin/env bash
# Usage: kit-log.sh stop | session-end | subagent-stop. stop (Stop): buffer this round's token usage in the git common
# dir and show a one-line summary (systemMessage). session-end (SessionEnd): record what came after the last Stop, then
# flush this session's buffer to ai/usage/ (usage.mjs end). subagent-stop (SubagentStop, Stop): log each finished
# ai-kit:decider call once to ai/usage/decisions/ (decider.mjs sync). Silent without ai/kit/; never blocks: a failure is
# one stderr line and exit 0.
set -euo pipefail

mode="${1:-}"
case "$mode" in stop | session-end | subagent-stop) ;; *) exit 0 ;; esac
command -v jq >/dev/null 2>&1 || exit 0
command -v node >/dev/null 2>&1 || exit 0
. "$(dirname "$0")/lib.sh"
input="$(cat)"
# the hook's cwd, not ours, locates the project when CLAUDE_PROJECT_DIR is unset
kit_root="$(kit_project_root "${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' <<<"$input")}")"
kit_config="$kit_root/ai/kit/config.json"
kit_enabled || exit 0

if [[ "$mode" != subagent-stop ]]; then
  # kit_conf reads false as empty, so test the stringified value
  [[ "$(kit_conf '.usage.enabled | tostring' true)" == false ]] && exit 0
fi
case "$mode" in
  stop) printf '%s' "$input" | node "$kit_plugin/scripts/usage.mjs" record || exit 0 ;;
  session-end)
    [[ -n "$(jq -r '.session_id // empty' <<<"$input")" ]] || exit 0
    printf '%s' "$input" | CLAUDE_PROJECT_DIR="$kit_root" node "$kit_plugin/scripts/usage.mjs" end || exit 0 ;;
  subagent-stop) printf '%s' "$input" | CLAUDE_PROJECT_DIR="$kit_root" node "$kit_plugin/scripts/decider.mjs" sync || exit 0 ;;
esac
