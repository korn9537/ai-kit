export const meta = {
  name: 'ai-kit-run-plan',
  description: 'Run a multi-commit plan: one ai-kit:committer per batch, a change-reviewer per commit, CONFIRMED fixes, a re-check and one more round',
  whenToUse: 'Launched by /ai-kit:run-plan with the planned batches as args (commands/run-plan.md)',
  phases: [
    { title: 'Commit', detail: 'one ai-kit:committer per batch, one at a time' },
    { title: 'Review', detail: 'one change-reviewer per commit with a code line' },
    { title: 'Fix', detail: 'CONFIRMED findings fixed and re-checked, one more round for what is left' },
  ],
}

// args: { request, plugin, job, repo?, batches: [{ id, title, brief, accept?: [check], verify?, waitsFor?: [id],
//   alsoInScope?: [item] }] }
// in plan order. The coordinator rules this replaces: docs/plan-batching.md §Coordinator pipeline.
const batches = (args && args.batches) || []
if (!batches.length || !args.plugin || !args.job) throw new Error('run-plan needs args.plugin, args.job and args.batches')
// the same format githooks/commit-msg accepts: a bad id would fail every committer's commit
if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/.test(args.job)) throw new Error(`run-plan args.job is not <yyyy-mm-dd>-<slug>: ${args.job}`)

const COMMIT = {
  type: 'object',
  properties: {
    hash: { type: 'string', description: 'the commit hash, or "" when nothing was committed' },
    files: { type: 'array', items: { type: 'string' } },
    choices: { type: 'array', items: { type: 'string' }, description: 'each choice the brief did not fix' },
    owner: { type: 'array', items: { type: 'string' }, description: 'owner decisions hit and left unanswered' },
    blockers: { type: 'array', items: { type: 'string' }, description: 'what stops a later batch building on it' },
    unmet: { type: 'array', items: { type: 'string' }, description: 'each Done when check not met, and why' },
    notes: { type: 'array', items: { type: 'string' }, description: 'verify results, assumptions, follow-ups' },
    review: { type: 'string', enum: ['review', 'skip'], description: 'the word review-needed.sh printed' },
  },
  required: ['hash', 'files', 'choices', 'owner', 'blockers', 'unmet', 'notes', 'review'],
}
const REVIEW = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          where: { type: 'string', description: 'file:line' },
          what: { type: 'string' },
          rule: { type: 'string', description: 'the rule or request it breaks' },
          fix: { type: 'string' },
          verdict: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE'] },
          dataRule: { type: 'boolean', description: 'about data or business-rule correctness' },
        },
        required: ['where', 'what', 'rule', 'fix', 'verdict', 'dataRule'],
      },
    },
    reviewed: { type: 'boolean', description: 'false when the diff could not be read (no such commit or repo)' },
    checked: { type: 'string', description: 'what was checked, one line; when not reviewed, why' },
  },
  required: ['findings', 'reviewed', 'checked'],
}

// one agent edits the repo at a time: commits and fixes queue here, reviews run beside them
let editor = Promise.resolve()
const exclusive = (fn) => {
  const run = editor.then(fn)
  editor = run.catch(() => {})
  return run
}
const needed = `bash "${args.plugin}/scripts/review-needed.sh"`
const where = args.repo ? `Repo: ${args.repo} (run every command there).` : ''
// one job per user request: every commit of the plan, fixes included, ends with this trailer (shared-checkout.md §Jobs)
const job = `End the commit message with the trailer line \`Job: ${args.job}\` (before any Co-Authored-By line).`
const report = [
  `After the commit run \`${needed} <hash>\` from the project root and put the word it prints in \`review\`.`,
  'Report in the structured output: hash ("" when nothing was committed), files, choices, owner (owner decisions',
  'left unanswered; stop before the code that depends on one), blockers (only what stops a later batch building on',
  'this commit; work a later batch below is planned to do is a note, never a blocker), unmet (each Done when check',
  'not met, and why), notes (verify results, assumptions, follow-ups). Nothing committed: restore the files you edited, so the next batch starts on a clean',
  'tree.',
].join('\n')

// the later batches' titles let the committer tell planned work (a note) from a blocker
const later = (b) => {
  const rest = batches.slice(batches.indexOf(b) + 1).map((x) => `- ${x.id}: ${x.title}`)
  return rest.length ? ['', 'Later batches of this plan:', ...rest, ''].join('\n') : ''
}
// the Batch trailer lets scripts/continuous.mjs find a commit whose agent died before it could report the hash
const trailer = (b) => `Add the trailer line \`Batch: ${b.id}\` just above the Job trailer.`
// the result the batch must reach, set before the work: the committer builds to it and the reviewer checks it first
const done = (b) => ((b.accept || []).length ? ['Done when:', ...b.accept.map((a) => `- ${a}`)].join('\n') : '')
const commitPrompt = (b) =>
  [`Batch ${b.id}: ${b.title}`, where, '', b.brief, '', done(b), b.verify ? `Verify: ${b.verify}` : '', job, trailer(b), later(b), report].join('\n')

