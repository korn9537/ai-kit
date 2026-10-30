#!/usr/bin/env bash
# Tests for review-before-stop.sh: a throwaway repo and hand-built transcripts; each case checks block or pass and,
# when blocked, a phrase of the reason.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
HOOK="$PWD/review-before-stop.sh"
TMP="$(mktemp -d)" || exit 1
trap 'rm -rf "$TMP"' EXIT
# the resolved path: transcript paths must match the repo root (macOS /var → /private/var)
REPO="$(cd "$TMP" && pwd -P)" || exit 1

git -C "$REPO" init -q
mkdir -p "$REPO/ai/kit" "$REPO/src/migrations"
for f in a b c other; do seq 1 40 >"$REPO/src/$f.ts"; done
seq 1 40 >"$REPO/src/migrations/m.ts"
git -C "$REPO" add -A
GIT_COMMITTER_DATE="2020-01-01T00:00:00Z" git -C "$REPO" -c user.name=t -c user.email=t@t commit -qm base \
  --date 2020-01-01T00:00:00Z

pass=0
fail=0
n=0
# line <name> <input json> → a transcript line for a main-session tool_use
line() {
  n=$((n + 1))
  jq -cn --arg name "$1" --argjson input "$2" --arg ts "2030-01-01T00:00:$(printf %02d "$n")Z" \
    '{type: "assistant", timestamp: $ts, message: {content: [{type: "tool_use", name: $name, input: $input}]}}'
}
edit() { line Edit "{\"file_path\": \"$REPO/$1\"}"; }

# run_case <desc> <block|pass> <reason phrase or -> <transcript lines...>
run_case() {
  local desc="$1" want="$2" phrase="$3" t out got
  shift 3
  t="$REPO/.git/t.jsonl"
  printf '%s\n' "$@" >"$t"
  out="$(jq -n --arg t "$t" '{transcript_path: $t, session_id: "s1"}' |
    env -i PATH="$PATH" HOME="$HOME" CLAUDE_PROJECT_DIR="$REPO" "$HOOK" 2>&1)"
  got=pass
  [[ "$(jq -r '.decision // empty' <<<"$out" 2>/dev/null)" == block ]] && got=block
  if [[ "$got" == "$want" && ("$phrase" == - || "$out" == *"$phrase"*) ]]; then
    echo "ok   - $desc"
    pass=$((pass + 1))
  else
    echo "FAIL - $desc (want $want${phrase:+ with \"$phrase\"}, got $got)"
    echo "       $out"
    fail=$((fail + 1))
  fi
}
reset() { git -C "$REPO" checkout -q -- src; rm -rf "$REPO/.git/claude-review"; }

sed -i.bak '1,2s/$/x/' "$REPO/src/a.ts" && rm "$REPO/src/a.ts.bak"
run_case "pass: 2 changed lines, no review" pass - "$(edit src/a.ts)"
sed -i.bak '1,20s/$/x/' "$REPO/src/a.ts" && rm "$REPO/src/a.ts.bak"
run_case "block: 20 changed lines, no review yet" block "no review yet" "$(edit src/a.ts)"
run_case "block: the brief reads the diff and the commits without the token records" block "-- . ':(exclude)ai/usage'" "$(edit src/a.ts)"
run_case "block: an Explore agent named review is not a review" block "no review yet" \
  "$(edit src/a.ts)" "$(line Agent '{"subagent_type": "Explore", "description": "review folders"}')"
run_case "pass: change-reviewer after the edit" pass - \
  "$(edit src/a.ts)" "$(line Agent '{"subagent_type": "ai-kit:change-reviewer", "description": "x"}')"
run_case "block: edit after a review asks for the re-check" block "SendMessage that reviewer" \
  "$(line Agent '{"subagent_type": "ai-kit:change-reviewer", "description": "x"}')" "$(edit src/a.ts)"
run_case "block: edit after the re-check asks to close" block "Review closed: re-checked once" \
  "$(line Agent '{"subagent_type": "ai-kit:change-reviewer", "description": "x"}')" \
  "$(line SendMessage '{"to": "r", "summary": "review fix diff"}')" "$(edit src/a.ts)"
reset

sed -i.bak '1s/$/x/' "$REPO/src/migrations/m.ts" && rm "$REPO/src/migrations/m.ts.bak"
run_case "block: one line in a review.always path" block - "$(edit src/migrations/m.ts)"
reset

sed -i.bak '1s/$/x/' "$REPO/src/b.ts" && rm "$REPO/src/b.ts.bak"
sed -i.bak '1,30s/$/x/' "$REPO/src/other.ts" && rm "$REPO/src/other.ts.bak"
run_case "pass: another session's large change is not counted" pass - "$(edit src/b.ts)"
run_case "pass: cleaning /tmp does not widen the diff to the whole tree" pass - "$(edit src/b.ts)" \
  "$(line Bash '{"command": "rm -rf /tmp/scratch && grep -rn -- --fix ."}')"
reset

