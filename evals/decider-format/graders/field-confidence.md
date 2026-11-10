---
type: regex
pattern: '^Confidence: \S'
flags: m
match: contains
target: last_message
---
The block has a Confidence line with text.
