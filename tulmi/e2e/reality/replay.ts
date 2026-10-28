/**
 * STAGE 0, THE CASSETTES: EVERY RECORDING REPLAYED AGAINST THE CODE AS IT IS NOW, FOR NOTHING.
 *
 * A cassette (e2e/cassettes/*.jsonl.gz; a plain .jsonl is still read) holds every model request of a paid run and the answer it got. Replayed strictly, the product runs again on those answers: if its
 * requests are the same, the answers are the same and the run comes out as it did, and any difference in the outcome is a CHANGE IN THE CODE AFTER THE MODEL'S ANSWER
 * (a regression, or a fix) found at ₹0. If the code now asks something that was not recorded, that is a MISS: the prompts or the inputs changed, the recording no
 * longer says what the new code would do, and the item must be re-run with money to be known. So each replayed item lands in one of four boxes:
 *
 *   same        no miss, the outcome is the baseline's           (the result is kept in the store: it IS a measurement of the current code)
 *   regressed   no miss, it passed in the baseline and now fails
 *   fixed       no miss, it failed in the baseline and now passes
 *   stale       some requests missed: the recording does not cover the current code (not kept as a result; it says what to re-record)
 *
 * The baseline is the documented outcome of the recorded run (RESULTS-2026-10-27/28: what passed) where there is one, and otherwise the first replay with no miss.
 * Four kinds of cassette are replayed, each as the run that recorded it was made:
 *   smoke      the nine smoke items, under the turn cap, models and tiers recorded in the cassette's sidecar
 *   probes     each model's capability probes (and its edit-format probe), through the product's own gateway pinned to that model
 *   router     the router part: the product's routing against one fixed mid tier
 *   editFormats  the edit-format probe per model
 * Anything else in the folder (a proxy cassette, another tool's) is listed and left alone.
 */
import "../env.js";
import fs from "node:fs";
import { CassetteStore, CASSETTES_DIR, cassetteNameOf } from "../adapters/cassette.js";
import { makeModelKit } from "../adapters/rig.js";
import type { Catalog } from "../catalog.js";
import { MemoryJobStore } from "../../src/code/jobs/store.js";
import { resetConfigForTests } from "../../src/config.js";
import { resetTierTableForTests } from "../../src/code/brain/tiers.js";
import { pinnedTiers } from "../bakeoff/engine.js";
import { EDIT_CASES, EDIT_FORMATS, scoreEditFormats } from "../bakeoff/editformat.js";
import { ALL_PROBES, runProbe } from "../bakeoff/probes.js";
import { makeCtx, runRouter, type CentPartResult } from "../bakeoff/centparts.js";
import { runSmoke } from "../smoke/index.js";
import { loadHashes } from "../smoke/changed.js";
import { SMOKE_FALLBACK, SMOKE_PRIMARY } from "../smoke/tiers.js";
import { tmpDir, rmrf } from "../util.js";
import { codeFingerprint, probeVersion, smokePromptVersion } from "./fingerprint.js";
import type { ResultsStore, ResultSource, StoredResult } from "./store.js";

export type CassetteKind = "smoke" | "probes" | "router" | "editFormats" | "other";

export function kindOfCassette(name: string): CassetteKind {
  if (/^smoke(-\d+)?$/.test(name) || /^reality-smoke/.test(name)) return "smoke";
  if (/^probes(-\d+)?$/.test(name) || /^reality-probes/.test(name)) return "probes";
  if (/^parts-router/.test(name)) return "router";
  if (/^parts-editformats/.test(name)) return "editFormats";
  return "other";
}

/** The cassettes, OLDEST RECORDING FIRST (by the time written in their first entry): when two recordings answer the same question, the newer one is the later word. */
export function listCassettes(dir = CASSETTES_DIR): Array<{ name: string; kind: CassetteKind; entries: number; bytes: number; recordedAt: string }> {
  if (!fs.existsSync(dir)) return [];
  const names = [...new Set(fs.readdirSync(dir).map((f) => cassetteNameOf(f)).filter((n): n is string => !!n))].sort();
  return names.map((name) => {
    const text = new CassetteStore(name, dir).text();
    const lines = text.split("\n").filter((l) => l.trim());
    let recordedAt = "";
    try { recordedAt = (JSON.parse(lines[0] ?? "{}") as { at?: string }).at ?? ""; } catch { /* a cassette whose first line cannot be read sorts first */ }
    return { name, kind: kindOfCassette(name), entries: lines.length, bytes: text.length, recordedAt };
  }).sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : a.name < b.name ? -1 : 1));
}