const scope = (b) => (b.alsoInScope || []).map((s) => `also in scope: ${s} (coordinator)`).join('\n')
const reviewPrompt = (b, hash) =>
  [
    `The user's request: ${args.request || b.title}`,
    `This commit is batch ${b.id}: ${b.title}`,
    where,
    scope(b),
    done(b),
    `Read \`git show ${hash} -- . ':(exclude)ai/usage'\`, not the work tree. Review that commit only.`,
  ].join('\n')

// a typed title keeps its scope: `feat(x): y` → `fix(x): y`, never `fix: feat(x): y`; a task id stays first:
// `T-12a: y` → `T-12a: fix y`
const fixSubject = (title) => {
  const m = title.match(/^(?:feat|fix|refactor|perf|docs|test|build|ci|chore|style|revert)(\([^)]*\))?!?: (.*)$/)
  if (m) return `fix${m[1] || ''}: ${m[2]}`
  const id = title.match(/^([A-Z][A-Z0-9]*-\d+[a-z]?): (.*)$/)
  return id ? `${id[1]}: fix ${id[2]}` : `fix: ${title}`
}
const list = (fs) => fs.map((f, i) => `${i + 1}. ${f.where} · ${f.what} · ${f.rule} · fix: ${f.fix}`).join('\n')
// the batch's brief and later batches: the fix agent is fresh, and planned work must not read as a blocker
const fixPrompt = (b, hash, fs) =>
  [
    `Review findings on commit ${hash} (batch ${b.id}: ${b.title}). Fix only these, verify the same way and make one`,
    `commit "${fixSubject(b.title)}". The rules were read for that commit: read only the rule a finding names.`,
    job,
    where,
    '',
    list(fs),
    '',
    'The brief the commit was made from:',
    b.brief,
    '',
    done(b),
    later(b),
    b.verify ? `Verify: ${b.verify}` : '',
    report,
  ].join('\n')

const recheckPrompt = (b, hash, fixHash, fs, fresh) =>
  fresh
    ? [
        `The user's request: ${args.request || b.title}`,
        `Batch ${b.id}: ${b.title}`,
        where,
        scope(b),
        done(b),
        `A data or rule finding was fixed, so this is a fresh review of the change as a whole: read`,
        `\`git show ${hash} ${fixHash} -- . ':(exclude)ai/usage'\`. The first review found:`,
        list(fs),
      ].join('\n')
    : [
        where,
        `Re-check of a fix. Read only \`git show ${fixHash} -- . ':(exclude)ai/usage'\`. For each finding below, is it`,
        'fixed? Report one still not fixed as CONFIRMED with what is left, and anything new the fix breaks.',
        list(fs),
        done(b),
      ].join('\n')

const results = {}
const pick = (c) => ({
  hash: c.hash, files: c.files, choices: c.choices, owner: c.owner, blockers: c.blockers, unmet: c.unmet || [], notes: c.notes,
})

// what a fix agent left open (owner decisions, blockers, unmet Done when checks) marks the batch partial, not only its
// fix entry; it holds a later batch that has not started, not a dependent already running (see where a commit lands)
const leftOpen = (r, x) => {
  const owner = (x && x.owner) || []
  const blockers = (x && x.blockers) || []
  const unmet = (x && x.unmet) || []
  r.owner = [...(r.owner || []), ...owner]
  r.blockers.push(...blockers)
  r.unmet = [...(r.unmet || []), ...unmet]
  if (owner.length + blockers.length + unmet.length) r.status = 'partial'
}

