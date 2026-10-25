# Sourced by the ai-kit plugin's hooks/post-edit-check.sh with $rel (repo-relative file) and run <label> <filter|-> <cmd...>.
# Add this project's fast per-file checks. run starts each in the background, so they must not write the same file;
# run inside a subshell (`( cd x && run ... )`) runs in the foreground: `bash -c 'cd x && ...'` keeps it parallel.
# Call a tool's bin directly: npx adds 0.2-1 s to every edit.
#
# case "$rel" in
#   src/*.ts | src/*.tsx) run "eslint" - node_modules/.bin/eslint --quiet "$rel" ;;
# esac
