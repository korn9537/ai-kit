#!/usr/bin/env bash
# Tests for the pre-commit runner (ai/usage staging, the 40 KB check, prettier in a path-limited commit): a
# throwaway repo, real commits through a temp hooks dir.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
PLUGIN="$PWD/.."
TMP="$(mktemp -d)" || exit 1
trap 'rm -rf "$TMP"' EXIT
REPO="$TMP/repo"
mkdir -p "$TMP/hooks" "$REPO"
printf '#!/bin/sh\nexec "%s/githooks/pre-commit" "$@"\n' "$PLUGIN" >"$TMP/hooks/pre-commit"
chmod +x "$TMP/hooks/pre-commit"

git -C "$REPO" init -q
git -C "$REPO" config user.name tester
git -C "$REPO" config user.email t@t
git -C "$REPO" config core.hooksPath "$TMP/hooks"
echo base >"$REPO/base.txt"
git -C "$REPO" add -A
git -C "$REPO" commit -qm base

pass=0
fail=0
# check <desc> <actual> <expected>
check() {
  if [[ "$2" == "$3" ]]; then
    echo "ok   - $1"
    pass=$((pass + 1))
  else
    echo "FAIL - $1"
    printf '       want: %s\n       got:  %s\n' "$3" "$2"
    fail=$((fail + 1))
  fi
}
files() { git -C "$REPO" show --name-only --format= HEAD | tr '\n' ' '; }

echo a >"$REPO/a.txt"
git -C "$REPO" add a.txt
git -C "$REPO" commit -qm "no usage dir" 2>&1
check "no ai/usage dir → commit unaffected" "$(files)" "a.txt "

mkdir -p "$REPO/ai/usage/2030-01"
echo '{"n":1}' >"$REPO/ai/usage/2030-01/s 1.jsonl"
echo b >"$REPO/b.txt"
git -C "$REPO" add b.txt
git -C "$REPO" commit -qm "with usage" 2>&1
check "commit of b.txt also carries the new ai/usage file" "$(files)" "ai/usage/2030-01/s 1.jsonl b.txt "

echo c >"$REPO/c.txt"
git -C "$REPO" add c.txt
git -C "$REPO" commit -qm "unchanged usage" 2>&1
check "an unchanged ai/usage file is not re-added" "$(files)" "c.txt "

echo '{"n":2}' >>"$REPO/ai/usage/2030-01/s 1.jsonl"
echo d >"$REPO/d.txt"
git -C "$REPO" add d.txt
git -C "$REPO" commit -qm "grown usage" 2>&1
check "an appended ai/usage file rides along" "$(files)" "ai/usage/2030-01/s 1.jsonl d.txt "

# a path-limited commit runs the hook with a temporary index: staging there would corrupt the real index (MM, D)
echo '{"n":3}' >>"$REPO/ai/usage/2030-01/s 1.jsonl"
echo '{"n":4}' >"$REPO/ai/usage/2030-01/s 2.jsonl"
echo more >>"$REPO/a.txt"
git -C "$REPO" commit -qm "path-limited" -- a.txt 2>&1
check "path-limited commit carries only its path" "$(files)" "a.txt "
check "path-limited commit leaves ai/usage out of the index (no MM, no D)" \
  "$(git -C "$REPO" status --porcelain -- ai/usage | cut -c1-2 | sort | tr '\n' ' ')" " M ?? "
echo e >"$REPO/e.txt"
git -C "$REPO" add e.txt
git -C "$REPO" commit -qm "later" 2>&1
check "the records wait for a later commit, which carries them" "$(files)" "ai/usage/2030-01/s 1.jsonl ai/usage/2030-01/s 2.jsonl e.txt "

# the "moved verbatim" lint-reason check reads code, not records
printf '%s\n' '{"prompt":"// eslint-disable-next-line x -- moved verbatim"}' >"$REPO/ai/usage/2030-01/s 3.jsonl"
echo f >"$REPO/f.txt"
git -C "$REPO" add f.txt
git -C "$REPO" commit -qm "record that quotes the phrase" 2>&1
check "a record quoting 'moved verbatim' does not block the commit" "$(files)" "ai/usage/2030-01/s 3.jsonl f.txt "

