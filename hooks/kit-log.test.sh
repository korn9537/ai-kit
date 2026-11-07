#!/usr/bin/env bash
# Tests for kit-log.sh: a throwaway repo and a hand-built transcript; part 1 (stop) checks the buffer file under the
# git dir, stdout and the exit code; part 2 (session-end) the flush into ai/usage/ and the idle flush from
# session-start.sh.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
HOOK="$PWD/kit-log.sh"
PLUGIN_JSON="$PWD/../.claude-plugin/plugin.json"
TMP="$(mktemp -d)" || exit 1
trap 'rm -rf "$TMP" "$TMP.wt"' EXIT
REPO="$(cd "$TMP" && pwd -P)" || exit 1

git -C "$REPO" init -q
git -C "$REPO" config user.name tester
mkdir -p "$REPO/ai/kit"
echo '{}' >"$REPO/ai/kit/config.json"
git -C "$REPO" add -A
git -C "$REPO" -c user.email=t@t commit -qm base

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
    env -i PATH="$PATH" HOME="$HOME" "$HOOK" stop 2>"$TMP/err")"
  RC=$?
  ERR="$(cat "$TMP/err")"
}
lines() { wc -l <"$1" | tr -d ' '; }
buf() { echo "$REPO/.git/claude-usage/$1.jsonl"; }
file="$(buf s1)"

stop_hook s1 "$T"
check "record: first stop writes one line to <git-common-dir>/claude-usage/<session>.jsonl" \
  "$(t bash -c '[[ -f "$1" && "$(wc -l <"$1" | tr -d " ")" == 1 ]] && jq -e ".v == 1 and .session == \"s1\" and .round == 1" "$1" >/dev/null' _ "$file")" \
  "rc=$RC err=$ERR"
check "record: nothing under ai/usage and git status shows nothing for ai/" \
  "$(t bash -c '[[ ! -e "$1/ai/usage" && -z "$(git -C "$1" status --porcelain -- ai)" ]]' _ "$REPO")"
