// Tests for scripts/lib/usage-flow.mjs: rows of v_flow_nodes and v_flow_edges from two projects merged into one
// graph, the back-and-forth pairs, the text summary and the HTML page. Usage: node scripts/usage-flow.test.mjs
import { backAndForth, flowGraph, flowHtml, flowMermaid, formatFlow } from "./lib/usage-flow.mjs";
import { eq, ok } from "./lib/test-util.mjs";

const node = (project, step, visits, units, usd = "1") => ({ kit_version: "2.59.0", project, step, visits, sessions: 1, items: visits, agents: 0, units: String(units), usd, avg_s: 10, p50_s: 5 });
const edge = (project, from_step, to_step, transitions) => ({ kit_version: "2.59.0", project, from_step, to_step, transitions, sessions: 1, to_units: "0", to_usd: "0" });
const g = flowGraph(
  [node("a", "prompt", 2, 100), node("b", "prompt", 1, 100), node("a", "edit", 3, 600), node("a", "test-fail", 2, 200, null)],
  [edge("a", "start", "prompt", 2), edge("b", "start", "prompt", 1), edge("a", "prompt", "edit", 2), edge("a", "edit", "test-fail", 2),
    edge("a", "test-fail", "edit", 1), edge("a", "edit", "end", 1)],
);
eq("steps of two projects merge", g.nodes.find((n) => n.step === "prompt").visits, 3);
eq("the costliest step comes first", g.nodes[0].step, "edit");
eq("cost share of a step", g.nodes[0].share, 0.6);
ok("a step with an unpriced row says so", g.nodes.find((n) => n.step === "test-fail").unpriced);
eq("edges of two projects merge", g.edges[0].n, 3);
eq("share of a step's exits", g.edges.find((e) => e.from === "edit" && e.to === "test-fail").share, 2 / 3);
eq("back and forth counts the rarer direction", JSON.stringify(backAndForth(g)), JSON.stringify([{ a: "edit", b: "test-fail", n: 1 }]));
const text = formatFlow(g, { kit: "2.59." });
ok("summary names the kit, the steps and the loop", /kit 2\.59\./.test(text) && /edit\s+60%/.test(text) && /edit ⇄ test-fail\s+1/.test(text), text);
const mm = flowMermaid(g, { maxEdges: 2 });
ok("mermaid keeps the commonest edges only", (mm.match(/-->/g) || []).length === 2 && !mm.includes("test-fail"), mm);
ok("start is drawn as a terminal", /\(\["start"\]\)/.test(mm), mm);
const html = flowHtml(g);
ok("html carries a title, the pinned mermaid and the map source", html.includes("<title>Session Process Map</title>")
  && html.includes("mermaid@10.9.1") && html.includes("--&gt;|3|"), html.slice(0, 300));
ok("html escapes a step name", flowHtml(flowGraph([node("a", "<x>", 1, 1)], [edge("a", "start", "<x>", 1)])).includes("&lt;x&gt;"));
