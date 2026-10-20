# S-<n> <Screen name>

platforms: web · mobile
reqs: REQ-<n>
data: → ai/data/<entity>.md
roles: <role> · <role>
files: <path/to/page.tsx> · <lib/screens/name_screen.dart>
reads: GET /screens/<screen>
lookups: GET /lookups/<set>
loads: GET /<parent>/{id}/<sub-list> (tab <name>, own paging)
actions: <action> → POST /<resource>/{id}/<command> (roles: <role>)
fields: <field> · <field> ← reads; client formats only
states: loading skeleton · empty → empty_state · error → retry
nav: row → S-<n> · <button> → S-<n>
web: route /<path>?<param>= · refresh keeps filters
mobile: deep link <scheme>://<path> · offline: last read shown read-only · Android back → S-<n>

## Copy

| key | th | en |
|---|---|---|
| empty_state | ยังไม่มีรายการ | No items yet |
