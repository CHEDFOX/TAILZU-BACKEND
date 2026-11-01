/**
 * THE PROJECT'S OVERVIEW WITH REAL MODELS AND REAL HISTORY: what each project really is, and a change of course seen from the work alone.
 *
 *   npx tsx e2e/overview-real.ts [--only backend|umami|pocketbase|fastapi] [--then 150] [--out e2e/out/overview.md]
 *
 * Each project's brain is built as when a person connects it (real models). Its history is read from its own git clone, as the brain keeps it
 * (the newest 100 commits, the files each touched). Then:
 *   1. THEN: the overview written from the work as it was --then commits ago (the history from there back), as if the project were read then;
 *   2. the drift of the project now from what that overview was written from, by code, with no one saying anything;
 *   3. NOW: the overview tuned from it when the drift says so: what it really is now, and how its course changed.
 */
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRig, USER } from "./adapters/rig.js";
import { basisOf, driftOf, overviewLines, tuneOverview, TUNE_AT, OVERVIEW_TEXTS, type OverviewInput } from "../src/code/project/overview.js";
import { Meter } from "../src/code/project/summarize.js";
import type { CommitRecord } from "../src/code/project/types.js";

const arg = (n: string, d = ""): string => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] ?? d : d; };
const THEN = Number(arg("then", "150"));
const PROJECTS = [
  { key: "backend", dir: "/home/user/TAILZU-BACKEND" },
  { key: "umami", dir: "/home/user/OPEN/umami" },
  { key: "pocketbase", dir: "/home/user/OPEN/pocketbase" },
  { key: "fastapi", dir: "/home/user/OPEN/full-stack-fastapi-template" },
  { key: "desktop", dir: "/home/user/TAILZU-DESKTOP" },
];

function filesOf(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 1 << 26 }).split("\n").filter(Boolean)) {
    if (/(^|\/)(?:e2e\/(?:cache|out)|node_modules)\//.test(p)) continue;
    try { const b = fs.readFileSync(path.join(dir, p)); if (b.length <= 300_000 && !b.includes(0)) out[p] = b.toString("utf8"); } catch { /* gone */ }
  }
  return out;
}

/** The history as the brain keeps it: newest first, each commit with the files it touched (none for one that touched more than 40), from `skip` back. */
function historyOf(dir: string, skip: number, n = 100): { commits: CommitRecord[]; messages: string[] } {
  const raw = execFileSync("git", ["-C", dir, "log", `--skip=${skip}`, `-n`, String(n), "--name-only", "--format=@@%H%x09%ct%x09%s"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const commits: CommitRecord[] = [];
  const messages: string[] = [];
  for (const block of raw.split("@@").filter(Boolean)) {
    const [head, ...rest] = block.split("\n");
    const [sha, at, subject] = head!.split("\t");
    const files = rest.map((l) => l.trim()).filter(Boolean);
    commits.push({ sha: sha!, at: Number(at) * 1000, files: files.length > 40 ? [] : files });
    messages.push(subject ?? "");
  }
  return { commits, messages };
}

async function main(): Promise<void> {
  const lines: string[] = [`# What each project really is, and a change of course seen from the work alone (${new Date().toISOString().slice(0, 10)})`, ""];
  const out = (...s: string[]) => { for (const l of s.length ? s : [""]) { lines.push(l); console.log(l); } };
  for (const p of PROJECTS.filter((x) => !arg("only") || x.key === arg("only"))) {
    const rig = await createRig({ mode: "real", brainBudgetPaise: 1000, room: false });
    try {
      const files = filesOf(p.dir);
      const h = await rig.addProjectFor({ id: p.key, repo: "synthetic", base: { files }, checks: {}, oracle: {} } as never, p.key);
      await rig.code.brain!.open(USER, h.project.id);
      const store = (rig.code.brain as unknown as { runtime: { store: import("../src/code/project/store.js").ProjectBrainStore } }).runtime.store;
      const b = (await store.getBrain(h.project.id))!;
      const rows = await store.listFiles(h.project.id);
      const texts = await store.sampleTexts(h.project.id, OVERVIEW_TEXTS);
      const spent = () => rig.kit.logs.reduce((n, l) => n + l.paise, 0);
      const brainPaise = spent();
      const base = { name: p.key, structure: b.structure, features: b.features, paths: rows.map((f) => f.path), rank: new Map<string, number>(rows.map((f) => [f.path, f.rank])), texts, owner: null };
      const ctx = { call: rig.kit.call, ...(rig.kit.gateway ? { gateway: rig.kit.gateway } : {}), userId: USER, meter: new Meter(500) };
      const nowH = historyOf(p.dir, 0);
      const thenH = historyOf(p.dir, THEN);
      const day = (c: CommitRecord[]) => (c.length ? `${new Date(c.at(-1)!.at).toISOString().slice(0, 10)} to ${new Date(c[0]!.at).toISOString().slice(0, 10)}` : "-");
      const nowIn: OverviewInput = { ...base, history: nowH.commits, messages: nowH.messages };
      const thenIn: OverviewInput = { ...base, history: thenH.commits, messages: thenH.messages };

      out(`## ${p.key} (${Object.keys(files).length} files; brain ₹${(brainPaise / 100).toFixed(2)})`, "");
      const p0 = spent();
      const then = await tuneOverview(ctx, thenIn, null, ["first read"], thenH.commits[0]?.sha ?? "then", Date.now() - 86_400_000, 300);
      out(`### Then: written from the work ${THEN} to ${THEN + 100} commits ago (${day(thenH.commits)}), ₹${((spent() - p0) / 100).toFixed(2)}`, "", ...overviewLines(then), "");
      const d = driftOf(then, basisOf(nowIn), nowH.commits.length);
      out(`### The project now (${day(nowH.commits)}): drift ${d.score} (tuned at ${TUNE_AT}), no one said anything`, "", ...d.reasons.map((r) => `- ${r}`), "");
      if (d.score >= TUNE_AT) {
        const p1 = spent();
        const now = await tuneOverview(ctx, nowIn, then, d.reasons, nowH.commits[0]?.sha ?? "now", Date.now(), 300);
        out(`### Now: tuned, ₹${((spent() - p1) / 100).toFixed(2)}`, "", ...overviewLines(now), "");
      } else out("(not tuned: the work has not moved enough)", "");
    } finally {
      await rig.dispose();
    }
  }
  const file = arg("out", path.join("e2e", "out", "overview.md"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
