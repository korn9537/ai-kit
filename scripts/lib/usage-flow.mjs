// The process map behind `usage.mjs flow`: rows of the server's v_flow_nodes and v_flow_edges (one per kit version and
// project) merged into one graph, a fixed-size text summary, and a self-contained HTML page drawn with Mermaid.

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

export function flowGraph(nodes, edges) {
  const N = new Map();
  const E = new Map();
  for (const r of nodes) {
    const n = N.get(r.step) ?? { step: r.step, visits: 0, sessions: 0, items: 0, units: 0, usd: 0, unpriced: false, secs: 0 };
    n.visits += num(r.visits) ?? 0;
    n.sessions += num(r.sessions) ?? 0;
    n.items += num(r.items) ?? 0;
    n.units += num(r.units) ?? 0;
    // `unpriced` (migration 007): any unpriced visit, since sum(usd) skips them; a null usd means all were
    if (r.unpriced === true || num(r.usd) === null) n.unpriced = true;
    n.usd += num(r.usd) ?? 0;
    n.secs += (num(r.avg_s) ?? 0) * (num(r.visits) ?? 0);
    N.set(r.step, n);
  }
  for (const r of edges) {
    const key = `${r.from_step}\u0000${r.to_step}`;
    const e = E.get(key) ?? { from: r.from_step, to: r.to_step, n: 0, sessions: 0 };
    e.n += num(r.transitions) ?? 0;
    e.sessions += num(r.sessions) ?? 0;
    E.set(key, e);
  }
  // priced steps share by dollars (models differ in price per unit), else by units, as the digest ranks
  const priced = [...N.values()].every((n) => !n.unpriced);
  const of = (n) => (priced ? n.usd : n.units);
  const units = [...N.values()].reduce((s, n) => s + n.units, 0);
  const total = [...N.values()].reduce((s, n) => s + of(n), 0);
  const out = new Map();
  for (const e of E.values()) out.set(e.from, (out.get(e.from) ?? 0) + e.n);
  for (const e of E.values()) e.share = out.get(e.from) ? e.n / out.get(e.from) : 0;
  return {
    units, measure: priced ? "cost" : "units",
    nodes: [...N.values()].map((n) => ({ ...n, share: total ? of(n) / total : 0, avg_s: n.visits ? Math.round(n.secs / n.visits) : 0 }))
      .sort((a, b) => b.share - a.share),
    edges: [...E.values()].sort((a, b) => b.n - a.n),
  };
}

// a→b and b→a both taken: the work went back and forth (edit and test, a commit and the review that sends it back)
export function backAndForth(g) {
  const by = new Map(g.edges.map((e) => [`${e.from}\u0000${e.to}`, e]));
  const seen = new Set();
  const out = [];
  for (const e of g.edges) {
    const back = by.get(`${e.to}\u0000${e.from}`);
    const key = [e.from, e.to].sort().join("\u0000");
    if (!back || e.from === e.to || seen.has(key)) continue;
    seen.add(key);
    out.push({ a: e.from, b: e.to, n: Math.min(e.n, back.n) });
  }
  return out.sort((x, y) => y.n - x.n);
}

const pct = (x) => `${Math.round(100 * x)}%`;
const pad = (s, n) => String(s).padEnd(n);

