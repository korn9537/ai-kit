#!/usr/bin/env bash
# Tests for kit-log.sh: a throwaway repo and a hand-built transcript; part 1 (stop) checks the buffer file under the
# git dir, stdout and the exit code; part 2 the detached sends of session-end and session-start.sh to a mock usage API.
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
  "$(t bash -c '[[ ! -e "$1" && "$2" == 0 && "$3" == kit-log:* && "$(wc -l <<<"$3" | tr -d " ")" == 1 ]]' _ "$(buf s3)" "$RC" "$ERR")" \
  "rc=$RC err=$ERR"
echo '{"transcript_path": "/nope"}' | env -i PATH="$PATH" HOME="$HOME" CLAUDE_PROJECT_DIR="$REPO" "$HOOK" stop 2>"$TMP/err"
rc=$?
check "skip: no session id → exit 0, one stderr line" \
  "$(t bash -c '[[ "$1" == 0 && "$(cat "$2")" == kit-log:* ]]' _ "$rc" "$TMP/err")"

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


# ---- part 2: session-end and the idle pass of session-start.sh start a detached send to a mock API (a fresh repo) ----
REPO="$TMP/r2"
mkdir -p "$REPO"
git -C "$REPO" init -q
git -C "$REPO" config user.name tester
git -C "$REPO" config user.email t@t
mkdir -p "$REPO/ai/kit"
echo '{}' >"$REPO/ai/kit/config.json"
git -C "$REPO" add -A
git -C "$REPO" commit -qm base
BUFS="$REPO/.git/claude-usage"

# the mock API: one line per POST ("<path> <session ids in the body>"), 200 always
node -e '
  const fs = require("fs");
  require("http").createServer((q, s) => {
    let b = "";
    q.on("data", (d) => (b += d));
    q.on("end", () => {
      let ids = "";
      try { ids = (JSON.parse(b).sessions ?? []).map((x) => x.session_id).join(","); } catch {}
      fs.appendFileSync(process.argv[1], `${q.url} ${ids}\n`);
      s.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  }).listen(0, "127.0.0.1", function () { fs.writeFileSync(process.argv[2], String(this.address().port)); });
' "$TMP/posts" "$TMP/port" &
MOCK=$!
disown "$MOCK"
trap 'kill "$MOCK" 2>/dev/null; rm -rf "$TMP" "$TMP.wt"' EXIT
for _ in $(seq 1 50); do [[ -s "$TMP/port" ]] && break; sleep 0.1; done
API="http://127.0.0.1:$(cat "$TMP/port")"
touch "$TMP/posts"

transcript() { jq -cn --arg t "$2" '{type: "user", timestamp: "2030-01-15T10:00:00Z", message: {role: "user", content: $t}}' >"$1"; }
asst() {
  jq -cn --arg id "$2" --argjson r "$3" '{type: "assistant", timestamp: "2030-01-15T10:00:30Z", message: {id: $id,
    model: "claude-opus-5-5", content: [{type: "text", text: "ok"}],
    usage: {input_tokens: 1, cache_read_input_tokens: $r, cache_creation_input_tokens: 0, output_tokens: 1}}}' >>"$1"
}
stop() { # <session> <transcript>
  jq -n --arg t "$2" --arg s "$1" --arg c "$REPO" '{transcript_path: $t, session_id: $s, cwd: $c}' |
    env -i PATH="$PATH" HOME="$HOME" AI_KIT_USAGE_ENDPOINT="$API" "$HOOK" stop >/dev/null 2>&1
}
end_hook() { # <session> [transcript] → exit code of the SessionEnd hook
  jq -n --arg s "$1" --arg c "$REPO" --arg t "${2:-}" '{session_id: $s, cwd: $c, hook_event_name: "SessionEnd"}
    + (if $t == "" then {} else {transcript_path: $t} end)' |
    env -i PATH="$PATH" HOME="$HOME" AI_KIT_USAGE_ENDPOINT="$API" "$HOOK" session-end 2>"$TMP/err"
}
# posted <session>: waits up to 10 s for the mock to see that session's events
posted() { for _ in $(seq 1 100); do grep -q "^/v1/events $1\$" "$TMP/posts" && return 0; sleep 0.1; done; return 1; }
age() { node -e 'const t = Date.now() / 1000 - Number(process.argv[2]); require("fs").utimesSync(process.argv[1], t, t)' "$1" "$2"; }
now_ms() { node -e 'console.log(Date.now())'; }

T1="$REPO/.git/t1.jsonl"
transcript "$T1" "first ask"
asst "$T1" m1 1000
stop s1 "$T1"
check "stop writes the buffer, the transcript path and the session's root, nothing in ai/" \
  "$(t bash -c '[[ -f "$1/s1.jsonl" && "$(sed -n 1p "$1/s1.transcript")" == "$3" && "$(sed -n 2p "$1/s1.transcript")" == "$2" && ! -e "$2/ai/usage" && -z "$(git -C "$2" status --porcelain -- ai)" ]]' _ "$BUFS" "$REPO" "$T1")"
