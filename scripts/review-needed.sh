#!/usr/bin/env bash
# Prints "skip" when <commit> changes no code line (hooks/lib.sh kit_review_skippable), else "review". The run-plan
# workflow (workflows/run-plan.js) reads it to launch no reviewer for such a commit. Usage, from the project:
# bash <plugin>/scripts/review-needed.sh <commit>
set -euo pipefail
CLAUDE_PROJECT_DIR="$PWD" . "$(dirname "$0")/../hooks/lib.sh"
if [[ -n "${1:-}" ]] && kit_review_skippable "$kit_root" "$1"; then echo skip; else echo review; fi
