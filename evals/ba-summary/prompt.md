---
name: ba-summary
tags: [business-analyst]
runs: 1
allowed_tools: [Read, Grep, Glob, Agent]
max_turns: 15
---
Launch the business-analyst subagent (ai-kit:business-analyst) with the request below and reply with its report
unchanged.

Request in the user's words: "Customers should be able to cancel an order until it ships; after that, no."

What the caller knows, inline because the sandbox holds no repo: an `Order` has `status` of `new`, `paid`, `shipped` or
`done`; `src/orders.ts:30-45` has `cancelOrder(id)` that sets `status = 'cancelled'` for any status. There is no
requirements folder and no decision doc. Answer from this text; where a fact is missing, say so.