check "stop sends nothing" "$(t test ! -s "$TMP/posts")"

t0="$(now_ms)"
end_hook s1 "$T1"
rc=$?
t1="$(now_ms)"
check "SessionEnd exits 0 within 3 s (the send is detached)" "$(t test "$rc" == 0 -a $((t1 - t0)) -lt 3000)" "rc=$rc $((t1 - t0)) ms $(cat "$TMP/err")"
check "the detached send posts the session's events" "$(t posted s1)" "$(cat "$TMP/posts") $(cat "$BUFS/send.log" 2>/dev/null)"
for _ in $(seq 1 50); do [[ -f "$BUFS/s1.sent" ]] && break; sleep 0.1; done
check "and records what it sent in <session>.sent; still nothing in ai/" \
  "$(t bash -c '[[ "$(jq -r .transcript "$1/s1.sent")" == "$3" && ! -e "$2/ai/usage" ]]' _ "$BUFS" "$REPO" "$T1")"

# idle pass: other sessions whose transcript is over 6 hours old and grew since their .sent
T7="$REPO/.git/t7.jsonl"
transcript "$T7" "idle ask"
asst "$T7" m1 500
stop s7 "$T7"
T9="$REPO/.git/t9.jsonl"
transcript "$T9" "own ask"
asst "$T9" m1 500
stop s9 "$T9"
age "$T7" 25200
age "$T9" 25200
out="$(jq -n --arg s s9 '{session_id: $s}' | env -i PATH="$PATH" HOME="$HOME" CLAUDE_PROJECT_DIR="$REPO" AI_KIT_USAGE_ENDPOINT="$API" "$PWD/session-start.sh" 2>&1 >/dev/null)"
check "session-start sends other idle sessions, prints nothing on stderr" "$(t posted s7)" "$out $(cat "$TMP/posts")"
sleep 0.5
check "and not its own session" "$(t bash -c '! grep -q " s9$" "$1"' _ "$TMP/posts")"
age "$T1" 25200
out="$(jq -n --arg s s9 '{session_id: $s}' | env -i PATH="$PATH" HOME="$HOME" CLAUDE_PROJECT_DIR="$REPO" AI_KIT_USAGE_ENDPOINT="$API" "$PWD/session-start.sh" 2>&1 >/dev/null)"
sleep 1
check "a session unchanged since its .sent is not sent again" "$(t bash -c '[[ "$(grep -c " s1$" "$1")" == 1 && "$(grep -c " s7$" "$1")" == 1 ]]' _ "$TMP/posts")" "$(cat "$TMP/posts")"

jq -n --arg s s13 --arg c "$REPO" '{session_id: $s, cwd: $c, transcript_path: "/nonexistent"}' |
  env -i PATH="$PATH" HOME="$HOME" AI_KIT_USAGE_ENDPOINT="$API" "$HOOK" session-end >/dev/null 2>&1
check "SessionEnd with an unreadable transcript still exits 0" "$(t test "$?" == 0)"

# usage.enabled false → SessionEnd starts no send
T10="$REPO/.git/t10.jsonl"
transcript "$T10" "disabled ask"
asst "$T10" m1 700
stop s10 "$T10"
echo '{"usage": {"enabled": false}}' >"$REPO/ai/kit/config.json"
end_hook s10 "$T10"
sleep 1
check "usage.enabled false: SessionEnd sends nothing" "$(t bash -c '! grep -q " s10$" "$1"' _ "$TMP/posts")"
echo '{}' >"$REPO/ai/kit/config.json"

# subagent-stop: a finished decider's verdict is logged under the git common dir until sent, and the hook exits 0
mkdir -p "$TMP/proj/ss/subagents"
jq -n --arg t "$TMP/proj/ss.jsonl" --arg c "$REPO" '{session_id: "ss", cwd: $c, transcript_path: $t, agent_id: "a9",
  agent_type: "ai-kit:decider", last_assistant_message: "Verdict: DECIDED\nChoice: x\nReason: y"}' |
  env -i PATH="$PATH" HOME="$HOME" AI_KIT_USAGE_ENDPOINT="$API" "$HOOK" subagent-stop 2>"$TMP/err"
rc=$?
check "subagent-stop logs a decider verdict to .git/claude-decider/log/, exit 0" \
  "$(t bash -c '[[ "$1" == 0 ]] && grep -q "\"choice\":\"x\"" "$2"/.git/claude-decider/log/ss.a9.jsonl' _ "$rc" "$REPO")" "rc=$rc $(cat "$TMP/err")"

echo "$pass passed, $fail failed"
((fail == 0))