seq 1 3 >"$REPO/src/new.ts"
run_case "block: a new file is never small" block - "$(edit src/new.ts)"
rm -f "$REPO/src/new.ts"

sed -i.bak '1,20s/$/x/' "$REPO/src/c.ts" && rm "$REPO/src/c.ts.bak"
run_case "pass: reading with open() is not a write" pass - \
  "$(line Bash "{\"command\": \"cd $REPO && python3 -c 'print(open(\\\"app.txt\\\").read())'\"}")"
run_case "pass: sed -i on /tmp is not a write" pass - "$(line Bash '{"command": "sed -i \"\" s/a/b/ /tmp/x.txt"}')"
run_case "block: sed -i in the repo" block - "$(line Bash "{\"command\": \"sed -i '' s/a/b/ $REPO/src/c.ts\"}")"
run_case "pass: skip review after the edit" pass - "$(edit src/c.ts)" \
  "$(jq -cn '{type: "user", timestamp: "2030-01-01T00:01:00Z", message: {content: "skip review"}}')"
run_case "block: a commit batch named review fixes is not a review" block "no review yet" "$(edit src/c.ts)" \
  "$(line Agent '{"subagent_type": "general-purpose", "description": "commit: review fixes"}')"
for i in $(seq 1 20); do echo "export const value$i = computeSomethingLong($i, 'argument');"; done >"$REPO/src/a.ts"
git -C "$REPO" add src/a.ts && git -C "$REPO" -c user.name=t -c user.email=t@t commit -qm wide
sed -n '1,20p' "$REPO/src/a.ts" | sed 's/^/  /' >>"$REPO/src/b.ts"
: >"$REPO/src/a.ts"
run_case "pass: a block moved to another file is no code change" pass - "$(edit src/a.ts)" "$(edit src/b.ts)"
git -C "$REPO" checkout -q HEAD~1 -- src/a.ts src/b.ts && git -C "$REPO" reset -q HEAD~1
run_case "block: an ai-kit:committer is not a review" block "no review yet" "$(edit src/c.ts)" \
  "$(line Agent '{"subagent_type": "ai-kit:committer", "description": "commit: review fixes"}')"
run_case "pass: general-purpose review fallback" pass - "$(edit src/c.ts)" \
  "$(line Agent '{"subagent_type": "general-purpose", "description": "review commit"}')"
# a finished ai-kit:committer's edits count even when its description lacks "commit:"
mkdir -p "$REPO/.git/t/subagents"
sed -i.bak '1,20s/$/z/' "$REPO/src/c.ts" && rm "$REPO/src/c.ts.bak"
jq -cn '{agentType: "ai-kit:committer", description: "transfer rows"}' >"$REPO/.git/t/subagents/agent-c1.meta.json"
{ edit src/c.ts | jq -c '.isSidechain = true'; jq -cn '{type: "assistant", isSidechain: true,
  timestamp: "2030-01-01T00:00:59Z", message: {stop_reason: "end_turn", content: [{type: "text", text: "Hash abc1234"}]}}'; } >"$REPO/.git/t/subagents/agent-c1.jsonl"
run_case "block: edits by a finished ai-kit:committer count" block "no review yet" "$(line Read '{"file_path": "x"}')"
rm -rf "$REPO/.git/t"
reset

sed -i.bak '1s/$/x/' "$REPO/src/a.ts" && rm "$REPO/src/a.ts.bak"
seq 1 30 | sed 's/$/y/' >"$REPO/src/b.ts"
run_case "block: a codemod over other files after a small edit" block - "$(edit src/a.ts)" \
  "$(line Bash '{"command": "npx prettier --write src"}')"
run_case "block: Path().open(\"w\") counts as a repo write" block - \
  "$(line Bash "{\"command\": \"cd $REPO && python3 -c 'Path(\\\"src/a.ts\\\").open(\\\"w\\\")'\"}")"
reset

# the session's cwd is the repo root: a relative write target names neither the root nor a code_dirs folder
incwd() { line Bash "$(jq -cn --arg c "$1" '{command: $c}')" | jq -c --arg d "$REPO" '.cwd = $d'; }
mkdir -p "$REPO/lib" && seq 1 40 | sed 's/$/y/' >"$REPO/lib/a.ts"
run_case "block: a relative redirect from a cwd in the repo" block "no review yet" "$(incwd 'seq 40 > lib/a.ts')"
run_case "block: cat heredoc to a relative path" block - "$(incwd $'cat > lib/a.ts <<EOF\nx\nEOF')"
run_case "block: mv of a relative path" block - "$(incwd 'mv lib/b.ts lib/a.ts')"
run_case "pass: stderr, /dev/null, /tmp and fd redirects are not repo writes" pass - \
  "$(incwd 'grep -rn x . 2>/dev/null >/tmp/out.txt; ls >&2; node -e "a => b" 2>&1 | tee /tmp/log')"
