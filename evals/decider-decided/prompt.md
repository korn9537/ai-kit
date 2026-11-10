---
name: decider-decided
tags: [decider, deterministic]
runs: 1
allowed_tools: [Read, Grep, Glob, Task]
max_turns: 12
---
Launch the decider subagent (ai-kit:decider) with the question below and reply with its verdict block unchanged.

Question the main session wanted to ask the owner: "The new `formatPrice` helper must round to two decimals. Should
it use the `roundHalfUp` function that `src/money.ts` already exports and that the other three price helpers call, or
a new `Math.round` inline?"

What the caller knows, inline because the sandbox holds no repo: `src/money.ts:12-18` exports
`roundHalfUp(n: number, digits: number): number`, used by `totalPrice`, `taxOf` and `discountOf`. `ai/decisions.md`
D-7 says: "All money rounding goes through roundHalfUp; no inline Math.round on an amount." The change is a code
detail, free to undo, and touches no payment, data deletion or legal text.
