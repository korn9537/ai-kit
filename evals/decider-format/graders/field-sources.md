---
type: regex
pattern: '^Sources: \S'
flags: m
match: contains
target: last_message
---
The block has a Sources line with text.