export type Box = "same" | "regressed" | "fixed" | "stale";

export interface ReplayItem {
  cassette: string;
  kind: CassetteKind;
  /** The item id: a smoke item, `<probe>`, `router/<arm>/<item>`, `editFormats`. */
  item: string;
  /** The model it was about ("-" for a smoke item, the arm for the router). */
  model: string;
  ok: boolean;
  hits: number;
  misses: number;
  /** What the recorded answers cost when they were paid, in rupees. */
  recordedInr: number;
  detail: string;
  box: Box;
  /** Free data kept with the result (the probe's errors, the edit-format rates). */
  data?: unknown;
  /** What the documented run said, when it said (true: passed). */
  baseline?: boolean;
  /** The stage of a smoke/router item that failed first, for the clustering of failures. */
  stage?: string;
  category?: string;
}

export interface ReplayReport {
  cassette: string;
  kind: CassetteKind;
  entries: number;
  items: ReplayItem[];
  hits: number;
  misses: number;
  recordedInr: number;
  ms: number;
  /** Differences from what the recorded run is documented to have found (RESULTS-*.md). */
  documented: string[];
  note: string;
}

/** What each recorded run found, as its RESULTS file says, to compare a replay with: the passing smoke items, and the router's counts. */
export const DOCUMENTED: Record<string, { about: string; passing?: number[]; router?: Record<string, { front: string; tasks: string }> }> = {
  smoke: { about: "RESULTS-2026-10-27 section 1: 4 of 9 items pass (1, 5, 6, 9)", passing: [1, 5, 6, 9] },
  "smoke-2": { about: "RESULTS-2026-10-28 section 1: 4 of 9 items pass (1, 4, 6, 9)", passing: [1, 4, 6, 9] },
  "parts-router-2": { about: "RESULTS-2026-10-28 section 5: both arms front door 11/12, smoke tasks 1/2", router: { routed: { front: "11/12", tasks: "1/2" }, "fixed-mid": { front: "11/12", tasks: "1/2" } } },
};

// -------------------------------------------------------------------------------------- helpers

const fxOf = (): number => Number(process.env.CODE_USD_INR) || 88;

/** Runs `f` with the product's tier settings put back afterwards: the smoke and router runs set CODE_MODEL_TIERS for the process. */
async function withTierEnv<T>(f: () => Promise<T>): Promise<T> {
  const saved = process.env.CODE_MODEL_TIERS;
  try { return await f(); } finally {
    if (saved === undefined) delete process.env.CODE_MODEL_TIERS; else process.env.CODE_MODEL_TIERS = saved;
    resetConfigForTests();
    resetTierTableForTests();
  }
}

// ------------------------------------------------------------------------------------- smoke

