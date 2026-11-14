#!/usr/bin/env bash
# SessionStart: records the plugin path for the git pre-commit shim (<git-common-dir>/ai-kit-root), injects the second
# half of CLAUDE.core.md (session-context.sh injects the first), starts a detached send of other sessions' usage idle
# for 6 hours to the usage server, records a new session's review snapshot and names the plans not closed.
# Silent without ai/kit/.
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
  # review baseline until the first review (review-before-stop.sh): a resumed session keeps its own or none
  src="$(printf '%s' "$input" | jq -r '.source // empty' 2>/dev/null || true)"
  rdir="$(kit_state_dir review "$kit_root" || true)"
  if [[ -n "$sid" && -n "$rdir" && "$src" =~ ^(startup|clear)$ && ! -f "$rdir/$sid" ]]; then
    # at most 4 s, so a large tree never delays the injection; killed before the write = no snapshot (the fallback)
    snap="$rdir/$sid"
    (tree="$("$(dirname "$0")/review-snapshot.sh" --tree "$kit_root")" && mkdir -p "${snap%/*}" &&
      printf '%s\n' "$tree" >"$snap.$$" && mv "$snap.$$" "$snap") >/dev/null 2>&1 &
    pid=$!
    for _ in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    # the subshell's children too (review-snapshot.sh, its git add); Git Bash has no pgrep: its ps lists PID PPID,
    # a status letter (I, S, O) first on some lines, apart from the PID or glued to it
    kids() {
      if command -v pgrep >/dev/null 2>&1; then pgrep -P "$1"; else
        ps 2>/dev/null | awk -v p="$1" '{ sub(/^[ \t]*[A-Za-z][ \t]*/, ""); if ($2 == p) print $1 }'
      fi
    }
    kill_tree() { local c; for c in $(kids "$1"); do kill_tree "$c"; done; kill "$1" 2>/dev/null; }
    kill_tree "$pid" || true
    wait "$pid" 2>/dev/null || true
  fi
fi
if command -v node >/dev/null 2>&1; then
  CLAUDE_PROJECT_DIR="$kit_root" node "$kit_plugin/scripts/usage.mjs" flush --idle ${sid:+--except "$sid"} >/dev/null 2>&1 || true
fi

rep="$kit_plugin/"
core="$(kit_core 2)"
if [[ -s "$kit_root/ai/kit/kit-proposals.md" ]]; then
  core+=$'\n\n'"Unfiled kit proposals in ai/kit/kit-proposals.md: file them per ${rep}docs/kit-proposals.md §Filing, then remove each filed entry (delete the file when empty)."
fi
# silent with no plan of plan.mjs: a hand-written plan has no batches to go on with
if command -v node >/dev/null 2>&1 && compgen -G "$kit_root/ai/plans/*.md" >/dev/null; then
  plans="$(cd "$kit_root" && node "$kit_plugin/scripts/plan.mjs" status --quick 2>/dev/null || true)"
  if [[ -n "$plans" ]]; then
    core+=$'\n\n'"Plans in ai/plans not closed, status from their commits:"$'\n'"$plans"$'\n'"Tell the user in your first reply. Go on only when they say so, per ${rep}docs/plan-batching.md §Plan file: another session may be running one."
  fi
fi
mem="$(kit_memory_dir)"
# MEMORY.md counts only when it holds more than index links (kit.mjs memoryFiles)
if [[ -n "$(find "$mem" -maxdepth 1 -name '*.md' ! -name MEMORY.md -print -quit 2>/dev/null)" ]] ||
  grep -qvE '^[[:space:]]*(#.*|[-*][[:space:]]+\[[^]]*\]\([^)]*\).*)?$' "$mem/MEMORY.md" 2>/dev/null; then
  core+=$'\n\n'"Local auto-memory files in $mem: run /ai-kit:memory-export to move them into the repo."
fi
# a note only: the tree changes when someone runs sync (docs/ai-layout.md §Runs without the plugin)
if [[ "$(kit_conf .unattended false)" == true ]] && command -v node >/dev/null 2>&1; then
  stale="$(cd "$kit_root" && node "$kit_plugin/scripts/kit.mjs" check 2>/dev/null | grep -cE 'is stale against|ai/kit/(conventions/|checks/|review-prompt).* is missing|check\.sh is missing or changed' || true)"
  if [[ "${stale:-0}" -gt 0 ]]; then
    core+=$'\n\n'"This repo's generated ai/kit files are out of date for unattended runs: run node $kit_plugin/scripts/kit.mjs sync and commit them."
  fi
fi
kit_inject "$core"
