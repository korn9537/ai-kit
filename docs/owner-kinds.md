# Owner kinds

The one list of what only the owner decides. CLAUDE.core.md, `agents/business-analyst.md`, `agents/decider.md` and
`agents/committer.md` point here and do not restate it; `scripts/handoffs.test.mjs` fails when one does.

1. **money** — a price, purchase, paid service or added infra cost; any change to an amount a customer pays, a bug fix
   toward the evident intent included (never filed as "assumed").
2. **irreversible** — an irreversible or outward action: delete real data, a production deploy, contacting people, a
   name or id that becomes permanent once published.
3. **legal** — legal wording, privacy, consent, public contact details, personal data.
4. **final-decision** — changing a decision recorded as final: `Confirmed`, or the final status label
   `ai/kit/analysis-sources.md` names.

Also the owner's (**owner-only**): a choice the user asked to make themselves, or a fact only the owner has (an
account, a customer's wish nobody wrote down) that no source holds.

Everything else inside the request is the agent's: technical choices, order of work, naming inside the code, which
of two readings of a requirement, which environment a non-production command runs on, a merge of the session's own
branches. It is decided, acted on and reported under Decided; the owner may overrule later. What the task created
(worktrees, scratch or test databases, temp branches, seeded test tenants) is cleaned up before the report and is not
kind 2.
