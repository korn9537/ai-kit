---
description: Run work to its end with nobody watching: asks once, runs the plan, retries failed committers, one report; `queue` runs every planned job in turn
---

The user starts this and leaves. Invoking it is the user's opt-in to the run-plan workflow and to the schedule below.
In this file `<plugin>` is the plugin root (`${CLAUDE_PLUGIN_ROOT}` at the start, named in the prompt on a tick) and
`<state>` is the absolute path `<git dir>/claude-review/continuous-<job>.json`.

$ARGUMENTS starting with `queue`: follow §Queue.

## Start

1. **Plan** per `<plugin>/commands/run-plan.md` steps 1 and 2, for $ARGUMENTS, at any batch count; the args carry
   each batch's `size` and `maxSize` (from `ai/kit/config.json` `committer.maxSize`) as there. This is the last
   moment the user answers: ask every owner decision now, in one message, and wait. `waitsFor` holds only what a
   batch truly needs, so one stuck batch stops as little as possible. Going on with an earlier job: reuse its id,
   with batch ids new to that job.
2. **State**: `mkdir -p` the folder of `<state>`, write the args to a temp file, then run
   `node <plugin>/scripts/continuous.mjs init <state> <args file>`, then `node <plugin>/scripts/plan.mjs write <args
   file>`, `init` first so a refusal commits nothing. A refusal names what to fix; fix it now, while the user is here.
   A `shared` key in the output of `write` lists files two briefs name: merge those batches per `plan-batching.md`
   §Plan file. A batch merged, renamed or dropped after `write` took the plan: `write --replace` with the fixed args
   file, then `init` again with that file, since each run starts from the batches in `<state>`.
   Going on with a plan a lost session left: skip step 1, clear `commands/run-plan.md` §Resume, and its `argsFile` is
   the args file here, `repo` added to it when needed; only `init` runs, no `write`.
3. **Awake**: where `caffeinate` exists, run `caffeinate -i -t 604800` as a background Bash command.
4. **Schedule**: CronCreate (load it by ToolSearch when deferred), `recurring: true`, cron every 30 minutes on an
   off-minute (`7,37 * * * *`), prompt `Continuous run <job>: follow §Tick of <plugin>/commands/continuous.md, plugin
   <plugin>, state <state>.` No such tool → say so: a retry that has to wait then ends the run, and a lost
   notification or a hung agent leaves it with no report.
5. **Tell the user** in one short message: it is running, keep this session open, the Mac plugged in with its lid
   open and the session in a mode that asks no permission (auto mode, or these commands allowed). No other session
   should edit this checkout: before a retry the script stashes what a dead committer left. A cron lives only
   in this session and expires after 7 days.
6. Do §Tick.

## Tick

Also on the workflow's notification; never copy its result, the script reads the run itself. Run
`node <plugin>/scripts/continuous.mjs next <state>` from the project root, with `failed` added when the notification
says the workflow did not complete, and act on the printed `action`:

- `running`: end the turn.
- `wait`: a failed batch waits out its hour, or for the printed `dirty` paths to clear. End the turn; with no cron, do
  §Close, the printed `open` and `dirty` under Open.
- `run`: Workflow with `scriptPath` the printed `script` and no `args`: that copy carries the printed `argsFile`'s
  content, so do not read the file into this session. Then run
  `node <plugin>/scripts/continuous.mjs started <state> <Transcript dir from the Workflow result> <its task id>`. End
  the turn. The
  call refused, or no Workflow tool: say so and do §Close, every batch of those args under Open.
- `stopped` with `reason` `log`: `git log` could not be read, so the commits are unknown and `commits` is empty.
  Report nothing as not run, do not `abandon`; end the turn and let the next tick retry. The state counts these
  failures: when the step carries `close`, the third in a row has come, so do §Close with the cause under Open. With no
  cron, do §Close at once with the cause under Open.
- `stopped` otherwise: the workflow failed, nothing moved for two hours, or a turn was lost around its launch.
  TaskStop it if it still runs (`task` in `<state>`), then
  `node <plugin>/scripts/continuous.mjs abandon <state>`. Commits may exist that `<state>` does not hold, so run
  nothing again: report what `node <plugin>/scripts/jobs.mjs <job>` prints from the project root, and do §Close.
  Under Open: each printed `open` batch as not run, each id in `commits` and hash in
  `loose` as committed but not reviewed. With `logFailed` in the step the commits are unknown and nothing is
  reported as not run: put the cause under Open. `abandon` stays on this path.
- `done`: do §Close, each batch in the printed `open` under Open, the printed `dirty` paths as edits a dead agent or
  someone else left in the tree.

## Queue

Runs every planned job one at a time under one cron. `<qfile>` is the output of `node <plugin>/scripts/queue.mjs
file`; its state per job is `<state>` as above.

