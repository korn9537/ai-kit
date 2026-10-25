#!/usr/bin/env bash
# Tests for usage-log.sh: a throwaway repo and a hand-built transcript; each case checks the record file, stdout
# and the exit code.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
HOOK="$PWD/usage-log.sh"
PLUGIN_JSON="$PWD/../.claude-plugin/plugin.json"
TMP="$(mktemp -d)" || exit 1
trap 'rm -rf "$TMP"' EXIT
REPO="$(cd "$TMP" && pwd -P)" || exit 1

git -C "$REPO" init -q
git -C "$REPO" config user.name tester
mkdir -p "$REPO/ai/kit"
echo '{}' >"$REPO/ai/kit/config.json"
git -C "$REPO" add -A
git -C "$REPO" -c user.email=t@t commit -qm base
home_branch="$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
git -C "$REPO" branch other

pass=0
fail=0
# check <desc> <condition exit code> [detail]
check() {
  if [[ "$2" == 0 ]]; then
    echo "ok   - $1"
    pass=$((pass + 1))
  else
    echo "FAIL - $1"
    [[ -z "${3:-}" ]] || echo "       $3"
    fail=$((fail + 1))
  fi
}
# t <command...> → 0 or 1 as a check argument
t() { if "$@" >/dev/null; then echo 0; else echo 1; fi; }

T="$REPO/.git/t.jsonl"
jq -cn '{type: "user", timestamp: "2030-01-15T10:00:00Z", message: {role: "user", content: "fix the login bug"}}' >"$T"
jq -cn '{type: "assistant", timestamp: "2030-01-15T10:00:30Z", message: {id: "m1", model: "claude-opus-5-5",
  content: [{type: "text", text: "done"}],
  usage: {input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, output_tokens: 50}}}' >>"$T"

# stop_hook <session> <transcript> → stdout in $OUT, stderr in $ERR, exit code in $RC
stop_hook() {
  OUT="$(jq -n --arg t "$2" --arg s "$1" --arg c "$REPO" '{transcript_path: $t, session_id: $s, cwd: $c}' |
    env -i PATH="$PATH" HOME="$HOME" "$HOOK" 2>"$TMP/err")"
  RC=$?
  ERR="$(cat "$TMP/err")"
}
lines() { wc -l <"$1" | tr -d ' '; }
file="$REPO/ai/usage/2030-01/s1.1.jsonl"

stop_hook s1 "$T"
check "record: first stop writes one line under ai/usage/<YYYY-MM>/<session>.<n>.jsonl" \
  "$(t bash -c '[[ -f "$1" && "$(wc -l <"$1" | tr -d " ")" == 1 ]] && jq -e ".v == 1 and .session == \"s1\" and .round == 1" "$1" >/dev/null' _ "$file")" \
  "rc=$RC err=$ERR"
check "record: stdout is {\"systemMessage\": ...} and exit 0" \
  "$(t bash -c '[[ "$1" == 0 ]] && jq -e ".systemMessage | startswith(\"tokens this round\")" <<<"$2" >/dev/null' _ "$RC" "$OUT")" \
  "rc=$RC out=$OUT"
check "record: no prompt text anywhere in ai/usage or the summary; the record has prompt_chars; the digest shows it" \
  "$(t bash -c '! grep -rq "fix the login bug" "$1/ai/usage" && ! grep -q "fix the login bug" <<<"$4" &&
    jq -e "(has(\"prompt\") | not) and .prompt_chars == 17" "$2" >/dev/null &&
    CLAUDE_PROJECT_DIR="$1" node "$3" digest | grep -q " r1 17 chars "' _ "$REPO" "$file" "$PWD/../scripts/usage.mjs" "$OUT")"
check "record: user, project and branch come from git" \
  "$(t jq -e --arg p "$(basename "$REPO")" '.user == "tester" and .project == $p and (.branch | length > 0)' "$file")"
check "record: the kit version is the plugin's" "$(t test "$(jq -r .kit "$file")" == "$(jq -r .version "$PLUGIN_JSON")")"

stop_hook s1 "$T"
check "record: second stop with nothing new writes nothing" \
  "$(t bash -c '[[ "$1" == 1 && -z "$2" && "$3" == 0 ]]' _ "$(lines "$file")" "$OUT" "$RC")" "out=$OUT"

# a cache lost between stops must not double-count: the file is the state
rm -rf "$REPO/.git/claude-usage"
stop_hook s1 "$T"
check "record: lost cache, same transcript → still one line" \
  "$(t bash -c '[[ "$1" == 1 && -z "$2" ]]' _ "$(lines "$file")" "$OUT")" "out=$OUT"

jq -cn '{type: "assistant", timestamp: "2030-02-01T10:01:00Z", message: {id: "m2", model: "claude-opus-5-5",
  content: [{type: "text", text: "more"}],
  usage: {input_tokens: 5, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0, output_tokens: 20}}}' >>"$T"