export async function replaySmoke(name: string, o: { catalog: Catalog; log: (s: string) => void }): Promise<ReplayReport> {
  const t0 = Date.now();
  const store = new CassetteStore(name);
  const meta = loadHashes(store.file)?.run;
  const out = tmpDir("reality-smoke");
  try {
    const run = await withTierEnv(() => runSmoke({
      mode: "real", cassetteMode: "replay", cassetteName: name, loose: false, capInr: 25, tiers: meta?.tiers ?? "smoke", primary: meta?.primary ?? SMOKE_PRIMARY, fallback: meta?.fallback ?? SMOKE_FALLBACK,
      maxTurns: meta?.maxTurns ?? 12, parallel: 3, outDir: out, changed: false, only: [], estimateOnly: false, log: () => undefined, catalog: o.catalog,
    }));
    const doc = DOCUMENTED[name];
    const items: ReplayItem[] = run.items.map((i) => {
      const failing = Object.entries(i.stages).find(([, v]) => v && !v.ok);
      return {
        cassette: name, kind: "smoke", item: i.id, model: "-", ok: i.ok, hits: i.cassette?.hits ?? 0, misses: i.cassette?.misses ?? 0, recordedInr: (i.cassette?.replayedUsd ?? 0) * fxOf(),
        detail: failing ? `${failing[0]}: ${failing[1]!.detail}`.slice(0, 220) : i.detail || "pass", box: "same", ...(failing ? { stage: failing[0] } : {}),
        ...(doc?.passing ? { baseline: doc.passing.includes(i.n) } : {}), data: { n: i.n, title: i.title, stages: i.stages, harness: i.harness ?? [], kind: i.kind },
      };
    });
    const documented: string[] = [];
    if (doc?.passing) {
      const got = run.items.filter((i) => i.ok).map((i) => i.n).sort((a, b) => a - b);
      const clean = items.every((i) => i.misses === 0);
      if (JSON.stringify(got) !== JSON.stringify(doc.passing)) documented.push(`${clean ? "DIFFERENT from" : "differs (some requests missed) from"} the documented run: items ${got.join(", ") || "none"} pass, ${doc.about}`);
    }
    return { cassette: name, kind: "smoke", entries: store.load().count, items, hits: items.reduce((n, i) => n + i.hits, 0), misses: items.reduce((n, i) => n + i.misses, 0), recordedInr: run.replayedInr, ms: Date.now() - t0, documented, note: meta ? `replayed under the recording's own settings: ${meta.maxTurns ?? "?"}-turn cap, ${meta.primary ?? "?"}` : "no sidecar: the 12-turn cap of the first recordings" };
  } finally { rmrf(out); }
}

// ------------------------------------------------------------------------------------ probes

export async function replayProbes(name: string, o: { catalog: Catalog; log: (s: string) => void }): Promise<ReplayReport> {
  const t0 = Date.now();
  const store = new CassetteStore(name).load();
  const fx = fxOf();
  const slugs = [...new Set(store.entries().map((e) => e.run?.split("|")[0]).filter((s): s is string => !!s))].sort();
  const items: ReplayItem[] = [];
  for (const slug of slugs) {
    const info = o.catalog.models.get(slug);
    const mine = store.entries().filter((e) => e.run === `${slug}|probes`);
    const ids = ALL_PROBES.map((p) => p.id).filter((id) => mine.some((e) => e.purpose === `probe.${id}`));
    if (ids.length) {
      const { kit, cassette } = makeModelKit({ mode: "real", tiers: pinnedTiers(slug, info), cassette: { store, mode: "replay", run: `${slug}|probes` } }, new MemoryJobStore());
      for (const id of ids) {
        const p = ALL_PROBES.find((x) => x.id === id)!;
        const m0 = cassette!.stats.misses.length, h0 = cassette!.stats.hits, u0 = cassette!.stats.replayedUsd;
        const r = await runProbe(p, { slug, call: (input) => kit.call(input) as never });
        const misses = cassette!.stats.misses.length - m0;
        items.push({ cassette: name, kind: "probes", item: id, model: slug, ok: r.pass, hits: cassette!.stats.hits - h0, misses, recordedInr: (cassette!.stats.replayedUsd - u0) * fx, detail: `${r.score.toFixed(2)} ${r.detail}`.slice(0, 200), box: "same", data: { score: r.score, errors: r.errors, ms: r.ms } });
      }
    }
    const edit = store.entries().filter((e) => e.run === `${slug}|edit`);
    if (edit.length) {
      const { kit, cassette } = makeModelKit({ mode: "real", tiers: pinnedTiers(slug, info), cassette: { store, mode: "replay", run: `${slug}|edit` } }, new MemoryJobStore());
      const score = await scoreEditFormats((input) => kit.call(input) as never);
      items.push({ cassette: name, kind: "probes", item: "editFormats", model: slug, ok: score.best !== undefined && Math.max(score.rates.exact, score.rates.blocks, score.rates.diff) > 0, hits: cassette!.stats.hits, misses: cassette!.stats.misses.length, recordedInr: cassette!.stats.replayedUsd * fx, detail: `exact ${Math.round(score.rates.exact * 100)}%, blocks ${Math.round(score.rates.blocks * 100)}%, diff ${Math.round(score.rates.diff * 100)}%`, box: "same", data: { exact: score.rates.exact, blocks: score.rates.blocks, diff: score.rates.diff, best: score.best } });
    }
  }
  return { cassette: name, kind: "probes", entries: store.count, items, hits: items.reduce((n, i) => n + i.hits, 0), misses: items.reduce((n, i) => n + i.misses, 0), recordedInr: items.reduce((n, i) => n + i.recordedInr, 0), ms: Date.now() - t0, documented: [], note: `${slugs.length} model(s)` };
}

