export const meta = {
  name: 'ai-kit-run-plan',
  description: 'Run a multi-commit plan: one ai-kit:committer per batch, a change-reviewer per commit, CONFIRMED fixes and one re-check',
  whenToUse: 'Launched by /ai-kit:run-plan with the planned batches as args (commands/run-plan.md)',
  phases: [
    { title: 'Commit', detail: 'one ai-kit:committer per batch, one at a time' },
    { title: 'Review', detail: 'one change-reviewer per commit with a code line' },
    { title: 'Fix', detail: 'CONFIRMED findings fixed, then one re-check' },
  ],
}

// args: { request, plugin, repo?, batches: [{ id, title, brief, verify?, waitsFor?: [id], heavy?, alsoInScope?: [item] }] }
// in plan order. The coordinator rules this replaces: docs/plan-batching.md §Coordinator pipeline.
const batches = (args && args.batches) || []
if (!batches.length || !args.plugin) throw new Error('run-plan needs args.plugin and args.batches')

const COMMIT = {
  type: 'object',
  properties: {
    hash: { type: 'string', description: 'the commit hash, or "" when nothing was committed' },
    files: { type: 'array', items: { type: 'string' } },
    choices: { type: 'array', items: { type: 'string' }, description: 'each choice the brief did not fix' },
    owner: { type: 'array', items: { type: 'string' }, description: 'owner decisions hit and left unanswered' },
    blockers: { type: 'array', items: { type: 'string' }, description: 'what stops a later batch building on it' },
    notes: { type: 'array', items: { type: 'string' }, description: 'verify results, assumptions, follow-ups' },
    review: { type: 'string', enum: ['review', 'skip'], description: 'the word review-needed.sh printed' },
  },
  required: ['hash', 'files', 'choices', 'owner', 'blockers', 'notes', 'review'],
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
// a DB schema or migration, a calculation, a permission or a final decision: opus at high effort
const tier = (b) => (b.heavy ? { model: 'opus', effort: 'high' } : {})
const needed = `bash "${args.plugin}/scripts/review-needed.sh"`
const where = args.repo ? `Repo: ${args.repo} (run every command there).` : ''
const report = [
  `After the commit run \`${needed} <hash>\` from the project root and put the word it prints in \`review\`.`,
  'Report in the structured output: hash ("" when nothing was committed), files, choices, owner (owner decisions',
  'left unanswered; stop before the code that depends on one), blockers (only what stops a later batch building on',
  'this commit), notes (verify results, assumptions, follow-ups). Nothing committed: restore the files you edited,',
  'so the next batch starts on a clean tree.',
].join('\n')

const commitPrompt = (b) =>
  [`Batch ${b.id}: ${b.title}`, where, '', b.brief, '', b.verify ? `Verify: ${b.verify}` : '', report].join('\n')

const scope = (b) => (b.alsoInScope || []).map((s) => `also in scope: ${s} (coordinator)`).join('\n')
const reviewPrompt = (b, hash) =>
  [
    `The user's request: ${args.request || b.title}`,
    `This commit is batch ${b.id}: ${b.title}`,
    where,
    scope(b),
    `Read \`git show ${hash} -- . ':(exclude)ai/usage'\`, not the work tree. Review that commit only.`,
  ].join('\n')

// a typed title keeps its scope: `feat(x): y` → `fix(x): y`, never `fix: feat(x): y`
const fixSubject = (title) => {
  const m = title.match(/^(?:feat|fix|refactor|perf|docs|test|build|ci|chore|style|revert)(\([^)]*\))?!?: (.*)$/)
  return m ? `fix${m[1] || ''}: ${m[2]}` : `fix: ${title}`
}
const list = (fs) => fs.map((f, i) => `${i + 1}. ${f.where} · ${f.what} · ${f.rule} · fix: ${f.fix}`).join('\n')
const fixPrompt = (b, hash, fs) =>
  [
    `Review findings on commit ${hash} (batch ${b.id}: ${b.title}). Fix only these, verify the same way and make one`,
    `commit "${fixSubject(b.title)}".`,
    where,
    '',
    list(fs),
    '',
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
        `A data or rule finding was fixed, so this is a fresh review of the change as a whole: read`,
        `\`git show ${hash} ${fixHash} -- . ':(exclude)ai/usage'\`. The first review found:`,
        list(fs),
      ].join('\n')
    : [
        where,
        `Re-check of a fix. Read only \`git show ${fixHash} -- . ':(exclude)ai/usage'\`. For each finding below, is it`,
        'fixed? Report one still not fixed as CONFIRMED with what is left, and anything new the fix breaks.',
        list(fs),
      ].join('\n')

const results = {}
const pick = (c) => ({ hash: c.hash, files: c.files, choices: c.choices, owner: c.owner, blockers: c.blockers, notes: c.notes })

async function reviewChain(b, r, need) {
  if (need === 'skip') {
    r.review = 'skipped: move-only or comment-only'
    return
  }
  const rv = await agent(reviewPrompt(b, r.hash), {
    label: `review: ${b.title}`, phase: 'Review', agentType: 'ai-kit:change-reviewer', schema: REVIEW, ...tier(b),
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
      label: `commit: fix ${b.title}`, phase: 'Fix', agentType: 'ai-kit:committer', schema: COMMIT, ...tier(b),
    }),
  )
  if (!fx || !fx.hash) {
    r.status = 'partial'
    r.review = 'CONFIRMED findings left unfixed'
    r.blockers.push(...((fx && fx.blockers) || []))
    r.notes.push(...((fx && fx.notes) || []))
    return
  }
  r.fix = pick(fx)
  const fresh = confirmed.some((f) => f.dataRule)
  const rc = await agent(recheckPrompt(b, r.hash, fx.hash, confirmed, fresh), {
    label: `review: recheck ${b.title}`, phase: 'Fix', agentType: 'ai-kit:change-reviewer', schema: REVIEW, ...tier(b),
  })
  if (!(rc && rc.reviewed)) {
    r.recheck = `not re-checked: ${rc ? rc.checked : 'reviewer failed or was skipped'}`
    r.review = 'fixed; not re-checked'
    return
  }
  r.recheck = rc.findings
  r.review = fresh ? 'fixed; fresh review of the data or rule fix' : 'fixed; re-checked once, no third pass'
  const left = (rc.findings || []).filter((f) => f.verdict === 'CONFIRMED').length
  if (left) {
    r.status = 'partial'
    r.review += `; ${left} CONFIRMED finding(s) left`
    r.blockers.push(`${left} CONFIRMED finding(s) left after the re-check: see recheck`)
  }
  log(`${b.title}: fix ${fx.hash}, ${rc.findings.length} finding(s) left`)
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
      label: `commit: ${b.title}`, phase: 'Commit', agentType: 'ai-kit:committer', schema: COMMIT, ...tier(b),
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
  // an owner decision or a blocker left open: the commit stands, but no batch that waits on it runs; notes never
  // hold one. waitsFor sees the commit only: a dependent may start before this commit's review ends
  const held = c.owner.length || c.blockers.length
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
