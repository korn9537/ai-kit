// Tests for the heavy-batch cap of plan.mjs write (heavyFiles, refuseWideHeavy); plan.test.mjs holds the rest.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { heavyFiles, merge, render, write } from "./plan.mjs";
import { ok, throws } from "./lib/test-util.mjs";

const JOB = "2026-11-05-heavy-cap";
const args = (batches) => ({
  request: "r",
  plugin: "/plugin",
  job: JOB,
  batches: batches.map((b) => ({ title: b.id, brief: `do ${b.id}`, accept: ["ok"], risks: ["r"], tests: ["t"], ...b })),
});
const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), "plan-heavy-")));
const git = (repo, ...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const repoAt = (name) => {
  const repo = join(tmp, name);
  execFileSync("git", ["init", "-q", repo]);
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "f.txt"), "x\n");
  git(repo, "add", "f.txt");
  git(repo, "commit", "-q", "-m", "base");
  return repo;
};

try {
  const wide = { id: "h", size: "heavy", brief: "src/a.ts src/b.ts src/c.ts src/d.ts src/e.ts src/f.ts" };
  throws("write refuses a heavy batch naming 6 files", () => write(repoAt("wide"), args([wide])), /heavy batch h names 6 files/);
  throws("the refusal lists the files it counted", () => write(repoAt("listed"), args([wide])), /\(src\/a\.ts, src\/b\.ts, .*src\/f\.ts\)/);
  ok("write takes a heavy batch naming 5 files",
    write(repoAt("narrow"), args([{ ...wide, brief: "src/a.ts src/b.ts src/c.ts src/d.ts src/e.ts" }])).committed === true);
  ok("write takes 6 files at size normal", write(repoAt("normal"), args([{ ...wide, size: "normal" }])).committed === true);
  ok("a maxSize of normal lets a wide heavy batch through (clamped)",
    write(repoAt("clamped"), { ...args([wide]), maxSize: "normal" }).committed === true);

  const root = repoAt("words");
  writeFileSync(join(root, "Makefile.mk"), "x\n");
  const brief = "Change scripts/plan.mjs:280-290 per docs/plan-batching.md and CLAUDE.md; plan.mjs write refuses. Node.js only. Makefile.mk";
  ok("heavyFiles leaves out the docs it follows, a bare name a path covers and a word that is no file",
    heavyFiles({ brief }, root).join() === "scripts/plan.mjs,Makefile.mk", heavyFiles({ brief }, root));
  ok("heavyFiles counts alsoInScope, not tests or risks",
    heavyFiles({ brief: "x", alsoInScope: ["src/a.ts"], tests: ["src/t.test.ts"], risks: ["src/r.ts"] }, root).join() === "src/a.ts");

  const kept = repoAt("kept");
  mkdirSync(join(kept, "ai", "plans"), { recursive: true });
  writeFileSync(join(kept, "ai", "plans", `${JOB}.md`), render(merge(null, args([wide]))));
  ok("a heavy batch the plan file already holds passes a re-write (an owner's answer, a rebase)",
    write(kept, args([{ ...wide, title: "answered" }])).committed === true);
  throws("the same batch naming one file more is refused",
    () => write(kept, args([{ ...wide, brief: `${wide.brief} src/g.ts` }])), /names 7 files/);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
