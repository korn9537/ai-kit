#!/usr/bin/env node
// Each half of CLAUDE.core.md as hooks/lib.sh kit_core injects it stays under Claude Code's 10,000-character cap on
// SessionStart context (over it, Claude sees a 2,000-character preview); the second half keeps room for the notes.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const CAP = 10000;
// a plugin path longer than the usual ~/.claude/plugins/cache/korn9537/ai-kit/<version>/
const PLUGIN_PATH = `/${"x".repeat(78)}/`;
// session-start.sh appends its notes (open plans, proposals, auto-memory, stale unattended files) to the second half
const NOTES = 2000;

const staged = process.argv.includes("--staged");
const text = staged
  ? execFileSync("git", ["show", ":CLAUDE.core.md"], { encoding: "utf8" })
  : readFileSync(new URL("../CLAUDE.core.md", import.meta.url), "utf8");
const at = text.search(/^## Delegation and report$/m);
if (at < 0) {
  console.error("CLAUDE.core.md: no '## Delegation and report' line, where hooks/lib.sh kit_core splits it");
  process.exit(1);
}
const halves = [text.slice(0, at), text.slice(at)].map((h) => h.replaceAll("ai-kit/", PLUGIN_PATH).length);
const limits = [CAP, CAP - NOTES];
let bad = 0;
halves.forEach((n, i) => {
  const line = `CLAUDE.core.md half ${i + 1}: ${n} characters with an ${PLUGIN_PATH.length}-character plugin path, limit ${limits[i]}`;
  if (n > limits[i]) {
    bad = 1;
    console.error(`${line}: over. Move a procedure into a skill (skills/) or shorten it.`);
  } else if (process.argv.includes("-v")) console.log(line);
});
process.exit(bad);
