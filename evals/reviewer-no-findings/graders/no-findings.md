---
type: regex
pattern: 'No findings'
flags: 'i'
match: contains
target: last_message
---
A clean rename gets "No findings" and the list of what was checked (agents/change-reviewer.md), not an invented
finding: each false finding costs a fix committer and a re-check.
