---
type: regex
pattern: '^Verdict: .+\nKind: .+\nQuestion: .+\nChoice: .+\nReason: .+\nConfidence: (?:high|medium|low)\nUndo: .+\nSources: .+\s*$'
flags: ''
match: contains
target: last_message
---
Exactly the 8 fields in the order of agents/decider.md, one block, nothing after the last block.
