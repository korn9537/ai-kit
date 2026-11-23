// The plan file format and its batch rules: render, parse, merge and order; plan.mjs (the CLI) re-exports them.
export const JOB = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/;
// what a repo's doc check allows
export const COLUMNS = 120;
const width = (s) => JSON.stringify(s).length - 2;
const wrapped = (v) => Array.isArray(v?.lines) && Object.keys(v).length === 1;

// cut at whitespace, inside a word only when it alone is too wide (Thai has no spaces); joined, it is the text again
function chunks(text, max) {
  const out = [""];
  for (const word of text.split(/(?<=\s)/)) {
    for (const piece of width(word) > max ? [...word] : [word]) {
      if (width(out.at(-1) + piece) > max) out.push("");
      out[out.length - 1] += piece;
    }
  }
  return out;
}

// a string that passes COLUMNS where JSON.stringify would put it, as { lines }: lead is its quoted key and ": ", 3 is
// its own quotes and comma, 4 the indent of the items
function fold(v, indent = 0, lead = 0) {
  if (typeof v === "string") {
    return indent + lead + width(v) + 3 > COLUMNS ? { lines: chunks(v, COLUMNS - indent - 4 - 3) } : v;
  }
  if (Array.isArray(v)) return v.map((x) => fold(x, indent + 2));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fold(x, indent + 2, width(k) + 4)]));
  }
  return v;
}

// every word a person wrote stays in the fence: check-docs reads ai/*.md strictly (Thai, dates, bold) outside one;
// a JSON string cannot wrap, so a long one is written as { lines } and parse joins it
export function render(plan) {
  const title = plan.job.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  const { job, request, base, batches } = plan;
  return [
    `# Plan ${title}`,
    "",
    "goal: the request in the block below, one commit per batch.",
    `job: \`${job}\``,
    "status: the commits of this job, by their Batch trailer (`plan.mjs status`); never edited here.",
    "",
    "```json",
    JSON.stringify(fold({ job, request, ...(base ? { base } : {}), batches }), null, 2),
    "```",
    "",
  ].join("\n");
}

// null for a plan written by hand: it has no job and no batches to run
export function parse(text) {
  const m = /^```json\r?\n([\s\S]*?)\r?\n```\r?$/m.exec(text);
  if (!m) return null;
  try {
    const plan = JSON.parse(m[1], (_, v) => (wrapped(v) ? v.lines.join("") : v));
    const fine = JOB.test(plan?.job ?? "") && Array.isArray(plan.batches) && plan.batches.every(
      (b) => typeof b?.id === "string" && (b.waitsFor === undefined || Array.isArray(b.waitsFor)),
    );
    return fine ? plan : null;
  } catch {
    return null;
  }
}

// plan order with each batch after what it waits for, otherwise as given: run-plan.js skips a batch whose waitsFor
// has not run yet, and a batch added to an old plan comes last in the file
export function ordered(batches) {
  const byId = new Map(batches.map((b) => [b.id, b]));
  const out = [];
  const state = new Map();
  const visit = (b) => {
    if (state.get(b.id) === "done") return;
    if (state.get(b.id) === "open") throw new Error(`waitsFor goes in a circle at ${b.id}`);
    state.set(b.id, "open");
    for (const w of b.waitsFor || []) if (byId.has(w)) visit(byId.get(w));
    state.set(b.id, "done");
    out.push(b);
  };
  batches.forEach(visit);
  return out;
}

// args are what the workflow will run, so a mistake here would surface as a skipped batch long after the start;
// replace: old batches with no commit that the args leave out are gone, for a plan fixed after a refusal
export const SIZES = ["light", "normal", "heavy"];

