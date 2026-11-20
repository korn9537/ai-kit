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
# a native jq.exe ends lines with \r\n; $(...) drops only the last \r, so `read` loops got "a.ts\r" (-b: plain \n)
if [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* ]] && command jq -b -n 1 >/dev/null 2>&1; then
  jq() { command jq -b "$@"; }
fi

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

# kit_state_dir <review|usage-cache|usage|decider> <dir>: the kit's state folder, git run from <dir>; prints nothing
# and fails when git does (callers: `|| exit 0`). review and usage-cache sit in the work tree's own git dir, usage and
# decider in the common git dir shared by all work trees. Twin of scripts/lib/state-dirs.mjs. Runs git only when called.
kit_state_dir() {
  local base
  case "$1" in
    review | usage-cache) base="$(git -C "$2" rev-parse --absolute-git-dir 2>/dev/null)" || return 1 ;;
    usage | decider) base="$(git -C "$2" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1 ;;
    *) return 1 ;;
  esac
  [[ -n "$base" ]] || return 1
  case "$1" in
    review) printf '%s\n' "$base/claude-review" ;;
    usage-cache | usage) printf '%s\n' "$base/claude-usage" ;;
    decider) printf '%s\n' "$base/claude-decider" ;;
  esac
}

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
# a general-purpose (type missing, general-purpose or claude, as agent-model-guard.sh) whose description contains
# review (any case: CodeReview, rereview; not preview) and does not start "commit:". kit_review_text: a SendMessage
# summary naming a review.
# shellcheck disable=SC2034  # read by the hooks that source this file
KIT_REVIEWER_JQ='def kit_is_reviewer: (.subagent_type // "") as $t | (.description // "") as $d
  | ($t | test("change-reviewer")) or (($t == "" or $t == "general-purpose" or $t == "claude")
    and ($d | test("(?<![Pp])(?<!un)review"; "i")) and ($d | test("^\\s*commit:"; "i") | not));
  def kit_review_text: test("(?<![Pp])(?<!un)review"; "i");
'