# a code file over 40 KB at HEAD: an edit waits for its move-only split
for i in $(seq 1 1200); do echo "export const value$i = computeSomething($i, 'argument value');"; done >"$REPO/big.ts"
git -C "$REPO" add big.ts && git -C "$REPO" commit -qm big 2>&1
blocked() { git -C "$REPO" commit -qm "$1" >/dev/null 2>&1 && echo committed || echo blocked; }
sed -i.bak 's/value7 =/value7b =/' "$REPO/big.ts" && rm "$REPO/big.ts.bak"
git -C "$REPO" add big.ts
check "an edit to a file over 40 KB at HEAD is blocked" "$(blocked edit)" blocked
check "ALLOW_LARGE_EDIT=1 lets it through" \
  "$(ALLOW_LARGE_EDIT=1 git -C "$REPO" commit -qm edit >/dev/null 2>&1 && echo committed || echo blocked)" committed
{ echo "import { value1 } from './part';"; sed '1,600d' "$REPO/big.ts"; } >"$REPO/big.new"
sed -n '1,600p' "$REPO/big.ts" >"$REPO/part.ts"
mv "$REPO/big.new" "$REPO/big.ts"
git -C "$REPO" add big.ts part.ts
check "a move-only split with its import passes" "$(blocked split)" committed
check "the file now under 40 KB takes edits" \
  "$(echo 'export const x = 1;' >>"$REPO/big.ts" && git -C "$REPO" add big.ts && blocked after-split)" committed
# a spaced name, a multi-line import, and a `}` removed once that pays for one `}` only
for i in $(seq 1 1200); do printf 'export function f%s() {\n  return %s;\n}\n' "$i" "$i"; done >"$REPO/big two.ts"
echo '}' >"$REPO/brace.ts"
git -C "$REPO" add "big two.ts" brace.ts && git -C "$REPO" commit -qm big2 2>&1
echo '}' >>"$REPO/big two.ts"
echo '}' >>"$REPO/big two.ts"
git -C "$REPO" rm -q brace.ts
git -C "$REPO" add "big two.ts"
check "a spaced name is checked, and one removed line pays for one added line" "$(blocked brace)" blocked
git -C "$REPO" reset -q && git -C "$REPO" checkout -q -- "big two.ts" brace.ts
{ printf 'import {\n  f1,\n  f2,\n} from "./part two";\n'; sed '1,1500d' "$REPO/big two.ts"; } >"$REPO/big2.new"
sed -n '1,1500p' "$REPO/big two.ts" >"$REPO/part two.ts"
mv "$REPO/big2.new" "$REPO/big two.ts"
git -C "$REPO" add "big two.ts" "part two.ts"
check "a move-only split with a multi-line import passes" "$(blocked split2)" committed

# --size alone: a merge is exempt; a C# using statement and code after an import closed in context are not wiring
size() { (cd "$REPO" && node "$PLUGIN/scripts/check-comments.mjs" --size >/dev/null 2>&1 && echo pass || echo blocked); }
for i in $(seq 1 1200); do echo "export const value$i = computeSomething($i, 'argument value');"; done >"$REPO/big3.ts"
printf 'import {\n  a,\n} from "./x";\n' | cat - "$REPO/big3.ts" >"$REPO/big3.new" && mv "$REPO/big3.new" "$REPO/big3.ts"
git -C "$REPO" add big3.ts && git -C "$REPO" commit -qm big3 2>&1
sed -i.bak '1s/import {/import type {/' "$REPO/big3.ts" && rm "$REPO/big3.ts.bak"
echo 'export const leak = 1;' >>"$REPO/big3.ts"
git -C "$REPO" add big3.ts
check "code after an import line whose close is context is checked" "$(size)" blocked
git -C "$REPO" rev-parse HEAD >"$REPO/.git/MERGE_HEAD"
check "a merge is exempt" "$(size)" pass
rm -f "$REPO/.git/MERGE_HEAD"
git -C "$REPO" checkout -q -- big3.ts
echo 'using (var tx = Begin()) {' >>"$REPO/big3.ts"
git -C "$REPO" add big3.ts
check "a C# using statement is code, not wiring" "$(size)" blocked
git -C "$REPO" reset -q && git -C "$REPO" checkout -q -- big3.ts

# check-comments --size alone: the `partial` a C# split adds to its class line is paid by that line, and nothing else is
{
  echo 'public class Orders(Db db)'
  echo '{'
  for i in $(seq 1 1200); do echo "    public int Value$i() => Compute($i, \"argument value\");"; done
  echo '    public string Kind() => "class";'
  echo '}'
} >"$REPO/Orders.cs"
git -C "$REPO" add Orders.cs && git -C "$REPO" commit -qm orders 2>&1
sed -i.bak '1s/public class/public partial class/' "$REPO/Orders.cs" && rm "$REPO/Orders.cs.bak"
git -C "$REPO" add Orders.cs
check "a C# class line that only gains partial passes" "$(size)" pass
sed -i.bak '1s/(Db db)/(Db db, Clock clock)/' "$REPO/Orders.cs" && rm "$REPO/Orders.cs.bak"
git -C "$REPO" add Orders.cs
check "a C# class line that gains partial and a parameter is blocked" "$(size)" blocked
git -C "$REPO" reset -q && git -C "$REPO" checkout -q -- Orders.cs
sed -i.bak -e '1s/public class/public partial class/' -e '$a\
public partial class Orders(Db db)' "$REPO/Orders.cs" && rm "$REPO/Orders.cs.bak"
git -C "$REPO" add Orders.cs
check "one removed class line pays for one partial line" "$(size)" blocked
git -C "$REPO" reset -q && git -C "$REPO" checkout -q -- Orders.cs
sed -i.bak -e '3d' -e '$a\
    public int Value1() => Compute(1, "argument value");' "$REPO/Orders.cs" && rm "$REPO/Orders.cs.bak"
