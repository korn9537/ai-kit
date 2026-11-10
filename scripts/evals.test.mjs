// Offline check of evals/: grader frontmatter, regex mode names, and every regex on a valid and a broken sample.
// Usage: node scripts/evals.test.mjs; exit 1 on a failure. Never calls the model.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "evals");
let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} - ${msg}`);
  if (!ok) failed++;
};

const front = (file) => {
  const m = readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---/);
  const o = {};
  for (const l of (m ? m[1] : "").split("\n")) {
    const k = l.match(/^(\w+): ?(.*)$/);
    if (k) o[k[1]] = k[2].replace(/^'(.*)'$/, "$1");
  }
  return o;
};

const block = (v, kind) =>
  `Verdict: ${v}\nKind: ${kind}\nQuestion: q\nChoice: c\nReason: r\nConfidence: high\nUndo: u\nSources: a.ts:1`;
const BA = ["The ask", "Today", "Rules that apply", "Conflicts and gaps", "Standard", "Recommendation", "Done when", "Owner decisions"];
const samples = {
  "decider-decided": { good: block("DECIDED", "-"), bad: block("OWNER", "money") + "\n---\n" + block("OWNER", "money") },
  "decider-owner-money": { good: block("OWNER", "money"), bad: block("DECIDED", "-") },
  "decider-format": { good: block("DECIDED", "-"), bad: block("DECIDED", "-") + "\nextra text after" },
  "reviewer-finds-bug": { good: "1. CONFIRMED off by one", bad: "looks fine" },
  "ba-summary": { good: BA.map((h, i) => `${i + 1}. **${h}** - x`).join("\n"), bad: "no headings here" },
};
// A per-field grader fails only on its own missing line; the whole-block graders must reject the broken sample.
const wholeBlock = new Set(["order.md", "one-block.md", "verdict.md", "kind.md"]);

for (const c of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "results")) {
  const dir = join(root, c.name);
  const p = front(join(dir, "prompt.md"));
  check(p.name === c.name, `${c.name}: prompt name matches the folder`);
  check(/Agent/.test(p.allowed_tools || ""), `${c.name}: Agent is allowed`);
  const s = samples[c.name];
  check(!!s, `${c.name}: has a fixture sample`);
  for (const g of readdirSync(join(dir, "graders"))) {
    const f = front(join(dir, "graders", g));
    const id = `${c.name}/${g}`;
    if (f.type === "regex") {
      check(/^(contains|not_contains|count:\d+)$/.test(f.match), `${id}: match mode ${f.match} is known`);
      check(f.target === "last_message", `${id}: target is last_message`);
      let re;
      try {
        re = new RegExp(f.pattern, f.flags);
      } catch (e) {
        check(false, `${id}: regex compiles (${e.message})`);
        continue;
      }
      const hit = (t) => re.test(t);
      const passes = (t) => (f.match === "not_contains" ? !hit(t) : hit(t));
      check(passes(s.good), `${id}: passes the valid sample`);
      if (c.name === "decider-format" ? g === "order.md" : wholeBlock.has(g) || c.name === "ba-summary" || c.name === "reviewer-finds-bug")
        check(!passes(s.bad), `${id}: fails the broken sample`);
    } else if (f.type === "tool_used") {
      check(f.tool === "Agent", `${id}: tool is Agent`);
      const re = new RegExp(f.input_match);
      const name = f.input_match.match(/\)\?([\w-]+)"/)[1];
      check(re.test(`{"subagent_type":"ai-kit:${name}"}`) && re.test(`{"subagent_type":"${name}"}`), `${id}: matches with and without prefix`);
      check(!re.test('{"subagent_type":"other"}'), `${id}: rejects another agent`);
    } else check(f.type === "llm" && !!f.criteria, `${id}: llm grader has criteria`);
  }
}
process.exit(failed ? 1 : 0);
