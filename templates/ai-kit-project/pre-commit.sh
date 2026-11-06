# Sourced by the ai-kit plugin's githooks/pre-commit (POSIX sh, cwd = repo root) after prettier; quiet() is defined there.
# Add this project's checks, each gated on the changed files it guards; changed() is defined there too and gives the
# staged files, or under ai/kit/check.sh the files changed from its base ref:
#
# if changed | grep -qE '^src/.*\.tsx?$'; then
#   quiet node scripts/check-something.mjs || { echo "Something failed. To bypass: git commit --no-verify"; exit 1; }
# fi
