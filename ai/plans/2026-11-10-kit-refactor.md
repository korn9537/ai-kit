# Plan kit-refactor

goal: the request in the block below, one commit per batch.
job: `2026-11-10-kit-refactor`
status: the commits of this job, by their Batch trailer (`plan.mjs status`); never edited here.

```json
{
  "job": "2026-11-10-kit-refactor",
  "request": {
    "lines": [
      "ทำ refactor ของ kit: (1) รวมพาธ state ไว้ที่เดียว (2) แยก scripts/kit.mjs เป็นไฟล์ต่อคำสั่ง (3) จัด scripts/ ",
      "ให้เป็นกลุ่มย่อย. ไม่เปลี่ยนพฤติกรรม; spec.md ต้องตรงกับไฟล์ในทุก commit"
    ]
  },
  "batches": [
    {
      "id": "state-dirs",
      "title": "one helper for the claude-review, claude-usage and claude-decider folders",
      "brief": {
        "lines": [
          "Refactor, no behavior change. Today every caller builds the state-folder path itself. Add `kit_state_dir ",
          "<review|usage-cache|usage|decider>` to hooks/lib.sh and a node twin scripts/lib/state-dirs.mjs (exports ",
          "reviewDir(root), usageCacheDir(root), usageBufDir(root), deciderDir(root)); both must return exactly the ",
          "paths used today: review = <absolute-git-dir>/claude-review, usage-cache = <absolute-git-dir>/claude-usage ",
          "(transcript cache <session>.json), usage = <git-common-dir>/claude-usage (buffer <session>.jsonl, ",
          ".flushed, locks), decider = <git-common-dir>/claude-decider. Replace the inline path building at: ",
          "hooks/review-snapshot.sh:9,42-45; hooks/review-before-stop.sh:180-182; ",
          "hooks/handoff-nudge.sh:40-41,52,102,107; hooks/session-start.sh:24-27; scripts/plan.mjs:432; ",
          "scripts/usage.mjs:263-271,303-305; scripts/decider.mjs:182-183. Do not touch scripts/kit.mjs. Add ",
          "scripts/state-dirs.test.mjs: in a temp repo with a `git worktree add` second work tree, assert the node ",
          "helper and `bash -c 'source hooks/lib.sh; kit_state_dir ...'` print the same four paths, that review and ",
          "usage-cache differ per work tree and usage and decider are shared, and that each equals the literal path ",
          "built from `git rev-parse --absolute-git-dir` / `--git-common-dir`. Name scripts/lib/state-dirs.mjs and ",
          "scripts/state-dirs.test.mjs in docs/spec.md (Files, scripts/) and README Layout, and mention the helper ",
          "where the state-folder table says which script writes a folder. Verify once: node scripts/test-all.mjs. ",
          "The brief holds no other file."
        ]
      },
      "accept": [
        {
          "lines": [
            "no hook or script builds a path ending in claude-review, claude-usage or claude-decider except ",
            "hooks/lib.sh and scripts/lib/state-dirs.mjs (grep shows only those two files, comments and tests aside)"
          ]
        },
        {
          "lines": [
            "kit_state_dir and the node helper return the same four paths in a repo and in a second work tree, and ",
            "each equals the path the old code built"
          ]
        },
        "node scripts/test-all.mjs passes, including the new scripts/state-dirs.test.mjs and scripts/spec.test.mjs"
      ],
      "risks": [
        {
          "lines": [
            "a hook runs with cwd outside the repo or in a subfolder: the helper must resolve the git dir from the ",
            "same directory the old inline code used"
          ]
        },
        {
          "lines": [
            "a work tree's absolute git dir differs from the common dir: review and usage-cache stay per work tree, ",
            "buffer and decider stay shared; swapping them loses a session's records or review snapshot"
          ]
        },
        {
          "lines": [
            "a hook sourcing lib.sh in a project without ai/kit/ must still exit 0 silently: adding the function must ",
            "not run git at source time"
          ]
        },
        {
          "lines": [
            "scripts/lib/ is a new folder: scripts/test-all.mjs does not scan sub-folders, so the new test lives in ",
            "scripts/"
          ]
        }
      ],
      "tests": [
        {
          "lines": [
            "scripts/state-dirs.test.mjs: bash and node helpers agree in a repo and in a linked work tree, and equal ",
            "the literal git paths"
          ]
        },
        "existing hooks/*.test.sh and scripts/{plan,usage,decider}.test.mjs pass unchanged"
      ],
      "verify": [
        "node scripts/test-all.mjs"
      ],
      "waitsFor": [],
      "alsoInScope": []
    },
    {
      "id": "kit-split",
      "title": "split scripts/kit.mjs into one module per command under scripts/kit/",
      "brief": {
        "lines": [
          "Move-only split of scripts/kit.mjs (1203 lines, over the 40 KB rule: the pre-commit blocks it unless the ",
          "edit only moves lines out plus imports and re-exports). Map from the current file: shared constants and ",
          "helpers (LINE, HEAD, SYNC, STAGED, HELPERS, kit, root, gitIn/tryGitIn/tryGit, at, read, readConf, readLF, ",
          "sha, isObj, jsonText, lsFiles, codeLines) at about :23-47,260-358,1080-1083; sync/unattended snapshot ",
          "(bodies, reviewBody, extras, headOf, syncSnapshot :136-197, snapshotWarnings :207-258, unattended helpers ",
          ":912-1079); check warnings (eolWarnings :379 .. problems :551-694, allWarnings :790-808); init (initFiles ",
          ":695-789, init :809-823); uninstall :824-908; inventory :1087-1181; dispatcher :1182-1203. Create ",
          "scripts/kit/{shared,sync,check,init,uninstall,unattended,inventory}.mjs (split further only if a file ",
          "would still be over 40 KB; a function used by two commands goes to shared.mjs or the module that owns it, ",
          "no cycle). scripts/kit.mjs keeps only the isMain dispatcher and re-exports every name that ",
          "scripts/kit-migrate.mjs imports (PLUGIN, allWarnings, at, eolOf, initFiles, isImportLine, isKitHook, ",
          "isObj, jsonText, kit, lsFiles, read, root, tryGit) plus HELPERS (scripts/unattended.test.mjs:122). Keep ",
          "the CLI path `node <plugin>/scripts/kit.mjs <command>` and every printed message byte for byte. `kit` must ",
          "still be the plugin root (now `../..` from scripts/kit/); `root` is still the git toplevel of cwd, ",
          "evaluated when shared.mjs is first imported. syncSnapshot must still read scripts/check-docs.mjs and ",
          "scripts/check-comments.mjs and write the same header text `from scripts/<name>.mjs`, so generated copies ",
          "in projects are not stale. No logic change: if a function must change to compile, stop and report it. ",
          "Update docs/spec.md (Files, scripts/: one row per new module, kit.mjs row says dispatcher) and README ",
          "Layout. Tests kit-init, kit-inventory, kit-migrate, kit-uninstall and unattended run kit.mjs as a CLI and ",
          "stay unchanged. Verify once: node scripts/test-all.mjs."
        ]
      },
      "accept": [
        {
          "lines": [
            "scripts/kit.mjs holds the dispatcher and re-exports only; every moved function is byte-identical apart ",
            "from import lines and `kit` path depth"
          ]
        },
        {
          "lines": [
            "kit.mjs init, check, sync, unattended, uninstall, inventory and migrate print the same output as before ",
            "on the existing fixtures (kit-init, kit-inventory, kit-migrate, kit-uninstall, unattended tests pass ",
            "unchanged)"
          ]
        },
        {
          "lines": [
            "generated copies written by sync keep the same header and sha256 for an unchanged kit (no project sees ",
            "its copies as stale)"
          ]
        },
        "no file in scripts/kit/ is over 40 KB and there is no import cycle between the modules",
        "docs/spec.md names every new file and node scripts/test-all.mjs passes"
      ],
      "risks": [
        {
          "lines": [
            "root and kit are computed at import time: a module imported before cwd is set, or a second copy of ",
            "shared.mjs, would resolve another root"
          ]
        },
        {
          "lines": [
            "an import cycle between check, sync and unattended breaks at load with a TDZ error that only some ",
            "commands hit"
          ]
        },
        {
          "lines": [
            "`kit` is derived from import.meta.dirname/..: one level deeper it points at scripts/, and sync would ",
            "copy from the wrong folder"
          ]
        },
        {
          "lines": [
            "kit-migrate.mjs and unattended.test.mjs import names from kit.mjs: a dropped re-export fails only when ",
            "that command runs"
          ]
        },
        "moving lines while editing them defeats the 40 KB move-only check and hides a behavior change from review"
      ],
      "tests": [
        {
          "lines": [
            "scripts/kit-init.test.mjs, kit-inventory.test.mjs, kit-migrate.test.mjs, kit-uninstall.test.mjs, ",
            "unattended.test.mjs pass unchanged"
          ]
        },
        "scripts/spec.test.mjs fails if a new module is not named in docs/spec.md"
      ],
      "verify": [
        "node scripts/test-all.mjs"
      ],
      "waitsFor": [
        "state-dirs"
      ],
      "alsoInScope": []
    },
    {
      "id": "lib-move",
      "title": "move the internal modules into scripts/lib/; CLI entry points keep their paths",
      "brief": {
        "lines": [
          "Move scripts/is-main.mjs, scripts/usage-collect.mjs and scripts/usage-digest.mjs into scripts/lib/ ",
          "(scripts/lib/state-dirs.mjs and scripts/lib/ already exist from batch state-dirs; scripts/kit/ from ",
          "kit-split). Every CLI entry point stays where it is and keeps its path (kit, plan, jobs, continuous, ",
          "decider, usage, check-docs, check-comments, check-specs, review-needed.sh), because commands, hooks, ",
          "README and users' docs name `<plugin>/scripts/<name>`. Update every import: kit.mjs and scripts/kit/*.mjs ",
          "(is-main, plan, usage-collect), kit-migrate.mjs (is-main, kit), decider.mjs, continuous.mjs, plan.mjs, ",
          "usage.mjs (is-main; usage-collect, usage-digest), usage-digest.mjs (usage-collect), plus tests that import ",
          "them: decider.test, continuous.test, handoffs.test, plan-live.test, plan.test, usage.test, ",
          "usage-collect.test, usage-digest.test, unattended.test.mjs:122, is-main.test (it greps the CLIs for a raw ",
          "compare against process.argv[1]; keep it true). scripts/lib files keep their ",
          "`import.meta.dirname`-relative reads correct one level deeper (usage-collect transcriptsDir and any path ",
          "to docs/ or hooks/). Do not move check-docs.mjs or check-comments.mjs (sync copies them into projects), do ",
          "not move any *.test.mjs (scripts/test-all.mjs scans scripts/ without sub-folders), do not touch ",
          "scripts/kit-migrate.mjs beyond its imports. Update docs/spec.md (Files, scripts/: paths scripts/lib/...; ",
          "add a note that scripts/lib holds modules with no CLI), README Layout rows, and any command or doc that ",
          "names a moved file (`grep -rn 'usage-collect\\|usage-digest\\|is-main' --include='*.md' --include='*.sh' ",
          "--include='*.js' .`). Verify once: node scripts/test-all.mjs."
        ]
      },
      "accept": [
        {
          "lines": [
            "scripts/is-main.mjs, usage-collect.mjs and usage-digest.mjs exist only under scripts/lib/ and nothing ",
            "imports the old paths"
          ]
        },
        "every CLI path named in commands/, hooks/, githooks/, workflows/, README.md and docs/ still exists",
        "docs/spec.md and README Layout name the moved files at their new paths and node scripts/test-all.mjs passes"
      ],
      "risks": [
        {
          "lines": [
            "a missed import fails only when that command runs (decider.test.mjs:130 imports usage.mjs dynamically; ",
            "hooks/kit-log.sh runs usage.mjs through node)"
          ]
        },
        {
          "lines": [
            "usage-collect.mjs and usage-digest.mjs read paths relative to import.meta.dirname: one level deeper they ",
            "resolve to scripts/ instead of the plugin root"
          ]
        },
        "moving check-docs or check-comments would make project copies from `kit.mjs sync` read a missing source",
        {
          "lines": [
            "a hook or command that names `scripts/usage-collect.mjs` or `scripts/is-main.mjs` directly breaks ",
            "silently inside a hook that exits 0 on error"
          ]
        }
      ],
      "tests": [
        "all existing suites pass unchanged except import lines",
        "scripts/is-main.test.mjs still passes after the move",
        "scripts/spec.test.mjs fails if a moved file is named at its old path"
      ],
      "verify": [
        "node scripts/test-all.mjs",
        {
          "lines": [
            "grep -rn 'scripts/is-main\\|scripts/usage-collect\\|scripts/usage-digest' --include='*.md' ",
            "--include='*.sh' --include='*.js' --include='*.mjs' --include='*.json' . | grep -v CHANGELOG | grep -v ",
            "superpowers"
          ]
        }
      ],
      "waitsFor": [
        "state-dirs",
        "kit-split"
      ],
      "alsoInScope": [
        {
          "lines": [
            "narrower than the request's 'group scripts/': only internal modules move, so no documented CLI path ",
            "changes (13 places name scripts/kit.mjs)"
          ]
        }
      ]
    },
    {
      "id": "release",
      "title": "2.38.1: version and CHANGELOG for the refactor",
      "brief": {
        "lines": [
          "Bump version in .claude-plugin/plugin.json from 2.38.0 to 2.38.1 and add a `## 2.38.1` entry at the top of ",
          "CHANGELOG.md: refactor, no behavior change; one helper for the claude-review, claude-usage and ",
          "claude-decider folders (hooks/lib.sh kit_state_dir, scripts/lib/state-dirs.mjs); scripts/kit.mjs split ",
          "into scripts/kit/*.mjs, dispatcher and CLI path unchanged; is-main, usage-collect and usage-digest moved ",
          "to scripts/lib/; no project needs to edit anything. Wrap lines at 120. Check docs/spec.md Processes P5 and ",
          "P8 and the state-folder table still describe the code after the three earlier batches and fix only what is ",
          "wrong. Verify once: node scripts/test-all.mjs."
        ]
      },
      "accept": [
        "plugin.json says 2.38.1 and CHANGELOG.md has a 2.38.1 entry naming all three changes",
        "node scripts/test-all.mjs passes"
      ],
      "risks": [
        "none: <doc and version only; no code line changes>"
      ],
      "tests": [
        "none: <doc and version only; scripts/spec.test.mjs and the suite run in verify>"
      ],
      "verify": [
        "node scripts/test-all.mjs"
      ],
      "waitsFor": [
        "lib-move"
      ],
      "alsoInScope": []
    }
  ]
}
```