run_case "pass: rm and cp on absolute paths outside the repo" pass - "$(incwd 'rm -rf /tmp/x && cp ~/a /tmp/b')"
run_case "pass: a copy from the repo to /tmp" pass - "$(incwd 'cp lib/a.ts /tmp/x')"
run_case "pass: a copy to a quoted /tmp path" pass - "$(incwd 'cp lib/a.ts "/tmp/x"')"
run_case "pass: > inside quotes is no redirect" pass - \
  "$(incwd $'jq \'select(.n > 3)\' f.json; awk \'$1 > 5\' x; echo "a > b"; node -e "a > b"')"
run_case "block: a quoted relative target" block - "$(incwd 'echo x > "lib/a.ts"')"
run_case "pass: the same relative redirect from a cwd outside the repo" pass - \
  "$(line Bash "$(jq -cn '{command: "seq 40 > lib/a.ts"}')" | jq -c '.cwd = "/elsewhere"')"
rm -rf "$REPO/lib"
reset

# snapshot branch: the snapshot is the reviewed tree
snap() { mkdir -p "$REPO/.git/claude-review" && ./review-snapshot.sh --tree "$REPO" >"$REPO/.git/claude-review/s1"; }
reviewer="$(line Agent '{"subagent_type": "ai-kit:change-reviewer", "description": "x"}')"
snap
sed -i.bak '1s/$/x/' "$REPO/src/a.ts" && rm "$REPO/src/a.ts.bak"
run_case "block: a 1-line fix after a review still goes to the re-check" block "SendMessage that reviewer" \
  "$reviewer" "$(edit src/a.ts)"
git -C "$REPO" checkout -q -- src
run_case "pass: nothing changed since the snapshot" pass - "$reviewer" "$(edit src/a.ts)"
printf '%s\n' '// note' >>"$REPO/src/a.ts"
run_case "pass: only a comment line added since the snapshot" pass - "$reviewer" "$(edit src/a.ts)"
reset
# a session-start snapshot: a Bash write is judged by what changed since, not by the names in its command
seq 1 30 | sed 's/$/y/' >"$REPO/src/other.ts"
snap
mkdir -p "$REPO/docs" && echo "see user.service.ts" >"$REPO/docs/plan.md"
mdwrite="$(line Bash "{\"command\": \"python3 - <<'EOF'\\nopen('$REPO/docs/plan.md', 'w').write('see user.service.ts')\\nEOF\"}")"
run_case "pass: a .md-only Bash write naming a .ts file, another session's change before the snapshot" pass - "$mdwrite"
sed -i.bak '1,20s/$/x/' "$REPO/src/c.ts" && rm "$REPO/src/c.ts.bak"
run_case "block: a Bash write to a .ts file after the snapshot" block "no review yet" \
  "$(line Bash "{\"command\": \"sed -i '' s/a/b/ $REPO/src/c.ts\"}")"
git -C "$REPO" checkout -q -- src/c.ts
sed -i.bak '1,20s/$/x/' "$REPO/src/b.ts" && rm "$REPO/src/b.ts.bak"
run_case "block: an Edit is still scoped to its path" block "no review yet" "$(edit src/b.ts)"
run_case "pass: an Edit does not count another session's change after the snapshot" pass - "$(edit src/a.ts)"
rm -rf "$REPO/docs"
reset

# records under ai/usage are logs, not work
usage() { mkdir -p "$REPO/ai/usage/2030-01" && seq 1 40 >"$REPO/ai/usage/2030-01/s1.jsonl"; }
snap
usage
run_case "pass: only ai/usage changed since the snapshot" pass - "$reviewer" "$(edit src/a.ts)"
rm -rf "$REPO/ai/usage"
reset
usage
run_case "pass: only ai/usage changed, no snapshot" pass - \
  "$(line Bash "{\"command\": \"echo x >> $REPO/ai/usage/2030-01/s1.jsonl\"}")"
rm -rf "$REPO/ai/usage"
reset

# a pruned snapshot is judged as none, not left to fail open
mkdir -p "$REPO/.git/claude-review" && echo 0123456789abcdef0123456789abcdef01234567 >"$REPO/.git/claude-review/s1"
sed -i.bak '1,20s/$/x/' "$REPO/src/a.ts" && rm "$REPO/src/a.ts.bak"
run_case "block: a snapshot tree gc has pruned" block "no review yet" "$(edit src/a.ts)"
reset

# regex characters in the repo path
REPO="$REPO/p(2" && mkdir -p "$REPO/ai/kit" "$REPO/src" && seq 1 40 >"$REPO/src/a.ts"
git -C "$REPO" init -q && git -C "$REPO" add -A
git -C "$REPO" -c user.name=t -c user.email=t@t commit -qm base --date 2020-01-01T00:00:00Z
sed -i.bak '1,20s/$/x/' "$REPO/src/a.ts" && rm "$REPO/src/a.ts.bak"
run_case "block: a repo path with ( still enforces review" block "no review yet" \
  "$(line Bash "$(jq -cn --arg c "echo x >> $REPO/src/a.ts" '{command: $c}')")"

echo "$pass passed, $fail failed"
((fail == 0))
