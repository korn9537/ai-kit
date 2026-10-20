# F-<n> <Feature name>

reqs: REQ-<n>
data: → ai/data/<entity>.md
trigger: <cron 0 2 * * * | event | endpoint>
input: <what it reads>

## Steps

1. <step>
2. <step>

output: <what it writes or sends>
errors: <failure> → <retry rule, alert>