export async function replayEditFormats(name: string, o: { catalog: Catalog; log: (s: string) => void }): Promise<ReplayReport> {
  const t0 = Date.now();
  const store = new CassetteStore(name).load();
  const fx = fxOf();
  const slugs = [...new Set(store.entries().map((e) => e.run?.split("|")[0]).filter((s): s is string => !!s))].sort();
  const items: ReplayItem[] = [];
  for (const slug of slugs) {
    const { kit, cassette } = makeModelKit({ mode: "real", tiers: pinnedTiers(slug, o.catalog.models.get(slug)), cassette: { store, mode: "replay", run: `${slug}|edit` } }, new MemoryJobStore());
    const score = await scoreEditFormats((input) => kit.call(input) as never);
    items.push({ cassette: name, kind: "editFormats", item: "editFormats", model: slug, ok: Math.max(score.rates.exact, score.rates.blocks, score.rates.diff) > 0, hits: cassette!.stats.hits, misses: cassette!.stats.misses.length, recordedInr: cassette!.stats.replayedUsd * fx, detail: `exact ${Math.round(score.rates.exact * 100)}%, blocks ${Math.round(score.rates.blocks * 100)}%, diff ${Math.round(score.rates.diff * 100)}% -> ${score.best}`, box: "same", data: { exact: score.rates.exact, blocks: score.rates.blocks, diff: score.rates.diff, best: score.best } });
  }
  void EDIT_CASES; void EDIT_FORMATS;
  return { cassette: name, kind: "editFormats", entries: store.count, items, hits: items.reduce((n, i) => n + i.hits, 0), misses: items.reduce((n, i) => n + i.misses, 0), recordedInr: items.reduce((n, i) => n + i.recordedInr, 0), ms: Date.now() - t0, documented: [], note: `${slugs.length} model(s)` };
}

// ------------------------------------------------------------------------------------ router

export async function replayRouter(name: string, o: { catalog: Catalog; log: (s: string) => void }): Promise<ReplayReport & { part: CentPartResult | null }> {
  const t0 = Date.now();
  const store = new CassetteStore(name).load();
  const out = tmpDir("reality-router");
  try {
    const ctx = await makeCtx({ mode: "real", cassetteMode: "replay", cassetteName: name, outDir: out, log: () => undefined });
    const part = await runRouter({ ...ctx, catalog: o.catalog });
    const data = part.data as { rows: Array<{ arm: string; front: string; pass: number; n: number }>; items: Array<{ arm: string; id: string; ok: boolean; why: string; stages: Record<string, unknown>; costPaise: number; cassette?: { hits: number; misses: number } }> };
    const fx = fxOf();
    const items: ReplayItem[] = data.items.map((x) => ({
      cassette: name, kind: "router", item: x.id, model: x.arm, ok: x.ok, hits: x.cassette?.hits ?? 0, misses: x.cassette?.misses ?? 0, recordedInr: 0, detail: x.why || "pass", box: "same", data: { stages: x.stages, costPaise: x.costPaise },
      ...(x.why ? { stage: x.why.split(":")[0]!.toLowerCase().replace("front door", "front").replace("pr", "pr") } : {}),
    }));
    void fx;
    const doc = DOCUMENTED[name]?.router;
    const documented: string[] = [];
    if (doc) for (const r of data.rows) {
      const want = doc[r.arm];
      const missed = items.filter((x) => x.model === r.arm && x.misses > 0).length;
      if (want && missed) documented.push(`arm ${r.arm}: ${missed} item(s) are stale (the code asks what the recording lacks), so the documented ${want.front} and ${want.tasks} cannot be compared`);
      else if (want && (want.front !== r.front || want.tasks !== `${r.pass}/${r.n}`)) documented.push(`arm ${r.arm}: front door ${r.front}, tasks ${r.pass}/${r.n}; the documented run had ${want.front} and ${want.tasks}`);
    }
    return { cassette: name, kind: "router", entries: store.count, items, hits: items.reduce((n, i) => n + i.hits, 0), misses: items.reduce((n, i) => n + i.misses, 0), recordedInr: store.totalUsd() * fxOf(), ms: Date.now() - t0, documented, note: "router arms replayed on the smoke tasks", part };
  } finally { rmrf(out); }
}

