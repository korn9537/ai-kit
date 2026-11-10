---
type: regex
pattern: '\AVerdict: .+\nKind: .+\nQuestion: .+\nChoice: .+\nReason: .+\nConfidence: (?:high|medium|low)\nUndo: .+\nSources: .+\s*\Z'
flags: ''
match: true
target: last_message
---
Exactly the 8 fields in the order of agents/decider.md, one block, nothing after the last block.