export function formatFlow(g, { kit = "", steps = 15, edges = 20, loops = 8 } = {}) {
  const lines = [`flow${kit ? ` · kit ${kit}` : ""} · ${g.nodes.length} steps · ${g.edges.reduce((s, e) => s + e.n, 0)} transitions`];
  lines.push("", `steps by ${g.measure} (share of all ${g.measure} · visits · items · avg seconds):`);
  for (const n of g.nodes.slice(0, steps)) lines.push(`  ${pad(n.step, 30)} ${pad(pct(n.share), 5)} ${pad(n.visits, 6)} ${pad(n.items, 6)} ${n.avg_s}s`);
  lines.push("", "commonest transitions (count · share of the step's exits):");
  for (const e of g.edges.slice(0, edges)) lines.push(`  ${pad(`${e.from} → ${e.to}`, 44)} ${pad(e.n, 6)} ${pct(e.share)}`);
  const bf = backAndForth(g).slice(0, loops);
  if (bf.length) {
    lines.push("", "back and forth (times both ways):");
    for (const l of bf) lines.push(`  ${pad(`${l.a} ⇄ ${l.b}`, 44)} ${l.n}`);
  }
  lines.push("", "note: a step is the main session's; a subagent step's cost holds its own calls, not its nested agents'");
  return lines.join("\n");
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The Mermaid source: the `maxEdges` commonest transitions and the steps they touch; a thicker line is a commoner one.
export function flowMermaid(g, { maxEdges = 60 } = {}) {
  const kept = g.edges.slice(0, maxEdges);
  const used = new Set(kept.flatMap((e) => [e.from, e.to]));
  const id = new Map([...used].map((s, i) => [s, `n${i}`]));
  const node = new Map(g.nodes.map((n) => [n.step, n]));
  const top = kept[0]?.n || 1;
  const lines = ["flowchart TD"];
  for (const s of used) {
    const n = node.get(s);
    const label = n ? `${s}<br/>${n.visits} visits · ${pct(n.share)} ${g.measure}` : s;
    const q = (t) => String(t).replace(/"/g, "'");
    lines.push(`  ${id.get(s)}${s === "start" || s === "end" ? `(["${q(s)}"])` : `["${q(label)}"]`}`);
  }
  kept.forEach((e) => lines.push(`  ${id.get(e.from)} -->|${e.n}| ${id.get(e.to)}`));
  kept.forEach((e, i) => lines.push(`  linkStyle ${i} stroke-width:${(1 + 5 * (e.n / top)).toFixed(1)}px`));
  const hot = g.nodes.filter((n) => used.has(n.step) && n.share >= 0.1).map((n) => id.get(n.step));
  if (hot.length) lines.push("  classDef hot fill:#fde2d6,stroke:#c2410c", `  class ${hot.join(",")} hot`);
  return lines.join("\n");
}

export function flowHtml(g, { kit = "", maxEdges = 60 } = {}) {
  const rows = g.nodes.map((n) => `<tr><td>${esc(n.step)}</td><td>${pct(n.share)}</td><td>${n.visits}</td><td>${n.items}</td><td>${n.avg_s}s</td></tr>`).join("");
  const bf = backAndForth(g).slice(0, 12).map((l) => `<tr><td>${esc(l.a)} ⇄ ${esc(l.b)}</td><td>${l.n}</td></tr>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Session Process Map</title>
<style>
:root{--bg:#fbfaf7;--fg:#1f2328;--muted:#6b6f76;--line:#e4e1da;--card:#fff}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#16181b;--fg:#e6e6e6;--muted:#9aa0a6;--line:#2c3036;--card:#1d2024}}
:root[data-theme="dark"]{--bg:#16181b;--fg:#e6e6e6;--muted:#9aa0a6;--line:#2c3036;--card:#1d2024}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}p.sub{color:var(--muted);margin:0 0 20px}
.map{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;overflow:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-top:20px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}
th{color:var(--muted);font-weight:600}
</style></head><body><main>
<h1>Session process map</h1>
<p class="sub">${kit ? `Kit ${esc(kit)} · ` : ""}${g.nodes.length} steps · the ${Math.min(maxEdges, g.edges.length)} commonest of ${g.edges.length} transitions; a thicker line is a commoner one, an orange step holds 10% of ${g.measure} or more.</p>
<div class="map"><pre class="mermaid">${esc(flowMermaid(g, { maxEdges }))}</pre></div>
<div class="grid">
<table><thead><tr><th>Step</th><th>${g.measure === "cost" ? "Cost" : "Units"}</th><th>Visits</th><th>Items</th><th>Avg</th></tr></thead><tbody>${rows}</tbody></table>
<table><thead><tr><th>Back and forth</th><th>Times</th></tr></thead><tbody>${bf || "<tr><td>None</td><td></td></tr>"}</tbody></table>
</div></main>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:true,securityLevel:"strict",theme:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"default",flowchart:{htmlLabels:true}});</script>
</body></html>
`;
}
