# Windows CI handoff (issue #59)

Temporary: the brief for the session that makes `node scripts/test-all.mjs` pass under Git Bash on Windows, so the
`windows-latest` job of `.github/workflows/test.yml` can lose its `continue-on-error`. Delete this file in the commit
that closes #59.

## State on 2026-11-20

- `main` is 2.58.1 (`d0d4389`): ubuntu and shellcheck green, windows advisory.
- Evidence: run 44669837183 (2.58.0, both red) and 44672778667 (2.58.1, windows only). Read a job's failures with
  `gh run view <id> --log-failed | grep "windows-latest" | grep -E "^FAIL|not ok|expected|actual"`.
- Windows: 15 of 35 suites fail. The hooks themselves run on Windows in projects (kit 2.54.0 usage records from a
  `d:\Work` checkout); the failures are the fixtures. Three groups, each with the fix to try first:

| Group | Suites | Symptom | Fix |
|---|---|---|---|
| MSYS paths | `review-before-stop.test.sh` (31 cases), `post-edit-check.test.sh` (8) | tests feed `/c/Users/...` (from `mktemp -d`, `pwd -P`) as `cwd`, `file_path`, transcript paths; the hooks normalise the root to `C:/Users/...` (`lib.sh kit_path`), as Claude Code sends `C:\...`; nothing matches, every block case passes | after `REPO=...`: `command -v cygpath >/dev/null 2>&1 && REPO="$(cygpath -m "$REPO")"`; same for any other dir a test puts in hook input (`S=`, `M=`, `LINKS=`) |
| `env -i` | `bash-guard.test.sh` (14), `kit-log.test.sh` (2), `ask-guard.test.sh` (1) | `env -i PATH= HOME=` drops `SYSTEMROOT` and `TEMP`; node, jq and the fake `bash` shim fail to load ("error while loading shared libraries", exit 126/127, "jq: error: writing output failed") | one helper per test (or in a shared `test-lib.sh`): `clean_env() { env -i PATH="$PATH" HOME="$HOME" ${SYSTEMROOT:+SYSTEMROOT="$SYSTEMROOT"} ${TEMP:+TEMP="$TEMP"} ${MSYSTEM:+MSYSTEM="$MSYSTEM"} "$@"; }` |
| node tests | `decider`, `kit-init`, `state-dirs`, `usage-send`, `usage-digest`, `check-specs` (case 7), `plan`, `queue`, `unattended` | posix separators expected from `path.join` (`/p/s1/subagents` vs `\p\s1\subagents`); `usage.mjs projectRoot` returns `''` for a Windows subfolder path (check whether this one is a real bug: the decider's guard reads it); executable-bit assertions (`kit-init` 19, 20); bash-vs-node path spelling (`state-dirs` 2, 3, 4, 7); root read from a transcript `cwd` (`usage-send` 53, `usage-digest` 51, 53); `plan`, `queue`, `unattended` not yet read | compare with `path.sep`-neutral forms (`split(/[\\/]/)`) or `path.posix` where the code promises posix; skip exec-bit cases on `win32` with a one-line reason; read the remaining suites' `not ok` lines first |

Fix the fixtures, not the hooks or scripts, unless a case shows the code is wrong on Windows (then it is a kit fix
with its own CHANGELOG line). A test that cannot hold on Windows is skipped there with the reason in one comment line,
never deleted.

## Done when

- `node scripts/test-all.mjs` prints `35 of 35 suites ok` under Git Bash on Windows and still on macOS or Linux.
- `.github/workflows/test.yml` has no `continue-on-error`; README (layout row for `.github/workflows/`, release step 2
  in both languages) no longer calls windows advisory.
- Version bumped (patch), one CHANGELOG entry, this file deleted and its `docs/spec.md` row removed, `#59` closed by
  the PR; CI green on the PR before the fast-forward to `main` and the tag.

## Prompt for the Windows session

Paste into Claude Code in the ai-kit clone on Windows, after `git pull`:

```text
Read docs/windows-ci.md and issue #59 (gh issue view 59). Make node scripts/test-all.mjs pass under Git Bash here,
suite by suite in the order of the table: run one failing suite alone (bash hooks/<name>.test.sh, or
node --test scripts/<name>.test.mjs), apply the fix the table names, rerun, then the next. Fix fixtures, not hooks or
scripts, unless a case proves the code wrong on Windows; say so when it does. When all 35 pass: remove
continue-on-error from .github/workflows/test.yml, update the README rows the doc names, bump the patch version,
write the CHANGELOG entry, delete docs/windows-ci.md and its docs/spec.md row, commit on a branch, open the PR that
closes #59, and wait for its CI before the fast-forward merge and the tag. Reply in Thai; report per CLAUDE.core.md.
```
