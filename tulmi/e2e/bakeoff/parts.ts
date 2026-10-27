/**
 * THE PART BAKE-OFFS, TOGETHER:   npm run bakeoff -- --parts [--prove] [--spend --budget-inr X] [--only extraction,locate,editFormats,contextStrategy,router]
 *
 *   FREE, measured now, no model:  page extraction (extract.ts) and locate (locate.ts)
 *   NEEDS CENTS, wired:            edit formats, context strategy, router (centparts.ts): their estimate and command are always shown; `--prove` runs each on scripted
 *                                  models to prove the machinery (not a measurement); `--spend` runs them for real, under the cap, when OPENROUTER_API_KEY is set
 *   ALSO IN THE REPORT:            the security suites' latest run (security/index.ts), the contestants and the cost of their grid with the key (contestants.ts),
 *                                  and the public benchmarks (public.ts)
 *
 * Writes out/parts/<time>/parts.json and report.html, and points out/parts/latest.* at them; the e2e report (report/html.ts) shows the same two sections.
 */
import "../env.js";
import { realKey } from "../env.js";
import fs from "node:fs";
import path from "node:path";
import { loadCatalog } from "../catalog.js";
import type { SecurityRun } from "../security/index.js";
import { OUT_DIR, mkdirp, readJson, writeJson } from "../util.js";
import { fetchCorpus, savedPages } from "./corpus.js";
import { contestantRows, estimateGrid, type ContestantRow, type GridEstimate } from "./contestants.js";
import {
  candidateModels, contextStrategyEstimate, editFormatsEstimate, makeCtx, routerEstimate, runContextStrategy, runEditFormats, runRouter, strategyTasks, type CentPartResult, type PartCtx,
} from "./centparts.js";
import { renderExtraction, runExtractionBakeoff, type ExtractionBakeoff } from "./extract.js";
import { renderLocate, runLocateBakeoff, type LocateBakeoff } from "./locate.js";
import { loadPools } from "./pools.js";
import { publicBench, type PublicBench } from "./public.js";
import { renderPartsHtml, type GridFile } from "../report/parts.js";
import { loadTasks } from "../tasks/schema.js";

export const PART_IDS = ["extraction", "locate", "editFormats", "contextStrategy", "router"] as const;
export type PartId = (typeof PART_IDS)[number];

export interface PartsFile {
  id: string;
  at: string;
  fx: number;
  extraction: ExtractionBakeoff | null;
  locate: LocateBakeoff | null;
  cents: CentPartResult[];
  security: SecurityRun | null;
  publicBench: PublicBench;
  contestants: { rows: ContestantRow[]; estimate: GridEstimate; models: string[]; tasks: number; taskGlob: string; command: string };
  notes: string[];
}

/** What a part that has not been run says: its estimate and the command. */
export function wiredCentParts(ctx: PartCtx): CentPartResult[] {
  const em = candidateModels(ctx.catalog, ["code", "strong"], 8);
  const e1 = editFormatsEstimate(ctx, em);
  const mid = loadPools().tiers.code[0]!;
  const st = strategyTasks(4);
  const e2 = contextStrategyEstimate(ctx, mid, st);
  const smoke = loadTasks().filter((t) => t.tags.includes("smoke") && ["bug", "feature"].includes(t.category) && !t.tags.includes("hostile")).length;
  const e3 = routerEstimate(ctx, mid, smoke);
  const base = (id: CentPartResult["id"], title: string, est: { inr: number; basis: string }, command: string, headline: string): CentPartResult => ({
    id, title, status: "wired", headline, notes: [], command, estimateInr: est.inr, estimateBasis: est.basis, spentInr: 0,
  });
  return [
    base("editFormats", "Edit formats per model", e1, `npm run bakeoff -- --parts --spend --only editFormats --budget-inr ${Math.max(5, Math.ceil(e1.inr * 1.5))}`, "exact replace vs search/replace blocks vs unified diff, per model: waits for the key"),
    base("contextStrategy", "Context strategy: summary, mask or hybrid", e2, `npm run bakeoff -- --parts --spend --only contextStrategy --budget-inr ${Math.max(10, Math.ceil(e2.inr * 1.5))}`, `summary vs mask vs hybrid on ${st.length} real tasks (${st.map((t) => t.id).join(", ")}): waits for the key`),
    base("router", "Router: learned routing against a fixed mid tier", e3, `npm run bakeoff -- --parts --spend --only router --budget-inr ${Math.max(10, Math.ceil(e3.inr * 1.5))}`, "routed tiers vs one mid-tier model, on the labelled front-door messages and the smoke tasks: waits for the key"),
  ];
}

export function latestSecurity(): SecurityRun | null {
  const f = path.join(OUT_DIR, "security", "latest.json");
  return fs.existsSync(f) ? readJson<SecurityRun>(f) : null;
}

