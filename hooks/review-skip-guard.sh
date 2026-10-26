#!/usr/bin/env bash
# PreToolUse guard (Agent|Task): a reviewer launched for commits that change no code line (only moved blocks,
# comments, blank lines, *.md or ai/usage; lib.sh kit_code_lines) reviews nothing, so the launch is blocked and the
# commit's review is skipped. The commits are the hashes the brief or description names; a brief naming none, or any
# commit with a code line, a new non-moved file or a review.always path, launches as usual.
set -euo pipefail
command -v jq >/dev/null 2>&1 || exit 0
. "$(dirname "$0")/lib.sh"
kit_enabled || exit 0
input="$(cat)"
tool="$(jq -r '.tool_name // empty' <<<"$input" 2>/dev/null || true)"
[[ "$tool" == Agent || "$tool" == Task ]] || exit 0
# same reviewer test as review-before-stop.sh: the type, or a general-purpose "review" not starting "commit:"
jq -e '.tool_input | (.subagent_type // "") as $t | (.description // "") as $d
  | ($t | test("change-reviewer")) or (($t == "" or $t == "general-purpose")
    and ($d | test("review"; "i")) and ($d | test("^\\s*commit:"; "i") | not))' <<<"$input" >/dev/null 2>&1 || exit 0

always="$(kit_conf '.review.always' '(^|/)(migrations?|schema|auth|permissions?|polic(y|ies))([/._-]|$)|\.(sql|prisma)$')"
hashes="$(jq -r '.tool_input | "\(.description // "") \(.prompt // "")"' <<<"$input" |
  grep -oE '[0-9a-f]{7,40}' | grep '[a-f]' | sort -u || true)"
skipped=()
while IFS= read -r h; do
  [[ -n "$h" ]] || continue
  full="$(git -C "$kit_root" rev-parse --verify -q "$h^{commit}" 2>/dev/null)" || continue
  git -C "$kit_root" rev-parse --verify -q "$full^" >/dev/null 2>&1 || exit 0
  [[ -z "$(kit_code_lines "$kit_root" "$full^" "$full" --)" ]] || exit 0
  paths="$(git -C "$kit_root" diff --name-only "$full^" "$full")"
  jq -Rse --arg re "$always" 'split("\n") | any(.[]; length > 0 and test($re; "i"))' <<<"$paths" >/dev/null 2>&1 && exit 0
  skipped+=("$h")
done <<<"$hashes"
((${#skipped[@]})) || exit 0

cat >&2 <<EOF
Blocked: ${skipped[*]} change no code line (only moved blocks, comments, docs or ai/usage), so there is nothing to
review: skip this review and go on (the coordinator pipeline, CLAUDE.core.md). Under "Checked" write: review skipped,
move-only or comment-only.
EOF
exit 2
