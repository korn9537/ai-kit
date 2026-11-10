# Plan usage-hooks

goal: the request in the block below, one commit per batch.
job: `2026-11-10-usage-hooks`
status: the commits of this job, by their Batch trailer (`plan.mjs status`); never edited here.

```json
{
  "job": "2026-11-10-usage-hooks",
  "request": {
    "lines": [
      "ปิดงานรีวิว hook/rule มากเกินไป: (ค) digest แยก cost/commit ตามขนาดงาน (commit ต่อรอบ) เพื่อไม่ให้ตัวเลข ",
      "all-cost/commits หลอก (ข) นับการทำงานของแต่ละ hook จาก transcript ในเครื่อง ผู้ใช้คนเดียวเครื่องเดียว ",
      "จึงไม่แก้ hook"
    ]
  },
  "batches": [
    {
      "id": "digest-commit-rounds",
      "title": "usage digest: cost per commit by commits per round, and per kit over commit rounds only",
      "brief": {
        "lines": [
          "Why: `usage.mjs digest` prints `all cost / commits` (scripts/lib/usage-digest.mjs:374-378) and a per-kit ",
          "`cost/commits` (:392-412). Both divide ALL cost, including rounds where no commit hash was seen, by the ",
          "commits seen in this project's records. In asw-sales-flow (2026-10-26..11-09) that read $0.85 (2.22.0) to ",
          "$2.60 (2.36.0) while cost per commit over rounds that HAD commits went $0.83 (2.22.0) to $0.70 (2.36.0) ",
          "and $0.30 (2.34.0): 73-84% of the newer kits' cost sat in rounds with no seen commit (86 of 137 Job ",
          "commits of 11-08..09 live in the sibling clone's records, 27 in none). So the figure cannot say whether ",
          "the per-commit pipeline got dearer. Change, in scripts/lib/usage-digest.mjs digest(): (1) after the `## ",
          "per commit` block add `## by commits per round`, skipped in baseline mode (1 record = 1 session), fixed ",
          "size: one line per bucket `0`, `1`, `2-3`, `4-7`, `8+` commits in the round (a round = the records sharing ",
          "session#round, commits counted with uniqueCommits :63, cost = sum of weight(agent) like the existing ",
          "rows): `<bucket> commits: <rounds> rounds · <cost> · <commits> commits · cost/commit <x> · reviewer a% · ",
          "coordinator b% · commit c%`; the `0` bucket line has no cost/commit and says its share of total cost ",
          "instead (`<p>% of cost`); an empty bucket is omitted; end with one line `commits are the hashes seen in ",
          "this repo's session transcripts; a sibling clone's commits are in its own records`. (2) In each `## by ",
          "kit` line (:392-412) add `commit rounds cost/commit <x>` computed over rounds with at least one commit ",
          "only (omit when there are none) and `no-commit rounds <p>% of cost`. Keep every existing line and number ",
          "as is; the digest stays a fixed-size text (CAP table at the top of the file; the new section is at most 6 ",
          "lines). Tests in scripts/usage-digest.test.mjs: a fixture with rounds of 0, 1, 3, 5 and 9 commits across ",
          "two kits asserting each bucket line, the per-kit additions, that baseline mode prints no such section, ",
          "that an input with no commits prints only the `0` bucket, and that all older assertions pass unchanged. ",
          "Update commands/usage.md (step 2: name cost per commit from `by commits per round` and the per-kit ",
          "commit-round figure, never from `all cost / commits`, when judging whether the per-commit pipeline got ",
          "dearer), the README §Commands digest paragraph and docs/spec.md if its usage-digest row describes the ",
          "sections. Verify once: node scripts/test-all.mjs."
        ]
      },
      "accept": [
        {
          "lines": [
            "digest prints `## by commits per round` with one line per non-empty bucket and the explanatory last ",
            "line, and prints it in no baseline digest"
          ]
        },
        {
          "lines": [
            "each `## by kit` line carries `commit rounds cost/commit` over rounds with commits only and `no-commit ",
            "rounds <p>% of cost`; every existing line is unchanged"
          ]
        },
        {
          "lines": [
            "running `node scripts/usage.mjs digest --since 2026-10-26` in /Users/palakorn/Work/asw-sales-flow shows ",
            "the 1-commit bucket at $2.81 per commit (71 rounds) and the 0 bucket at 40% of cost (all kits together; ",
            "the per-kit lines show the split: commit rounds $0.83 for 2.22.0, $0.70 for 2.36.0)"
          ]
        },
        "commands/usage.md tells the analyst to use the new section, and node scripts/test-all.mjs passes"
      ],
      "risks": [
        {
          "lines": [
            "a round whose records are split across files: commits and cost must be summed per session#round first, ",
            "or a commit round is counted twice"
          ]
        },
        {
          "lines": [
            "a round with commits but zero priced cost (unpriced model) gives cost/commit $0.00 or NaN: print ",
            "`unpriced` or omit, never NaN"
          ]
        },
        {
          "lines": [
            "a commit hash that appears in two records (sameCommit prefix match) must count once, as uniqueCommits ",
            "does elsewhere"
          ]
        },
        {
          "lines": [
            "the digest is read by /ai-kit:usage and tests with exact-line expectations: adding lines inside `## by ",
            "kit` could break a parser that expects the old part order, so append the new parts last"
          ]
        }
      ],
      "tests": [
        {
          "lines": [
            "scripts/usage-digest.test.mjs: bucket lines and numbers for rounds of 0, 1, 3, 5, 9 commits; per-kit ",
            "additions; no section in baseline; zero-cost commit round prints no NaN; one commit seen in two records ",
            "counts once"
          ]
        },
        "all existing usage-digest and usage tests pass unchanged"
      ],
      "verify": [
        "node scripts/test-all.mjs"
      ],
      "waitsFor": [],
      "alsoInScope": []
    },
    {
      "id": "usage-hooks",
      "title": "usage.mjs hooks: count each kit hook's firings from the local transcripts",
      "brief": {
        "lines": [
          "Why: a hook's value or cost cannot be judged because no record says it fired; the digest holds tokens ",
          "only. The user works alone on one machine, so this machine's Claude Code transcripts ",
          "(`transcriptsDir(root)` in scripts/lib/usage-collect.mjs:21-30, files `<session>.jsonl` and ",
          "`<session>/subagents/**/*.jsonl`) are all the data: count from them, do not change any hook. A working ",
          "prototype is at /private/tmp/claude-501/-Users-palakorn-Work-ai-kit/ff1cd8de-d7d6-4534-a770-a717ddfbbda7/sc",
          "ratchpad/hookscan.mjs (read it first; it counted 49 PostToolUse, 147 Stop and 53 sweeping-stage blocks on ",
          "asw-sales-flow): it dedups lines by uuid, takes text from user tool results and from `attachment` records ",
          "(`stdout`, `stderr`, `blockingError.blockingError`, `content`), matches each hook's message text, counts ",
          "main vs subagent (path contains /subagents/ or isSidechain), per session, and per kit version from ",
          "ai/usage records. Build it into the kit: new scripts/lib/hook-events.mjs holding ONE table `HOOK_EVENTS` ",
          "of `{id, file, anchor, re}`: `id` as `<script>.<behavior>` (bash-guard.staging, bash-guard.build, ",
          "memory-guard, agent-model-guard, ask-guard.none/.decided/.pending, ",
          "stop.block.no-review/.since-review/.since-recheck, post-edit.fail, ",
          "handoff.read-count/.whole-file/.max-context, ",
          "session-start.kit-proposals-note/.plans-note/.memory-note/.unattended-stale-note, ",
          "pre-commit.docs/.comments/.size/.backslash/.eslint-moved/.prettier-fail/.node-missing/.kit-check, ",
          "commit-msg.job), `file` the hook or script that prints it, `anchor` a literal string that must appear in ",
          "that file, `re` the transcript regex. Also three non-message events kept in the same file as `{id, kind: ",
          "\"prompt\"|\"command\"}`: `stop.skip-review-escape` (a user prompt starting with `skip review` or `ไม่ต้อง ",
          "review`), `stop.review-closed-phrase` (an assistant text with plain `Review closed: re-checked once`), and ",
          "Bash commands using `ALLOW_BUILD_WHILE_DEV=1`, `ALLOW_LARGE_EDIT=1` or `git commit --no-verify`. Add ",
          "`usage.mjs hooks [--since YYYY-MM-DD]` (scripts/usage.mjs main() :335-392 (synchronous: await the async ",
          "scan with a .catch that prints one line and sets the exit code; add `hooks [--since]` to its usage line at ",
          ":390); usage text of digestCmd :313-319 as a model): reads the project's transcripts, prints a fixed-size ",
          "text, writes nothing: header `files N · sessions N · since <date>`, then one line per event with a count, ",
          "most first, capped at 40: `<id>: <n> (main <a>, sub <b>) in <s> sessions`, then `no firing: <ids>` (ids ",
          "capped, `+k more`). It prints only counts, never message text or paths. Read each file as a stream by ",
          "lines (a project's transcripts are hundreds of MB: no whole-directory readFileSync of everything at once) ",
          "and skip a transcript whose mtime is before --since. Tests: scripts/usage-hooks.test.mjs builds a temp ",
          "CLAUDE_CONFIG_DIR with a transcript dir (main file plus a subagent file) holding one line per event type, ",
          "a repeated uuid and an old line, and asserts the counts, the main/sub split, the dedup, the `--since` cut, ",
          "`no firing`, and that unrelated text matches nothing; plus a DRIFT test: for every table entry with an ",
          "`anchor`, the anchor string is found in the entry's `file` (hooks/*.sh, githooks/*, scripts/*.mjs), so ",
          "renaming a hook message fails the suite. Name scripts/lib/hook-events.mjs and scripts/usage-hooks.test.mjs ",
          "in docs/spec.md and README Layout; add `usage.mjs hooks` to README §Commands and to commands/usage.md (one ",
          "line: use it before judging that a hook or rule can go). Verify once: node scripts/test-all.mjs. MATCHING ",
          "RULES from the plan review (all required): (a) map tool_use_id to tool name; match pre-commit, commit-msg ",
          "and other git-hook events only in Bash tool_results, and PreToolUse/PostToolUse/Stop guard events only in ",
          "hook-block results or `attachment` records or the harness's `Stop hook feedback:` user text; never in an ",
          "Agent/Task result, a Read/Grep result or a typed prompt (a committer report quoting a hook message, or a ",
          "hook file read aloud, must count 0; a pre-commit failure inside a subagent must count once, not again in ",
          "the main Agent result that quotes it); (b) copy the hook's own regexes exactly for the prompt and phrase ",
          "events: hooks/review-before-stop.sh:126 accepts `^\\s*(ไม่ต้อง ?review|skip review)` case-insensitively, ",
          "also inside content arrays, and skips text starting with `<`; hooks/review-before-stop.sh:103 excludes a ",
          "closed phrase preceded by a backtick, a quote or the curly quote; give these entries an `anchor` in that ",
          "file so the drift test covers them; (c) the drift test also asserts each entry's `re` matches a sample ",
          "message built from its anchor; (d) print the kit version per line as a capped part `kits 2.34.0:n 2.36.0:m ",
          "?:k` (`?` for a session with no usage record) and test it; (e) --since cuts a transcript by file mtime AND ",
          "each line by its `timestamp`; a line with no uuid or no timestamp is skipped; the last line of a file may ",
          "be cut off (the live session is being appended): skip a line that does not parse."
        ]
      },
      "accept": [
        {
          "lines": [
            "`node scripts/usage.mjs hooks --since 2026-10-26` run in /Users/palakorn/Work/asw-sales-flow prints ",
            "counts near the prototype's (stop blocks 147 in total, bash-guard.staging about 53, post-edit.fail about ",
            "49, commit-msg.job about 128) in under 60 seconds and prints no message text"
          ]
        },
        "every HOOK_EVENTS entry with an anchor has that anchor in its file, enforced by a test",
        "no hook script is changed by this batch",
        {
          "lines": [
            "docs/spec.md, README Layout and Commands and commands/usage.md name the new file and subcommand, and ",
            "node scripts/test-all.mjs passes"
          ]
        }
      ],
      "risks": [
        {
          "lines": [
            "a project's transcripts are large: reading everything into memory or scanning all months slows or kills ",
            "the command; stream by line and skip files older than --since"
          ]
        },
        {
          "lines": [
            "a hook message edited later makes the count silently 0: the drift test is the guard, and `no firing` ",
            "must not be read as proof a hook is unused when its anchor test is missing"
          ]
        },
        {
          "lines": [
            "the same line appears in a main transcript and a subagent copy or after a resume: dedup by uuid, or ",
            "counts double"
          ]
        },
        {
          "lines": [
            "a pattern that is too loose (a user pasting a hook message, an assistant quoting it) counts text that is ",
            "not a firing: match tool results, attachments and prompts only, as the prototype does"
          ]
        },
        {
          "lines": [
            "kit version per session comes from ai/usage records that may not exist (a fresh clone, usage off): print ",
            "`?` and still count"
          ]
        },
        "no `ai/kit/` in the project or no transcripts dir: print one line and exit 0, never throw"
      ],
      "tests": [
        {
          "lines": [
            "scripts/usage-hooks.test.mjs: counts, main/sub split, uuid dedup, --since, no-firing line, no text ",
            "leaked, empty/missing transcripts dir"
          ]
        },
        "scripts/usage-hooks.test.mjs DRIFT: every anchor exists in its file",
        "scripts/spec.test.mjs names the new files"
      ],
      "verify": [
        "node scripts/test-all.mjs"
      ],
      "waitsFor": [],
      "alsoInScope": []
    },
    {
      "id": "release",
      "title": "2.40.0: version and CHANGELOG for the digest section and usage.mjs hooks",
      "brief": {
        "lines": [
          "Bump version in .claude-plugin/plugin.json from 2.39.0 to 2.40.0 (minor: a new digest section and a new ",
          "subcommand) and add a `## 2.40.0` entry at the top of CHANGELOG.md. Take the figures from the real output ",
          "of `node scripts/usage.mjs digest --since 2026-10-26` run in /Users/palakorn/Work/asw-sales-flow, not from ",
          "this text: the digest gains `## by commits per round` and, per kit, cost/commit over commit rounds only ",
          "and the share of cost in rounds with no seen commit, because `all cost / commits` divided all cost by the ",
          "commits seen in one project's transcripts (asw-sales-flow: $0.85 for 2.22.0 against $2.60 for 2.36.0) ",
          "while the share of cost in no-commit rounds rose from 40% to 73% and the commit-round figure showed no ",
          "rise ($0.83 to $0.70); a commit counts in the earliest round that saw it. `usage.mjs hooks [--since]` ",
          "counts each kit hook's firings from the local transcripts (no hook changed; the table is ",
          "scripts/lib/hook-events.mjs and a test fails when a hook message it matches is renamed). No project needs ",
          "to edit anything. Wrap lines at 120. Check docs/spec.md P5 mentions both and fix only what is wrong. ",
          "Verify once: node scripts/test-all.mjs."
        ]
      },
      "accept": [
        "plugin.json says 2.40.0 and CHANGELOG.md has a 2.40.0 entry naming both changes",
        "node scripts/test-all.mjs passes"
      ],
      "risks": [
        "none: <doc and version only; no code line changes>"
      ],
      "tests": [
        "none: <doc and version only; the suite runs in verify>"
      ],
      "verify": [
        "node scripts/test-all.mjs"
      ],
      "waitsFor": [
        "usage-hooks"
      ],
      "alsoInScope": []
    }
  ]
}
```
