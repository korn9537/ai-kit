#!/usr/bin/env bash
# Stop hook: code edited in this session after the last review → block the stop once and ask for a fresh-eyes
# review by the ai-kit:change-reviewer agent (CLAUDE.core.md "Working conventions"). A review = an Agent call whose
# description or subagent_type contains "review". Docs (*.md) and files outside the repo do not count; a Bash
# command that writes into the repo counts (auto mode edits that way); a .md-only Bash write does not. Edits by a
# finished commit subagent (description "commit: ...") count too; one still running is skipped until it ends.
#
# A main-session reply with `Review closed: re-checked once` (not quoted) right after a re-check (the last review was
# a SendMessage) counts as a review. Gap: an unreviewed commit closed right after the previous re-check passes.
# Escape hatch: a user message starting with "ไม่ต้อง review" or "skip review" after the last edit.
# Comment-only: nothing but //, one-line /* */ or blank lines changed since the last review's snapshot
# (review-snapshot.sh), or since the session began when none was reviewed → no review.
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
  def re_escape: gsub("(?<c>[.+])"; "\\\(.c)");
  ($root | re_escape) as $r
  | def writes_repo:
      test("sed -i|perl -pi|git apply|apply_patch|write_text|writeFileSync|open\\([^)]*[\"'][wa]")
      or test("(>>?|tee) *[\"']?(\\./|\\$\\{?\\w+\\}?/)?(" + $r + "|(" + $dirs + ")/)")
      or (test("cd [\"']?" + $r) and test("(^|[^0-9&>])(>>?|tee) *(?!/dev/|/tmp|/private/tmp|&)[^ ]"));
    def only_md: [scan("[A-Za-z0-9_./-]+\\.[A-Za-z]{1,6}\\b")] | length > 0 and all(test("\\.md$"));
  fromjson? // empty
  | select((.isSidechain == true) == $side)
  | .timestamp as $ts
  | if .type == "assistant" then
      .message.content | arrays | .[]
      | if .type == "text" and ($side | not)
             and ((.text // "") | test("(?<![\"`'\u201c])Review closed: re-checked once"; "i")) then
          {k: "closed", ts: $ts}
        elif .type != "tool_use" then empty
        elif (.name | test("^(Edit|Write|MultiEdit|NotebookEdit)$")) then
          ((.input.file_path // .input.notebook_path // "") | gsub("\\\\"; "/")) as $p
          | select(($p | startswith($root)) and ($p | test("\\.md$") | not))
          | {k: "edit", p: ($p | ltrimstr($root)), ts: $ts}
        elif .name == "Bash" and ((.input.command // "") | writes_repo and (only_md | not)) then
          {k: "edit", p: "(via Bash)", ts: $ts}
        elif $side then empty
        elif (.name == "Agent" or .name == "Task" or .name == "SendMessage")
             and ([.input.description, .input.subagent_type, .input.summary] | map(. // "") | join(" ")
               | test("review"; "i")) then
          {k: "review", ts: $ts, recheck: (.name == "SendMessage")}
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
  | (map(.k == "review") | rindex(true)) as $last
  | (if $last == null then . else .[($last + 1):] end)
  | map(select(.k == "edit") | .p) | unique | .[]
JQ
# config code_dirs: top-level folders a Bash redirect writes code into
dirs="$(kit_conf '.code_dirs | map(gsub("\\."; "\\.")) | join("|")' 'apps|src|packages|scripts|\.claude|\.githooks')"
events="$(jq -R --arg root "$project/" --arg dirs "$dirs" --argjson side false "$events_jq" "$transcript")" || {
  echo "review-before-stop: could not read the transcript, review not enforced" >&2
  exit 0
}
# <session>/subagents/agent-*.jsonl + .meta.json; reviewers and analysts never count (their greps look like writes)
for sub in "${transcript%.jsonl}"/subagents/agent-*.jsonl; do
  [[ -f "$sub" ]] || continue
  jq -e '.description // "" | test("^\\s*commit:"; "i")' "${sub%.jsonl}.meta.json" >/dev/null 2>&1 || continue
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
files="$(jq -rs "$tail_jq" <<<"$events")"
[[ -n "$files" ]] || exit 0

code_since() {  # $1 $2 = trees/commits to diff ($2 empty → the work tree); prints anything that is not a comment
  git -C "$project" diff --numstat "$1" ${2:+"$2"} -- . ':(exclude)*.md' | grep -E '^-' || true
  git -C "$project" diff -U0 "$1" ${2:+"$2"} -- . ':(exclude)*.md' \
    | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) (a/|b/|/dev/null)' \
    | sed -E 's/^[+-][[:space:]]*//' \
    | grep -vE '^$|^//|^/\*([^*]|\*+[^*/])*\*+/$|^\{/\*([^*]|\*+[^*/])*\*+/\}$' || true
}

session="$(jq -r '.session_id // empty' <<<"$input")"
gitdir="$(git -C "$project" rev-parse --absolute-git-dir 2>/dev/null || true)"
snapshot=""
[[ -n "$session" && -n "$gitdir" && -f "$gitdir/claude-review/$session" ]] && snapshot="$(cat "$gitdir/claude-review/$session")"
if [[ -n "$snapshot" ]]; then
  # Both sides built by review-snapshot.sh, so untracked files compare line by line too.
  now_tree="$("$(dirname "$0")/review-snapshot.sh" --tree "$project" 2>/dev/null || true)"
  [[ -n "$now_tree" && -z "$(code_since "$snapshot" "$now_tree")" ]] && exit 0
else
  since="$(jq -R 'fromjson? // empty | .timestamp // empty' -r "$transcript" | head -1 || true)"
  base="$(git -C "$project" rev-list -1 --before="$since" HEAD 2>/dev/null || true)"
  if [[ -n "$since" && -n "$base" ]]; then
    untracked="$(git -C "$project" ls-files --others --exclude-standard | grep -v '\.md$' || true)"
    [[ -z "$untracked" && -z "$(code_since "$base")" ]] && exit 0
  fi
fi

reason="Code changed since the last review. If this commit's reviewer already re-checked once and nothing left is a
CONFIRMED data or rule issue, write under \"Checked\" as plain text with no quotes or backticks: Review closed: re-checked once, no third pass. Then stop. Re-checking fixes for the findings of the same commit: SendMessage that
commit's reviewer only the fix diff (summary containing \"review\"), once. Otherwise launch a fresh Agent with
subagent_type \"ai-kit:change-reviewer\", run_in_background: true, one per commit (its model and effort are fixed in
$kit_plugin/agents/change-reviewer.md; do not override them); never reuse an earlier commit's reviewer. If that agent type is
not loaded (the plugin was enabled mid-session), use general-purpose with a description containing \"review\" and tell it to read
and follow $kit_plugin/agents/change-reviewer.md, where \${CLAUDE_PLUGIN_ROOT} means $kit_plugin. Give it the user's request in their words, the changed files and
their \`git diff\` (or the commits made in this session). When it reports, fix every CONFIRMED finding and judge
each PLAUSIBLE one; findings from the re-check are fixed without a third pass unless CONFIRMED and about data or
rule correctness. Until a background reviewer reports, end the turn with one line saying the review is running; the
final report comes after its findings. Report the review under \"Checked\". Files:
$files"

jq -n --arg r "$reason" '{decision: "block", reason: $r}'
