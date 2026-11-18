# Plan plan-queue-complete

goal: the request in the block below, one commit per batch.
job: `2026-11-18-plan-queue-complete`
status: the commits of this job, by their Batch trailer (`plan.mjs status`); never edited here.

```json
{
  "job": "2026-11-18-plan-queue-complete",
  "request": {
    "lines": [
      "open จะแก้ยังไง ... ลุยเลย เอาให้มันครบ (fix every Open item of job 2026-11-18-plan-queue: (1) a run marker so ",
      "resume and queue see a run-plan Workflow another session runs; (2) a test for the queue entry whose git log ",
      "fails; (3) plans with no base take the commit that added the plan file as base; (4) an unattended queue: ",
      "/ai-kit:continuous queue)"
    ]
  },
  "base": "1e787b2f45663c8ea6e1efca2be33780f239f5cd",
  "batches": [
    {
      "id": "plan-mjs",
      "title": "plan.mjs: run marker, base from the plan commit, queue error test",
      "size": "normal",
      "brief": {
        "lines": [
          "scripts/plan.mjs and scripts/plan.test.mjs; readRun moves out of scripts/continuous.mjs into a new ",
          "scripts/lib/workflow-run.mjs. (1) Run marker. Move readRun (scripts/continuous.mjs, the function after ",
          "`write`, ~line 178-194) into scripts/lib/workflow-run.mjs unchanged; continuous.mjs imports and re-exports ",
          "it (continuous.test.mjs imports it from continuous.mjs). New CLI `plan.mjs mark <job> <workflow transcript ",
          "dir> [task id]` writes `<reviewDir>/run-<job>.json` { job, dir, task, startedAt } (reviewDir as ",
          "continuousState uses it, scripts/plan.mjs:599-606; tmp file and rename). New function runMarker(root, job, ",
          "now) → null when there is no marker or readRun(dir).status is 'completed' (that run is over: delete the ",
          "marker file then), else { dir, task, idleMinutes } with idle from readRun. close() ",
          "(scripts/plan.mjs:508-528) deletes the job's marker. resume() (scripts/plan.mjs:608-634) adds `running: ",
          "<marker>` when runMarker is not null. queue() (scripts/plan.mjs:536-575) adds to a row `running: { kind: ",
          "'run-plan', idleMinutes }` from runMarker or `running: { kind: 'continuous' }` when continuousState(root, ",
          "job) has running or launching. (2) Base from the plan commit. staleFiles (scripts/plan.mjs:481-506): a ",
          "plan with no base takes the last commit that added its plan file (`git log --diff-filter=A -1 --format=%H ",
          "-- ai/plans/<job>.md`) as base and reports `baseFrom: 'plan commit <short>'` beside stale; only when there ",
          "is no such commit does it say staleUnknown 'plan written before base was recorded'. The ancestor and ",
          "cat-file checks apply to that base too. write() keeps its rule that a plan with no base gets HEAD. (3) ",
          "queue error test: queue(root, { commitsOf } = {}) takes an optional commitsOf for tests, defaulting to the ",
          "module's; a test passes one that throws for one job and checks that row is { job, error: 'status not ",
          "known' } while the other plans keep their order. Update the usage lines (header comment, ",
          "scripts/plan.mjs:2-4, and the CLI usage at the end) with `mark`."
        ]
      },
      "accept": [
        {
          "lines": [
            "plan.mjs mark writes the run marker, and resume prints running with dir, task and idleMinutes while that ",
            "workflow's run file is not completed"
          ]
        },
        "a marker whose workflow run file says completed is ignored and deleted; close deletes the job's marker",
        {
          "lines": [
            "plan.mjs queue rows carry running for a live run-plan marker and for a continuous state with running or ",
            "launching"
          ]
        },
        {
          "lines": [
            "resume of a plan with no base reports stale from the commit that added the plan file, with baseFrom; a ",
            "plan file never committed says staleUnknown"
          ]
        },
        {
          "lines": [
            "queue with a commitsOf that throws for one job lists it as { job, error: 'status not known' } and still ",
            "orders the others"
          ]
        },
        "node scripts/plan.test.mjs, node scripts/continuous.test.mjs and node scripts/plan-live.test.mjs pass"
      ],
      "risks": [
        {
          "lines": [
            "a session that dies leaves a marker whose run file never says completed: it stays as running with a ",
            "growing idleMinutes, which the docs batch tells the session to put to the user, never to drop silently"
          ]
        },
        {
          "lines": [
            "the marker dir sits in the git common dir, shared by every worktree: two worktrees running the same job ",
            "see each other, which is the point"
          ]
        },
        {
          "lines": [
            "a run file not written yet (workflow just launched) must read as running, not as over: only status ",
            "completed ends it"
          ]
        },
        "moving readRun must not change continuous.mjs behaviour: it re-exports the same function",
        {
          "lines": [
            "a base taken from the plan commit after a rebase fails the ancestor check → staleUnknown, as for a ",
            "recorded base"
          ]
        }
      ],
      "tests": [
        {
          "lines": [
            "mark then resume → running with idleMinutes; a run file with status completed → no running and the ",
            "marker file is gone"
          ]
        },
        "close removes the marker",
        {
          "lines": [
            "queue: a live marker → running kind run-plan; a continuous state file with running true → running kind ",
            "continuous"
          ]
        },
        {
          "lines": [
            "plan with no base, committed, then a commit outside the job on a named file → stale holds it and ",
            "baseFrom names the plan commit"
          ]
        },
        "plan with no base and never committed → staleUnknown",
        "queue with an injected commitsOf throwing for one job → error row, others in order"
      ],
      "verify": [
        "node scripts/plan.test.mjs",
        "node scripts/continuous.test.mjs",
        "node scripts/plan-live.test.mjs"
      ],
      "waitsFor": [],
      "alsoInScope": [
        "readRun moved to scripts/lib/workflow-run.mjs so plan.mjs can read a workflow's run file"
      ]
    },
    {
      "id": "continuous-queue",
      "title": "/ai-kit:continuous queue: run every planned job unattended, one at a time",
      "size": "normal",
      "brief": {
        "lines": [
          "New scripts/queue.mjs with scripts/queue.test.mjs, and commands/continuous.md. (1) scripts/queue.mjs keeps ",
          "the queue state in `<reviewDir>/continuous-queue.json` (reviewDir from scripts/lib/state-dirs.mjs as ",
          "plan.mjs uses it; tmp file and rename as continuous.mjs write does). Pure exported functions plus a CLI: ",
          "`queue.mjs init <qfile> <job...>` → { jobs, current: 0, outcomes: {}, ended: false }, refused while an ",
          "earlier queue in that file has ended false (message: a queue is still going; `queue.mjs end <qfile>` gives ",
          "it up); `queue.mjs next <qfile> <clean|open|stopped>` records the outcome of the current job and prints { ",
          "action: 'job', job, state: '<reviewDir>/continuous-<job>.json' } for the next one only after clean, else { ",
          "action: 'end', ran: [jobs with outcomes], notRun: [jobs] } and sets ended; `queue.mjs show <qfile>` prints ",
          "the state with { current job, state path }; `queue.mjs end <qfile>` sets ended. A job id is checked with ",
          "JOB from plan.mjs. (2) commands/continuous.md: a line at the top: $ARGUMENTS starting with `queue` → ",
          "§Queue. New §Queue (before §Close). Start, while the user is here: `plan.mjs queue` gives the order (jobs ",
          "named after `queue` keep only those, in their order); for every plan in it run `plan.mjs resume <job>` and ",
          "clear now each step of commands/run-plan.md §Resume that needs the user's word (running, ",
          "continuousRunning, dirty, heldBy, an owner's answer into a brief through write), so nothing later waits on ",
          "the user; the stale step is done for the first plan now. Then `queue.mjs init`, then for the first job ",
          "§Start steps 2-6 with resume's argsFile as the args file (only `init`, no write), except the cron prompt ",
          "names the queue: `Continuous queue <qfile>: follow §Queue tick of <plugin>/commands/continuous.md, plugin ",
          "<plugin>.` Queue tick: `queue.mjs show <qfile>` gives the current job and its state; do §Tick for it, ",
          "except `done` with nothing under Open → `plan.mjs close <job>` and `queue.mjs next <qfile> clean`; `done` ",
          "with something under Open, or `stopped` → `queue.mjs next <qfile> open` or `stopped`. On action job: ",
          "`plan.mjs resume <job>`; a step that needs the user's word now (running, continuousRunning, dirty, heldBy, ",
          "loose commits that may hold a batch) → `queue.mjs next <qfile> stopped` and end the queue; stale or ",
          "staleUnknown → the session re-checks those briefs against the code itself and writes the fixes (plain ",
          "write) or `write --rebase`, then resume again (a fix that needs an owner decision → stopped); then ",
          "`continuous.mjs init <state> <argsFile>` and §Tick at once. On action end: §Close once for the whole queue ",
          "(CronDelete, caffeinate), one final report per job that ran from its state file, then the notRun jobs ",
          "under Open with how to go on (`/ai-kit:continuous queue`). Keep the existing §Start, §Tick and §Close text ",
          "working for a single job."
        ]
      },
      "accept": [
        {
          "lines": [
            "queue.mjs init/next/show/end keep one queue state, refuse a second init while one has not ended, and ",
            "next moves on only after clean"
          ]
        },
        {
          "lines": [
            "/ai-kit:continuous queue asks every user question for every queued plan before the user leaves, then ",
            "runs the jobs one at a time under one cron"
          ]
        },
        {
          "lines": [
            "a job that ends with anything under Open, or a resume step that needs the user's word, ends the queue ",
            "with the jobs not run listed"
          ]
        },
        {
          "lines": [
            "stale briefs of a later job are re-checked by the session itself, with write or write --rebase, before ",
            "that job's init"
          ]
        },
        "§Close runs once at the end of a queue, with one report per job that ran",
        "node scripts/queue.test.mjs and node scripts/continuous.test.mjs pass"
      ],
      "risks": [
        {
          "lines": [
            "a tick fires between next and the following job's init: show must still name a job with no state file ",
            "yet, and the tick then does the resume and init instead of failing on a missing state"
          ]
        },
        "a queue file left by a lost session blocks a new queue: init refuses with the end command to give it up",
        {
          "lines": [
            "two jobs share files: the later one's briefs are stale when its turn comes, handled by the stale step ",
            "before init"
          ]
        },
        "an owner decision only visible after an earlier job ran cannot be asked: the queue stops there, never guesses",
        "the cron prompt text changes for a queue: a single-job continuous run keeps its old prompt"
      ],
      "tests": [
        "init writes jobs and current 0; a second init while ended is false is refused; after end it is accepted",
        {
          "lines": [
            "next clean on a two-job queue → action job with the second job and its state path; next clean again → ",
            "end with both in ran"
          ]
        },
        "next open or stopped on the first job → end with the second in notRun",
        "show on a queue whose current job has no state file yet → names the job and the state path",
        "a bad job id is refused by init"
      ],
      "verify": [
        "node scripts/queue.test.mjs",
        "node scripts/continuous.test.mjs"
      ],
      "waitsFor": [
        "plan-mjs"
      ],
      "alsoInScope": [
        "queue.mjs end to give up a queue a lost session left"
      ]
    },
    {
      "id": "docs",
      "title": "docs for the run marker, base fallback and continuous queue; release 2.53.0",
      "size": "light",
      "brief": {
        "lines": [
          "Read the commits of batches plan-mjs and continuous-queue for the exact names. (1) commands/run-plan.md: ",
          "step 3 Run (commands/run-plan.md:35-44): right after the Workflow starts, `plan.mjs mark <job> <Transcript ",
          "dir> <task id>`. §Resume step 1 (commands/run-plan.md:76-79): `running` printed (a run-plan Workflow of ",
          "this job started by some session, with its idle minutes) is the same case as continuousRunning: ask the ",
          "user first; their word that it is over → go on (close or the run's completion clears the marker). §Resume ",
          "stale step: a plan with no base now gets its base from the plan commit (`baseFrom`). §Queue ",
          "(commands/run-plan.md:102-114): a row with `running` stops the queue like a step needing the user's word, ",
          "and `/ai-kit:continuous queue` is the unattended form. (2) docs/plan-batching.md §Plan file (the Base, ",
          "Plan only and Queue bullets, docs/plan-batching.md:77-84): base from the plan commit for plans with none; ",
          "a Run marker bullet (`plan.mjs mark`, read by resume and queue, over when the workflow's run file says ",
          "completed, removed by close); Queue names `/ai-kit:continuous queue`. (3) README.md: the rows for ",
          "commands/continuous.md, scripts/plan.mjs (mark) and a new row for scripts/queue.mjs with its test, in the ",
          "table near README.md:33-40. (4) CHANGELOG.md: `## 2.53.0` above 2.52.0 in the same style: the run marker, ",
          "base from the plan commit (plans written by 2.51.0 no longer say staleUnknown when committed), the queue ",
          "error test, and `/ai-kit:continuous queue`; no project needs to edit anything. .claude-plugin/plugin.json ",
          "2.53.0. Docs wrap at 120 columns and pass scripts/check-docs.mjs (no bold in prose lines it checks, no ",
          "emoji, no dates)."
        ]
      },
      "accept": [
        {
          "lines": [
            "run-plan.md Run step marks the run, §Resume step 1 treats running like continuousRunning, §Queue stops ",
            "on a running row and names /ai-kit:continuous queue"
          ]
        },
        "docs/plan-batching.md §Plan file describes the run marker, base from the plan commit and the unattended queue",
        "README lists scripts/queue.mjs and plan.mjs mark",
        "CHANGELOG has 2.53.0 and plugin.json says 2.53.0",
        "node scripts/handoffs.test.mjs, node scripts/run-plan.test.mjs and node scripts/check-docs.mjs pass"
      ],
      "risks": [
        "handoffs.test.mjs matches exact phrases of commands/run-plan.md and continuous.md: keep the ones it checks",
        "a doc line over 120 columns or a form check-docs refuses fails the pre-commit"
      ],
      "tests": [
        "none: command and doc prose only; handoffs.test.mjs and check-docs in the pre-commit cover it"
      ],
      "verify": [
        "node scripts/handoffs.test.mjs",
        "node scripts/check-docs.mjs"
      ],
      "waitsFor": [
        "plan-mjs",
        "continuous-queue"
      ],
      "alsoInScope": []
    }
  ]
}
```
