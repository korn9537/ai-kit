---
name: decider-format
tags: [decider, deterministic]
runs: 1
allowed_tools: [Read, Grep, Glob, Task]
max_turns: 12
---
Launch the decider subagent (ai-kit:decider) with the question below and reply with its verdict block unchanged.

Question the main session wanted to ask the owner: "The `--verbose` flag of `scripts/export.mjs` should print one line
per file. Should the line show the path relative to the repo root or the absolute path?"

What the caller knows, inline because the sandbox holds no repo: `scripts/export.mjs:40-44` already prints relative
paths in its error lines, and `ai/decisions.md` D-3 says "CLI output uses repo-relative paths". The change is free to
undo.
