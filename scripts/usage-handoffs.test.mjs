// Tests for `usage.mjs handoffs` and scripts/lib/handoff-audit.mjs: roles, the report from a handback call or text,
// re-reads by the parent of paths a report named, and the before-first-edit counts. Usage: node scripts/usage-handoffs.test.mjs
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditAgent, formatHandoffs, kindOf, roleOf, scanHandoffs } from "./lib/handoff-audit.mjs";
import { eq, ok } from "./lib/test-util.mjs";

const tmp = mkdtempSync(join(tmpdir(), "usage-handoffs-"));
const prompt = (text) => ({ type: "user", message: { content: text } });
const use = (name, input) => ({ type: "assistant", message: { content: [{ type: "tool_use", id: `t${Math.random()}`, name, input }] } });
const say = (text) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
const back = (message) => ({ type: "assistant", message: { content: [{ type: "tool_use", name: "SubagentHandback", input: { message } }] } });
const note = (id) => ({ type: "user", message: { content: `<task-notification><task-id>${id}</task-id><status>completed</status></task-notification>` } });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

try {
  eq("role of a committer by type", roleOf({ agentType: "ai-kit:committer" }), "commit");
  eq("role of a commit brief by description", roleOf({ agentType: "general-purpose", description: "commit: b1" }), "commit");
  eq("role of the BA", roleOf({ agentType: "ai-kit:business-analyst" }), "ba");
  for (const [cmd, want] of [
    ["grep -rn x src 2>/dev/null", "search"], ["sed -n 1,20p src/a.ts 2>&1", "read"], ["echo x > src/a.ts", "edit"],
    ["echo x >> src/a.ts", "edit"], ["cat <<EOF >> notes.md", "edit"], ['grep -n "=> {" src', "search"],
    ['awk "$1 > 5" f.txt', "read"], ['git log --format="%h -> %s"', "read"], ["sed -i '' s/a/b/ f.ts", "edit"],
  ]) eq(`kind of ${cmd}`, kindOf("Bash", { command: cmd }), want);

  const parent = [note("aaa"), use("Bash", { command: "sed -n 60,80p src/web/hook.ts" }), use("Read", { file_path: "/r/src/other.ts" })];
  const ba = auditAgent(
    [prompt("Analyse the change"), use("Grep", { pattern: "x" }), back("Today: src/web/hook.ts:69-77 joins only project_id")],
    { agentType: "ai-kit:business-analyst" }, parent, "aaa");
  ok("the report is the handback message", ba.reportChars > 30 && ba.reportPaths === 1, ba);
  eq("the parent's read of a reported path is a re-read", ba.reReads.length, 1);

  ok("examples name the tool and the reported path, not the command", ba.reReads[0] === "Bash: web/hook.ts", ba.reReads);

  const win = auditAgent([prompt("x"), back("Today: C:\\r\\src\\web\\hook.ts:3 and /Users/x/r/src/lib/a.ts:9")],
    { agentType: "ai-kit:explorer" },
    [note("www"), use("Read", { file_path: "C:\\r\\src\\web\\hook.ts" }), use("Bash", { command: "sed -n 1,5p src/lib/a.ts" })], "www");
  eq("Windows and absolute report paths match the parent's reads", win.reReads.length, 2);

  const quoted = auditAgent([prompt("x"), back("see src/web/hook.ts:1")], { agentType: "ai-kit:explorer" },
    [{ type: "user", message: { content: "<task-notification><task-id>zzz</task-id><status>completed</status><result>agent qqq</result>" } },
      use("Read", { file_path: "/r/src/web/hook.ts" })], "qqq");
  ok("another agent's notification quoting this id is not this agent's", !quoted.parentSeen, quoted);
  const tagged = auditAgent([prompt("x"), back("see src/web/hook.ts:1")], { agentType: "ai-kit:explorer" },
    [{ type: "user", message: { content: "<task-notification><task-id>zzz</task-id><status>completed</status><result>quotes <task-id>qqq</task-id></result>" } }], "qqq");
  ok("a notification quoting this agent's full tag is not its completion", !tagged.parentSeen, tagged);

  const resumed = auditAgent([prompt("x"), back("first: src/one/a.ts:1"), prompt("re-check"), back("second: src/two/b.ts:1")],
    { agentType: "ai-kit:change-reviewer" },
    [note("rrr"), use("Read", { file_path: "/r/src/one/a.ts" }), note("rrr"), use("Read", { file_path: "/r/src/two/b.ts" })], "rrr");
  ok("a resumed agent's last report goes with its last completion", resumed.reReads.join() === "Read: two/b.ts", resumed.reReads);

  const c = auditAgent([prompt("Change src/a.ts:10-20"), use("Grep", { pattern: "f" }), use("Read", { file_path: "/r/src/a.ts" }),
    use("Edit", { file_path: "/r/src/a.ts" }), say("Committed abc123")], { agentType: "ai-kit:committer" }, null, "bbb");
  ok("committer: ranged brief, one search and one read before the first edit",
    c.ranged && c.searchesBeforeEdit === 1 && c.readsBeforeEdit === 1 && c.edits && !c.parentSeen, c);

  const dir = join(tmp, "proj");
  mkdirSync(join(dir, "S1", "subagents"), { recursive: true });
  writeFileSync(join(dir, "S1.jsonl"), jsonl(parent));
  writeFileSync(join(dir, "S1", "subagents", "agent-aaa.jsonl"), jsonl([prompt("x"), back("see src/web/hook.ts:69")]));
  writeFileSync(join(dir, "S1", "subagents", "agent-aaa.meta.json"), JSON.stringify({ agentType: "ai-kit:business-analyst", description: "BA: x" }));
  const res = scanHandoffs(dir);
  eq("scan finds the one subagent", res.agents.length, 1);
  const text = formatHandoffs(res);
  ok("format: a ba line with the re-read rate and an example", /^ba: 1 .*in 100% of 1/m.test(text) && /- ba "BA: x": 1 re-reads/.test(text), text);
  ok("format prints no brief or report text", !text.includes("joins only"), text);
  eq("since after the files skips them", scanHandoffs(dir, { since: "2999-01-01" }).agents.length, 0);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