# kit_code_lines <repo> <git diff args...>: the changed lines that are code: no blank, comment or *.md line (a tool
# directive such as // @ts-ignore or //go:build is code), none in ai/usage, and none that moved to another file
# (--color-moved marks moved lines "ul"; a line counts as moved only when its own run holds 3 or more consecutive
# moved code lines (comment, blank and # lines do not count toward the run) and the counterpart, leading
# whitespace aside, is in a different file, so a reorder or re-indent within a file still counts), plus a numstat row
# per binary file.
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
      # run counting only: a directive is code; a comment opener, a * line, a closer and a # line are not
      function iscode(s) {
        sub(/^[+-][ \t]*/, "", s)
        return (s ~ /^\/\/[ \t]*(@ts-|eslint-|prettier-ignore|biome-ignore|deno-lint-ignore|go:|\+build|nolint)/) ||
          !(s ~ /^$|^\/\/|^\/\*|^\*|^#|^\{\/\*([^*]|\*+[^*\/])*\*+\/\}$/)
      }
      { line = strip($0) }
      line ~ /^diff --git / { file = line; hunk = 0; next }
      line ~ /^@@/ { hunk++; next }
      line ~ /^(\+\+\+|---) "?(a\/|b\/|\/dev\/null)/ || line !~ /^[+-]/ { next }
      {
        n++; f[n] = file; l[n] = line; m[n] = ($0 ~ /^\033\[4;3[12]m/)
        # a run: consecutive moved lines of one hunk, one file, one sign
        key = file SUBSEP hunk SUBSEP substr(line, 1, 1)
        run[n] = (m[n] && n > 1 && m[n - 1] && key == prev) ? run[n - 1] : n
        if (m[n] && iscode(line)) len[run[n]]++
        prev = key
      }
      END {
        # one moved code line is no move (requireAdmin(req); from a.ts to b.ts): a line drops when its own run holds 3
        # or more code lines (comment and blank lines do not count) and its counterpart is in another file. No other
        # run excuses it: an unpaired line stays visible
        for (i = 1; i <= n; i++) if (m[i]) {
          k = l[i]; sub(/^[+-][ \t]*/, substr(l[i], 1, 1), k)
          at[k] = at[k] SUBSEP f[i]
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

# kit_memory_re: an extended regex for a path inside any project's auto-memory dir: ~/.claude/projects/<slug>/memory,
# or under CLAUDE_CONFIG_DIR (also its Git Bash /c/x spelling). Used by memory-guard.sh and bash-guard.sh.
kit_memory_re() {
  local cfg='\.claude' c lit
  if [[ -n "${CLAUDE_CONFIG_DIR:-}" ]]; then
    c="$(kit_path "$CLAUDE_CONFIG_DIR")" && c="${c%/}"
    lit="$(printf '%s' "$c" | sed 's/[][\.*^$+?(){}|]/\\&/g')"
    cfg="(\\.claude|$lit"
    if [[ "$c" =~ ^([A-Za-z]):(/.*)$ ]]; then
      lit="/$(printf '%s' "${BASH_REMATCH[1]}" | tr A-Z a-z)${BASH_REMATCH[2]}"
      cfg+="|$(printf '%s' "$lit" | sed 's/[][\.*^$+?(){}|]/\\&/g')"
    fi
    cfg+=")"
  fi
  printf '%s\n' "$cfg/projects/[^/[:space:]]+/memory(/|\$)"
}

# kit_memory_msg: the block message for a write into the auto-memory dir
kit_memory_msg() {
  cat <<'EOT'
Blocked: auto-memory (~/.claude/projects/*/memory/) is on this machine only; the team never sees it. Write the fact
to its repo target, same commit as the work (working conventions, Project knowledge): CLAUDE.md,
ai/kit/review-checklist.md, the decisions source, ai/notes.md, or a kit proposal.
EOT
}

# kit_split_cmd: a Bash command on stdin as one simple command per line. Splits on ; && || | a single & (not >& or &>)
# a newline, backtick and parentheses; drops heredoc bodies and # comments; skips << inside $(( )). Quote characters are
# removed and the text inside a quote stays one word. A line is its words joined and ended by \037 (read it with
# IFS=$'\037' read -r -a), placeholders already decoded; an empty quote is an empty word. A line of \006( or \006) marks
# a parenthesis, so a caller can scope a cd; a line of \006` marks a backtick, so a caller sees that `git add `ls``
# had an argument it cannot read (backticks come in pairs: the odd mark opens one). An unquoted > is written \007>, so
# a caller tells a redirect from a quoted >. The last line is \006ok, or \006raw when the scan could not follow the
# text (it ended inside a quote or heredoc, a double quote or an unquoted heredoc holds $( or a backtick, an open
# $(( )): the caller then checks the raw text as well. The one $( read through is the message form of git and gh: a
# double quote ending its line in an unescaped $(cat <<'W', whose body is dropped, closed by a line of ) alone; for any
# other command the output may be run (bash -c, eval). No \006ok at all means awk failed. awk under LC_ALL=C: bash 3.2
# replaces in a UTF-8 string in quadratic time (a 24 KB Thai heredoc: 14 s). A batch: commands each ended by a line of
# \036 alone, one marker each.
kit_split_cmd() {
  LC_ALL=C awk '
function word(w) {
  if (w ~ PH) {
    gsub("\001", " ", w); gsub("\002", "(", w); gsub("\003", ")", w); gsub("\004", " ", w); gsub("\005", "", w)
    gsub("\016", ";", w); gsub("\017", "\\&", w); gsub("\020", "|", w); gsub("\021", "`", w)
  }
  return w
}
function flush(   n, a, k, out) {
  sub(/^[ \t]+/, "", seg); sub(/[ \t]+$/, "", seg)
  if (seg != "") {
    n = split(seg, a, /[ \t]+/); out = ""
    for (k = 1; k <= n; k++) out = out word(a[k]) US
    print out
  }
  seg = ""
}
function enc(s) {
  gsub("[ \t]", "\001", s); gsub("[(]", "\002", s); gsub("[)]", "\003", s); gsub(";", "\016", s)
  gsub("&", "\017", s); gsub("[|]", "\020", s); gsub("`", "\021", s)
  return s
}
function escaped(s, pos,   b) {
  while (pos > 1 && substr(s, pos - 1, 1) == BS) { b++; pos-- }
  return b % 2
}
function fin() {
  flush()
  if (q != "" || hd || ar > 0) raw = 1
  print MK (raw ? "raw" : "ok")
  q = ""; qn = hd = hdq = hdtab = hdpend = dqhd = dqtab = dqclose = cont = ar = raw = 0; hdword = dqword = ""
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
BEGIN {
  SQ = "\047"; DQ = "\""; BS = "\\"; special = "[\\\\\047\"#;|&()<`>]"; US = "\037"; MK = "\006"
  PH = "[\001-\005\016-\021]"
}
$0 == "\036" { fin(); nsep++; lastsep = NR; next }
{
  if (dqhd) {
    t = $0
    if (dqtab) sub(/^\t+/, "", t)
    if (t == dqword) { dqhd = 0; dqclose = 1 }
    next
  }
  if (hd) {
    t = $0
    if (!hdq && (index(t, "$(") || index(t, "`"))) raw = 1
    if (hdtab) sub(/^\t+/, "", t)
    if (t == hdword) hd = 0
    next
  }
  line = $0
  while (line != "") {
    if (q != "") {
      p = (q == SQ) ? index(line, SQ) : dqend(line)
      if (p == 0) { chunk = line; line = "" } else { chunk = substr(line, 1, p - 1); line = substr(line, p + 1) }
      if (q == DQ) {
        text = chunk
        if (dqclose) {
          dqclose = 0
          if (p == 0 || chunk !~ /^[ \t]*\)[ \t]*$/) raw = 1
        }
        else if (p == 0 && seg ~ /^[ \t]*(git|gh)[ \t]/ &&
                 match(chunk, /\$\([ \t]*cat[ \t]+<<-?[ \t]*\047[^\047]+\047[ \t]*$/) && !escaped(chunk, RSTART)) {
          w = substr(chunk, RSTART); text = substr(chunk, 1, RSTART - 1)
          dqtab = index(w, "<<-") > 0
          sub(/^[^\047]*\047/, "", w); sub(/\047[ \t]*$/, "", w)
          dqword = w; dqhd = 1
        }
        if (index(text, "$(") || index(text, "`")) raw = 1
      }
      seg = seg enc(chunk); qn += length(chunk)
      if (p) { if (qn == 0) seg = seg "\005"; q = "" }
      continue
    }
    if (!match(line, special)) { seg = seg line; line = ""; break }
    seg = seg substr(line, 1, RSTART - 1)
    c = substr(line, RSTART, 1)
    line = substr(line, RSTART + 1)
    prev = substr(seg, length(seg), 1)
    if (ar > 0 && (c == "(" || c == ")" || c == "<" || c == ";" || c == "&" || c == "|" || c == "#" || c == ">")) {
      if (c == "(") ar++
      else if (c == ")") ar--
      seg = seg c
    }
    else if (c == ">") seg = seg "\007>"
    else if (c == "|" && substr(seg, length(seg) - 1) == "\007>") seg = seg c
    else if (c == SQ || c == DQ) { q = c; qn = 0 }
    else if (c == BS) {
      if (line == "") cont = 1
      else { seg = seg enc(substr(line, 1, 1)); line = substr(line, 2) }
    }
    else if (c == "#") { if (seg == "" || prev == " " || prev == "\t") line = ""; else seg = seg c }
    else if (c == "&") { if (prev == ">" || prev == "<" || substr(line, 1, 1) == ">") seg = seg c; else flush() }
    else if (c == "(") {
      if (prev == "$" && substr(line, 1, 1) == "(") { ar = 2; seg = seg "(("; line = substr(line, 2) }
      else { flush(); print MK "(" }
    }
    else if (c == ")") { flush(); print MK ")" }
    else if (c == "<") {
      if (substr(line, 1, 2) == "<<") { seg = seg "<<<"; line = substr(line, 3) }
      else if (substr(line, 1, 1) == "<") {
        r = substr(line, 2); hdtab = 0
        if (substr(r, 1, 1) == "-") { hdtab = 1; r = substr(r, 2) }
        sub(/^[ \t]+/, "", r)
        d1 = substr(r, 1, 1); hdq = (d1 == SQ || d1 == DQ || d1 == BS)
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
    else if (c == "`") { flush(); print MK "`" }
    else flush()
  }
  if (q != "") { seg = seg "\004"; qn++ }
  else if (cont) cont = 0
  else flush()
  if (hdpend) { hd = 1; hdpend = 0 }
}
END { if (!nsep || NR > lastsep) fin() }'
}

# kit_bash_writes <root> <code_dirs re> <flags>: Bash commands on stdin, each ended by a \036 line (flag k = 1: its
# cwd in the repo); per command w = writes into the repo (not .md-only), - = no, r = unsure (raw split, bash -c, eval)
kit_bash_writes() {
  local root="${1%/}" dirs="$2" flags="$3" k=0 here=0 v=- seg n j w r any=1 f_was=1 sw rc IFS=$'\037'
  local -a t a stack vars
  case $- in *f*) ;; *) f_was=0; set -f ;; esac
  root="$(kit_path "$root")"
  here="${flags:0:1}"
  while IFS= read -r seg; do
    case "$seg" in
      $'\006ok' | $'\006raw')
        [[ "$v" == - && "$seg" == $'\006raw' ]] && v=r
        printf '%s\n' "$v"
        [[ "$v" == w ]] && any=0
        k=$((k + 1)) v=- stack=() vars=() here="${flags:k:1}"
        continue ;;
      $'\006(') stack+=("$here"); continue ;;
      $'\006)')
        if ((${#stack[@]})); then here="${stack[${#stack[@]} - 1]}"; unset "stack[${#stack[@]}-1]"; fi
        continue ;;
      $'\006'*) continue ;;
    esac
    [[ "$v" == w ]] && continue
    # shellcheck disable=SC2206  # split on \037 with globbing off
    t=($seg)
    n=${#t[@]} a=() sw=0
    # a redirect word: \007> (unquoted), the target the rest of the word or the next one; the other words go to a
    for ((j = 0; j < n; j++)); do
      w="${t[j]}"
      if [[ "$w" == *$'\007>'* ]]; then
        r="${w#*$'\007'>}" r="${r#$'\007'>}" r="${r#[|]}"
        [[ "${w%%$'\007'*}" =~ ^[0-9]*\&?$ ]] || a+=("${w%%$'\007'*}")
        if [[ -z "$r" ]]; then j=$((j + 1)); r="${t[j]:-}"; fi
        [[ -n "$r" && "$r" != '&'* ]] && _kbw_in "$r" && sw=1
      else
        a+=("$w")
      fi
    done
    # NAME=value alone (or after export): a later $NAME/ in a target or cd reads as value/
    if ((${#a[@]})) && [[ "${a[0]}" == export || "${a[0]}" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      rc=0
      for w in "${a[@]}"; do [[ "$w" == export || "$w" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || rc=1; done
      ((rc)) || for w in "${a[@]}"; do [[ "$w" == export ]] || vars=("$w" ${vars[@]+"${vars[@]}"}); done
    fi
    if ((!sw && ${#a[@]})); then
      rc=0
      _kbw_cmd 0 ${#a[@]} 1 || rc=$?
      ((rc == 0)) && sw=1
      ((rc == 2)) && [[ "$v" == - ]] && v=r
    fi
    if ((sw)) && ! _kbw_md_only "${t[@]}"; then v=w; fi
  done < <(kit_split_cmd)
  ((f_was)) || set +f
  return $any
}
# _kbw_in <word>: the word names a path in the repo: under root, in a code_dirs folder (also after ./ or $VAR/), or
# relative while the cwd (here) is in the repo
_kbw_in() {
  local w
  _kbw_var "$1"
  w="${w//\\//}"
  while [[ "$w" == ./* ]]; do w="${w#./}"; done
  [[ "$w" =~ ^[a-z]:/ ]] && w="$(printf %s "${w:0:1}" | tr a-z A-Z)${w:1}"
  case "$w" in "$root" | "$root"/*) return 0 ;; esac
  local re='^(\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/)?('"$dirs"')/'
  [[ -n "$dirs" && "$w" =~ $re ]] && return 0
  ((here)) && [[ "$w" =~ ^[A-Za-z0-9_.] ]]
}
# _kbw_var <word>: w = the word, a leading ~, $NAME or ${NAME} replaced by its value (vars, else $HOME for HOME)
_kbw_var() {
  local x re='^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?(/.*)?$'
  w="$1"
  # shellcheck disable=SC2088  # a pattern on the word, not an expansion
  if [[ -n "${HOME:-}" && ("$w" == '~' || "$w" == '~/'*) ]]; then w="$HOME${w#\~}"; return 0; fi
  [[ "$w" =~ $re ]] || return 0
  for x in ${vars[@]+"${vars[@]}"}; do
    if [[ "${x%%=*}" == "${BASH_REMATCH[1]}" ]]; then w="${x#*=}${BASH_REMATCH[2]}"; return 0; fi
  done
  [[ "${BASH_REMATCH[1]}" == HOME && -n "${HOME:-}" ]] && w="$HOME${BASH_REMATCH[2]}"
  return 0
}
_kbw_tmp() { local re='^(/private)?/tmp/|^\$\{?TMP'; [[ "$1" =~ $re ]]; }
# _kbw_md_only <words>: every file name in them ends .md, and there is one
_kbw_md_only() {
  local w seen=0 re='[A-Za-z0-9_./-]+\.([A-Za-z]{1,6})([^A-Za-z0-9_]|$)'
  for w; do
    while [[ "$w" =~ $re ]]; do
      [[ "${BASH_REMATCH[1]}" == md ]] || return 1
      seen=1 w="${w#*"${BASH_REMATCH[0]}"}"
    done
  done
  ((seen))
}
# _kbw_cmd <from> <to> <top>: the words a[from..to-1] as one command; 0 writes, 1 does not, 2 runs a text (bash -c,
# eval, rg --pre) this cannot read. top = 1: a cd changes here
_kbw_cmd() {
  local i=$1 e=$2 top=$3 c j w s pos=() inpl=0 script=0 expect=0 dash=0 ch rest
  # leading assignments, keywords and wrappers (env, sudo, xargs, timeout, ...) before the command word
  while ((i < e)); do
    w="${a[i]}"
    if [[ "$w" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then i=$((i + 1)); continue; fi
    case "${w##*/}" in
      '!' | '{' | '}' | then | do | else | elif | if | while | until | time | command | builtin | exec | nohup)
        i=$((i + 1)) ;;
      env | sudo | nice | xargs | timeout | stdbuf)
        c="${w##*/}" i=$((i + 1))
        while ((i < e)) && [[ "${a[i]}" == -* ]]; do
          case "$c:${a[i]}" in
            env:-u | sudo:-[ugCh] | nice:-n | xargs:-[nILPsdEa] | timeout:-[sk] | stdbuf:-[ioe]) i=$((i + 2)) ;;
            *) i=$((i + 1)) ;;
          esac
        done
        [[ "$c" == timeout ]] && i=$((i + 1)) ;;
      *) break ;;
    esac
  done
  ((i < e)) || return 1
  c="${a[i]##*/}"
  case "$c" in
    cd | pushd)
      ((top)) || return 1
      j=$((i + 1))
      while ((j < e)) && [[ "${a[j]}" == -[LPe@] ]]; do j=$((j + 1)); done
      _kbw_var "${a[j]:-}"
      w="${w//\\//}"
      case "$w" in
        "" | '~'*) here=0 ;;
        "$root" | "$root"/*) here=1 ;;
        /* | [A-Za-z]:/*) here=0 ;;
      esac
      return 1 ;;
    bash | sh | zsh | dash | ksh)
      for ((j = i + 1; j < e; j++)); do [[ "${a[j]}" =~ ^-[A-Za-z]*c ]] && return 2; done
      return 1 ;;
    eval) return 2 ;;
    rg)
      for ((j = i + 1; j < e; j++)); do [[ "${a[j]}" == --pre || "${a[j]}" == --pre=* ]] && return 2; done
      return 1 ;;
    sed | gsed | perl)
      # options: i turns in-place on (the rest of the word is a suffix); sed e/f and perl e/E take the script
      for ((j = i + 1; j < e; j++)); do
        w="${a[j]}"
        if ((expect)); then expect=0 script=1; continue; fi
        case "$w" in
          --in-place*) inpl=1 ;;
          --expression=* | --file=*) script=1 ;;
          --expression | --file) expect=1 ;;
          --*) ;;
          -?*)
            rest="${w#-}"
            while [[ -n "$rest" ]]; do
              ch="${rest:0:1}" rest="${rest:1}"
              if [[ "$ch" == i ]]; then
                inpl=1
                # BSD sed -i '' or -i .bak: the next word is the suffix
                [[ -z "$rest" && "$c" != perl && $((j + 1)) -lt $e && "${a[j + 1]}" =~ ^(\.[A-Za-z0-9_~-]*)?$ ]] &&
                  j=$((j + 1))
                break
              fi
              if [[ "$c" == perl && "$ch" =~ [eE] ]] || [[ "$c" != perl && "$ch" =~ [ef] ]]; then
                script=1; [[ -z "$rest" ]] && expect=1
                break
              fi
              [[ "$c" == perl && "$ch" =~ [MmI] ]] && { [[ -z "$rest" ]] && j=$((j + 1)); break; }
            done ;;
          *) pos+=("$w") ;;
        esac
      done
      ((inpl)) || return 1
      ((script || ! ${#pos[@]})) || pos=(${pos[@]+"${pos[@]:1}"})
      ((${#pos[@]})) || return 0
      for s in "${pos[@]}"; do _kbw_var "$s"; _kbw_tmp "$w" || return 0; done
      return 1 ;;
    patch)
      for ((j = i + 1; j < e; j++)); do [[ "${a[j]}" =~ ^--(version|help|dry-run)$ ]] && return 1; done
      return 0 ;;
    gofmt)
      for ((j = i + 1; j < e; j++)); do [[ "${a[j]}" == -w ]] && return 0; done
      return 1 ;;
    dotnet) [[ "${a[i + 1]:-}" == format ]] && return 0; return 1 ;;
    git)
      j=$((i + 1))
      while ((j < e)) && [[ "${a[j]}" == -* ]]; do
        case "${a[j]}" in -C | -c | --git-dir | --work-tree | --namespace) j=$((j + 2)) ;; *) j=$((j + 1)) ;; esac
      done
      case "${a[j]:-}" in
        checkout) for ((j = j + 1; j < e; j++)); do [[ "${a[j]}" == -- ]] && return 0; done; return 1 ;;
        restore)
          # a --staged-only restore leaves the work tree; --worktree beside it does not
          local staged=0 wt=0
          for ((j = j + 1; j < e; j++)); do
            case "${a[j]}" in
              --staged) staged=1 ;; --worktree) wt=1 ;;
              --*) ;;
              -*) [[ "${a[j]}" == *S* ]] && staged=1; [[ "${a[j]}" == *W* ]] && wt=1 ;;
            esac
          done
          ((!staged || wt)) && return 0; return 1 ;;
        mv | rm) _kbw_files "${a[j]}" $((j + 1)) "$e"; return ;;
      esac
      return 1 ;;
    mv | cp | rm | tee) _kbw_files "$c" $((i + 1)) "$e"; return ;;
    find)
      for ((j = i + 1; j < e; j++)); do
        if [[ "${a[j]}" =~ ^-(exec|execdir|ok|okdir)$ ]]; then
          s=$((j + 1))
          while ((j < e)) && [[ "${a[j]}" != ';' && "${a[j]}" != + ]]; do j=$((j + 1)); done
          w=0
          _kbw_cmd "$s" "$j" 0 || w=$?
          ((w != 1)) && return $w
        fi
      done
      return 1 ;;
    npx | bunx)
      j=$((i + 1))
      while ((j < e)) && [[ "${a[j]}" == -* ]]; do
        case "${a[j]}" in -p | --package) j=$((j + 2)) ;; *) j=$((j + 1)) ;; esac
      done
      _kbw_cmd "$j" "$e" 0; return ;;
    npm | pnpm | yarn | bun)
      j=$((i + 1))
      while ((j < e)) && [[ "${a[j]}" == -* ]]; do
        case "${a[j]}" in
          -C | --dir | --filter | -F | --prefix | -w | --workspace | --cwd) j=$((j + 2)) ;;
          *) j=$((j + 1)) ;;
        esac
      done
      w="${a[j]:-}"
      case "$w" in
        exec | dlx | x) _kbw_cmd $((j + 1)) "$e" 0; return ;;
        run | run-script) j=$((j + 1)) w="${a[j]:-}" ;;
      esac
      # a fix or format script (lint-fix, autofix, format:all), not prefix or check-format; or -- --fix
      if [[ "$w" =~ ^[A-Za-z0-9_:-]*(fix|format)(:[A-Za-z0-9_:-]+)?$ && "$w" != prefix &&
        ! "$w" =~ check[-_:]?format ]]; then return 0; fi
      for ((s = j + 1; s < e; s++)); do
        if ((dash)); then [[ "${a[s]}" =~ ^--(fix|write)(=|$) ]] && return 0; fi
        [[ "${a[s]}" == -- ]] && dash=1
      done
      [[ "$c" != npm && -n "$w" ]] && { _kbw_cmd "$j" "$e" 0; return; }
      return 1 ;;
    node | deno | tsx | ts-node)
      j=$((i + 1))
      while ((j < e)) && [[ "${a[j]}" == -* ]]; do j=$((j + 1)); done
      [[ "${a[j]:-}" =~ codemod|jscodeshift ]] && return 0
      return 1 ;;
    *codemod* | *jscodeshift*) return 0 ;;
  esac
  # a fixing formatter: eslint, prettier, biome, stylelint, ruff with --fix or --write; ruff format without --check
  c="${c%%@*}"
  if [[ "$c" =~ (eslint|prettier|biome|stylelint|ruff)$ ]]; then
    for ((j = i + 1; j < e; j++)); do
      [[ "${a[j]}" =~ ^--(fix|write)(=|$) ]] && return 0
      [[ "$c" == *prettier && "${a[j]}" == -w ]] && return 0
    done
    if [[ "$c" == *ruff && "${a[i + 1]:-}" == format ]]; then
      for ((j = i + 2; j < e; j++)); do [[ "${a[j]}" =~ ^--(check|diff)$ ]] && return 1; done
      return 0
    fi
  fi
  return 1
}
# _kbw_files <mv|cp|rm|tee> <from> <to>: rm, tee and mv write every file word (mv empties its source), cp only its
# target: the last word, or -t
_kbw_files() {
  local c=$1 j last="" opts=1
  for ((j = $2; j < $3; j++)); do
    if ((opts)) && [[ "${a[j]}" == -- ]]; then opts=0; continue; fi
    if ((opts)) && [[ "$c" == cp && "${a[j]}" == -t ]]; then
      j=$((j + 1)); _kbw_in "${a[j]:-}" && return 0; continue
    fi
    if ((opts)) && [[ "$c" == cp && "${a[j]}" == --target-directory=* ]]; then
      _kbw_in "${a[j]#*=}" && return 0; continue
    fi
    ((opts)) && [[ "${a[j]}" == -* ]] && continue
    if [[ "$c" == cp ]]; then last="${a[j]}"; else _kbw_in "${a[j]}" && return 0; fi
  done
  [[ -n "$last" ]] && _kbw_in "$last"
}
