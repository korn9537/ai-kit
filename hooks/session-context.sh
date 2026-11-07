#!/usr/bin/env bash
# SessionStart: injects the first half of CLAUDE.core.md and nothing else, so a slow session-start.sh never costs it.
# Silent without ai/kit/.
set -euo pipefail

. "$(dirname "$0")/lib.sh"
kit_enabled || exit 0
kit_inject "$(kit_core 1)"
