#!/usr/bin/env bash
# Sourced by the kit hooks: kit_conf <jq path> <default> reads the project's ai/kit/config.json (needs jq).
# kit_enabled fails in a project without ai/kit/: the plugin may be on at user scope, so hooks then exit 0.
kit_toplevel() { git -C "$1" rev-parse --show-toplevel 2>/dev/null || printf '%s\n' "$1"; }
# a session started in a subdirectory (repo/api) still uses the repo root
kit_root="$(kit_toplevel "${CLAUDE_PROJECT_DIR:-$PWD}")"
kit_config="$kit_root/ai/kit/config.json"
kit_plugin="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

kit_enabled() { [[ -d "$kit_root/ai/kit" ]]; }

kit_conf() {
  local v=""
  [[ -f "$kit_config" ]] && v="$(jq -r "$1 // empty" "$kit_config" 2>/dev/null || true)"
  printf '%s' "${v:-$2}"
}
