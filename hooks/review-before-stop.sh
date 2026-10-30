#!/usr/bin/env bash
# Stop hook: code edited in this session after the last review → block the stop once and ask for a fresh-eyes
# review by the ai-kit:change-reviewer agent (CLAUDE.core.md "Working conventions"). A review = an Agent call with
# that subagent_type, or a general-purpose one whose description contains "review" and does not start "commit:"
# (fallback). Docs (*.md), ai/usage records and files outside the repo do not count; a Bash command that writes
# into the repo counts (auto mode edits that way), and so does a formatter, fixer, codemod, mv, cp or rm; a
# .md-only Bash write does not; a relative redirect, tee, mv, cp or rm target counts when the line's cwd is in the
# repo. Edits by a finished commit subagent (ai-kit:committer or description "commit: ...") count too; one still
# running is skipped until it ends.
#
# A main-session reply with `Review closed: re-checked once` (not quoted) right after a re-check (the last review was
# a SendMessage) counts as a review. Gap: an unreviewed commit closed right after the previous re-check passes.
# Escape hatch: a user message starting with "ไม่ต้อง review" or "skip review" after the last edit.
# Comment-only: nothing but //, one-line /* */ or blank lines changed since the snapshot (review-snapshot.sh: the
# last review's tree, else the one session-start.sh took), or since the commit before the session began without one → no
# review. A Bash write is judged by those changed lines, not by the files its command names. Small: at most config
# review.skip_lines changed code lines, no new file, no path matching review.always, nothing reviewed yet (a fix
# after a review always goes to its re-check) → no review. Gap: sed -i whose script names /tmp/ is not counted, nor a
# change to a path no Edit named when no Bash write was seen (a user hook's formatter, an unrecognized rename).
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "review-before-stop: jq not installed, review not enforced" >&2
  exit 0
fi

. "$(dirname "$0")/lib.sh"
kit_enabled || exit 0
input="$(cat)"
[[ "$(jq -r '.stop_hook_active // false' <<<"$input")" == "true" ]] && exit 0

transcript="$(jq -r '.transcript_path // empty' <<<"$input")"
[[ -n "$transcript" && -f "$transcript" ]] || exit 0
project="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' <<<"$input")}"
[[ -n "$project" ]] && project="$(kit_project_root "$project")"
[[ -n "$project" ]] || exit 0
project="${project//\\//}"
project="${project%/}"

