#!/usr/bin/env bash
# Sourced by the kit hooks: kit_conf <jq path> <default> reads the project's ai/kit/config.json (needs jq).
# kit_enabled fails in a project without ai/kit/: the plugin may be on at user scope, so hooks then exit 0.
# kit_project_root <dir>: the repo root of a subdirectory (repo/api), keeping the given spelling: --show-toplevel
# resolves symlinks (/tmp -> /private/tmp), which breaks matching transcript paths against the root.
kit_project_root() {
  local d="${1%/}" prefix
  [[ -n "$d" ]] || d=/
  if [[ -d "$d/ai/kit" ]]; then printf '%s\n' "$d"; return; fi
  prefix="$(git -C "$d" rev-parse --show-prefix 2>/dev/null || true)"
  prefix="${prefix%/}"
  if [[ -n "$prefix" && "$d" == *"/$prefix" ]]; then d="${d%"/$prefix"}"; fi
  printf '%s\n' "${d:-/}"
}
kit_root="$(kit_project_root "${CLAUDE_PROJECT_DIR:-$PWD}")"
kit_config="$kit_root/ai/kit/config.json"
kit_plugin="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

kit_enabled() { [[ -d "$kit_root/ai/kit" ]]; }

kit_conf() {
  local v=""
  [[ -f "$kit_config" ]] && v="$(jq -r "$1 // empty" "$kit_config" 2>/dev/null || true)"
  printf '%s' "${v:-$2}"
}

# kit_memory_dir: Claude Code's auto-memory dir for this repo (main worktree path, non-alphanumerics -> '-'; a long
# path's hashed slug is not followed, so a miss only skips the nudge).
kit_memory_dir() {
  local main
  main="$(git -C "$kit_root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  main="${main%/.git}"
  [[ -n "$main" ]] || main="$kit_root"
  printf '%s\n' "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/${main//[^a-zA-Z0-9]/-}/memory"
}