**Start**, while the user is here:

1. `node <plugin>/scripts/plan.mjs queue` gives the order; jobs named after `queue` in $ARGUMENTS keep only those, in
   their order.
2. `node <plugin>/scripts/queue.mjs init <qfile> <job...>`; a refusal says a queue is still going: ask the user, and
   `queue.mjs end <qfile>` gives it up. Init comes first, so `approve` finds the queue.
3. For every plan in it run `node <plugin>/scripts/plan.mjs resume <job>` and clear now each step of
   `<plugin>/commands/run-plan.md` §Resume that needs the user's word (`running`, `continuousRunning`, `dirty`,
   `heldBy`, an owner's answer into a brief through `write`), all questions in one message, so nothing later waits on
   the user. A `running` marker the user calls over: `node <plugin>/scripts/plan.mjs unmark <job>`. The stale step is
   done for the first plan now. Each yes the user gives that `resume` keeps printing is recorded, one item per thing
   seen, because `resume` prints it again on that job's turn: `node <plugin>/scripts/queue.mjs approve <qfile> <job>
   heldBy:<id> running:<dir> dirty:<path> loose:<hash>`. A yes covers what the user saw, never a later edit: each
   dirty path and loose hash is its own item.
4. The first job: §Start steps 2 to 6 with `resume`'s `argsFile` as the args file (only `init`, no `write`), except
   the cron prompt names the queue: `Continuous queue <qfile>: follow §Queue tick of <plugin>/commands/continuous.md,
   plugin <plugin>.`

**Queue tick**, also on the workflow's notification. `node <plugin>/scripts/queue.mjs show <qfile>` gives `job` and its
`state`; a tick between `next` and that job's `init` finds no state file there: go to **On action job**. Otherwise do
§Tick for the job, except each branch that would do §Close ends the job in the queue instead, and §Close runs only on
action end:

- `running`, or `wait` with a cron: end the turn.
- `run`: as §Tick. Refused or no Workflow tool: `queue.mjs next <qfile> <job> stopped`.
- `stopped` with `reason` `log` and no `close`: end the turn, the next tick retries; with `close`, or with no cron:
  `queue.mjs next <qfile> <job> stopped`, the cause under Open.
- `wait` with no cron: `queue.mjs next <qfile> <job> open`.
- `stopped` otherwise: as §Tick (TaskStop, `abandon`, `jobs.mjs` report), then `queue.mjs next <qfile> <job> stopped`.
- `done` with nothing under Open: `node <plugin>/scripts/plan.mjs close <job>`, then `queue.mjs next <qfile> <job>
  clean`. A plan already closed (no `ai/plans/<job>.md`, every batch committed) counts as clean: skip `close`. With
  something under Open: `queue.mjs next <qfile> <job> open`.

`next` takes the job it records and moves nothing when that job is not the current one, so a repeated tick or a turn
lost after `close` does no harm. Act on the printed `action`:

- **On action job**: `plan.mjs resume <job>`. A step that needs the user's word now (`running`, `continuousRunning`,
  `dirty`, `heldBy`, loose commits that may hold a batch) stops the queue, but only what `queue.mjs check <qfile> <job>
  <item...>` prints as `new` against the start's approvals (items as in Start step 3, one per path, hash or run seen
  now, so a path dirtied after the start is new): `queue.mjs next <qfile> <job>
  stopped`, then the end below. `stale` or `staleUnknown`: re-check those briefs against the code yourself and write
  the fixes (`plan.mjs write`, or `write --rebase`), then resume again; a fix that needs an owner decision stops the
  queue the same way, never a guess. Then `node <plugin>/scripts/continuous.mjs init <state> <argsFile>` and §Tick at
  once.
- **On action end**: §Close once for the whole queue (CronDelete, `caffeinate`, no `plan.mjs close` here), one final
  report per job in `ran` from its state file, then each job in `notRun` under Open with how to go on
  (`/ai-kit:continuous queue`).

## Close

CronDelete this run's cron (CronList finds it) and stop `caffeinate` (`pkill -f "caffeinate -i -t 604800"`). No batch
would go under Open: from the project root, `node <plugin>/scripts/plan.mjs close <job>`, that commit under Git. Then
write one final report per `<plugin>/commands/run-plan.md` step 4 from the `batches` of `<state>`, which hold every
run's results, and its `planReviews` and `reviews` (one per run; `run-plan.md` step 4, Plan review and
Checked). A batch whose `review` is `not reviewed: no agent reported this commit` goes under Open as committed but
not reviewed. Each name in its `stashes` goes under Open: the edits a dead committer left, in `git stash list`. To go
on after answering, the user runs this command again with what is left and the same job. A batch reported with a
commit stays in `<state>`; what is left of one under Open takes a new batch id, and batches that waited for it wait
for that id.
