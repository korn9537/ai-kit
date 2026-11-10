---
type: regex
pattern: '^Verdict: \S'
flags: m
match: contains
target: last_message
---
The block has a Verdict line with text.
