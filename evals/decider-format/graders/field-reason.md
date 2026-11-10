---
type: regex
pattern: '^Reason: \S'
flags: m
match: contains
target: last_message
---
The block has a Reason line with text.