stop_hook s1 "$T"
check "record: later stop appends to the session's file, even in a later month" \
  "$(t bash -c '[[ "$1" == 2 && ! -e "$2/ai/usage/2030-02" ]]' _ "$(lines "$file")" "$REPO")" "err=$ERR"
check "record: a later record in the same round has no prompt_chars" "$(sed -n 2p "$file" | t jq -e 'has("prompt_chars") | not')"

stop_hook s2 "$T"
check "record: a second session writes its own file" "$(t test -f "$REPO/ai/usage/2030-01/s2.1.jsonl")"

# a part that is in the index is never modified: the next record starts part 2 and git switch still works
git -C "$REPO" add ai/usage
git -C "$REPO" -c user.email=t@t commit -qm "records part 1"
before="$(shasum "$file" | cut -d' ' -f1)"
jq -cn '{type: "assistant", timestamp: "2030-02-01T10:02:00Z", message: {id: "m3", model: "claude-opus-5-5",
  content: [{type: "text", text: "after the commit"}],
  usage: {input_tokens: 1, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0, output_tokens: 5}}}' >>"$T"
stop_hook s1 "$T"
part2="$REPO/ai/usage/2030-01/s1.2.jsonl"
check "parts: a record after a commit of part 1 goes to part 2, part 1 is untouched" \
  "$(t bash -c '[[ -f "$1" && "$(wc -l <"$1" | tr -d " ")" == 1 && "$(shasum "$2" | cut -d" " -f1)" == "$3" ]]' _ "$part2" "$file" "$before")" "err=$ERR"
check "parts: part 2 delta ignores part 1 (round 1 continues, no prompt)" \
  "$(t jq -e '.round == 1 and has("prompt_chars") == false and (.agents[0].read == 3000)' "$part2")"
check "parts: git status shows only untracked files for ai/usage" \
  "$(t bash -c '[[ -n "$1" && -z "$(grep -v "^?? " <<<"$1")" ]]' _ "$(git -C "$REPO" status --porcelain -- ai/usage)")"
git -C "$REPO" switch -q other 2>"$TMP/switch-err"
check "parts: git switch to another branch succeeds" "$(t test "$(git -C "$REPO" rev-parse --abbrev-ref HEAD)" == other)" "$(cat "$TMP/switch-err")"
git -C "$REPO" switch -q "$home_branch" 2>/dev/null

# skip cases start from a repo with no usage records
rm -rf "$REPO/ai/usage" "$REPO/.git/claude-usage"
mv "$REPO/ai/kit" "$REPO/ai/kit.off"
stop_hook s3 "$T"
check "skip: no ai/kit/ → no file, exit 0" "$(t bash -c '[[ ! -e "$1/ai/usage" && "$2" == 0 && -z "$3" ]]' _ "$REPO" "$RC" "$OUT")"
mv "$REPO/ai/kit.off" "$REPO/ai/kit"

echo '{"usage": {"enabled": false}}' >"$REPO/ai/kit/config.json"
stop_hook s3 "$T"
check "skip: \"usage\": {\"enabled\": false} → no file" \
  "$(t bash -c '[[ ! -e "$1/ai/usage" && "$2" == 0 && -z "$3" ]]' _ "$REPO" "$RC" "$OUT")"

echo '{}' >"$REPO/ai/kit/config.json"
stop_hook s3 "$REPO/.git/missing.jsonl"
check "skip: unreadable transcript → exit 0, one stderr line" \
  "$(t bash -c '[[ ! -e "$1/ai/usage" && "$2" == 0 && "$3" == usage-log:* && "$(wc -l <<<"$3" | tr -d " ")" == 1 ]]' _ "$REPO" "$RC" "$ERR")" \
  "rc=$RC err=$ERR"
echo '{"transcript_path": "/nope"}' | env -i PATH="$PATH" HOME="$HOME" CLAUDE_PROJECT_DIR="$REPO" "$HOOK" 2>"$TMP/err"
rc=$?
check "skip: no session id → exit 0, one stderr line" \
  "$(t bash -c '[[ "$1" == 0 && "$(cat "$2")" == usage-log:* ]]' _ "$rc" "$TMP/err")"

echo '{"usage": {"prices": {"claude-opus-5-5": 100}}}' >"$REPO/ai/kit/config.json"
stop_hook s5 "$T"
check "config usage.prices overrides the default price" "$(t test "$OUT" != "${OUT%\$0.09*}")" "$OUT"

echo "$pass passed, $fail failed"
((fail == 0))