async function reviewChain(b, r, need) {
  if (need === 'skip') {
    r.review = 'skipped: move-only or comment-only'
    return
  }
  const rv = await agent(reviewPrompt(b, r.hash), {
    label: `review: [${b.id}] ${b.title}`, phase: 'Review', agentType: 'ai-kit:change-reviewer', schema: REVIEW,
  })
  if (!rv || !rv.reviewed) {
    r.review = `not reviewed: ${rv ? rv.checked : 'reviewer failed or was skipped'}`
    return
  }
  const confirmed = rv.findings.filter((f) => f.verdict === 'CONFIRMED')
  r.plausible = rv.findings.filter((f) => f.verdict === 'PLAUSIBLE')
  r.confirmed = confirmed
  if (!confirmed.length) {
    r.review = `no CONFIRMED finding (${rv.checked})`
    return
  }
  log(`${b.title}: ${confirmed.length} CONFIRMED → fix`)
  const fx = await exclusive(() =>
    agent(fixPrompt(b, r.hash, confirmed), {
      label: `commit: [${b.id} fix] ${b.title}`, phase: 'Fix', agentType: 'ai-kit:committer', schema: COMMIT,
    }),
  )
  if (!fx || !fx.hash) {
    r.status = 'partial'
    // the report lists r.confirmed for this review value: no re-check holds the findings
    r.review = 'CONFIRMED findings left unfixed'
    leftOpen(r, fx)
    r.notes.push(...((fx && fx.notes) || []))
    return
  }
  r.fix = pick(fx)
  leftOpen(r, fx)
  const fresh = confirmed.some((f) => f.dataRule)
  const rc = await agent(recheckPrompt(b, r.hash, fx.hash, confirmed, fresh), {
    label: `review: [${b.id} recheck] ${b.title}`, phase: 'Fix', agentType: 'ai-kit:change-reviewer', schema: REVIEW,
  })
  if (!(rc && rc.reviewed)) {
    r.recheck = `not re-checked: ${rc ? rc.checked : 'reviewer failed or was skipped'}`
    r.review = 'fixed; not re-checked'
    return
  }
  r.recheck = rc.findings
  r.review = fresh ? 'fixed; fresh review of the data or rule fix' : 'fixed; re-checked once, no third pass'
  let left = (rc.findings || []).filter((f) => f.verdict === 'CONFIRMED')
  // one more fix and a re-check of it, not a stop at the report; an owner decision still open holds it
  if (left.length && !(r.owner || []).length) {
    const fx2 = await exclusive(() =>
      agent(fixPrompt(b, fx.hash, left), {
        label: `commit: [${b.id} fix] ${b.title}`, phase: 'Fix', agentType: 'ai-kit:committer', schema: COMMIT,
      }),
    )
    // what the fix agent left open counts before its re-check, which may fail
    leftOpen(r, fx2)
    if (fx2 && fx2.hash) {
      r.fix2 = pick(fx2)
      const fresh2 = left.some((f) => f.dataRule)
      const rc2 = await agent(recheckPrompt(b, `${r.hash} ${fx.hash}`, fx2.hash, left, fresh2), {
        label: `review: [${b.id} recheck] ${b.title}`, phase: 'Fix', agentType: 'ai-kit:change-reviewer', schema: REVIEW,
      })
      if (!(rc2 && rc2.reviewed)) {
        r.recheck2 = `not re-checked: ${rc2 ? rc2.checked : 'reviewer failed or was skipped'}`
        r.review = 'fixed; second fix not re-checked'
        r.status = 'partial'
        return
      }
      r.recheck2 = rc2.findings
      left = (rc2.findings || []).filter((f) => f.verdict === 'CONFIRMED')
      r.review = 'fixed; a second fix re-checked'
    } else {
      r.notes.push(...((fx2 && fx2.notes) || []))
    }
  }
  if (left.length) {
    r.status = 'partial'
    r.review = `fixed; ${left.length} CONFIRMED finding(s) left`
    r.blockers.push(`${left.length} CONFIRMED finding(s) left after the last re-check: see ${r.fix2 ? 'recheck2' : 'recheck'}`)
  }
  log(`${b.title}: fix ${(r.fix2 || fx).hash}, ${left.length} CONFIRMED left`)
}

const reviews = []
for (const [i, b] of batches.entries()) {
  const head = { id: b.id, title: b.title }
  const waiting = (b.waitsFor || []).filter((w) => !results[w] || results[w].status !== 'committed')
  if (waiting.length) {
    results[b.id] = { ...head, status: 'skipped', reason: `waits for ${waiting.join(', ')}, not committed in full` }
    log(`${i + 1}/${batches.length} ${b.title}: skipped, waits for ${waiting.join(', ')}`)
    continue
  }
  const c = await exclusive(() =>
    agent(commitPrompt(b), {
      label: `commit: [${b.id}] ${b.title}`, phase: 'Commit', agentType: 'ai-kit:committer', schema: COMMIT,
    }),
  )
  if (!c || !c.hash) {
    results[b.id] = {
      ...head, status: 'blocked', owner: (c && c.owner) || [],
      blockers: (c && c.blockers) || ['agent failed'], notes: (c && c.notes) || [],
    }
    log(`${i + 1}/${batches.length} ${b.title}: not committed`)
    continue
  }
  // an owner decision, a blocker or an unmet Done when check left open: the commit stands, but no batch that waits on
  // it runs; notes never hold one. waitsFor sees the commit only: a dependent may start before its review ends
  const held = c.owner.length || c.blockers.length || (c.unmet || []).length
  const r = { ...head, status: held ? 'partial' : 'committed', ...pick(c) }
  results[b.id] = r
  log(`${i + 1}/${batches.length} ${b.title} → ${c.hash}${held ? ' (left open: see report)' : ''}`)
  reviews.push(
    reviewChain(b, r, c.review).catch((e) => {
      r.status = 'partial'
      r.review = `review chain failed: ${e && e.message}`
    }),
  )
}
await Promise.all(reviews)
return { batches: batches.map((b) => results[b.id]) }
