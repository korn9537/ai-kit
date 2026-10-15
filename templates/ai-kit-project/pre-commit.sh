# Sourced by the ai-kit plugin's githooks/pre-commit (POSIX sh, cwd = repo root) after prettier; quiet() is defined there.
# Add this project's checks, each gated on the staged files it guards:
#
# if git diff --cached --name-only --diff-filter=ACMR | grep -qE '^src/.*\.tsx?$'; then
#   quiet node scripts/check-something.mjs || { echo "Something failed. To bypass: git commit --no-verify"; exit 1; }
# fi
