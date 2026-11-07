#!/usr/bin/env bash
# Sourced by the kit hooks: kit_conf <jq path> <default> reads the project's ai/kit/config.json (needs jq).
# kit_enabled fails in a project without ai/kit/: the plugin may be on at user scope, so hooks then exit 0.
# kit_project_root <dir>: the repo root of a subdirectory (repo/api), keeping the given spelling: --show-toplevel
# resolves symlinks (/tmp -> /private/tmp), which breaks matching transcript paths against the root.
# kit_path <path>: a Windows spelling (C:\a\b, or /c/a/b under Git Bash) as C:/a/b, the form git prints; else as is
kit_path() {
  local p="${1//\\//}"
  if [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* ]] && [[ "$p" =~ ^/([a-zA-Z])(/.*)?$ ]]; then
    p="$(printf '%s' "${BASH_REMATCH[1]}" | tr a-z A-Z):${BASH_REMATCH[2]:-/}"
  fi
  printf '%s\n' "$p"
}

kit_project_root() {
  local d prefix
  d="$(kit_path "$1")"
  d="${d%/}"
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

# kit_core 1|2: CLAUDE.core.md before or from its "Delegation and report" heading, ai-kit/ paths made absolute. Two
# hooks inject one half each: Claude Code keeps only a 2,000-character preview of a string over 10,000 characters.
# sed, not ${core//…}: bash 3.2 (macOS) replaces in a UTF-8 string in quadratic time, 2 s for this file
kit_core() {
  sed "s|ai-kit/|$(printf '%s' "$kit_plugin/" | sed 's/[|&\\]/\\&/g')|g" "$kit_plugin/CLAUDE.core.md" |
    awk -v half="$1" '/^## Delegation and report$/ { second = 1 } (half == 2) == (second == 1)'
}

# kit_inject <text>: SessionStart context, plain text without jq
kit_inject() {
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg c "$1" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $c}}'
  else
    printf '%s\n' "$1"
  fi
}

kit_conf() {
  local v=""
  [[ -f "$kit_config" ]] && v="$(jq -r "$1 // empty" "$kit_config" 2>/dev/null || true)"
  printf '%s' "${v:-$2}"
}

# KIT_REVIEWER_JQ: jq defs shared by the review hooks. kit_is_reviewer takes a tool_input: the change-reviewer type, or
# a general-purpose (type missing, general-purpose or claude, as agent-model-guard.sh) whose description has the word
# "review" (not "preview") and does not start "commit:". kit_review_text: a SendMessage summary naming a review.
KIT_REVIEWER_JQ='def kit_is_reviewer: (.subagent_type // "") as $t | (.description // "") as $d
  | ($t | test("change-reviewer")) or (($t == "" or $t == "general-purpose" or $t == "claude")
    and ($d | test("\\breview"; "i")) and ($d | test("^\\s*commit:"; "i") | not));
  def kit_review_text: test("\\breview"; "i");
'