export async function runParts(o: {
  only?: readonly PartId[]; prove: boolean; spend: boolean; capInr: number; cassetteName: string; outDir: string; log: (s: string) => void;
}): Promise<PartsFile> {
  const want = (id: PartId): boolean => !o.only || o.only.includes(id);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const fx = Number(process.env.CODE_USD_INR) || 88;
  mkdirp(o.outDir);
  const notes: string[] = [];
  let extraction: ExtractionBakeoff | null = null;
  let locate: LocateBakeoff | null = null;
  if (want("extraction")) {
    if (!savedPages().length) { o.log("extraction: no saved pages yet, fetching the corpus once"); await fetchCorpus(o.log); }
    extraction = await runExtractionBakeoff({ log: o.log });
    o.log(renderExtraction(extraction));
  }
  if (want("locate")) {
    locate = await runLocateBakeoff({ log: o.log });
    o.log(renderLocate(locate));
  }

  const catalog = await loadCatalog({ offline: true });
  const wiredCtx: PartCtx = { mode: "sim", fx, catalog, capInr: 0, cassetteName: o.cassetteName, cassetteMode: null, outDir: o.outDir, log: o.log };
  let cents = wiredCentParts(wiredCtx).filter((c) => want(c.id));
  if (o.spend) {
    if (!realKey) { notes.push("--spend was asked for but OPENROUTER_API_KEY is not set: the cents parts stay wired."); }
    else {
      const ctx = await makeCtx({ mode: "real", capInr: o.capInr, cassetteName: o.cassetteName, outDir: o.outDir, log: o.log });
      cents = [];
      if (want("editFormats")) cents.push(await runEditFormats(ctx));
      if (want("contextStrategy")) cents.push(await runContextStrategy(ctx));
      if (want("router")) cents.push(await runRouter(ctx));
    }
  } else if (o.prove) {
    const ctx = await makeCtx({ mode: "sim", outDir: o.outDir, log: o.log });
    const proved: CentPartResult[] = [];
    if (want("editFormats")) proved.push(await runEditFormats(ctx));
    if (want("contextStrategy")) proved.push(await runContextStrategy(ctx));
    if (want("router")) proved.push(await runRouter(ctx));
    // The estimate and command of the real run stay on the proved entries.
    cents = proved.map((p) => { const w = cents.find((c) => c.id === p.id); return w ? { ...p, estimateInr: w.estimateInr, estimateBasis: w.estimateBasis, command: w.command } : p; });
  }

  const pools = loadPools();
  const gridModels = [pools.tiers.tiny[0]!, pools.tiers.code[0]!, pools.tiers.strong[0]!];
  const agents = ["tailzu", "aider", "opencode", "codex", "mini-swe-agent", "openhands"];
  const smokeTasks = loadTasks().filter((t) => t.tags.includes("smoke")).length;
  const estimate = estimateGrid({ agents, models: gridModels, tasks: smokeTasks, catalog, fx });
  const file: PartsFile = {
    id: stamp, at: new Date().toISOString(), fx, extraction, locate, cents, security: latestSecurity(), publicBench: await publicBench(),
    contestants: { rows: contestantRows(), estimate, models: gridModels, tasks: smokeTasks, taskGlob: "tag:smoke", command: `npm run bakeoff -- --grid --models ${gridModels.join(",")} --agents ${agents.join(",")} --tasks 'tag:smoke' --budget-inr ${Math.ceil(estimate.highInr * 1.2)}` },
    notes,
  };
  writeJson(path.join(o.outDir, "parts.json"), file);
  fs.writeFileSync(path.join(o.outDir, "report.html"), renderPartsHtml(file, loadLatestGrid()));
  const latest = path.join(OUT_DIR, "parts");
  mkdirp(latest);
  fs.copyFileSync(path.join(o.outDir, "parts.json"), path.join(latest, "latest.json"));
  fs.copyFileSync(path.join(o.outDir, "report.html"), path.join(latest, "latest.html"));
  return file;
}

export function loadLatestGrid(): GridFile | null {
  const f = path.join(OUT_DIR, "grid", "latest.json");
  return fs.existsSync(f) ? readJson<GridFile>(f) : null;
}

export function loadLatestParts(): PartsFile | null {
  const f = path.join(OUT_DIR, "parts", "latest.json");
  return fs.existsSync(f) ? readJson<PartsFile>(f) : null;
}

export async function runPartsCli(argv: string[]): Promise<number> {
  const arg = (n: string): string | undefined => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const flag = (n: string): boolean => argv.includes(`--${n}`);
  if (flag("fetch-pages")) { const r = await fetchCorpus((s) => console.log(s)); console.log(`${r.have} page(s) saved, ${r.fetched.length} fetched now, ${r.failed.length} failed${r.failed.length ? `: ${r.failed.map((f) => `${f.id} (${f.why})`).join(", ")}` : ""}`); return r.failed.length ? 1 : 0; }
  const only = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean) as PartId[] | undefined;
  for (const x of only ?? []) if (!(PART_IDS as readonly string[]).includes(x)) throw new Error(`no part called ${x}; there are ${PART_IDS.join(", ")}`);
  const spend = flag("spend");
  const capInr = Number(arg("budget-inr") ?? 0);
  if (spend && !(capInr > 0)) throw new Error("--spend needs --budget-inr X, a hard cap in rupees");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const outDir = path.resolve(arg("out") ?? path.join(OUT_DIR, "parts", stamp));
  const f = await runParts({ ...(only ? { only } : {}), prove: flag("prove"), spend, capInr, cassetteName: arg("cassette") ?? "parts", outDir, log: (s) => console.log(s) });
  console.log(`\nparts report: ${path.join(outDir, "report.html")}`);
  for (const c of f.cents) console.log(`  ${c.title}: ${c.status}; ${c.status === "wired" ? "waits for the key" : c.headline.slice(0, 120)}; the real run is estimated at ₹${c.estimateInr.toFixed(2)}`);
  console.log(`  contestants grid with the key: ₹${f.contestants.estimate.totalInr.toFixed(0)} (range ₹${f.contestants.estimate.lowInr.toFixed(0)} to ₹${f.contestants.estimate.highInr.toFixed(0)}), ${f.contestants.estimate.runs} runs`);
  return 0;
}
