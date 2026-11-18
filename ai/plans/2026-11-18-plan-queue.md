# Plan plan-queue

goal: the request in the block below, one commit per batch.
job: `2026-11-18-plan-queue`
status: the commits of this job, by their Batch trailer (`plan.mjs status`); never edited here.

```json
{
  "job": "2026-11-18-plan-queue",
  "request": {
    "lines": [
      "ผมคุยหลาย session ให้มันวิเคราะห์และเตรียมแผนต่างๆไว้ให้ก่อน แล้วอาจจะมีคำสั่งให้ไล่ทำงานที่วางแผนไว้ (agreed: ",
      "/ai-kit:run-plan plan = write the plan and stop; /ai-kit:run-plan queue = run open plans one at a time, oldest ",
      "first, stop at one that ends not clean; plans record a base commit and resume reports stale paths; plan.mjs ",
      "queue reports files two plans share; an unattended continuous queue is later work)"
    ]
  },
  "batches": [
    {
      "id": "plan-mjs",
      "title": "plan.mjs: base commit, stale paths in resume, queue command",
      "size": "normal",
      "brief": {
        "lines": [
          "All in scripts/plan.mjs, tests in scripts/plan.test.mjs (temp git repos, as the existing tests do). (1) ",
          "base: write() (scripts/plan.mjs:439-463) sets plan.base to `git rev-parse HEAD` of root before rendering ",
          "(unborn HEAD: no base). render() (scripts/plan.mjs:46-62) writes { job, request, base, batches } with base ",
          "left out when absent; refuseFile compares parse(text) with the plan, so build the plan object in that same ",
          "key order. The no-op check in write ignores base: a write whose only change is base commits nothing ",
          "(otherwise every write after the plan's own commit would commit again). merge() stays pure. A plan file ",
          "from before (no base) still parses, resumes and closes. (2) stale: new exported staleFiles(root, plan) → { ",
          "stale: [paths] } or { staleUnknown: '<why>' }. With plan.base: `git log -E --invert-grep --grep=^Job: ",
          "<job>$ --name-only --relative --format= <base>..HEAD` run in root (paths relative to the project root, ",
          "commits of this job left out), deduped, sorted, kept only when inScope(path, scopePaths(the batches with ",
          "no commit, root)) (scripts/plan.mjs:397-427). No base → staleUnknown 'plan written before base was ",
          "recorded'; base not a commit (`git cat-file -e <base>^{commit}` fails: rebased or squashed away) → ",
          "staleUnknown naming the short hash; git log failing → staleUnknown with its first error line. resume() ",
          "(scripts/plan.mjs:521-551) adds the result to its output (stale or staleUnknown), also when no batch is ",
          "left is not needed: only when p.left is not empty. (3) queue: new exported queue(root) and CLI `plan.mjs ",
          "queue` printing JSON { queue: [{ job, left, ready }], shared: [{ file, jobs }] }. queue holds the parsed ",
          "plans (openPlans) with batches left, oldest first by the commit time of the last commit that added the ",
          "plan file (`git log --diff-filter=A -1 --format=%ct -- ai/plans/<job>.md`); a plan with no such commit ",
          "(not committed yet) comes after them, by file name. A plan whose git log fails gets { job, error: 'status ",
          "not known' } in its place instead of throwing for the whole queue. shared lists each scopePaths entry (of ",
          "the left batches, root-relative) that two or more queued plans name, with those jobs in queue order. ",
          "Update the usage text in the header comment (scripts/plan.mjs:3-4) and the CLI usage line ",
          "(scripts/plan.mjs:~700) with `queue`."
        ]
      },
      "accept": [
        {
          "lines": [
            "plan.mjs write records base = HEAD in the plan's JSON block, and a second write with the same batches ",
            "commits nothing"
          ]
        },
        {
          "lines": [
            "plan.mjs resume prints stale with the root-relative paths in the left batches' scope that commits ",
            "outside the job changed after base, and none of the job's own commits' paths"
          ]
        },
        "resume prints staleUnknown, not an error, for a plan with no base and for a base that is no longer a commit",
        {
          "lines": [
            "plan.mjs queue prints plans with batches left, oldest added first, skips closed or fully committed ",
            "plans, and lists in shared a path two plans' left batches both name"
          ]
        },
        "a plan file written by 2.51.0 (no base) still parses, resumes and closes",
        "node scripts/plan.test.mjs and node scripts/plan-live.test.mjs pass"
      ],
      "risks": [
        "base rebased or squashed away: git cat-file fails → staleUnknown, never a crash of resume",
        {
          "lines": [
            "project root below the repo top (ai/kit in a subfolder): --relative from root keeps paths comparable ",
            "with scopePaths"
          ]
        },
        {
          "lines": [
            "the plan's own commits and the job's batch commits move HEAD: --invert-grep on the Job trailer keeps ",
            "them out of stale"
          ]
        },
        "write after the plan commit would re-commit only for a new base: the no-op check ignores base",
        {
          "lines": [
            "one broken plan in ai/plans must not stop queue for the others: per-plan error entry; a plan that does ",
            "not parse is skipped as openPlans does"
          ]
        },
        "a 40-character base line stays under the 120-column check of the plan file"
      ],
      "tests": [
        "write records base; a repeat write with the same args reports committed: false",
        {
          "lines": [
            "resume: a commit outside the job changing a file a left batch names → stale holds it; a file no brief ",
            "names → not in stale; a batch commit of the job → not in stale"
          ]
        },
        "resume on a plan file with no base → staleUnknown; with a base hash that is not a commit → staleUnknown",
        "resume with ai/kit in a subfolder of the repo → stale paths relative to that folder",
        {
          "lines": [
            "queue: two plans written in order → oldest first; a plan with every batch committed is left out; a path ",
            "both name → in shared with both jobs"
          ]
        },
        "queue: a plan file that does not parse is skipped without failing the others"
      ],
      "verify": [
        "node scripts/plan.test.mjs",
        "node scripts/plan-live.test.mjs"
      ],
      "waitsFor": [],
      "alsoInScope": [
        "staleUnknown for plans with no base or a lost base",
        "per-plan error entry in queue output"
      ]
    },
    {
      "id": "docs",
      "title": "run-plan plan and queue modes, stale step in Resume, docs and release 2.52.0",
      "size": "light",
      "brief": {
        "lines": [
          "Docs for what batch plan-mjs added (read its commit for the exact output keys: base, stale, staleUnknown, ",
          "queue, shared). (1) commands/run-plan.md: near the top (commands/run-plan.md:8) add: $ARGUMENTS starting ",
          "with `plan` → steps 1 and 2, then the `plan.mjs write` of step 3 and stop with no Workflow: tell the user ",
          "the job id, that the plan is committed in ai/plans/<job>.md, and that `/ai-kit:run-plan resume <job>` or ",
          "`/ai-kit:run-plan queue` runs it; owner decisions are asked now, so the run does not stop for them. ",
          "$ARGUMENTS starting with `queue` → new section §Queue. §Queue: run `plan.mjs queue` from the project root; ",
          "jobs named after `queue` keep only those, in the given order, else its order (oldest plan first). Tell the ",
          "user the order and each shared entry (two plans touch one file, so the later one's briefs will be stale). ",
          "Then one plan at a time, never two at once: §Resume for it, **Run** with its argsFile, **Report** with its ",
          "close; a plan that ends with anything under Open, or a §Resume step that needs the user's word ",
          "(continuousRunning, dirty, heldBy), stops the queue: report the plans not run and how to go on ",
          "(`/ai-kit:run-plan queue`). After each plan run `plan.mjs queue` again, so a plan another session wrote ",
          "meanwhile joins at the end. One final report per plan, and at the end one line per plan of the queue. In ",
          "§Resume (commands/run-plan.md:65-90) add a step before argsFile: `stale` not empty, or `staleUnknown` → ",
          "the briefs that name those paths (staleUnknown: every left brief's paths) are checked against the code ",
          "now: fix their path:start-end and what they say through `write --replace`, then `resume` again; nothing to ",
          "fix → go on. (2) docs/plan-batching.md §Plan file (docs/plan-batching.md:60-84): a bullet for base (HEAD ",
          "at each write) and stale/staleUnknown in resume; bullets for Plan only (`/ai-kit:run-plan plan`) and Queue ",
          "(`/ai-kit:run-plan queue`, one plan at a time, stops at one not clean; several sessions may write plans, ",
          "each write commits only its plan file and refuses while other files are staged). (3) README.md:33 and ",
          "README.md:37: name the plan and queue modes and plan.mjs queue. (4) hooks/session-start.sh:53-59: the ",
          "open-plans message also says `/ai-kit:run-plan queue` runs them one at a time; hooks/session-start.test.sh ",
          "(~line 66) checks that the message names it; the second half must stay under 7000 characters (the test ",
          "checks). (5) CHANGELOG.md: a `## 2.52.0` entry above 2.51.0 in the style of the others (what changed, no ",
          "project needs to edit anything; plans written by 2.51.0 have no base, so resume says staleUnknown for ",
          "them); .claude-plugin/plugin.json version 2.52.0. Docs are wrapped at 120 columns and checked by ",
          "scripts/check-docs.mjs in the pre-commit (no bold, no emoji, no dates in prose)."
        ]
      },
      "accept": [
        {
          "lines": [
            "/ai-kit:run-plan plan stops after plan.mjs write with no Workflow and tells the user the job id and how ",
            "to run it later"
          ]
        },
        {
          "lines": [
            "/ai-kit:run-plan queue runs plans one at a time in plan.mjs queue order (or the named jobs' order), ",
            "reruns queue after each, and stops at a plan that ends with anything under Open or needs the user's word"
          ]
        },
        "§Resume has a step for stale and staleUnknown before argsFile",
        "docs/plan-batching.md §Plan file describes base, stale, plan-only and queue",
        "the session-start open-plans message names /ai-kit:run-plan queue and hooks/session-start.test.sh checks it",
        "CHANGELOG has a 2.52.0 entry and plugin.json says 2.52.0",
        "bash hooks/session-start.test.sh, node scripts/handoffs.test.mjs and node scripts/check-docs.mjs pass"
      ],
      "risks": [
        {
          "lines": [
            "handoffs.test.mjs matches exact phrases of commands/run-plan.md: keep them (e.g. the Args field list, ",
            "Plan review line)"
          ]
        },
        "the session-start second half has a 7000-character cap: keep the added words short",
        "a doc line over 120 columns or a forbidden form fails check-docs in the pre-commit",
        {
          "lines": [
            "queue running while another session writes a plan: the doc says write refuses while other files are ",
            "staged, so a committer's staged batch is never taken into a plan commit"
          ]
        }
      ],
      "tests": [
        "hooks/session-start.test.sh: the open-plans message names /ai-kit:run-plan queue",
        "none: the rest is command and doc prose, covered by handoffs.test.mjs and check-docs in the pre-commit"
      ],
      "verify": [
        "bash hooks/session-start.test.sh",
        "node scripts/check-docs.mjs"
      ],
      "waitsFor": [
        "plan-mjs"
      ],
      "alsoInScope": [
        "queue re-reads plan.mjs queue after each plan so plans written meanwhile join"
      ]
    }
  ]
}
```
