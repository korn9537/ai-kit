// kit unattended: makes a project's hooks run without the plugin; see scripts/kit.mjs
import { existsSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { STAGED, at, codeLines, dropEcho, eolOf, jsonText, kit, read, readConf, readLF, root, toolsIn } from "./shared.mjs";
import { snapshotWarnings, syncSnapshot } from "./sync.mjs";

// `git diff --cached` -> `git diff $AI_KIT_RANGE`, except where the range cannot work, left so check.sh still refuses:
// single quotes, diff-index, diff-tree, a revision (a usage error, which a pipe reads as no change)
const onlyOptions = (s) => {
  for (const w of s.trim().split(/\s+/).filter(Boolean)) {
    if (w === "--" || /^\d*[<>]/.test(w)) return true;
    if (!w.startsWith("-")) return false;
  }
  return true;
};

// a command that goes on after a `\`, up to its first pipe or end
const continued = (lines, i) => {
  const out = [];
  for (let n = i; /\\\r?$/.test(lines[n] ?? "") && n + 1 < lines.length; n++) out.push(lines[n + 1].replace(/\\\r?$/, ""));
  return out.join(" ").split(/[|;&)]/)[0];
};

const rewriteRange = (text) => {
  const done = [];
  const all_ = text.split("\n");
  const out = all_.map((line, i) => {
    if (/^\s*#/.test(line)) return line;
    const next = line.replace(/\bdiff(?![\w-])([^|;&)]*?)--(?:cached|staged)\b(?=([^|;&)"`]*))/g, (m, head, tail, at, all) =>
      (all.slice(0, at).match(/'/g) ?? []).length % 2 || !onlyOptions(head) || !onlyOptions(`${tail.replace(/\\\r?$/, "")} ${continued(all_, i)}`)
        ? m
        : `diff${head}$AI_KIT_RANGE`,
    );
    if (next !== line) done.push(i + 1);
    return next;
  });
  return { text: out.join("\n"), done };
};

const SCRIPT = String.raw`\.(?:mjs|cjs|js|ts|sh|py)`;

// paths a shell text runs: [found in the text, a path with a variable, which no reader can follow]
const scriptsIn = (sh) => ({
  paths: [...sh.matchAll(new RegExp(String.raw`(?:^|[\s"'(=])((?:\.{0,2}/)?[\w.@-]+(?:/[\w.@-]+)*${SCRIPT})(?=$|[\s"');|&])`, "gm"))].map((m) => m[1].replace(/^\.\//, "")),
  vars: [
    ...[...sh.matchAll(new RegExp(String.raw`\$[\w{}()"'/.-]*/[\w./-]+${SCRIPT}(?!\w)`, "g"))].map((m) => m[0]),
    ...[...sh.matchAll(new RegExp(String.raw`\b(?:in|node|sh|bash|tsx)\s+["']?([\w./-]*\*[\w./*-]*${SCRIPT})(?!\w)`, "g"))].map((m) => m[1]),
  ],
});

const PM_BUILTIN = new Set(["exec", "dlx", "install", "i", "add", "x"]);

// a root script is followed; a workspace call, turbo and make run what no path here names, so they are named instead
const packageCalls = (sh) => {
  const scripts = JSON.parse(read(at("package.json")) ?? "{}").scripts ?? {};
  const texts = [];
  const unknown = [];
  for (const m of sh.matchAll(/\b(?:pnpm(?: run)?|npm run|yarn|bun run)((?:\s+--?[\w-]+(?:[= ](?!-)\S+)?)*)\s+([\w:.-]+)/g)) {
    if (PM_BUILTIN.has(m[2])) continue;
    if (!m[1].trim() && scripts[m[2]]) texts.push(scripts[m[2]]);
    else unknown.push(m[0].trim());
  }
  for (const m of sh.matchAll(/(?:^|[;&|({]\s*|\bquiet\s+)((?:turbo|make)\b[^|;&)'"\n]*)/gm)) unknown.push(m[1].trim());
  return { texts, unknown };
};

const resolveFrom = (from, rel) => {
  const base = relative(root, resolve(root, dirname(from), rel));
  return ["", ".mjs", ".js", ".ts", ".cjs", "/index.js", "/index.ts"].map((e) => base + e).find((p) => existsSync(at(p)) && statSync(at(p)).isFile());
};

// scripts ai/kit/pre-commit.sh runs, and what they run and import, that read the index: under check.sh they find
// nothing and pass. `unknown` is what could not be followed; a script a script starts by itself is still not seen.
const indexReaders = (code) => {
  const seen = new Set();
  const unknown = new Set();
  const todo = [];
  const walked = new Set();
  const ran = new Set();
  const shell = (sh) => {
    if (walked.has(sh)) return;
    walked.add(sh);
    const text = dropEcho(sh);
    const { paths, vars } = scriptsIn(text);
    todo.push(...paths);
    for (const [, f] of text.matchAll(new RegExp(String.raw`\b(?:node|sh|bash|tsx|ts-node|python3?)\s+(?:-\S+\s+)*["']?(?:\./)?([\w./@-]+${SCRIPT})(?!\w)`, "g"))) ran.add(f);
    vars.forEach((v) => unknown.add(v));
    const calls = packageCalls(text);
    calls.unknown.forEach((u) => unknown.add(u));
    calls.texts.forEach(shell);
  };
  shell(code);
  const out = [];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f) || f === "ai/kit/check.sh" || f.startsWith("ai/kit/checks/") || f.includes("node_modules/")) continue;
    seen.add(f);
    const t = readLF(at(f));
    if (t === null) {
      // a path in a pattern or fixture is no script; one a command runs is
      if (ran.has(f)) unknown.add(f);
      continue;
    }
    const body = t.split("\n").filter((l) => !/^\s*(#|\/\/)/.test(l)).join("\n");
    if (/--cached|--staged/.test(body) && !body.includes("AI_KIT_RANGE")) out.push(f);
    if (f.endsWith(".sh")) shell(body);
    for (const [, rel] of body.matchAll(/(?:from\s+|import\s*\(?\s*|require\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
      const hit = resolveFrom(f, rel) ?? resolveFrom(f, rel.replace(/\.js$/, ".ts"));
      if (hit) todo.push(hit);
      else unknown.add(`${rel} (from ${f})`);
    }
  }
  return { readers: out.sort(), unknown: [...unknown].sort() };
};

const withUnattended = (text, conf) => {
  const edited = /"unattended"\s*:/.test(text)
    ? text.replace(/("unattended"\s*:\s*)[^,}\s]+/, "$1true")
    : text.replace(/\{(\r?\n)?(\s*)/, (m, nl = "", sp) => `{${nl}${sp}"unattended": true,${nl || " "}${sp}`);
  try {
    if (JSON.parse(edited).unattended === true) return edited;
  } catch {}
  return jsonText({ ...conf, unattended: true }, eolOf(text));
};

// turns a repo on for runs without the plugin, or says what stops it; check.sh on the target branch gates every run
// of a worker at once, so a repo that cannot pass it is not turned on
function unattended(flags) {
  const dry = flags.includes("--dry-run");
  const force = flags.includes("--force");
  const c = readConf();
  if (!c.conf) {
    console.log("ai/kit/config.json is missing or malformed (fix: kit.mjs init)");
    process.exit(1);
  }
  const path = at("ai", "kit", "pre-commit.sh");
  const before = read(path);
  if (before === null) {
    console.log("ai/kit/pre-commit.sh is missing (fix: kit.mjs init)");
    process.exit(1);
  }
  const { text, done } = rewriteRange(before);
  if (done.length) {
    if (!dry) writeFileSync(path, text);
    console.log(`${dry ? "would rewrite" : "~ rewrote"} ai/kit/pre-commit.sh line(s) ${done.join(", ")} to $AI_KIT_RANGE`);
  }
  const lines = text.split("\n");
  const kept = lines.flatMap((l, i) => (!/^\s*#/.test(l) && new RegExp(STAGED).test(l) ? [i + 1] : []));
  const code = codeLines(text.replace(/\r\n/g, "\n")).join("\n");
  const { readers, unknown } = indexReaders(code);
  const empty = !code.trim();
  for (const n of kept) console.log(`! ai/kit/pre-commit.sh:${n} still reads the staged diff: ${lines[n - 1].trim().slice(0, 100)}`);
  for (const f of readers) console.log(`! ${f} reads the index: read AI_KIT_RANGE from the environment instead`);
  for (const f of unknown) console.log(`! ${f} could not be followed: if it reads the index it passes unchecked, so read it`);
  if (empty) console.log("! ai/kit/pre-commit.sh has no checks: a gate would only run the kit's own");
  if (dry && !existsSync(at("ai", "kit", "requires.txt")))
    console.log(`would write ai/kit/requires.txt: ${toolsIn(code).join(" ") || "no known command"}; a start, add what it does not know`);
  const blocked = kept.length > 0 || (!force && (readers.length > 0 || unknown.length > 0 || empty));
  if (dry) {
    console.log(blocked ? "not ready: fix the lines marked !" : "ready");
    process.exit(blocked ? 1 : 0);
  }
  if (blocked) {
    console.log(`not turned on: fix the lines marked !, then run this again${kept.length ? "" : " (--force when one is no real gate)"}`);
    process.exit(1);
  }
  if (c.conf.unattended !== true) {
    writeFileSync(at("ai", "kit", "config.json"), withUnattended(c.text, c.conf));
    console.log('~ ai/kit/config.json "unattended": true');
  }
  const conf = { ...c.conf, unattended: true };
  const left = syncSnapshot(root, kit, conf);
  const warned = snapshotWarnings(root, kit, conf);
  warned.forEach((w) => console.log(`! ai-kit: ${w}`));
  const open = left + warned.length;
  console.log(open ? `turned on with ${open} item(s) open, see above` : "turned on: commit ai/kit/, CLAUDE.md and what was rewritten");
  if (open) process.exitCode = 1;
}

export { unattended };
