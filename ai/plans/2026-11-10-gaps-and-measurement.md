# Plan gaps-and-measurement

goal: the request in the block below, one commit per batch.
job: `2026-11-10-gaps-and-measurement`
status: the commits of this job, by their Batch trailer (`plan.mjs status`); never edited here.

```json
{
  "job": "2026-11-10-gaps-and-measurement",
  "request": {
    "lines": [
      "ทำได้ทั้งหมดเลยนะ (implement all 10 proposed features: Bash-write post-edit checks, bash-guard gaps, ",
      "memory-guard for Bash, ask-guard per-question match, review gap during an open plan, usage compare by kit ",
      "version, refusal records, agent evals, more conventions, route-vs-API-spec check)"
    ]
  },
  "batches": [
    {
      "id": "guard",
      "title": "bash-guard: xargs, sh -c, git add $(...); memory dir writes through Bash",
      "brief": {
        "lines": [
          "Kit clone (the repo is the plugin). Two gaps in hooks/bash-guard.sh. (a) Known gaps at ",
          "hooks/bash-guard.sh:11: `xargs git add` (no named files = sweep), `bash -c`/`sh -c`/`zsh -c \"...\"` ",
          "(recurse: run the -c word through kit_split_cmd (hooks/lib.sh:187) and scan it; scan() at ",
          "bash-guard.sh:219-263 uses globals t/n/i/wd, save and restore them), `git add $(...)`/backtick args (the ",
          "raw pass at :290-293; path check path_sweeps :96, git_sweeps :109-168) count as a sweep. strip_lead :33-70 ",
          "holds the wrapper list (time|env|sudo|nice|timeout) for xargs and its flags. (b) Memory dir: ",
          "hooks/memory-guard.sh:15-24 builds the memory-dir regex inline (CLAUDE_CONFIG_DIR, Git Bash /c/ spelling); ",
          "move it to a lib.sh function (e.g. kit_memory_re) used by both hooks. In bash-guard's scan, per split ",
          "segment (words already unquoted, so no quadratic raw-text match; see why memory-guard.sh:4-6 excluded ",
          "Bash), block a write target under the memory dir: `>`/`>>` redirect target, tee args, cp/mv/install last ",
          "word, sed -i / perl -i files, mkdir/touch. Expand a leading ~ and $HOME / ${HOME}. Block message names the ",
          "repo file to use, as memory-guard does. Update the header comments, README.md hooks section (bash-guard ",
          "and memory-guard bullets: drop the 'Not seen' list for what is now seen, say Bash writes into the memory ",
          "dir are blocked), docs/spec.md rows for both hooks and lib.sh's function list. No version bump or ",
          "CHANGELOG (the release batch does it)."
        ]
      },
      "accept": [
        {
          "lines": [
            "`xargs git add`, `bash -c \"git add -A\"`, `sh -c 'git add .'` and `git add $(git ls-files -m)` are ",
            "blocked; `xargs git add -n` and `bash -c \"git add src/a.ts\"` pass"
          ]
        },
        {
          "lines": [
            "echo x > ~/.claude/projects/p/memory/a.md, tee, cp/mv into that dir and sed -i on a file there are ",
            "blocked, also with $HOME and CLAUDE_CONFIG_DIR spellings; a write elsewhere under ~/.claude passes"
          ]
        },
        "memory-guard.sh and bash-guard.sh use one shared regex function from hooks/lib.sh",
        "README.md and docs/spec.md describe the new behavior; node scripts/test-all.mjs passes"
      ],
      "risks": [
        {
          "lines": [
            "recursion into sh -c could loop or blow up on nested quoting: cap the depth (e.g. 3) and fall back to ",
            "the raw check"
          ]
        },
        {
          "lines": [
            "a heredoc body or commit message naming the memory path must not block (scan works on split segments ",
            "where bodies are dropped)"
          ]
        },
        "bash 3.2 on macOS: no associative arrays, no ${var,,}; keep the scan linear on long input"
      ],
      "tests": [
        {
          "lines": [
            "hooks/bash-guard.test.sh: cases for each new blocked form and each pass form above, a depth-capped ",
            "nested sh -c, a commit message naming `xargs git add`"
          ]
        },
        {
          "lines": [
            "hooks/memory-guard.test.sh still passes with the moved regex; bash-guard.test.sh cases for ",
            "redirect/tee/cp/mv/sed -i into the memory dir, $HOME and CLAUDE_CONFIG_DIR, and a heredoc body naming ",
            "the path that passes"
          ]
        }
      ],
      "verify": [
        "bash hooks/bash-guard.test.sh",
        "bash hooks/memory-guard.test.sh",
        "node scripts/spec.test.mjs",
        "node scripts/test-all.mjs"
      ],
      "waitsFor": [],
      "alsoInScope": []
    },
    {
      "id": "bash-edits",
      "title": "post-edit checks for files a Bash call wrote",
      "brief": {
        "lines": [
          "Kit clone. hooks/post-edit-check.sh runs comment/doc/project checks only for Edit/Write/MultiEdit ",
          "(.tool_input.file_path at :9-10; scope jq :27-31; run()/run_to() :37-61; checks :64-68; exit 2 :75). A ",
          "Bash write (sed -i, python3, heredoc) is first checked at pre-commit: in 5 days 49 committers hit the ",
          "comment rule that way (CHANGELOG 2.46.1). Add: PreToolUse Bash touches a marker file keyed by tool_use_id ",
          "in the kit state dir (kit_state_dir, hooks/lib.sh:33; e.g. claude-review/bash-<id>); PostToolUse Bash ",
          "lists files changed in the work tree (`git status --porcelain -uall`, modified/added/untracked, not ",
          "deleted) whose mtime is newer than that marker (find -newer), removes the marker, and runs the same checks ",
          "over each file in scope, reporting failures the same way (exit 2, file named, said to come from this Bash ",
          "call). Refactor post-edit-check.sh so the per-file run takes a list of files (one path from Edit/Write, ",
          "many from Bash). Keep it cheap: no-op when the project has no ai/kit/, when the command does not look like ",
          "a write is irrelevant (always run, the porcelain+mtime filter is the gate), cap at e.g. 20 files and say ",
          "so. Skip files under ai/usage and .git. Wire in hooks/hooks.json (PreToolUse Bash beside bash-guard; ",
          "PostToolUse Bash beside handoff-nudge, which stays). Update README.md post-edit bullet and docs/spec.md ",
          "rows (hooks.json events). No version bump or CHANGELOG."
        ]
      },
      "accept": [
        {
          "lines": [
            "a Bash call that writes a code file breaking the comment rule gets the same post-edit failure message as ",
            "an Edit would, naming the file"
          ]
        },
        "files changed by another process before the Bash call started (mtime older than the marker) are not checked",
        "a Bash call that writes nothing produces no output and adds under ~100 ms on a medium repo",
        "Edit/Write behavior is unchanged; README.md and docs/spec.md describe it; node scripts/test-all.mjs passes"
      ],
      "risks": [
        {
          "lines": [
            "another session in the shared checkout writes during the Bash call: its file is checked too; acceptable, ",
            "the message says 'changed during this Bash call', never blocks the next command"
          ]
        },
        {
          "lines": [
            "marker left behind when PostToolUse never runs (interrupted call): stale markers older than a day are ",
            "removed on the next run"
          ]
        },
        {
          "lines": [
            "mtime granularity of 1 s on some filesystems: touch the marker then compare with -newer; a file written ",
            "in the same second may be missed, said in a comment"
          ]
        },
        "huge untracked trees (node_modules not ignored): cap the file count"
      ],
      "tests": [
        {
          "lines": [
            "hooks/post-edit-check.test.sh: Pre then Post Bash with a sed-written bad file → exit 2 naming it; with a ",
            "file modified before the marker → no output; with no marker (Pre never ran) → no output; cap message ",
            "over 20 files; Edit path unchanged"
          ]
        }
      ],
      "verify": [
        "bash hooks/post-edit-check.test.sh",
        "node scripts/spec.test.mjs",
        "node scripts/test-all.mjs",
        "claude plugin validate /Users/palakorn/Work/ai-kit"
      ],
      "waitsFor": [
        "guard"
      ],
      "alsoInScope": []
    },
    {
      "id": "ask",
      "title": "ask-guard matches the decider verdict per question",
      "brief": {
        "lines": [
          "Kit clone. hooks/ask-guard.sh:25 pipes input to scripts/decider.mjs guard (guard() :180-203, context() ",
          ":150-155, deciders() :70-133, parseBlocks :37-56, FIELDS :15, FRESH_MS :17; used ids stored in ",
          "<git-common-dir>/claude-decider/<session>.json, written :195-201). Today one OWNER call serves one ask ",
          "whatever it asked (README.md:103-104 'Gap: the verdict is matched per call, not per question'). Change: ",
          "guard reads tool_input.questions[].question (and header) and matches each asked question to a verdict ",
          "block's `Question:` line (agents/decider.md:25-39) by normalized token overlap (lowercase, strip ",
          "punctuation, overlap >= ~0.5 of the shorter side; pick the threshold and say why in a comment). Used state ",
          "per (call id, block index). Pass when every asked question matches an unused fresh OWNER block; any asked ",
          "question matching only a DECIDED block → the block message says to act on that choice (quote it); a ",
          "question matching no block → say which question has no decider verdict and to ask the decider about it. ",
          "Keep fail-open behavior (node missing, guard error, decider.enabled false, always_owner). Old state files ",
          "with {used:[ids]} still read. Update README.md ask-guard bullet (drop the Gap sentence) and docs/spec.md. ",
          "No version bump or CHANGELOG."
        ]
      },
      "accept": [
        "an OWNER verdict on question A does not let an AskUserQuestion about an unrelated question B through",
        "two questions asked in one AskUserQuestion pass only when each matches an OWNER block; a block is used once",
        "a question matching a DECIDED block is blocked with that block's Choice in the message",
        "old {used:[ids]} state files still work; README.md and docs/spec.md updated; node scripts/test-all.mjs passes"
      ],
      "risks": [
        {
          "lines": [
            "the decider rephrases the question: fuzzy overlap could miss it and block a legitimate ask; threshold ",
            "tuned in tests with a rephrased pair, and the message tells how to proceed"
          ]
        },
        "two decider calls running at once for different questions: each block matched independently",
        "question text with non-ASCII (Thai) words: tokenizer must keep Unicode letters (\\p{L})"
      ],
      "tests": [
        {
          "lines": [
            "scripts/decider.test.mjs: match/no-match pairs incl. a rephrased question and a Thai one; per-block used ",
            "state; legacy state file"
          ]
        },
        {
          "lines": [
            "hooks/ask-guard.test.sh: A-verdict blocks B; two questions both covered pass; DECIDED match blocks with ",
            "Choice"
          ]
        }
      ],
      "verify": [
        "node scripts/decider.test.mjs",
        "bash hooks/ask-guard.test.sh",
        "node scripts/test-all.mjs"
      ],
      "waitsFor": [],
      "alsoInScope": []
    },
    {
      "id": "plan-scope",
      "title": "review-before-stop: an edit outside the open plan's files is reviewed",
      "brief": {
        "lines": [
          "Kit clone. hooks/review-before-stop.sh:208-229: while the session's job has an ai/plans/<job>.md plan with ",
          "batches left (plan.mjs status <job> --quick, :226-227), the stop exits 0, so an unrelated edit passes ",
          "unreviewed (gap noted :210-211, README.md:155-156, CHANGELOG 2.45.0). $files/$paths/$changed (session ",
          "edits since the snapshot) are computed :168-205. Add a plan.mjs subcommand (e.g. `plan.mjs scope <job>`) ",
          "printing the paths the plan covers: paths named in every batch's brief and alsoInScope (reuse the path ",
          "regex of sharedFiles, scripts/plan.mjs:362-372, exported as a function) plus files touched by the job's ",
          "commits (git log of commits with the Job trailer). The hook passes mid-plan only when every changed path ",
          "is in that set (a named directory covers files under it); otherwise it falls through to the normal review ",
          "ask, naming the paths outside the plan. Update README.md (drop the gap sentence), docs/spec.md, and the ",
          "hook comment. No version bump or CHANGELOG."
        ]
      },
      "accept": [
        {
          "lines": [
            "mid-plan, a stop whose changed files are all named by the plan's briefs or the job's commits passes with ",
            "no review, as before"
          ]
        },
        "mid-plan, a stop with a changed file the plan does not name asks for review and names that file",
        "a plan whose briefs name no paths behaves as today only for files of the job's commits",
        "README.md and docs/spec.md updated; node scripts/test-all.mjs passes"
      ],
      "risks": [
        {
          "lines": [
            "briefs name files loosely (basename only, root files without a slash): match a basename-only mention ",
            "too, so a planned edit is not blocked"
          ]
        },
        {
          "lines": [
            "node missing or plan.mjs scope failing: fall back to today's pass (never block on a kit error), stderr ",
            "one line"
          ]
        },
        "large job history: limit git log to the job's commits only"
      ],
      "tests": [
        "scripts/plan.test.mjs: scope output from briefs, alsoInScope and job commits; basename and directory mentions",
        {
          "lines": [
            "hooks/review-before-stop.test.sh: mid-plan in-scope edit passes; out-of-scope edit asks for review; ",
            "scope error falls back to pass"
          ]
        }
      ],
      "verify": [
        "node scripts/plan.test.mjs",
        "bash hooks/review-before-stop.test.sh",
        "node scripts/test-all.mjs"
      ],
      "waitsFor": [],
      "alsoInScope": []
    },
    {
      "id": "usage",
      "title": "refusal records in ai/usage and digest --compare by kit version",
      "brief": {
        "lines": [
          "Kit clone. (a) Refusals: githooks/pre-commit exits at :34 node missing, :55 backslash, :64 docs, :75 ",
          "eslint moved, :82 size, :93/:111/:132 prettier, :153 comments, :168 kit check; githooks/commit-msg:19 Job ",
          "trailer. Today they are only counted from local transcripts by text match ",
          "(scripts/lib/hook-events.mjs:43-52, `usage.mjs hooks`), so other machines and changed message texts are ",
          "missed. Add `usage.mjs refusal <rule-id>` (ids as in hook-events.mjs, e.g. pre-commit.comments, ",
          "commit-msg.job) appending {v:1, ts, rule, kit, branch} to an untracked buffer in ",
          "<git-common-dir>/claude-usage (scripts/lib/state-dirs.mjs:25 usageBufDir) under its lock (withLock ",
          "usage.mjs:88, never wait over 1.5 s, never fail the hook); each refusal exit calls it once, best effort, ",
          "skipped when node is missing (node-missing exit just skips). Flush (flushSession/flushLocked ",
          "usage.mjs:135-170, session-start idle flush) moves buffered refusals to a NEW file ",
          "ai/usage/refusals/<YYYY-MM>/<random-or-host-hash>.jsonl, never modifying a tracked file; pre-commit ",
          "already stages ai/usage new files by name (:37-47). loadRecords (scripts/lib/usage-digest.mjs:195) skips ",
          "decisions/ today: skip refusals/ there and load them separately. digest gets a `## refusals` section: ",
          "count per rule and per kit. (b) Compare: `usage.mjs digest --compare <kitA> <kitB>` (digestCmd ",
          "usage.mjs:314-340, usage strings :416) prints for each of the two kit versions side by side: sessions, ",
          "rounds, cost per round, cost per commit, main-session peak, Read+Grep per round (agents[].tools), ",
          "committer calls per commit, reviewer findings, refusals per commit, and the change in %. Build it from the ",
          "same records and roundInfo used by the `## by kit` section (usage-digest.mjs:415-455); version prefixes ",
          "(2.45) match all patches. An unknown version says so. commands/usage.md mentions --compare for measuring a ",
          "kit change. Update README.md Commands and usage text, docs/spec.md (new folder, new subcommand). No ",
          "version bump or CHANGELOG."
        ]
      },
      "accept": [
        {
          "lines": [
            "a refused commit (comment rule, Job trailer) leaves one record in the buffer; after flush it is in a new ",
            "ai/usage/refusals/** file; no tracked file is modified"
          ]
        },
        "digest prints a refusals section counted per rule and per kit; old records without refusals still digest",
        "digest --compare 2.45 2.46 prints both columns and the % change for each metric; an unknown version is named",
        {
          "lines": [
            "a refusal record never makes the commit hook slower than 1.5 s extra or fail it; README.md, ",
            "commands/usage.md and docs/spec.md updated; node scripts/test-all.mjs passes"
          ]
        }
      ],
      "risks": [
        "lock contention with the Stop hook's record: bounded wait, then skip with one stderr line",
        "the hooks run under sh with no session id: records carry none; flush is per machine buffer, not per session",
        "a commit run in a worktree: git-common-dir is shared, so one buffer for all worktrees, as the usage buffer",
        "file name collisions across machines: name includes a random or host-hash part"
      ],
      "tests": [
        "scripts/usage.test.mjs: refusal append under lock, lock timeout skip, flush to new file, never rewrite",
        "scripts/usage-digest.test.mjs: refusals section, compare with two kits, prefix match, unknown version",
        {
          "lines": [
            "githooks/pre-commit.test.sh and commit-msg.test.sh: a refused commit writes one record; node missing ",
            "still refuses without a record"
          ]
        }
      ],
      "verify": [
        "node scripts/usage.test.mjs",
        "node scripts/usage-digest.test.mjs",
        "bash githooks/pre-commit.test.sh",
        "bash githooks/commit-msg.test.sh",
        "node scripts/test-all.mjs"
      ],
      "waitsFor": [],
      "alsoInScope": []
    },
    {
      "id": "routes",
      "title": "check-specs warns of API routes with no API spec entry",
      "brief": {
        "lines": [
          "Kit clone. scripts/check-specs.mjs collects API spec endpoints in apiEndpoints() (:116-) with METHODS and ",
          "norm() and warns when a screen names a missing endpoint (:184-189); it is warn-only, run by ",
          "githooks/pre-commit :157-160 when ui.platforms is non-empty. API spec format: templates/ai/api.md, ",
          "docs/screen-specs.md:61-65 (`## METHOD /path` per endpoint, or an OpenAPI .json for ui.api). Add the ",
          "reverse check: routes found in code with no API spec entry. Route extraction (new module ",
          "scripts/lib/routes.mjs, path regexes as in scripts/kit/inventory.mjs:25-30): Next app router ",
          "app/**/route.(ts|js) (exported GET/POST/... functions; path from directories, [id] → :id, (group) ",
          "dropped), Next pages/api, NestJS @Controller('x') + @Get/@Post(...) in *.controller.ts, Express/Fastify ",
          "`app|router.get|post|put|patch|delete('/path'` , FastAPI/Flask `@app|router.get('/path')` / `@app.route`. ",
          "Normalize with the same norm(). Scope: only files staged in the commit (pre-commit) or all with --all; ",
          "warn per route `METHOD /path (file:line) has no entry in <ui.api>`. Config: `ui.routes` (default true when ",
          "ui.api is set; false turns it off). Export the pieces of check-specs.mjs needed without changing its CLI. ",
          "inventory may reuse routes.mjs for a count. Update docs/screen-specs.md, README.md config text, ",
          "docs/spec.md, templates/ai-kit-project if the key is shown there. No version bump or CHANGELOG."
        ]
      },
      "accept": [
        {
          "lines": [
            "a staged Next route.ts exporting GET under app/api/orders/[id]/ with no `## GET /api/orders/:id` in the ",
            "API spec gets one warning naming file:line; with the entry, none"
          ]
        },
        "NestJS, Express and FastAPI fixtures are detected; the commit is never blocked by this check",
        "ui.routes false turns it off; a project without ui.api is unchanged",
        "docs/screen-specs.md, README.md and docs/spec.md updated; node scripts/test-all.mjs passes"
      ],
      "risks": [
        {
          "lines": [
            "regex extraction misses dynamic routes or mounts with prefixes (app.use('/v1', router)): say so in docs; ",
            "no false block since warn-only"
          ]
        },
        "large repos: --all is opt-in, the pre-commit scans staged files only",
        "path param spellings differ ({id}, :id, [id]): norm() handles all, tested"
      ],
      "tests": [
        {
          "lines": [
            "scripts/check-specs.test.mjs: one fixture per framework, with and without the spec entry; ui.routes ",
            "false; param spelling cases"
          ]
        },
        "scripts/kit-inventory.test.mjs still passes"
      ],
      "verify": [
        "node scripts/check-specs.test.mjs",
        "node scripts/kit-inventory.test.mjs",
        "node scripts/test-all.mjs"
      ],
      "waitsFor": [],
      "alsoInScope": []
    },
    {
      "id": "conventions",
      "title": "conventions for python, react, flutter and java",
      "brief": {
        "lines": [
          "Kit clone. Add conventions/python.md, conventions/react.md (Adds to typescript.md), conventions/flutter.md ",
          "(Adds to dart.md), conventions/java.md, in the shape of the existing files (conventions/typeorm.md, ",
          "typescript.md: `# X conventions`, `Reader: ... Adds to \\`general.md\\` ...` line, numbered items `1. ",
          "**Name** — rule, reason, Wrong:/Right: example`, 120-col wrap, 5-10 items, no other headings). Rules must ",
          "pass the cross-repo test of docs/kit-proposals.md (no project names or paths) and not repeat general.md; ",
          "pick widely agreed, checkable rules (e.g. Python: typed signatures on public functions, no bare except, no ",
          "mutable default args, timezone-aware datetimes, parametrized SQL; React: hooks rules, keys from ids not ",
          "indexes, server state via one query layer, no derived state in useState, effects only for sync with ",
          "outside systems; Flutter: const constructors, dispose controllers, no BuildContext across async gaps, ",
          "state management one way; Java: Optional not null for absent returns, try-with-resources, BigDecimal for ",
          "money, no catch Exception without rethrow/log). kit/sync.mjs:54-70 follows `Adds to` links, so they must ",
          "be correct. Update README.md (line 51 examples and the Thai section list), docs/spec.md (name each new ",
          "file). No version bump or CHANGELOG."
        ]
      },
      "accept": [
        "four new convention files in the existing shape, each with a correct Adds to line and Wrong/Right examples",
        {
          "lines": [
            "kit.mjs check accepts conventions [\"python\",\"react\",\"flutter\",\"java\"] in a fixture project and ",
            "sync copies the linked files"
          ]
        },
        {
          "lines": [
            "no project-specific names; check-docs passes; README.md and docs/spec.md name them; node ",
            "scripts/test-all.mjs passes"
          ]
        }
      ],
      "risks": [
        "none: doc-only content; the one code-side risk, a wrong Adds to link, is covered by the sync test"
      ],
      "tests": [
        {
          "lines": [
            "scripts/unattended.test.mjs (or the existing sync test): a fixture with conventions ",
            "[\"react\",\"flutter\"] copies typescript.md and dart.md too"
          ]
        }
      ],
      "verify": [
        "node scripts/spec.test.mjs",
        "node scripts/check-docs.mjs --wrap conventions/*.md",
        "node scripts/test-all.mjs"
      ],
      "waitsFor": [],
      "alsoInScope": []
    },
    {
      "id": "evals",
      "title": "claude plugin eval suite for the kit agents",
      "brief": {
        "lines": [
          "Kit clone. Agents (agents/decider.md, change-reviewer.md, committer.md, business-analyst.md) have no ",
          "tests. Add an eval suite for `claude plugin eval` at evals/ (plugin root). Format (from `claude plugin ",
          "eval --help`, Claude Code 2.1.234; confirm with --help yourself): evals/<case>/prompt.md with frontmatter ",
          "(name, tags, runs, allowed_tools, max_turns) and the prompt as body; evals/<case>/graders/*.md each with ",
          "frontmatter `type:` regex (pattern, flags, match, target: last_message) | tool_used (tool, input_match, ",
          "min) | llm (criteria) | file_exists ...; results go to evals/results/ (gitignore it). Cases: ",
          "decider-decided (a code question the repo settles → one block, Verdict: DECIDED, Kind: -, Sources ",
          "non-empty), decider-owner-money (a paid-plan question → Verdict: OWNER, Kind: money), decider-format ",
          "(exactly the 8 fields of agents/decider.md:25-39 per block, nothing after the last block: regex graders), ",
          "reviewer-finds-bug (prompt carries a small inline diff with an off-by-one; ai-kit:change-reviewer must ",
          "report it CONFIRMED: llm grader + regex on CONFIRMED), ba-summary (business-analyst returns its sections: ",
          "regex on headings of agents/business-analyst.md). Use deterministic graders where possible, tool_used to ",
          "check the subagent ran (subagent_type matching (?:[\\w-]+:)?decider). Do NOT run the evals: each run calls ",
          "the model and costs money; only run what loads cases without a model if --help offers such a mode (e.g. ",
          "listing). Add a script entry or README section: how to run (`claude plugin eval . --ablation none --runs 1 ",
          "--case 'decider-*'`), CI form (--trust-plugin --no-publish --max-cost-usd 5 --threshold 0.9) and the cost ",
          "(sessions = cases × runs). Not part of scripts/test-all.mjs. Update docs/spec.md (name evals/ and its ",
          "cases), README.md Layout and Editing the kit, .gitignore. No version bump or CHANGELOG."
        ]
      },
      "accept": [
        "evals/ holds the five cases with graders in the documented format; evals/results/ is git-ignored",
        "README.md says how to run them, their cost, and that test-all does not run them; docs/spec.md names evals/",
        "claude plugin validate passes; node scripts/test-all.mjs passes"
      ],
      "risks": [
        {
          "lines": [
            "format details unconfirmed by docs: the committer checks `claude plugin eval --help` and states in ",
            "choices what it could not confirm without a paid run"
          ]
        },
        "agents namespaced differently in the sandbox: tool_used patterns tolerate an optional prefix"
      ],
      "tests": [
        "none: eval cases are the tests themselves and running them costs money; the owner runs the first pass"
      ],
      "verify": [
        "claude plugin validate /Users/palakorn/Work/ai-kit",
        "node scripts/spec.test.mjs",
        "node scripts/test-all.mjs"
      ],
      "waitsFor": [],
      "alsoInScope": []
    },
    {
      "id": "release",
      "title": "release 2.47.0: version bump and CHANGELOG",
      "brief": {
        "lines": [
          "Kit clone. After every other batch of this job: bump .claude-plugin/plugin.json version 2.46.1 → 2.47.0 ",
          "(minor: new hooks wiring, subcommands, config key ui.routes with a default). Add one `## 2.47.0` section ",
          "at the top of CHANGELOG.md in the existing prose style (see 2.46.1, 2.46.0): one paragraph per change of ",
          "this job (read `git log --format='%h %s%n%b' main..HEAD` for what landed), each with why (the evidence: 49 ",
          "committers hit the comment rule through Bash writes, CHANGELOG 2.46.1; the gaps README named), and a ",
          "closing line on what a project must do (expected: nothing; evals are optional and cost money). Update the ",
          "Thai section of README.md for anything user-facing that changed in this job and is not yet there ",
          "(post-edit on Bash, refusal records, --compare, new conventions, route check). Do not tag or push."
        ]
      },
      "accept": [
        "plugin.json is 2.47.0; CHANGELOG.md has one 2.47.0 section covering every commit of the job",
        {
          "lines": [
            "README Thai section mentions the user-facing changes; check-docs --wrap passes; node ",
            "scripts/test-all.mjs passes"
          ]
        }
      ],
      "risks": [
        "none: version and doc text only; a missed change is caught by reading the job's git log"
      ],
      "tests": [
        "none: doc and version only, covered by spec.test and the wrap check"
      ],
      "verify": [
        "node scripts/test-all.mjs",
        "claude plugin validate /Users/palakorn/Work/ai-kit"
      ],
      "waitsFor": [
        "guard",
        "bash-edits",
        "ask",
        "plan-scope",
        "usage",
        "routes",
        "conventions",
        "evals"
      ],
      "alsoInScope": [
        "release batch: version bump and CHANGELOG (coordinator)"
      ]
    }
  ]
}
```
