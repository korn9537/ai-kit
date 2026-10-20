# API <area>

data: → ai/data/<entity>.md

## GET /screens/<screen>

- roles: <role>
- query: <param> (<type>, <limit>) · page · size (default 50, cap 200)
- response: items[] { id, <field>, <field> } · total
- errors: 403 role

## POST /<resource>/{id}/<command>

- roles: <role>
- body: { <field> }
- transition: <status> → <status>
- errors: 403 role · 409 status is not <status>
