#!/usr/bin/env bash
# Tests for usage-flush.sh (SessionEnd), the idle flush from session-start.sh and the buffer-to-ai/usage flow: a
# throwaway repo, hand-built transcripts, the real hooks.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
HOOKS="$PWD"
CLI="$PWD/../scripts/usage.mjs"
TMP="$(mktemp -d)" || exit 1
trap 'rm -rf "$TMP"' EXIT
REPO="$(cd "$TMP" && pwd -P)" || exit 1

git -C "$REPO" init -q
git -C "$REPO" config user.name tester
git -C "$REPO" config user.email t@t
mkdir -p "$REPO/ai/kit"
echo '{}' >"$REPO/ai/kit/config.json"
git -C "$REPO" add -A
git -C "$REPO" commit -qm base
home_branch="$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"

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
t() { if "$@" >/dev/null; then echo 0; else echo 1; fi; }

month="$(date -u +%Y-%m)"
UD="$REPO/ai/usage/$month"
BUFS="$REPO/.git/claude-usage"
lines() { wc -l <"$1" | tr -d ' '; }

# transcript <file> <first user line>; asst <file> <id> <cache read tokens>
transcript() { jq -cn --arg t "$2" '{type: "user", timestamp: "2030-01-15T10:00:00Z", message: {role: "user", content: $t}}' >"$1"; }
asst() {
  jq -cn --arg id "$2" --argjson r "$3" '{type: "assistant", timestamp: "2030-01-15T10:00:30Z", message: {id: $id,
    model: "claude-opus-5-5", content: [{type: "text", text: "ok"}],
    usage: {input_tokens: 1, cache_read_input_tokens: $r, cache_creation_input_tokens: 0, output_tokens: 1}}}' >>"$1"
}
stop() { # <session> <transcript>
  jq -n --arg t "$2" --arg s "$1" --arg c "$REPO" '{transcript_path: $t, session_id: $s, cwd: $c}' |
    env -i PATH="$PATH" HOME="$HOME" "$HOOKS/usage-log.sh" >/dev/null 2>&1
}
flush() { # <session> → exit code of the SessionEnd hook
  jq -n --arg s "$1" --arg c "$REPO" '{session_id: $s, cwd: $c, hook_event_name: "SessionEnd"}' |
    env -i PATH="$PATH" HOME="$HOME" "$HOOKS/usage-flush.sh" 2>"$TMP/err"
}
sum_reads() { jq -s '[.[].agents[].read] | add' "$@"; }
cli() { CLAUDE_PROJECT_DIR="$REPO" node "$CLI" "$@"; }
age() { node -e 'const t = Date.now() / 1000 - Number(process.argv[2]); require("fs").utimesSync(process.argv[1], t, t)' "$1" "$2"; }

T1="$REPO/.git/t1.jsonl"
transcript "$T1" "first ask"
asst "$T1" m1 1000
stop s1 "$T1"
check "stop writes only the buffer: ai/usage absent, git status shows nothing for ai/" \
  "$(t bash -c '[[ -f "$1/s1.jsonl" && ! -e "$2/ai/usage" && -z "$(git -C "$2" status --porcelain -- ai)" ]]' _ "$BUFS" "$REPO")"

flush s1
check "SessionEnd flush writes ai/usage/<YYYY-MM>/<session>.jsonl, the buffer's lines" \
  "$(t bash -c '[[ "$(cat "$1/s1.jsonl")" == "$(cat "$2/s1.jsonl")" ]]' _ "$BUFS" "$UD")" "$(cat "$TMP/err")"
check "the buffer is kept as the session's state" "$(t test -f "$BUFS/s1.jsonl")"
sha1="$(shasum "$UD/s1.jsonl" | cut -d' ' -f1)"

asst "$T1" m2 2000
stop s1 "$T1"
flush s1
check "a second flush after more rounds writes <session>.2.jsonl with only the new record" \
  "$(t bash -c '[[ "$(wc -l <"$1/s1.2.jsonl" | tr -d " ")" == 1 && "$(jq -r ".agents[0].read" "$1/s1.2.jsonl")" == 2000 ]]' _ "$UD")"
check "the first file is never modified" "$(t test "$(shasum "$UD/s1.jsonl" | cut -d' ' -f1)" == "$sha1")"
flush s1
check "a flush with nothing new writes nothing" "$(t bash -c '[[ ! -e "$1/s1.3.jsonl" && "$(ls "$1" | wc -l | tr -d " ")" == 2 ]]' _ "$UD")"
check "summed records equal the transcript total" "$(t test "$(sum_reads "$UD"/s1*.jsonl)" == 3000)"

# a buffer lost on this machine is seeded from ai/usage: no double count
rm -f "$BUFS/s1.jsonl" "$BUFS/s1.flushed" "$BUFS"/s1.json
asst "$T1" m3 4000
stop s1 "$T1"
check "seeded from ai/usage: the new record holds only the new tokens" \
  "$(t bash -c '[[ "$(wc -l <"$1/s1.jsonl" | tr -d " ")" == 3 && "$(tail -n 1 "$1/s1.jsonl" | jq -r ".agents[0].read")" == 4000 ]]' _ "$BUFS")"