read -r -d '' events_jq <<'JQ' || true
  # Windows: backslashes as / and the drive letter upper-case, so C:\repo and c:/repo compare equal
  def norm: gsub("\\\\"; "/") | if test("^[a-z]:/") then (.[0:1] | ascii_upcase) + .[1:] else . end;
  def re_escape: gsub("(?<c>[\\\\^$.|?*+()\\[\\]{}])"; "\\\(.c)");
  ($root | norm) as $root
  | ($root | re_escape) as $r
  # cd into the root, spelled with or without its trailing slash
  | ("cd [\"']?" + ($r | rtrimstr("/")) + "([/\"' ;&]|$)") as $cd
  # $in: the command ran with its cwd in the repo, as a cd into the root does
  | def writes_repo($in):
      test("(sed -i|perl -pi)(?![^;&|]*/(private/)?tmp/)|git apply|apply_patch|write_text|writeFileSync")
      or test("(\\.open\\(|open\\([^)]*, *)(mode *= *)?[\"'][wa][bt+]?[\"']")
      # as a command word: a codemod or a fixing formatter; mv/cp/rm on a repo path, or after cd into the repo
      or test("(^|[;&|(\n] *)(npx +|node +|bun +)?[\\w./-]*(codemod|jscodeshift)")
      or test("(^|[;&|(\n] *)(npx +|pnpm +(exec +)?|yarn +|bunx +)?[\\w./-]*(eslint|prettier|biome|stylelint|ruff)\\b[^;&|\n]*--(fix|write)\\b|gofmt +-w|dotnet +format")
      or test("(^|[;&|(\n] *)(git +)?(mv|cp|rm)\\b[^;&|\n]*(" + $r + "|[ \"'](\\./)?(" + $dirs + ")/)")
      or (test($cd) and test("(^|[;&|(\n] *)(git +)?(mv|cp|rm) (?![^;&|\n]*(/tmp|/private/tmp|\\$\\{?TMP))"))
      # quoted text is one word Q: a > inside jq, awk or echo quotes is no redirect, a quoted target still counts
      or ($in and (test("(^|[;&|(\n] *)(git +)?(mv|cp|rm)\\b[^;&|\n]*(/tmp|/private/tmp|\\$\\{?TMP)") | not)
          and (gsub("\"[^\"]*\"|'[^']*'"; "Q") | test("(^|[;&|(\n] *)(git +)?(mv|cp|rm)\\b[^;&|\n]* (?![-/~$])[\\w.]")))
      or test("(>>?|tee) *[\"']?(\\./|\\$\\{?\\w+\\}?/)?(" + $r + "|(" + $dirs + ")/)")
      or (test($cd) and test("(^|[^0-9&>])(>>?|tee) *(?!/dev/|/tmp|/private/tmp|&)[^ ]"))
      or ($in and (gsub("\"[^\"]*\"|'[^']*'"; "Q") | test("(^|[\\s;&|(])>>? *(?![/~$&(])[\\w.]|(^|[;&|(\n] *)tee +(-a +)?(?![-/~$])[\\w.]")));
    def only_md: [scan("[A-Za-z0-9_./-]+\\.[A-Za-z]{1,6}\\b")] | length > 0 and all(test("\\.md$"));
  fromjson? // empty
  | select((.isSidechain == true) == $side)
  | .timestamp as $ts
  | ((.cwd // "") | norm | rtrimstr("/") + "/" | startswith($root)) as $in
  | if .type == "assistant" then
      .message.content | arrays | .[]
      | if .type == "text" and ($side | not)
             and ((.text // "") | test("(?<![\"`'\u201c])Review closed: re-checked once"; "i")) then
          {k: "closed", ts: $ts}
        elif .type != "tool_use" then empty
        elif (.name | test("^(Edit|Write|MultiEdit|NotebookEdit)$")) then
          ((.input.file_path // .input.notebook_path // "") | norm) as $p
          | select(($p | startswith($root)) and ($p | test("\\.md$") | not))
          | {k: "edit", p: ($p | ltrimstr($root)), ts: $ts}
        elif .name == "Bash" and ((.input.command // "") | writes_repo($in) and (only_md | not)) then
          {k: "edit", p: "(via Bash)", ts: $ts}
        elif $side then empty
        elif (.name == "Agent" or .name == "Task")
             and ((.input.subagent_type // "") as $t | ($t | test("change-reviewer"))
               or (($t == "" or $t == "general-purpose") and ((.input.description // "") as $d
                 | ($d | test("review"; "i")) and ($d | test("^\\s*commit:"; "i") | not)))) then
          {k: "review", ts: $ts, recheck: false}
        elif .name == "SendMessage" and ((.input.summary // "") | test("review"; "i")) then
          {k: "review", ts: $ts, recheck: true}
        else empty end
    elif $side then empty
    elif .type == "user" and .isMeta != true then
      (.message.content | if type == "string" then [.] else [.[]? | select(.type == "text") | .text] end)
      | select(any(.[]; (startswith("<") | not) and test("^\\s*(ไม่ต้อง ?review|skip review)"; "i")))
      | {k: "review", ts: $ts}
    else empty end
JQ
read -r -d '' tail_jq <<'JQ' || true
  sort_by(.ts) | . as $e
  | [range(length) as $i | $e[$i]
     | if .k != "closed" then . elif ([$e[:$i][] | select(.k == "review")] | last | .recheck) == true then .k = "review" else empty end]
  | . as $x | (map(.k == "review") | rindex(true)) as $last
  # state of the last review: fresh agent, SendMessage re-check, or none (none yet, skip, closed)
  | {state: (if $last == null then "none" else {"true": "recheck", "false": "reviewed"}[$x[$last].recheck | tostring] // "none" end),
     files: ((if $last == null then $x else $x[($last + 1):] end) | map(select(.k == "edit") | .p) | unique)}
JQ
# config code_dirs: top-level folders a Bash redirect writes code into
dirs="$(kit_conf '.code_dirs | map(gsub("(?<c>[\\\\^$.|?*+()\\[\\]{}])"; "\\\(.c)")) | join("|")' 'apps|src|packages|scripts|\.claude|\.githooks')"
events="$(jq -R --arg root "$project/" --arg dirs "$dirs" --argjson side false "$events_jq" "$transcript")" || {
  echo "review-before-stop: could not read the transcript, review not enforced" >&2
  exit 0
}
# <session>/subagents/agent-*.jsonl + .meta.json; reviewers and analysts never count (their greps look like writes)
for sub in "${transcript%.jsonl}"/subagents/agent-*.jsonl; do
  [[ -f "$sub" ]] || continue
  jq -e '(.agentType // "" | test("committer")) or (.description // "" | test("^\\s*commit:"; "i"))' \
    "${sub%.jsonl}.meta.json" >/dev/null 2>&1 || continue
  # finished = last assistant line is the handback call, or an end_turn reply with no tool call (null = still writing)
  done_="$(jq -R 'fromjson? // empty | select(.type == "assistant")
    | ([.message.content[]? | select(.type == "tool_use") | .name]) as $t
    | ($t == ["SubagentHandback"]) or ($t == [] and .message.stop_reason == "end_turn")' "$sub" 2>/dev/null | tail -n 1)"
  [[ "$done_" == "true" ]] || continue
  events+=$'\n'"$(jq -R --arg root "$project/" --arg dirs "$dirs" --argjson side true "$events_jq" "$sub" || true)"
done
# the reply being stopped may not be in the transcript yet: read it from the hook input as the newest event
last="$(jq -c '.last_assistant_message // empty | strings
  | {type: "assistant", timestamp: "9999", message: {content: [{type: "text", text: .}]}}' <<<"$input" 2>/dev/null || true)"
[[ -n "$last" ]] && events+=$'\n'"$(jq -R --arg root "$project/" --arg dirs "$dirs" --argjson side false "$events_jq" <<<"$last" || true)"
result="$(jq -cs "$tail_jq" <<<"$events")"
files="$(jq -r '.files[]' <<<"$result")"
[[ -n "$files" ]] || exit 0
state="$(jq -r '.state' <<<"$result")"

# diff only the paths this session edited (other sessions share the checkout), all when via Bash
specs=(.)
if ! grep -qxF '(via Bash)' <<<"$files"; then
  specs=()
  while IFS= read -r f; do specs+=(":(literal)$f"); done <<<"$files"
fi
code_since() {  # $1 $2 = trees/commits to diff ($2 empty → the work tree); prints the changed code lines (lib.sh)
  kit_code_lines "$project" "$1" ${2:+"$2"} -- "${specs[@]}"
}

session="$(jq -r '.session_id // empty' <<<"$input")"
gitdir="$(git -C "$project" rev-parse --absolute-git-dir 2>/dev/null || true)"
snapshot=""
[[ -n "$session" && -n "$gitdir" && -f "$gitdir/claude-review/$session" ]] && snapshot="$(cat "$gitdir/claude-review/$session")"
# the tree is unreferenced, so gc may have pruned it: then judge as without a snapshot
[[ -n "$snapshot" ]] && ! git -C "$project" cat-file -e "$snapshot^{tree}" 2>/dev/null && snapshot=""
changed="" new_files="" paths=""
if [[ -n "$snapshot" ]]; then
  # Both sides built by review-snapshot.sh, so untracked files compare line by line too.
  now_tree="$("$(dirname "$0")/review-snapshot.sh" --tree "$project" 2>/dev/null || true)"
  if [[ -n "$now_tree" ]]; then
    changed="$(code_since "$snapshot" "$now_tree")"
    [[ -z "$changed" ]] && exit 0
    new_files="$(git -C "$project" diff --name-only --diff-filter=A "$snapshot" "$now_tree" -- "${specs[@]}" ':(exclude)*.md' ':(exclude)ai/usage')"
    paths="$(git -C "$project" diff --name-only "$snapshot" "$now_tree" -- "${specs[@]}" ':(exclude)*.md' ':(exclude)ai/usage')"
  fi
else
  since="$(jq -R 'fromjson? // empty | .timestamp // empty' -r "$transcript" | head -1 || true)"
  base="$(git -C "$project" rev-list -1 --before="$since" HEAD 2>/dev/null || true)"
  if [[ -n "$since" && -n "$base" ]]; then
    new_files="$(git -C "$project" ls-files --others --exclude-standard -- "${specs[@]}" ':(exclude)*.md' ':(exclude)ai/usage' || true)"
    changed="$(code_since "$base")"
    [[ -z "$new_files" && -z "$changed" ]] && exit 0
    new_files+=$'\n'"$(git -C "$project" diff --name-only --diff-filter=A "$base" -- "${specs[@]}" ':(exclude)*.md' ':(exclude)ai/usage')"
    paths="$(git -C "$project" diff --name-only "$base" -- "${specs[@]}" ':(exclude)*.md' ':(exclude)ai/usage')"
  fi
fi
skip_lines="$(kit_conf '.review.skip_lines' 10)"
always="$(kit_conf '.review.always' '(^|/)(migrations?|schema|auth|permissions?|polic(y|ies))([/._-]|$)|\.(sql|prisma)$')"
# JS-style regex (jq test, as the other config patterns); an invalid one counts as a match
hits_always() { jq -Rse --arg re "$always" 'split("\n") | any(.[]; test($re; "i"))' <<<"$paths" >/dev/null 2>&1 \
  || [[ $? -ne 1 ]]; }
if [[ "$state" == none && -n "$changed" && -z "${new_files//$'\n'/}" ]] && (($(wc -l <<<"$changed") <= skip_lines)) &&
  ! hits_always; then
  exit 0
fi

launch="launch a fresh Agent with subagent_type \"ai-kit:change-reviewer\", run_in_background: true, one per commit,
never an earlier commit's reviewer (sonnet, medium effort from its frontmatter; pass model \"opus\" and effort
\"high\" only when the commit touches a DB schema or migration, a calculation, a permission or a decision recorded
as final). Agent type not loaded (plugin
enabled mid-session): general-purpose, description containing \"review\", told to follow
$kit_plugin/agents/change-reviewer.md (\${CLAUDE_PLUGIN_ROOT} = $kit_plugin). Brief: the user's request in their
words, the changed files and their \`git diff -- . ':(exclude)ai/usage'\` (or this session's commits, read with
\`git show <hash> -- . ':(exclude)ai/usage'\`). Fix every CONFIRMED finding, judge each
PLAUSIBLE one. Until it reports, end the turn with one line saying the review is running; the final report comes
after. Report the review under \"Checked\"."
case "$state" in
  reviewed) reason="Code changed since the last review. Fixes for its findings: SendMessage that reviewer only the
fix diff, summary containing \"review\", once. New work instead: $launch" ;;
  recheck) reason="Code changed since the re-check. Fixes for its findings, none of them a CONFIRMED data or rule
issue left: write under \"Checked\" as plain text with no quotes or backticks:
Review closed: re-checked once, no third pass. Then stop. New work instead: $launch" ;;
  *) reason="Code changed with no review yet: $launch" ;;
esac
reason+=$'\n'"Files:"$'\n'"$files"

jq -n --arg r "$reason" '{decision: "block", reason: $r}'