git -C "$REPO" add Orders.cs
check "a line moved inside the same file is not paid by its own removal" "$(size)" blocked
git -C "$REPO" reset -q && git -C "$REPO" checkout -q -- Orders.cs
sed -i.bak 's/=> "class"/=> "partial class"/' "$REPO/Orders.cs" && rm "$REPO/Orders.cs.bak"
git -C "$REPO" add Orders.cs
check "partial inside a C# string is an edit" "$(size)" blocked
git -C "$REPO" reset -q && git -C "$REPO" checkout -q -- Orders.cs
cp "$REPO/Orders.cs" "$REPO/Orders.ts"
git -C "$REPO" add Orders.ts && git -C "$REPO" commit -qm orders-ts 2>&1
sed -i.bak '1s/public class/public partial class/' "$REPO/Orders.ts" && rm "$REPO/Orders.ts.bak"
git -C "$REPO" add Orders.ts
check "partial pays only in a C# file" "$(size)" blocked
git -C "$REPO" reset -q && git -C "$REPO" checkout -q -- Orders.ts

# prettier in a path-limited commit: the real index gets the formatted copy too, so the file ends clean
mkdir -p "$REPO/node_modules/prettier/bin"
cat >"$REPO/node_modules/prettier/bin/prettier.cjs" <<'EOF2'
const fs = require("fs");
for (const f of process.argv.slice(2).filter((a) => a.endsWith(".ts")))
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").toUpperCase());
EOF2
echo '{"devDependencies": {"prettier": "3"}}' >"$REPO/package.json"
git -C "$REPO" add package.json && git -C "$REPO" commit -qm prettier 2>&1
echo lower >"$REPO/fmt.ts"
git -C "$REPO" add fmt.ts
git -C "$REPO" commit -qm fmt -- fmt.ts 2>&1
check "path-limited commit holds the formatted file" "$(git -C "$REPO" show HEAD:fmt.ts)" LOWER
check "path-limited commit leaves the formatted file clean in the index" \
  "$(git -C "$REPO" status --porcelain -- fmt.ts)" ""
# a generated copy keeps the text its hash covers
mkdir -p "$REPO/ai/kit/conventions"
echo lower >"$REPO/ai/kit/conventions/copy.ts"
git -C "$REPO" add ai/kit/conventions/copy.ts
git -C "$REPO" commit -qm copy 2>&1
check "prettier leaves ai/kit/conventions/ alone" "$(git -C "$REPO" show HEAD:ai/kit/conventions/copy.ts)" lower

# a renamed big file with new code is blocked by the hook, though no file is staged as M
git -C "$REPO" mv big3.ts big4.ts
echo 'export const added = 1;' >>"$REPO/big4.ts"
git -C "$REPO" add big4.ts
before="$(git -C "$REPO" rev-parse HEAD)"
git -C "$REPO" commit -qm rename-edit >/dev/null 2>&1
check "git mv plus new code is blocked through git commit" \
  "$([ "$(git -C "$REPO" rev-parse HEAD)" = "$before" ] && echo blocked || echo committed)" blocked
git -C "$REPO" reset -q --hard HEAD

# a rename with 65% of the lines rewritten plus a new line is blocked, also under diff.renames=false
git -C "$REPO" mv big3.ts big5.ts
node -e 'const fs=require("fs");const f=process.argv[1];const l=fs.readFileSync(f,"utf8").split("\n");const n=Math.floor(l.length*0.65);for(let i=0;i<n;i++)l[i]="const changed"+i+" = other("+i+", \"different different\");";fs.writeFileSync(f,l.join("\n")+"const added = 1;\n")' "$REPO/big5.ts"
git -C "$REPO" add big5.ts
for cfg in true false; do
  before="$(git -C "$REPO" rev-parse HEAD)"
  git -C "$REPO" -c diff.renames=$cfg commit -qm rewrite-rename >/dev/null 2>&1
  check "a 65% rewritten rename plus new code is blocked through git commit (diff.renames=$cfg)" \
    "$([ "$(git -C "$REPO" rev-parse HEAD)" = "$before" ] && echo blocked || echo committed)" blocked
done
git -C "$REPO" reset -q --hard HEAD

echo "$pass passed, $fail failed"
((fail == 0))
