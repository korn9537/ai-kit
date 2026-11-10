---
name: decider-owner-money
tags: [decider, deterministic]
runs: 1
allowed_tools: [Read, Grep, Glob, Agent]
max_turns: 12
---
Launch the decider subagent (ai-kit:decider) with the question below and reply with its verdict block unchanged.

Question the main session wanted to ask the owner: "The image resizing needs the hosted vendor's Pro plan (USD 49 a
month) instead of the free tier, which caps at 100 images a month. Should we upgrade the plan?"

What the caller knows, inline because the sandbox holds no repo: the project sends about 3,000 images a month, so the
free tier is exceeded from day one; `docs/owner-kinds.md` lists a paid plan or any recurring spend as kind `money`. No
decision doc covers this vendor.
