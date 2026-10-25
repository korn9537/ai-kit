# Token management: notes (deleted in Task 8)

1. A Stop hook's `{"systemMessage": "..."}` is shown to the user and stays out of the model's context: yes, so
   Task 5 prints it.
   Evidence: `claude -p` 2.1.234 emitted a `system`/`informational` entry "Stop says: ..."; the transcript holds it
   only as a `hook_system_message` attachment; asked next round, the model did not mention it.
2. Two Stop hooks in one group both have their JSON applied: yes (they run in parallel).
   Evidence: hook A printing `systemMessage` and hook B printing `decision:block` in one group showed "Stop says: ..."
   and the model got "Stop hook feedback: (the reason)" and continued.