// the fields of one batch that run-plan.js reads; continuous.mjs init checks args with it too
export function checkBatch(b) {
  if (typeof b?.id !== "string" || !b.id || /\s/.test(b.id)) throw new Error(`batch id is empty or holds a space: ${b?.id}`);
  // run-plan.js and plan.mjs live name the job review `job`
  if (b.id === "job") throw new Error("batch id job is the job review's, pick another");
  if (!b.title || !b.brief) throw new Error(`batch ${b.id} needs a title and a brief`);
  if (b.accept !== undefined && !(Array.isArray(b.accept) && b.accept.every((a) => typeof a === "string" && a.trim()))) {
    throw new Error(`batch ${b.id}: accept is a list of checks (strings)`);
  }
  // set before the work: the plan review reads them, and the committer builds to them (plan-batching.md §Plan review)
  for (const k of ["risks"]) {
    if (!(Array.isArray(b[k]) && b[k].length && b[k].every((a) => typeof a === "string" && a.trim()))) {
      throw new Error(`batch ${b.id}: ${k} is a list of strings, not empty (a batch with none says "none: <why>")`);
    }
    // a bare "none", "n/a" or "-" is the boilerplate the gate exists to stop: the why is the content
    if (b[k].some((a) => /^\s*(none|n\/?a|nil|-+)\s*[.:]?\s*$/i.test(a))) {
      throw new Error(`batch ${b.id}: a ${k} entry of "none" says why: "none: <why>"`);
    }
  }
  // absent is normal: a plan or args file from before sizes stays valid
  if (b.size !== undefined && !SIZES.includes(b.size)) throw new Error(`batch ${b.id}: size is light, normal or heavy`);
  for (const k of ["waitsFor", "alsoInScope"])
    if (b[k] !== undefined && !Array.isArray(b[k])) throw new Error(`batch ${b.id}: ${k} is a list`);
}

// the job-level cap on a committer's size; plan.mjs write and continuous.mjs init both refuse another value
export function checkMaxSize(args) {
  if (args.maxSize !== undefined && !SIZES.includes(args.maxSize)) throw new Error(`maxSize is light, normal or heavy: ${args.maxSize}`);
}

export function merge(old, args, commits = new Map(), replace = false) {
  checkMaxSize(args);
  if (!JOB.test(args.job || "")) throw new Error(`job is not <yyyy-mm-dd>-<slug>: ${args.job}`);
  if (!args.batches?.length) throw new Error("args need batches");
  const seen = new Set();
  for (const b of args.batches) {
    checkBatch(b);
    // the job's one review checks every batch against these, and a batch with none leaves it only the request to go
    // by; a batch a plan file from before 2.44.0 already holds without them may be re-written (an owner's answer)
    const prev = old?.batches?.find((o) => o.id === b.id);
    if (!b.accept?.length && !(prev && !prev.accept?.length)) throw new Error(`batch ${b.id}: accept is empty: give the summary's Done when checks it must meet`);
    if (seen.has(b.id)) throw new Error(`batch id appears twice: ${b.id}`);
    if (commits.has(b.id)) throw new Error(`batch ${b.id} already has commit ${commits.get(b.id)}, pick a new id`);
    for (const w of b.waitsFor || []) {
      if (seen.has(w)) continue;
      if (args.batches.some((x) => x.id === w)) throw new Error(`${b.id} waits for ${w}, planned after it`);
      if (commits.has(w)) throw new Error(`${b.id} waits for ${w}, committed: drop it from waitsFor once the job review is clean`);
      // run-plan.js counts an id outside the run as not committed and would skip this batch
      throw new Error(`${b.id} waits for ${w}, not in this run`);
    }
    seen.add(b.id);
  }
  const given = new Map(args.batches.map((b) => [b.id, b]));
  const kept = (old?.batches || [])
    .filter((b) => !replace || given.has(b.id) || commits.has(b.id))
    .map((b) => given.get(b.id) ?? b);
  const known = new Set((old?.batches || []).map((b) => b.id));
  const batches = ordered([...kept, ...args.batches.filter((b) => !known.has(b.id))]);
  const ids = new Set(batches.map((b) => b.id));
  for (const b of batches) {
    for (const w of b.waitsFor || []) {
      if (!ids.has(w) && !commits.has(w)) throw new Error(`${b.id} waits for ${w}, not in the plan`);
    }
  }
  return { job: args.job, request: args.request || old?.request || "", batches };
}

// left: batches with no commit of their own; ready: those of them no other left batch holds back
export function progress(plan, commits) {
  const left = plan.batches.filter((b) => !commits.has(b.id));
  const open = new Set(left.map((b) => b.id));
  return {
    done: plan.batches.filter((b) => commits.has(b.id)).map((b) => ({ id: b.id, hash: commits.get(b.id) })),
    left: left.map((b) => b.id),
    ready: left.filter((b) => !(b.waitsFor || []).some((w) => open.has(w))).map((b) => b.id),
  };
}

// run-plan.js counts a waitsFor id outside the run as not committed, so a committed one leaves the list
export function resumeArgs(plan, commits, plugin, maxSize) {
  const batches = plan.batches
    .filter((b) => !commits.has(b.id))
    .map((b) => ({ ...b, waitsFor: (b.waitsFor || []).filter((w) => !commits.has(w)) }));
  return { request: plan.request, plugin, job: plan.job, ...(maxSize ? { maxSize } : {}), batches };
}
