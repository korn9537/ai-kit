# Kit proposals

Source: GitHub issues on `korn9537/ai-kit`, label `proposal`. Filed from project sessions, landed by
`/ai-kit:harvest` in the ai-kit clone. Never edit the installed plugin: an update overwrites it.

## When to file

- Summary item 5 (or BA item 5) sets a new standard that passes the cross-repo test.
- A reviewer finding seen a second time that passes the test. A script could catch it → say so in the issue.
- The user corrects how the agent works, in a way that holds in any repo.
- A kit gap: hook misfire, check false positive or miss, rule that contradicts another.

## Cross-repo test

- Pass: the rule reads complete without the project's name, domain, customers, business rules, code or paths, and
  holds for every repo in that language (or every repo, for `general.md` and core).
- Fail → this repo only, no issue: a check in `ai/kit/pre-commit.sh` when a script can catch it, else a line in
  `ai/kit/review-checklist.md`.
- The repo is public: an issue that needs a real snippet or path to make sense fails the test.

## Filing

1. Search first, closed included:
   `gh issue list -R korn9537/ai-kit --label proposal --state all -L 200 --search "<keywords>"`.
   - Open match → comment `Seen again: <source kind>, <language>` plus anything the rule text lacks. No new issue.
   - Closed as not planned → file again only with a reason the closing comment did not weigh, linking it.
2. Body: fill the plugin's `.github/ISSUE_TEMPLATE/proposal.md` (sibling of this doc's `docs/`), below its
   frontmatter, every section.
3. Create, title `<target file>: <rule in a few words>`:
   `gh issue create -R korn9537/ai-kit --label proposal --title "<title>" --body-file <file>`.
4. Pre-approved outward action: no owner question. Report under Decided with the issue link.
5. Needed in this repo before a release → also a line in `ai/kit/review-checklist.md` ending
   `→ korn9537/ai-kit#<n>`; drop the line once that issue is closed as completed and the kit version that holds
   it is installed.

## Fallback

- `gh` missing, unauthenticated or offline → append the filled body to `ai/kit/kit-proposals.md` (one `---` between
  entries) and add that path to the file `git rev-parse --git-path info/exclude` prints; never commit it. The next session start asks for filing;
  filed entries are removed, the file deleted when empty.
