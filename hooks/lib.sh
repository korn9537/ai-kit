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

# kit_code_lines <repo> <git diff args...>: the changed lines that are code: no blank, comment or *.md line (a tool
# directive such as // @ts-ignore or //go:build is code), none in ai/usage, and none that moved to another file
# (--color-moved marks moved lines "ul"; a line counts as moved only when its counterpart, leading whitespace aside,
# is in a different file, so a reorder or re-indent within a file still counts), plus a numstat row per binary file.
# A failing git diff prints a line too, so a caller never reads it as "no change". Byte-safe (LC_ALL=C): non-UTF-8
# text must not end the pipeline early.
kit_code_lines() {
  local repo="$1" rc=0
  shift
  local -a g=(git -C "$repo" -c core.quotePath=false -c diff.noprefix=false -c diff.mnemonicPrefix=false)
  local -a ex=(':(exclude)*.md' ':(exclude)ai/usage')
  "${g[@]}" diff --no-ext-diff --quiet "$@" "${ex[@]}" >/dev/null 2>&1 || rc=$?
  if ((rc > 1)); then
    echo "(git diff failed)"
    return 0
  fi
  "${g[@]}" diff --no-ext-diff --numstat "$@" "${ex[@]}" | LC_ALL=C grep -E '^-' || true
  "${g[@]}" -c color.diff.oldMoved='ul red' -c color.diff.newMoved='ul green' -c color.diff.old=red \
    -c color.diff.new=green -c color.diff.meta=bold -c color.diff.frag=cyan \
    diff --no-ext-diff -U0 --color=always --color-moved=plain --color-moved-ws=allow-indentation-change "$@" "${ex[@]}" \
    | LC_ALL=C awk '
      function strip(s) { gsub(/\033\[[0-9;]*m/, "", s); return s }
      { line = strip($0) }
      line ~ /^diff --git / { file = line; next }
      line ~ /^(\+\+\+|---) "?(a\/|b\/|\/dev\/null)/ || line !~ /^[+-]/ { next }
      {
        n++; f[n] = file; l[n] = line; m[n] = ($0 ~ /^\033\[4;3[12]m/)
        if (m[n]) { k = line; sub(/^[+-][ \t]*/, substr(line, 1, 1), k); at[k] = at[k] SUBSEP file }
      }
      END {
        for (i = 1; i <= n; i++) {
          if (m[i]) {
            other = l[i]; sub(/^[+-][ \t]*/, "", other)
            other = (substr(l[i], 1, 1) == "+" ? "-" : "+") other
            cnt = split(at[other], fs, SUBSEP)
            cross = 0
            for (k = 1; k <= cnt; k++) if (fs[k] != "" && fs[k] != f[i]) cross = 1
            if (cross) continue
          }
          print l[i]
        }
      }' \
    | LC_ALL=C sed -E 's/^[+-][[:space:]]*//' \
    | LC_ALL=C awk '/^\/\/[[:space:]]*(@ts-|eslint-|prettier-ignore|biome-ignore|deno-lint-ignore|go:|\+build|nolint)/ ||
      !/^$|^\/\/|^\/\*([^*]|\*+[^*\/])*\*+\/$|^\{\/\*([^*]|\*+[^*\/])*\*+\/\}$/' || true
}

# kit_review_skippable <repo> <commit>: succeeds when the commit changes no code line (kit_code_lines) and so needs no
# reviewer. A missing commit, a merge, a root commit, a mode change, an empty new file or a review.always path (old or
# new name; an invalid pattern counts as a match) fails: reviewed as usual.
kit_review_skippable() {
  local repo="$1" full stat paths always rc=0
  full="$(git -C "$repo" rev-parse --verify -q "$2^{commit}" 2>/dev/null)" || return 1
  [[ "$(git -C "$repo" rev-list --parents -n 1 "$full" | wc -w)" -eq 2 ]] || return 1
  [[ -z "$(kit_code_lines "$repo" "$full^" "$full" --)" ]] || return 1
  # a mode change or an empty new file has no +/- line; a numstat row of 0 0 shows it
  stat="$(git -C "$repo" diff --no-ext-diff --numstat --no-renames "$full^" "$full" 2>/dev/null)" || return 1
  LC_ALL=C grep -qE '^0[[:space:]]+0[[:space:]]' <<<"$stat" && return 1
  paths="$(cut -f3- <<<"$stat")"
  always="$(kit_conf '.review.always' '(^|/)(migrations?|schema|auth|permissions?|polic(y|ies))([/._-]|$)|\.(sql|prisma)$')"
  jq -Rse --arg re "$always" 'split("\n") | any(.[]; length > 0 and test($re; "i"))' <<<"$paths" >/dev/null 2>&1 || rc=$?
  ((rc == 1))
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