// ----------------------------------------------------------------------------- the whole sweep

/** Replays one cassette by its kind. */
export async function replayCassette(name: string, kind: CassetteKind, o: { catalog: Catalog; log: (s: string) => void }): Promise<ReplayReport | null> {
  if (kind === "smoke") return replaySmoke(name, o);
  if (kind === "probes") return replayProbes(name, o);
  if (kind === "router") return replayRouter(name, o);
  if (kind === "editFormats") return replayEditFormats(name, o);
  return null;
}

/** Puts each item in its box against the baseline: the documented outcome, else the first clean replay in the store. */
export function classify(items: ReplayItem[], store: ResultsStore): ReplayItem[] {
  return items.map((i) => {
    if (i.misses > 0) return { ...i, box: "stale" as const };
    const earlier = store.history("replay", "-", i.cassette, `${i.kind}/${i.model}/${i.item}`).filter((r) => (r.data as { misses?: number } | undefined)?.misses === 0);
    const base = i.baseline ?? earlier[0]?.ok;
    if (base === undefined) return { ...i, box: "same" as const };
    return { ...i, baseline: base, box: base === i.ok ? ("same" as const) : base ? ("regressed" as const) : ("fixed" as const) };
  });
}

/**
 * Keeps what the replays found. Every item is written as a `replay` line (so the next sweep has a baseline and the report can say what was stale). An item with no
 * miss is also a RESULT of the current code (its source is "replay", its cost what it cost when recorded) and is written under its own kind, so that the plan does
 * not pay to measure it again.
 */
export function remember(store: ResultsStore, report: ReplayReport, run: string, source: ResultSource = "replay"): { kept: number; stale: number } {
  const at = new Date().toISOString();
  let kept = 0, stale = 0;
  const part = codeFingerprint("part:router");
  // Written once: the same sweep on the same code finds the same things, and a store that grew by 170 lines on every run would bury what is new.
  const once = (r: StoredResult): void => {
    const have = store.get(r);
    if (have && have.ok === r.ok && (r.kind !== "replay" || (have.data as { misses?: number } | undefined)?.misses === (r.data as { misses?: number }).misses)) return;
    store.append(r);
  };
  for (const i of report.items) {
    const base = { agent: "-", at, run, source };
    once({ ...base, kind: "replay", model: report.cassette, item: `${i.kind}/${i.model}/${i.item}`, code: codeFingerprint("task"), prompt: report.cassette, ok: i.ok, costInr: i.recordedInr, wallMs: 0, detail: i.detail, data: { misses: i.misses, hits: i.hits, box: i.box } });
    if (i.misses > 0) { stale += 1; continue; }
    kept += 1;
    if (i.kind === "smoke") {
      const d = i.data as { n: number; stages: unknown; harness: string[] };
      once({ ...base, kind: "smoke", agent: "tailzu", model: "smoke-ladder", item: i.item, code: codeFingerprint("smoke"), prompt: smokePromptVersion(), ok: i.ok, costInr: i.recordedInr, wallMs: 0, detail: i.detail, data: d });
    } else if (i.kind === "probes" && i.item !== "editFormats") {
      const d = i.data as { score: number; errors: unknown };
      once({ ...base, kind: "probe", agent: "-", model: i.model, item: i.item, code: codeFingerprint("probe"), prompt: probeVersion(), ok: i.ok, score: d.score, costInr: i.recordedInr, wallMs: 0, detail: i.detail, data: d });
    } else if (i.item === "editFormats") {
      once({ ...base, kind: "part", agent: "-", model: i.model, item: "editFormats", code: codeFingerprint("part:editFormats"), prompt: probeVersion(), ok: i.ok, costInr: i.recordedInr, wallMs: 0, detail: i.detail, data: i.data });
    } else if (i.kind === "router") {
      once({ ...base, kind: "part", agent: "tailzu", model: i.model, item: `router/${i.item}`, code: part, prompt: smokePromptVersion(), ok: i.ok, costInr: i.recordedInr, wallMs: 0, detail: i.detail, data: i.data });
    }
  }
  return { kept, stale };
}