# kit_code_lines <repo> <git diff args...>: the changed lines that are code: no blank, comment or *.md line (a tool
# directive such as // @ts-ignore or //go:build is code), none in ai/usage, and none that moved to another file
# (--color-moved marks moved lines "ul"; a line counts as moved only in a run of 3 or more consecutive moved lines
# whose counterpart, leading whitespace aside, is in a different file, so a reorder or re-indent within a file still
# counts), plus a numstat row per binary file.
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
      line ~ /^diff --git / { file = line; hunk = 0; next }
      line ~ /^@@/ { hunk++; next }
      line ~ /^(\+\+\+|---) "?(a\/|b\/|\/dev\/null)/ || line !~ /^[+-]/ { next }
      {
        n++; f[n] = file; l[n] = line; m[n] = ($0 ~ /^\033\[4;3[12]m/)
        # a run: consecutive moved lines of one hunk, one file, one sign
        key = file SUBSEP hunk SUBSEP substr(line, 1, 1)
        run[n] = (m[n] && n > 1 && m[n - 1] && key == prev) ? run[n - 1] : n
        if (m[n]) len[run[n]]++
        prev = key
      }
      END {
        # one moved line is no move (requireAdmin(req); from a.ts to b.ts): a run needs 3 or more lines
        for (i = 1; i <= n; i++) if (m[i] && len[run[i]] >= 3) {
          k = l[i]; sub(/^[+-][ \t]*/, substr(l[i], 1, 1), k); at[k] = at[k] SUBSEP f[i]
        }
        for (i = 1; i <= n; i++) {
          if (m[i] && len[run[i]] >= 3) {
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

# kit_split_cmd: a Bash command on stdin as one simple command per line. Splits on ; && || | a single & (not >& or &>)
# a newline, backtick and parentheses; drops heredoc bodies and # comments. Quote characters are removed and the text
# inside a quote stays one word: its space becomes \001, ( \002, ) \003, ; & | backtick newline \004, an empty
# quote \005. awk under LC_ALL=C: bash 3.2 replaces in a UTF-8 string in quadratic time (a 24 KB Thai heredoc: 14 s).
kit_split_cmd() {
  LC_ALL=C awk '
function flush() { sub(/^[ \t]+/, "", seg); if (seg != "") print seg; seg = "" }
function enc(s) {
  gsub("[ \t]", "\001", s); gsub("[(]", "\002", s); gsub("[)]", "\003", s); gsub("[;&|`]", "\004", s)
  return s
}
function dqend(s,   off, k, pos, b, j) {
  off = 0
  while ((k = index(substr(s, off + 1), DQ)) > 0) {
    pos = off + k; b = 0; j = pos - 1
    while (j >= 1 && substr(s, j, 1) == BS) { b++; j-- }
    if (b % 2 == 0) return pos
    off = pos
  }
  return 0
}
BEGIN { SQ = "\047"; DQ = "\""; BS = "\\"; special = "[\\\\\047\"#;|&()<`]" }
{
  if (hd) {
    t = $0
    if (hdtab) sub(/^\t+/, "", t)
    if (t == hdword) hd = 0
    next
  }
  line = $0
  while (line != "") {
    if (q != "") {
      p = (q == SQ) ? index(line, SQ) : dqend(line)
      if (p == 0) { chunk = line; line = "" } else { chunk = substr(line, 1, p - 1); line = substr(line, p + 1) }
      seg = seg enc(chunk); qn += length(chunk)
      if (p) { if (qn == 0) seg = seg "\005"; q = "" }
      continue
    }
    if (!match(line, special)) { seg = seg line; line = ""; break }
    seg = seg substr(line, 1, RSTART - 1)
    c = substr(line, RSTART, 1)
    line = substr(line, RSTART + 1)
    prev = substr(seg, length(seg), 1)
    if (c == SQ || c == DQ) { q = c; qn = 0 }
    else if (c == BS) {
      if (line == "") cont = 1
      else { seg = seg enc(substr(line, 1, 1)); line = substr(line, 2) }
    }
    else if (c == "#") { if (seg == "" || prev == " " || prev == "\t") line = ""; else seg = seg c }
    else if (c == "&") { if (prev == ">" || prev == "<" || substr(line, 1, 1) == ">") seg = seg c; else flush() }
    else if (c == "<") {
      if (substr(line, 1, 2) == "<<") { seg = seg "<<<"; line = substr(line, 3) }
      else if (substr(line, 1, 1) == "<") {
        r = substr(line, 2); hdtab = 0
        if (substr(r, 1, 1) == "-") { hdtab = 1; r = substr(r, 2) }
        sub(/^[ \t]+/, "", r)
        d1 = substr(r, 1, 1)
        if (d1 == SQ || d1 == DQ) {
          r = substr(r, 2); p = index(r, d1)
          if (p) { w = substr(r, 1, p - 1); r = substr(r, p + 1) } else { w = r; r = "" }
        } else {
          if (d1 == BS) r = substr(r, 2)
          match(r, "^[^ \t;&|()<>]*"); w = substr(r, 1, RLENGTH); r = substr(r, RLENGTH + 1)
        }
        hdword = w; hdpend = 1; line = r
      } else seg = seg c
    }
    else flush()
  }
  if (q != "") { seg = seg "\004"; qn++ }
  else if (cont) cont = 0
  else flush()
  if (hdpend) { hd = 1; hdpend = 0 }
}
END { flush() }'
}
