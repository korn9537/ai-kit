# Plan committer-size

goal: the request in the block below, one commit per batch.
job: `2026-11-13-committer-size`
status: the commits of this job, by their Batch trailer (`plan.mjs status`); never edited here.

```json
{
  "job": "2026-11-13-committer-size",
  "request": {
    "lines": [
      "ควรแยก agent committer เป็น frontend, backend, mobile ไหม (performance, effort, model) → agreed instead: ",
      "per-batch size tiers (light|normal|heavy) mapped to model/effort, escalation on review fixes capped at heavy, ",
      "optional committer.maxSize, heavy criteria code-level only since BA already covers business rules. ok"
    ]
  },
  "batches": [
    {
      "id": "plan-size",
      "title": "plan.mjs: batch size field and maxSize arg",
      "brief": {
        "lines": [
          "This repo is the ai-kit plugin source. Add an optional per-batch `size` (\"light\" | \"normal\" | ",
          "\"heavy\") and an optional job-level `maxSize` (same values) to the plan args.\n1. scripts/plan.mjs ",
          "`checkBatch` (scripts/plan.mjs:98-119): `size` when present must be one of the three; otherwise throw ",
          "`batch <id>: size is light, normal or heavy`. Absent = normal (old plans and old args files stay valid). ",
          "continuous.mjs init already calls checkBatch, so it gets the check too; confirm that.\n2. Where ",
          "`write`/`merge` validates job-level args (scripts/plan.mjs:121 on), accept `maxSize` with the same three ",
          "values, refuse any other value.\n3. The plan file must keep `size` per batch: `write` then `parse` gives ",
          "it back unchanged (see how risks/tests/alsoInScope are stored, scripts/plan.mjs:379 and the parse code).\n",
          "4. `resumeArgs` (scripts/plan.mjs:169) and `resume` (scripts/plan.mjs:499-524): the args file it writes ",
          "carries each batch's `size`, and `maxSize` read from the project's ai/kit/config.json `committer.maxSize` ",
          "when set and valid; an invalid value is left out and named in resume's output as a warning (not a throw). ",
          "Read config the way scripts/usage.mjs:244 does (missing file or bad JSON = no maxSize).\n5. Update the ",
          "usage comment at scripts/plan.mjs:3 only if the CLI changes (it should not).\nDo not touch ",
          "workflows/run-plan.js (batch workflow-tiers) or docs (batch docs)."
        ]
      },
      "accept": [
        "checkBatch refuses a size other than light, normal or heavy, and accepts a batch with no size",
        "plan.mjs write refuses an args maxSize other than light, normal or heavy",
        "a batch's size survives plan.mjs write then parse unchanged",
        {
          "lines": [
            "plan.mjs resume's args file holds each batch's size and maxSize from ai/kit/config.json ",
            "committer.maxSize when valid; an invalid config value is left out with a warning"
          ]
        },
        "plans and args files without size or maxSize behave exactly as before"
      ],
      "risks": [
        "an old plan file or a continuous state written by 2.47 has no size: absent must mean normal, never a refusal",
        "ai/kit/config.json missing, unreadable or without committer: resume must still work and add no maxSize",
        "a size stored in the plan file pushes a line past the 120-column doc check: keep the stored form short"
      ],
      "tests": [
        "plan.test.mjs: checkBatch with size light/normal/heavy passes, size 'opus' throws, no size passes",
        "plan.test.mjs: write args with maxSize 'max' is refused",
        "plan.test.mjs: write then parse keeps size on each batch",
        {
          "lines": [
            "plan.test.mjs: resume with config committer.maxSize normal puts maxSize in the args file; with 'huge' ",
            "leaves it out and warns; with no config file adds none"
          ]
        },
        "continuous.test.mjs: init refuses a batch with an invalid size"
      ],
      "verify": "node scripts/plan.test.mjs 2>&1 | tail -n 20 && node scripts/continuous.test.mjs 2>&1 | tail -n 20",
      "waitsFor": [],
      "alsoInScope": [
        {
          "lines": [
            "continuous retries keep the batch's size: continuous only retries an agent that died ",
            "(continuous.mjs:17), which says nothing about difficulty (coordinator)"
          ]
        }
      ]
    },
    {
      "id": "workflow-tiers",
      "title": "run-plan.js: run each committer at its batch size",
      "brief": {
        "lines": [
          "In workflows/run-plan.js (plain JS, no fs access; agent(prompt, opts) accepts opts.model and ",
          "opts.effort):\n1. One map near the top: light → {model: 'sonnet', effort: 'low'}, normal → {} (the ",
          "committer's frontmatter: sonnet, medium), heavy → {model: 'opus', effort: 'high'}. Order light < normal < ",
          "heavy. Never xhigh or max.\n2. `args.maxSize` (optional) clamps every size down to it. A clamped run is ",
          "recorded, not silent.\n3. The batch commit call (workflows/run-plan.js:349-353): spread the tier opts of ",
          "`b.size` (absent = normal) after clamping.\n4. Job review fixes (reviewChain, ",
          "workflows/run-plan.js:229-300; the job pseudo-batch is built at workflows/run-plan.js:372-385): the first ",
          "fix runs at the highest size among the committed batches, raised to heavy when any CONFIRMED finding it ",
          "fixes has dataRule; fix2 runs one tier above the first fix's size. Every raise stops at heavy, then ",
          "maxSize clamps.\n5. Each batch result and the job review's fix/fix2 entries carry `size: {planned, ran}` ",
          "(ran differs only when maxSize clamped); log() lines name the ran size when not normal. Do not change any ",
          "agent label: plan.mjs live and the usage scripts read `commit: [<id>] <title>`.\n6. The plan review prompt ",
          "(planPrompt, workflows/run-plan.js:321): add a check that each batch's size fits the criteria: heavy only ",
          "for code-level difficulty (a migration or data change on live data; transactions, concurrency or ",
          "idempotency); business rules or calculations that a BA report and the brief already settle stay normal; ",
          "light for docs-only, copy, config values, a codemod run, a rename or a move-only change. A wrong size is a ",
          "PLAUSIBLE finding.\nContinuous retries are not changed: they rerun the same args, so the size stays. Do ",
          "not edit docs (batch docs)."
        ]
      },
      "accept": [
        {
          "lines": [
            "a light batch's committer is called with model sonnet, effort low; heavy with model opus, effort high; ",
            "normal and absent with neither key"
          ]
        },
        {
          "lines": [
            "the first job fix runs at the highest committed batch size, heavy when any CONFIRMED finding it fixes ",
            "has dataRule; fix2 runs one tier higher; nothing goes above heavy"
          ]
        },
        "args.maxSize clamps every committer and fix call, and the result's size {planned, ran} shows the clamp",
        "agent labels are unchanged",
        "the plan review prompt asks for a size check against the code-level heavy criteria"
      ],
      "risks": [
        {
          "lines": [
            "agent() given model: undefined or effort: undefined could override the frontmatter: normal must pass no ",
            "keys at all"
          ]
        },
        "a raise past heavy (fix2 of a heavy job) must stay heavy, never index past the map",
        {
          "lines": [
            "a size value the workflow does not know (args written by hand, skipping plan.mjs) must fall back to ",
            "normal, not throw mid-run"
          ]
        },
        "changing a label breaks plan.mjs live and usage attribution"
      ],
      "tests": [
        {
          "lines": [
            "run-plan.test.mjs: the fake agent records opts; light/normal/heavy/absent batches get the expected ",
            "model/effort keys (normal and absent: no keys)"
          ]
        },
        {
          "lines": [
            "run-plan.test.mjs: a job of a light and a normal batch with a dataRule CONFIRMED finding runs its fix at ",
            "heavy; a non-dataRule finding runs it at normal; fix2 after a heavy fix stays heavy"
          ]
        },
        {
          "lines": [
            "run-plan.test.mjs: maxSize normal turns a heavy batch's call into no keys and its result shows size ",
            "{planned: heavy, ran: normal}"
          ]
        },
        "run-plan.test.mjs: an unknown size runs as normal",
        "run-plan.test.mjs: labels match the existing commit:/review: forms"
      ],
      "verify": "node scripts/run-plan.test.mjs 2>&1 | tail -n 20",
      "waitsFor": [],
      "alsoInScope": []
    },
    {
      "id": "docs",
      "title": "docs: size tiers, criteria and caps",
      "brief": {
        "lines": [
          "Document what batches plan-size and workflow-tiers built (read their commits: git log --grep 'Job: ",
          "2026-11-13-committer-size').\n1. docs/plan-batching.md: in §Before the first edit, a step or bullet for ",
          "each batch's size: light (docs-only, copy, config values, a codemod run, rename, move-only), normal (the ",
          "default, including business rules or calculations a business-analyst report and the brief settle), heavy ",
          "(code-level difficulty only: a migration or data change on live data; transactions, concurrency, ",
          "idempotency). §Plan review: the reviewer checks size. §Coordinator pipeline: replace ",
          "docs/plan-batching.md:103 (\"The Agent call passes no model or effort\") with the size → model/effort map ",
          "and the escalation (first job fix at the highest batch size, heavy for a dataRule finding, fix2 one tier ",
          "up, nothing above heavy, never xhigh/max automatically, maxSize clamps); the main-session coordinator (no ",
          "workflow) passes the same model/effort on its Agent calls; adjust the general-purpose fallback at ",
          "docs/plan-batching.md:99-100 to match. Say continuous retries keep the size (they retry only an agent that ",
          "died).\n2. commands/run-plan.md step 2: add `size` to the batch fields and `maxSize` (from ",
          "ai/kit/config.json committer.maxSize when set) to the args. commands/continuous.md: the same `maxSize` ",
          "when it writes the args file.\n3. docs/handoffs.md, docs/spec.md, CLAUDE.core.md (its Agent model bullet ",
          "near line 59), templates/ai-kit-project/config.json and README: update each only where it lists the batch ",
          "fields, the args, the agents' models or the config keys; leave the template's committer key out unless the ",
          "template lists every optional key.\n4. CHANGELOG.md: an Unreleased entry in the file's existing style.\n",
          "Keep the docs' existing voice (short imperative lines, reader: AI agents) and the 120-column wrap the ",
          "pre-commit checks."
        ]
      },
      "accept": [
        {
          "lines": [
            "plan-batching.md states the size criteria with heavy limited to code-level difficulty and business rules ",
            "settled by BA as normal"
          ]
        },
        {
          "lines": [
            "plan-batching.md no longer says the Agent call passes no model or effort, and states the map, the fix ",
            "escalation, the heavy ceiling and maxSize"
          ]
        },
        "commands/run-plan.md and commands/continuous.md name size and maxSize",
        "every doc that lists batch fields, args or the committer's model agrees with the code",
        "CHANGELOG has an Unreleased entry"
      ],
      "risks": [
        {
          "lines": [
            "handoffs.test.mjs checks the docs against the agents and the workflow: a field named in one and not the ",
            "other fails the pre-commit"
          ]
        },
        "a doc line over 120 columns fails check-docs",
        "a doc claim (for example that continuous escalates) the code does not make true"
      ],
      "tests": [
        "none: doc-only batch; handoffs.test.mjs and check-docs run in the pre-commit and hold the docs to the code"
      ],
      "verify": "node scripts/handoffs.test.mjs 2>&1 | tail -n 20 && node scripts/test-all.mjs 2>&1 | tail -n 20",
      "waitsFor": [
        "plan-size",
        "workflow-tiers"
      ],
      "alsoInScope": []
    }
  ]
}
```