check "record: stdout is {\"systemMessage\": ...} and exit 0" \
  "$(t bash -c '[[ "$1" == 0 ]] && jq -e ".systemMessage | startswith(\"tokens this round\")" <<<"$2" >/dev/null' _ "$RC" "$OUT")" \
  "rc=$RC out=$OUT"
check "record: no prompt text in the buffer or the summary; the record has prompt_chars" \
  "$(t bash -c '! grep -rq "fix the login bug" "$1/.git/claude-usage" && ! grep -q "fix the login bug" <<<"$3" &&
    jq -e "(has(\"prompt\") | not) and .prompt_chars == 17" "$2" >/dev/null' _ "$REPO" "$file" "$OUT")"
check "record: user, project and branch come from git" \
  "$(t jq -e --arg p "$(basename "$REPO")" '.user == "tester" and .project == $p and (.branch | length > 0)' "$file")"
check "record: the kit version is the plugin's" "$(t test "$(jq -r .kit "$file")" == "$(jq -r .version "$PLUGIN_JSON")")"

stop_hook s1 "$T"
check "record: second stop with nothing new writes nothing" \
  "$(t bash -c '[[ "$1" == 1 && -z "$2" && "$3" == 0 ]]' _ "$(lines "$file")" "$OUT" "$RC")" "out=$OUT"

# a cache lost between stops must not double-count: the buffer is the state
rm -f "$REPO"/.git/claude-usage/*.json
stop_hook s1 "$T"
check "record: lost cache, same transcript → still one line" \
  "$(t bash -c '[[ "$1" == 1 && -z "$2" ]]' _ "$(lines "$file")" "$OUT")" "out=$OUT"

jq -cn '{type: "assistant", timestamp: "2030-02-01T10:01:00Z", message: {id: "m2", model: "claude-opus-5-5",
  content: [{type: "text", text: "more"}],
  usage: {input_tokens: 5, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0, output_tokens: 20}}}' >>"$T"
stop_hook s1 "$T"
check "record: a later stop appends to the session's buffer, still nothing in ai/usage" \
  "$(t bash -c '[[ "$1" == 2 && ! -e "$2/ai/usage" ]]' _ "$(lines "$file")" "$REPO")" "err=$ERR"
check "record: a later record in the same round has no prompt_chars" "$(sed -n 2p "$file" | t jq -e 'has("prompt_chars") | not')"

stop_hook s2 "$T"
check "record: a second session has its own buffer" "$(t test -f "$(buf s2)")"

# a linked worktree shares the main repo's buffer
git -C "$REPO" worktree add -q "$TMP.wt" -b wtbranch
mkdir -p "$TMP.wt/ai/kit"
echo '{}' >"$TMP.wt/ai/kit/config.json"
jq -n --arg t "$T" --arg c "$TMP.wt" '{transcript_path: $t, session_id: "s6", cwd: $c}' |
  env -i PATH="$PATH" HOME="$HOME" "$HOOK" stop >/dev/null 2>&1
check "record: from a linked worktree the buffer is in the main git dir" "$(t test -f "$(buf s6)")"

# skip cases start from a repo with no buffers
rm -rf "$REPO/ai/usage" "$REPO/.git/claude-usage"
mv "$REPO/ai/kit" "$REPO/ai/kit.off"
stop_hook s3 "$T"
check "skip: no ai/kit/ → no buffer, exit 0" "$(t bash -c '[[ ! -e "$1" && "$2" == 0 && -z "$3" ]]' _ "$(buf s3)" "$RC" "$OUT")"
mv "$REPO/ai/kit.off" "$REPO/ai/kit"

echo '{"usage": {"enabled": false}}' >"$REPO/ai/kit/config.json"
stop_hook s3 "$T"
check "skip: \"usage\": {\"enabled\": false} → no buffer" \
  "$(t bash -c '[[ ! -e "$1" && "$2" == 0 && -z "$3" ]]' _ "$(buf s3)" "$RC" "$OUT")"

echo '{}' >"$REPO/ai/kit/config.json"
stop_hook s3 "$REPO/.git/missing.jsonl"
check "skip: unreadable transcript → exit 0, one stderr line" \
  "$(t bash -c '[[ ! -e "$1" && "$2" == 0 && "$3" == usage-log:* && "$(wc -l <<<"$3" | tr -d " ")" == 1 ]]' _ "$(buf s3)" "$RC" "$ERR")" \
  "rc=$RC err=$ERR"
echo '{"transcript_path": "/nope"}' | env -i PATH="$PATH" HOME="$HOME" CLAUDE_PROJECT_DIR="$REPO" "$HOOK" stop 2>"$TMP/err"
rc=$?
check "skip: no session id → exit 0, one stderr line" \
  "$(t bash -c '[[ "$1" == 0 && "$(cat "$2")" == usage-log:* ]]' _ "$rc" "$TMP/err")"

echo '{"usage": {"prices": {"claude-opus-5-5": 100}}}' >"$REPO/ai/kit/config.json"
stop_hook s5 "$T"
check "config usage.prices overrides the default price" "$(t test "$OUT" != "${OUT%\$0.08*}")" "$OUT"

# git commit -q prints no hash: the record still names HEAD's commits since the round's prompt, none from before it
GIT_COMMITTER_DATE="2030-01-15T09:00:00Z" git -C "$REPO" -c user.email=t@t commit -q --allow-empty -m before
GIT_COMMITTER_DATE="2030-01-15T10:00:10Z" git -C "$REPO" -c user.email=t@t commit -q --allow-empty -m quiet
quiet="$(git -C "$REPO" log -1 --format=%h)"
stop_hook s9 "$T"
check "record: a quiet commit after the prompt is in commits, one before it is not" \
  "$(t jq -e --arg h "$quiet" '.commits == [$h]' "$(buf s9)")" "$(cat "$(buf s9)" 2>/dev/null)"


# ---- part 2: session-end, the idle flush and the buffer-to-ai/usage flow (a fresh repo) ----
REPO="$TMP/r2"
mkdir -p "$REPO"
git -C "$REPO" init -q
git -C "$REPO" config user.name tester
git -C "$REPO" config user.email t@t
mkdir -p "$REPO/ai/kit"
echo '{}' >"$REPO/ai/kit/config.json"
git -C "$REPO" add -A
git -C "$REPO" commit -qm base
home_branch="$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
CLI="$PWD/../scripts/usage.mjs"

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
    env -i PATH="$PATH" HOME="$HOME" "$HOOK" stop >/dev/null 2>&1
}
flush() { # <session> [transcript] → exit code of the SessionEnd hook
  jq -n --arg s "$1" --arg c "$REPO" --arg t "${2:-}" '{session_id: $s, cwd: $c, hook_event_name: "SessionEnd"}
    + (if $t == "" then {} else {transcript_path: $t} end)' |
    env -i PATH="$PATH" HOME="$HOME" "$HOOK" session-end 2>"$TMP/err"
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
out="$(jq -n --arg s s9 '{session_id: $s}' | env -i PATH="$PATH" HOME="$HOME" CLAUDE_PROJECT_DIR="$REPO" "$PWD/session-start.sh" 2>&1 >/dev/null)"
check "session-start flushes other sessions' stale buffers, not its own, and prints nothing on stderr" \
  "$(t bash -c '[[ -f "$1/s8.jsonl" && ! -e "$1/s9.jsonl" && -z "$2" ]]' _ "$UD" "$out")" "$out"

# SessionEnd records what came after the last Stop, then flushes
T12="$REPO/.git/t12.jsonl"
transcript "$T12" "tail ask"
asst "$T12" m1 1000
stop s12 "$T12"
asst "$T12" m2 5000
flush s12 "$T12"
check "SessionEnd records the tokens after the last Stop: summed records equal the transcript total" \
  "$(t test "$(sum_reads "$UD"/s12*.jsonl)" == 6000)" "$(cat "$TMP/err")"
flush s12 "$T12"
check "a second SessionEnd adds nothing" "$(t test "$(sum_reads "$UD"/s12*.jsonl)" == 6000)"
jq -n --arg s s13 --arg c "$REPO" '{session_id: $s, cwd: $c, transcript_path: "/nonexistent"}' |
  env -i PATH="$PATH" HOME="$HOME" "$HOOK" session-end >/dev/null 2>&1
check "SessionEnd with an unreadable transcript still exits 0" "$(t test "$?" == 0)"

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