flush s1
check "after the seed the flush writes only the new record, as file 3" \
  "$(t bash -c '[[ "$(wc -l <"$1/s1.3.jsonl" | tr -d " ")" == 1 ]]' _ "$UD")"
check "still equal to the transcript total" "$(t test "$(sum_reads "$UD"/s1*.jsonl)" == 7000)"

# idle flush: other sessions' buffers whose last write is over 6 hours old
T7="$REPO/.git/t7.jsonl"
transcript "$T7" "idle ask"
asst "$T7" m1 500
stop s7 "$T7"
cli flush --idle
check "idle flush skips a buffer written just now" "$(t test ! -e "$UD/s7.jsonl")"
age "$BUFS/s7.jsonl" 60
cli flush --idle
check "idle flush skips a buffer written 1 minute ago" "$(t test ! -e "$UD/s7.jsonl")"
age "$BUFS/s7.jsonl" 25200
cli flush --idle --except s7
check "idle flush --except skips the named session" "$(t test ! -e "$UD/s7.jsonl")"
cli flush --idle
check "idle flush writes a buffer 7 hours old" "$(t test "$(sum_reads "$UD/s7.jsonl")" == 500)"

T8="$REPO/.git/t8.jsonl"
transcript "$T8" "stale ask"
asst "$T8" m1 600
stop s8 "$T8"
age "$BUFS/s8.jsonl" 25200
stop s9 "$T8"
age "$BUFS/s9.jsonl" 25200
out="$(jq -n --arg s s9 '{session_id: $s}' | env -i PATH="$PATH" HOME="$HOME" CLAUDE_PROJECT_DIR="$REPO" "$HOOKS/session-start.sh" 2>&1 >/dev/null)"
check "session-start flushes other sessions' stale buffers, not its own, and prints nothing on stderr" \
  "$(t bash -c '[[ -f "$1/s8.jsonl" && ! -e "$1/s9.jsonl" && -z "$2" ]]' _ "$UD" "$out")" "$out"

# usage.enabled false → the SessionEnd hook writes nothing
T10="$REPO/.git/t10.jsonl"
transcript "$T10" "disabled ask"
asst "$T10" m1 700
stop s10 "$T10"
echo '{"usage": {"enabled": false}}' >"$REPO/ai/kit/config.json"
flush s10
check "usage.enabled false: SessionEnd flush writes nothing" "$(t bash -c '[[ ! -e "$1/s10.jsonl" && "$2" == 0 ]]' _ "$UD" "$?")"
age "$BUFS/s10.jsonl" 25200
cli flush --idle
check "usage.enabled false: idle flush writes nothing" "$(t test ! -e "$UD/s10.jsonl")"
echo '{}' >"$REPO/ai/kit/config.json"

# the cross-branch flow: part committed on main, part committed on feature, switch, record, merge, switch
T11="$REPO/.git/t11.jsonl"
transcript "$T11" "branching ask"
asst "$T11" m1 1000
stop s11 "$T11"
flush s11
git -C "$REPO" add ai/usage/"$month"/s11.jsonl
git -C "$REPO" commit -qm "records on main"
git -C "$REPO" switch -q -c feature
asst "$T11" m2 2000
stop s11 "$T11"
flush s11
git -C "$REPO" add ai/usage/"$month"/s11.2.jsonl
git -C "$REPO" commit -qm "records on feature"
git -C "$REPO" switch -q "$home_branch"
echo x >"$REPO/x.txt"
git -C "$REPO" add x.txt
git -C "$REPO" commit -qm "main moves on"
asst "$T11" m3 3000
stop s11 "$T11"
flush s11
check "on main after the switch the new records are a new untracked file, nothing else changed" \
  "$(t bash -c '[[ -f "$1/s11.3.jsonl" && "$(git -C "$2" status --porcelain -- ai/usage/"$3"/s11.jsonl ai/usage/"$3"/s11.2.jsonl ai/usage/"$3"/s11.3.jsonl)" == "?? ai/usage/$3/s11.3.jsonl" ]]' _ "$UD" "$REPO" "$month")"
git -C "$REPO" merge -q --no-edit feature 2>"$TMP/merge-err"
check "git merge feature succeeds" "$(t test "$(git -C "$REPO" rev-list --count --merges HEAD)" == 1)" "$(cat "$TMP/merge-err")"
check "after the merge the summed records equal the transcript total" "$(t test "$(sum_reads "$UD"/s11*.jsonl)" == 6000)"
git -C "$REPO" switch -q feature 2>"$TMP/switch-err"
check "git switch feature succeeds" "$(t test "$(git -C "$REPO" rev-parse --abbrev-ref HEAD)" == feature)" "$(cat "$TMP/switch-err")"

echo "$pass passed, $fail failed"
((fail == 0))
