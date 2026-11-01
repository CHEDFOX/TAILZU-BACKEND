/**
 * THE PROJECT'S OVERVIEW WITH REAL MODELS: what each project's first read writes, then what a change of course the owner states makes of it.
 *
 *   npx tsx e2e/overview-real.ts [--only backend|umami|pocketbase] [--out e2e/out/overview.md]
 *
 * Each project's brain is built as when a person connects it (real models, the import budget), its overview printed as the card shows it; then
 * the owner says it is changing course, and the overview tuned from that is printed: what moved, how its course changed, what it was.
 */
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRig, USER } from "./adapters/rig.js";
import { overviewLines, kindsOf } from "../src/code/project/overview.js";

const arg = (n: string, d = ""): string => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] ?? d : d; };
const PROJECTS = [
  { key: "backend", dir: "/home/user/TAILZU-BACKEND", turn: { for: "X0 Bot: a platform where anyone builds and runs their own bots; Xode, the coding bot, is the first.", next: "Open the bots platform to everyone: bot builder, bot store, payouts." } },
  { key: "umami", dir: "/home/user/OPEN/umami", turn: { for: "A product-analytics suite: session replays, funnels and revenue, not only page views.", next: "Session replays for every plan, then funnels." } },
  { key: "fastapi", dir: "/home/user/OPEN/full-stack-fastapi-template", turn: { for: "A starter for multi-tenant SaaS apps: organisations, billing and an admin, not only users and items.", next: "Organisations and Stripe billing." } },
  { key: "pocketbase", dir: "/home/user/OPEN/pocketbase", turn: { for: "A backend you can also run as a managed cloud, with teams and billing.", next: "A hosted version with teams." } },
];

function filesOf(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 1 << 26 }).split("\n").filter(Boolean)) {
    if (/(^|\/)(?:e2e\/(?:cache|out)|node_modules)\//.test(p)) continue;
    try { const b = fs.readFileSync(path.join(dir, p)); if (b.length <= 300_000 && !b.includes(0)) out[p] = b.toString("utf8"); } catch { /* gone */ }
  }
  return out;
}

async function main(): Promise<void> {
  const lines: string[] = [`# The project's overview, with real models (${new Date().toISOString().slice(0, 10)})`, ""];
  const out = (...s: string[]) => { for (const l of s.length ? s : [""]) { lines.push(l); console.log(l); } };
  for (const p of PROJECTS.filter((x) => !arg("only") || x.key === arg("only"))) {
    const rig = await createRig({ mode: "real", brainBudgetPaise: 1000, room: false });
    try {
      const files = filesOf(p.dir);
      const t0 = Date.now();
      const h = await rig.addProjectFor({ id: p.key, repo: "synthetic", base: { files }, checks: {}, oracle: {} } as never, p.key);
      const brain = await rig.code.brain!.open(USER, h.project.id);
      const spent = () => Math.ceil(rig.kit.logs.reduce((n, l) => n + l.paise, 0));
      const overviewCalls = () => rig.kit.logs.filter((l) => l.purpose === "brain.overview");
      const store = (rig.code.brain as unknown as { runtime: { store: { getBrain: (id: string) => Promise<{ book?: { overview?: import("../src/code/project/overview.js").Overview } } | null> } } }).runtime.store;
      const ov1 = (await store.getBrain(h.project.id))?.book?.overview;
      out(`## ${p.key} (${Object.keys(files).length} files)`, );
      out();
      out(`Brain built in ${((Date.now() - t0) / 1000).toFixed(0)}s for ₹${(spent() / 100).toFixed(2)}; the overview call: ₹${(overviewCalls().reduce((n, l) => n + l.paise, 0) / 100).toFixed(2)} (${ov1?.via ?? "none"}).`);
      out(`Kinds by code: ${ov1 ? ov1.basis.kinds.join(", ") : "-"}; latest work in: ${ov1?.basis.focus.join(", ") || "-"}`);
      out();
      out("### First read", "", ...(ov1 ? overviewLines(ov1) : ["(none)"]), "");
      const before = overviewCalls().length;
      await brain.answerBook(p.turn);
      for (let k = 0; k < 120 && overviewCalls().length === before; k += 1) await new Promise((r) => setTimeout(r, 500));
      await new Promise((r) => setTimeout(r, 1500));
      const ov2 = (await store.getBrain(h.project.id))?.book?.overview;
      out(`### After the owner says: "${p.turn.for}" / next: "${p.turn.next}"`, "", ...(ov2 ? overviewLines(ov2) : ["(none)"]));
      if (ov2?.earlier.length) out(`- Before: ${ov2.earlier[0]!.kind}. ${ov2.earlier[0]!.what}`);
      out("", `Tune: ₹${((overviewCalls().slice(before).reduce((n, l) => n + l.paise, 0)) / 100).toFixed(2)}.`, "");
      for (const l of overviewCalls().slice(before).filter((x) => !x.ok)) out(`(the tune's call failed: ${l.error ?? ""} ${l.why ?? ""})`);
      void kindsOf;
    } finally {
      await rig.dispose();
    }
  }
  const file = arg("out", path.join("e2e", "out", "overview.md"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
