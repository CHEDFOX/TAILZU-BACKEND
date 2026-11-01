/**
 * THE PROJECT'S OVERVIEW: WHAT KIND OF APPLICATION IT IS, WHAT IT DOES AND FOR WHOM, ITS MAIN PARTS AND HOW THEY CONNECT, WHERE IT IS HEADING.
 *
 * What a new teammate reads first, and what the chat and every job start from. Written once when the project is first read, by one model call
 * (summarize.ts writeOverview), from what the code says, not from a guess:
 *
 *   kind       what kind of application it is: the signals are found by code (server routes and a server framework: a web service; Expo: a
 *              phone app; a `bin`: a command-line tool; Electron: a desktop app; ...), the model words them
 *   what       what it does and for whom, two or three sentences; the owner's words win
 *   parts      its main parts as a person names them, what each does, the file each starts from (a path the project has, checked)
 *   flows      one to three ways work moves through the parts ("a pageview: the tracker posts to /api/send, which checks it and saves it")
 *   direction  how its course changed, when it did ("Started as a dictation app; now a platform of bots.")
 *
 * A PROJECT CHANGES COURSE WHILE IT IS MADE. The overview keeps the fingerprint of what it was written from (its BASIS: the kinds, the stack,
 * what its README and manifest say it is, the owner's words, its parts and their sizes, where the latest work is). Every build compares the
 * project with that basis, by code and for nothing, and scores how far it has moved (driftOf): a new kind of application, the owner saying
 * something new, the README saying something new, a new or a gone part, the stack changing, most of the latest work landing where the overview
 * says nothing, many commits since. Small moves add up across builds, because the basis stays the one it was written from; once they reach
 * TUNE_AT the overview is TUNED, not written afresh: the model is given the overview as it was and what moved, keeps what is still true, and
 * says how the direction changed. The overview as it was is kept (EARLIER_KEPT of them), so "what was this before?" has an answer. The owner's
 * new words tune it at once (index.ts answerBook); anything else at most once in TUNE_GAP_MS.
 *
 * With no model, or no money left, the overview is the code's own (fallbackOverview): the kinds, the README's words, the parts as the index
 * named them. Never a failure.
 */
import type { CommitRecord, Feature, Structure } from "./types.js";
import { baseName, classOf } from "./lang.js";
import { writeOverview, type SummaryCtx } from "./summarize.js";

export interface OverviewPart { name: string; does: string; start: string }

export interface OverviewBasis {
  /** The kinds of application the code shows, by id. */
  kinds: string[];
  /** The frameworks it is built with. */
  stack: string[];
  /** What its README and manifest say it is, as a short fingerprint. */
  said: string;
  /** What the owner said it is and where it goes, as a short fingerprint ("" when they have not): new words are a change, the same words again are not. */
  owner: string;
  /** Its parts, each with how many files it has. */
  parts: Record<string, number>;
  files: number;
  /** The parts most of the latest commits touched. */
  focus: string[];
  /** The names its own screens and messages use most for it (the product as its people see it). */
  names?: string[];
}

export interface Overview {
  /** What the project really is now, in one sentence, in its own names: what only it does. */
  essence: string;
  kind: string;
  what: string;
  parts: OverviewPart[];
  flows: string[];
  direction: string;
  /** "model": written by the model from the signals; "code": the code's own, with no model. */
  via: "model" | "code";
  at: number;
  /** The head it was written at. */
  commit: string;
  basis: OverviewBasis;
  /** What it was before it was last tuned, newest first. */
  earlier: Array<{ at: number; commit: string; kind: string; what: string; essence?: string }>;
}

export interface OverviewInput {
  name: string;
  structure: Structure;
  features: readonly Feature[];
  /** Every path the project has. */
  paths: readonly string[];
  /** How central each file is (the index's rank by what imports it): a part starts at its most central file. */
  rank?: ReadonlyMap<string, number>;
  /** The newest commits, newest first, each with the files it touched. */
  history: readonly CommitRecord[];
  /** The newest commits' messages, newest first. */
  messages: readonly string[];
  owner: { for?: string; next?: string; keep?: string; at: number } | null;
  /** What its screens and messages say (the index's texts, a sample): the names the product goes by, and where each is said. */
  texts?: ReadonlyArray<{ text: string; kind: string; path?: string }>;
}

/** Drift at which the overview is tuned. */
export const TUNE_AT = 1;
/** At most one tune in this long, unless the owner said something new. */
export const TUNE_GAP_MS = 6 * 3_600_000;
/** The versions kept from before. */
export const EARLIER_KEPT = 4;
/** Commits since it was written that count as drift on their own. */
const COMMITS_STALE = 150;
/** The latest commits looked at for where the work is. */
const FOCUS_COMMITS = 30;

// ---------------------------------------------------------------- the kinds

interface Kind { id: string; label: string; why: string }

const SERVER = /^(?:Express|Fastify|Hono|Koa|NestJS|tRPC|FastAPI|Flask|Django|Django REST framework|Starlette|Tornado|aiohttp|Sanic|Gin|Echo|Fiber|chi|Gorilla Mux|Actix Web|Axum|Rocket|Warp|Rails|Sinatra|Laravel|Symfony|Slim|Spring Boot|Ktor|Micronaut|Quarkus|ASP\.NET Core|Vapor|GraphQL \(Apollo\))$/;
const FULLSTACK = /^(?:Next\.js|Nuxt|Remix|SvelteKit)$/;
const SITE = /^(?:Gatsby|Astro)$/;
const UI = /^(?:React|Vue|Svelte|Angular|Solid|Preact|Yew|Leptos)$/;
const MOBILE = /^(?:React Native|Expo|Flutter|Android|Jetpack Compose)$/;
const DESKTOP = /^(?:Electron|Tauri)$/;
const CLI = /^(?:Cobra|clap)$/;
const ML = /^(?:PyTorch|TensorFlow|Transformers|scikit-learn)$/;
const DATA_APP = /^(?:Streamlit|Gradio)$/;
const GAME = /^(?:Bevy)$/;

/**
 * The kinds of application the code shows, each with why: what a server framework, routes, a phone or desktop framework, a `bin`, a Worker's
 * config, a game engine, notebooks say. Several at once is common (a web service and the phone app it serves). By code, for nothing.
 */
export function kindsOf(i: Pick<OverviewInput, "structure" | "features" | "paths">): Kind[] {
  const out: Kind[] = [];
  const add = (id: string, label: string, why: string) => { if (!out.some((k) => k.id === id)) out.push({ id, label, why }); };
  const fw = i.structure.frameworks;
  const has = (re: RegExp) => fw.filter((f) => re.test(f));
  const routes = i.features.reduce((n, f) => n + f.routes.length, 0);
  const paths = i.paths;
  const anyPath = (re: RegExp) => paths.some((p) => re.test(p));
  const core = Object.values(i.structure.core);

  if (has(MOBILE).length || anyPath(/(?:^|\/)(?:AndroidManifest\.xml|[^/]+\.xcodeproj\/project\.pbxproj)$/)) {
    add("mobile", "a phone app", has(MOBILE).join(", ") || "an Android or iOS project");
  }
  if (has(DESKTOP).length) add("desktop", "a desktop app", has(DESKTOP).join(", "));
  if (has(FULLSTACK).length) add("fullstack", "a full-stack web app (pages and their server together)", has(FULLSTACK).join(", "));
  if (has(SERVER).length || routes >= 3) {
    add("service", "a web service (an HTTP API)", [has(SERVER).join(", "), routes ? `${routes} routes` : ""].filter(Boolean).join(", "));
  }
  if (anyPath(/(?:^|\/)wrangler\.(?:toml|jsonc?)$/)) add("edge", "serverless functions on Cloudflare Workers", "wrangler config");
  if (anyPath(/(?:^|\/)serverless\.ya?ml$/)) add("serverless", "serverless functions", "serverless.yml");
  if (has(SITE).length) add("site", "a website", has(SITE).join(", "));
  if (has(UI).length && !has(MOBILE).length && !has(FULLSTACK).length && !has(SITE).length && anyPath(/\.(?:tsx|jsx|vue|svelte)$/)) {
    add("webapp", "a web app in the browser", has(UI).join(", "));
  }
  const bin = core.some((e) => e.kind === "npm" && Array.isArray((e.data as { bin?: unknown }).bin) && ((e.data as { bin: unknown[] }).bin).length > 0);
  if (bin || has(CLI).length || anyPath(/(?:^|\/)cmd\/[^/]+\/main\.go$/)) add("cli", "a command-line tool", bin ? "a bin in package.json" : has(CLI).join(", ") || "cmd/*/main.go");
  if (has(DATA_APP).length) add("dataapp", "an interactive data app", has(DATA_APP).join(", "));
  if (has(ML).length || paths.filter((p) => p.endsWith(".ipynb")).length >= 3) add("ml", "machine-learning code", has(ML).join(", ") || "notebooks");
  if (has(GAME).length || anyPath(/(?:^|\/)(?:project\.godot|ProjectSettings\/ProjectVersion\.txt)$/)) add("game", "a game", has(GAME).join(", ") || "a game engine's project");
  if (paths.filter((p) => p.endsWith(".tf")).length >= 2) add("infra", "infrastructure as code", "Terraform");
  // A package others use: a manifest that publishes it, and none of the above.
  if (!out.length) {
    const lib = core.find((e) => e.kind === "npm" && !(e.data as { private?: boolean }).private && !!(e.data as { main?: string }).main);
    if (lib) add("library", "a library others use in their code", "a published package with an entry");
    else if (core.some((e) => ["pyproject", "cargo", "gomod"].includes(e.kind)) && !i.structure.entryPoints.length) add("library", "a library others use in their code", "a package with no app entry");
  }
  if (i.structure.monorepo && i.structure.monorepo.packages.length >= 2) add("monorepo", `several packages in one repo (${i.structure.monorepo.packages.length})`, i.structure.monorepo.tool);
  return out;
}

// ---------------------------------------------------------------- what the code and its history show it is

/**
 * A part that is the project's upkeep, not what it is: mostly tests, docs, data and config files (CI workflows, translations, fixtures). Work
 * there keeps the project going; it is not where the project is heading.
 */
export function upkeep(f: Pick<Feature, "files">): boolean {
  if (!f.files.length) return false;
  const product = f.files.filter((p) => !p.startsWith(".github/") && ["source", "markup"].includes(classOf(p))).length;
  return product / f.files.length < 0.5;
}

/** Where the work went: each part's share of the newest commits and of the ones before them; what rose, what is new, what faded. */
export interface Trajectory {
  recent: Array<{ part: string; share: number }>;
  earlier: Array<{ part: string; share: number }>;
  rising: string[];
  fresh: string[];
  fading: string[];
  recentCommits: number;
  earlierCommits: number;
}

/** The newest commits looked at as "recent": up to this many, and never more than half of what there is. */
const RECENT_COMMITS = 40;
/** An earlier window this small says nothing about a change. */
const EARLIER_MIN = 10;

/**
 * Where the work went, by code: the history's newest commits against the ones before, each part's share of the commits that touched it. A part
 * that took a fifth of the recent work and twice its earlier share is RISING; one with a tenth now and none before is NEW; one that had a fifth
 * and has a third of that now is FADING. What the project is becoming, read from what its people do, not from what anyone says.
 */
export function trajectoryOf(features: readonly Feature[], history: readonly CommitRecord[]): Trajectory {
  const owner = new Map<string, string>();
  for (const f of features) if (!upkeep(f)) for (const p of f.files) owner.set(p, f.name);
  const cut = Math.min(RECENT_COMMITS, Math.ceil(history.length / 2));
  const shares = (cs: readonly CommitRecord[]) => {
    const n = new Map<string, number>();
    let touched = 0;
    for (const c of cs) {
      const parts = new Set(c.files.map((p) => owner.get(p)).filter((x): x is string => !!x));
      if (parts.size) touched += 1;
      for (const k of parts) n.set(k, (n.get(k) ?? 0) + 1);
    }
    return { touched, list: [...n].map(([part, c]) => ({ part, share: touched ? c / touched : 0 })).sort((a, b) => b.share - a.share) };
  };
  const r = shares(history.slice(0, cut));
  const e = shares(history.slice(cut));
  const before = new Map(e.list.map((x) => [x.part, x.share]));
  const now = new Map(r.list.map((x) => [x.part, x.share]));
  const known = e.touched >= EARLIER_MIN;
  return {
    recent: r.list.slice(0, 8), earlier: e.list.slice(0, 8), recentCommits: r.touched, earlierCommits: e.touched,
    rising: known ? r.list.filter((x) => x.share >= 0.2 && before.has(x.part) && x.share >= 2 * before.get(x.part)!).map((x) => x.part) : [],
    fresh: known ? r.list.filter((x) => x.share >= 0.1 && !before.has(x.part)).map((x) => x.part) : [],
    fading: known ? e.list.filter((x) => x.share >= 0.2 && (now.get(x.part) ?? 0) <= x.share / 3).map((x) => x.part) : [],
  };
}

/**
 * The names a project's own screens and messages use most: the product as its people see it ("X0 Bot", "Xode"), which its folders rarely say.
 * Capitalised words and short runs of them, inside a text and not at its start (a sentence's first word, a label's only word); an acronym of
 * letters alone (API, URL) is a word of the trade, not a name. Three texts at least.
 */
export function namesIn(texts: ReadonlyArray<{ text: string; kind: string }>): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  // A word that opens a sentence may be a name or only capitalised for the sentence: it counts once the same word is seen inside one.
  const opening = new Map<string, number>();
  // How often each word is written in lower case: a name almost never is ("X0 Bot", "Xode"); a word of the language mostly is ("That", "You").
  const lower = new Map<string, number>();
  for (const t of texts) {
    if (t.kind === "setting") continue;
    // A catalog's key ("label.delete: Delete") or a message's code said as words ("daily limit: You've used ...") is not what a person reads.
    const said = t.kind === "i18n" || t.kind === "message" ? t.text.replace(/^[\w .[\]-]{1,40}: /, "") : t.text;
    // Names are read from what the product says in sentences: a list of proper nouns (a table of countries, "Falkland Islands") is data.
    if (said.split(/\s+/).length < 3 || !/(?<![\p{L}\p{N}])[a-z]/u.test(said)) continue;
    for (const w of said.match(/(?<![\p{L}\p{N}])[a-z][\p{L}\p{N}]*/gu) ?? []) lower.set(w, (lower.get(w) ?? 0) + 1);
    const seen = new Set<string>();
    const first = new Set<string>();
    for (const m of said.matchAll(/(?<![\p{L}\p{N}.'])([A-Z][\p{L}\p{N}]*(?:[ -][A-Z0-9][\p{L}\p{N}]*){0,2})(?![\p{L}\p{N}])/gu)) {
      const at = m.index ?? 0;
      // At a sentence's start its first word is capitalised for the sentence ("Ask X0 Bot anything"): the rest of the run is the name.
      const opens = at === 0 || /[.!?:]\s*$/.test(said.slice(0, at)) || said.slice(0, at).trim() === "";
      const run = m[1]!.split(/[ -]/);
      const name = opens ? run.slice(1).join(" ") : m[1]!;
      if (opens && run.length === 1) first.add(run[0]!);
      if (!name || name.length < 2 || /^[A-Z]{2,5}$/.test(name)) continue;
      seen.add(name);
    }
    for (const n of seen) counts.set(n, (counts.get(n) ?? 0) + 1);
    for (const n of first) opening.set(n, (opening.get(n) ?? 0) + 1);
  }
  // Judged by its uses inside sentences alone: a word written in lower case at least as often is a word of the language, not a name.
  const common = (n: string): boolean => { const w = n.split(" ")[0]!.toLowerCase(); return (lower.get(w) ?? 0) >= (counts.get(n) ?? 0); };
  for (const n of [...counts.keys()]) if (common(n)) counts.delete(n);
  for (const [n, c] of opening) if (counts.has(n)) counts.set(n, counts.get(n)! + c);
  return [...counts].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
}

/**
 * How out of date the README may be: how many of the latest commits came since it last changed, and the parts most of that work went to that it
 * never names. A README that has not moved while the work went elsewhere is a claim from before, not what the project is now.
 */
export function readmeAge(i: Pick<OverviewInput, "structure" | "features" | "history">): { since: number; away: string[] } | null {
  const rm = i.structure.readme;
  if (!rm) return null;
  const at = i.history.findIndex((c) => c.files.includes(rm.path));
  const since = at >= 0 ? at : i.history.length;
  const said = `${rm.title} ${rm.blurb}`.toLowerCase();
  const t = trajectoryOf(i.features, i.history.slice(0, since));
  const away = t.recent.filter((x) => x.share >= 0.2 && ![...words(x.part)].some((w) => said.includes(w))).map((x) => x.part).slice(0, 3);
  return { since, away };
}

// ---------------------------------------------------------------- the basis

const partKey = (f: Feature): string => f.key || f.name;
/** A short fingerprint of words: what the README and manifest say the project is. */
const fingerprint = (s: string): string => {
  let h = 2166136261;
  for (const c of s.toLowerCase().replace(/\s+/g, " ").trim()) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
};

/** The parts most of the latest commits touched: at least a quarter of the touches each, three at most. */
export function focusOf(features: readonly Feature[], history: readonly CommitRecord[]): string[] {
  const owner = new Map<string, string>();
  for (const f of features) if (!upkeep(f)) for (const p of f.files) owner.set(p, partKey(f));
  const touches = new Map<string, number>();
  let all = 0;
  for (const c of history.slice(0, FOCUS_COMMITS)) {
    const seen = new Set<string>();
    for (const p of c.files) { const k = owner.get(p); if (k && !seen.has(k)) { seen.add(k); touches.set(k, (touches.get(k) ?? 0) + 1); all += 1; } }
  }
  return [...touches].filter(([, n]) => all && n / all >= 1 / 4).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
}

export function basisOf(i: OverviewInput): OverviewBasis {
  const about = i.structure.about;
  return {
    kinds: kindsOf(i).map((k) => k.id).sort(),
    stack: [...i.structure.frameworks].slice(0, 16).sort(),
    said: fingerprint([i.structure.readme?.title ?? "", i.structure.readme?.blurb ?? "", about?.product ?? "", about?.text ?? ""].join("|")),
    owner: i.owner && (i.owner.for || i.owner.next) ? fingerprint(`${i.owner.for ?? ""}|${i.owner.next ?? ""}`) : "",
    parts: Object.fromEntries(i.features.map((f) => [partKey(f), f.fileCount])),
    files: i.structure.fileCount,
    focus: focusOf(i.features, i.history),
    names: namesIn(i.texts ?? []).slice(0, 2).map((n) => n.name),
  };
}

// ---------------------------------------------------------------- drift

const KIND_WORDS: Record<string, string> = {
  mobile: "a phone app", desktop: "a desktop app", fullstack: "a full-stack web app", service: "a web service", edge: "Cloudflare Workers",
  serverless: "serverless functions", site: "a website", webapp: "a web app", cli: "a command-line tool", dataapp: "a data app", ml: "machine-learning code",
  game: "a game", infra: "infrastructure as code", library: "a library", monorepo: "several packages",
};
const words = (s: string): Set<string> => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3));
/** Whether the overview says anything about a part: its name's words among the overview's parts. */
const covered = (o: Overview, part: string): boolean => {
  const w = words(part);
  return o.parts.some((p) => [...words(`${p.name} ${p.does} ${p.start}`)].some((x) => w.has(x)));
};

/**
 * How far the project has moved from what its overview was written from, and why, in plain words. By code, for nothing: run on every build.
 *   the owner said something new                       2      (their words win)
 *   a kind of application came or went                  2 each
 *   its README or manifest says something new           1
 *   a framework came or went                            0.4 each, 1.2 at most
 *   new parts and gone parts, by their share of files   3 × the share, 2 at most
 *   a part that doubled or halved, with 5% of the files 0.3 each
 *   the latest work is mostly where the overview is not 0.6 for each such part
 *   COMMITS_STALE commits since it was written          0.5
 */
export function driftOf(o: Overview, now: OverviewBasis, commitsSince: number): { score: number; reasons: string[] } {
  const was = o.basis;
  let score = 0;
  const reasons: string[] = [];
  if (now.owner && now.owner !== was.owner) { score += 2; reasons.push("the owner said what it is or where it goes"); }
  for (const k of now.kinds.filter((x) => !was.kinds.includes(x))) { score += 2; reasons.push(`it is now also ${KIND_WORDS[k] ?? k}`); }
  for (const k of was.kinds.filter((x) => !now.kinds.includes(x))) { score += 2; reasons.push(`it is no longer ${KIND_WORDS[k] ?? k}`); }
  if (now.said !== was.said) { score += 1; reasons.push("its README or manifest says something new about what it is"); }
  const came = now.stack.filter((x) => !was.stack.includes(x));
  const went = was.stack.filter((x) => !now.stack.includes(x));
  if (came.length || went.length) {
    score += Math.min(1.2, 0.4 * (came.length + went.length));
    reasons.push([came.length ? `built with ${came.join(", ")} now` : "", went.length ? `no longer with ${went.join(", ")}` : ""].filter(Boolean).join("; "));
  }
  const total = Math.max(1, now.files);
  const fresh = Object.entries(now.parts).filter(([k]) => !(k in was.parts));
  const gone = Object.entries(was.parts).filter(([k]) => !(k in now.parts));
  const share = [...fresh, ...gone].reduce((n, [, c]) => n + c, 0) / total;
  if (share > 0) {
    score += Math.min(2, 3 * share);
    if (fresh.length) reasons.push(`new parts: ${fresh.sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, c]) => `${k} (${c} files)`).join(", ")}`);
    if (gone.length) reasons.push(`parts gone: ${gone.slice(0, 4).map(([k]) => k).join(", ")}`);
  }
  for (const [k, c] of Object.entries(now.parts)) {
    const before = was.parts[k];
    if (before && Math.max(c, before) / total >= 0.05 && (c >= before * 2 || c * 2 <= before)) { score += 0.3; reasons.push(`${k} went from ${before} to ${c} files`); }
  }
  const nowName = now.names?.[0] ?? "";
  const wasName = was.names?.[0] ?? "";
  if (nowName && wasName && nowName !== wasName && !(was.names ?? []).includes(nowName)) { score += 1; reasons.push(`its screens now call it ${nowName} (they called it ${wasName})`); }
  const away = now.focus.filter((k) => !was.focus.includes(k) && !covered(o, k));
  // The work's main place moving is one fact: counted once, as "not covered" when the overview says nothing of it, else as the move.
  if (now.focus[0] && was.focus[0] && now.focus[0] !== was.focus[0] && !was.focus.includes(now.focus[0]) && !away.includes(now.focus[0])) {
    score += 0.5; reasons.push(`most of the latest work is now in ${now.focus[0]}, not ${was.focus[0]}`);
  }
  if (away.length) { score += 0.6 * away.length; reasons.push(`the latest work is mostly in ${away.join(", ")}, which the overview does not cover`); }
  if (commitsSince >= COMMITS_STALE) { score += 0.5; reasons.push(`${commitsSince} or more commits since it was written`); }
  return { score: Math.round(score * 100) / 100, reasons };
}

/** Commits since the overview was written: where its head is in the history, newest first; the whole history when it is older than that. */
export function commitsSince(o: Overview, history: readonly CommitRecord[]): number {
  const at = history.findIndex((c) => c.sha === o.commit);
  return at >= 0 ? at : history.length;
}

/**
 * Whether to write or tune the overview now, and why: there is none (or only the code's own while a model could write it), or it has drifted
 * TUNE_AT or more and the last tune is TUNE_GAP_MS old (the owner's new words do not wait). Null: keep it as it is.
 */
export function overviewDue(o: Overview | null, now: OverviewBasis, since: number, at: number, modelCan: boolean): string[] | null {
  if (!o) return ["first read"];
  if (o.via === "code" && modelCan) return ["the overview was the code's own, written with no model"];
  const d = driftOf(o, now, since);
  if (d.score < TUNE_AT) return null;
  const owner = !!now.owner && now.owner !== o.basis.owner;
  if (!owner && at - o.at < TUNE_GAP_MS) return null;
  return d.reasons;
}

// ---------------------------------------------------------------- what the model is given

const one = (s: string, n: number): string => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

/** The project as the overview's model reads it: the signals by code, the parts the index named, the owner's words, the latest work. */
/** Where a part starts: its entry point, else its most central file, else its first. */
const leadOf = (i: Pick<OverviewInput, "structure" | "rank">, f: Feature): string =>
  f.files.find((p) => i.structure.entryPoints.some((e) => e.path === p))
  ?? (i.rank ? [...f.files].sort((a, b) => (i.rank!.get(b) ?? 0) - (i.rank!.get(a) ?? 0))[0] : undefined)
  ?? f.files[0] ?? "";

export function overviewFacts(i: OverviewInput): string {
  const st = i.structure;
  const kinds = kindsOf(i);
  const lead = (f: Feature) => leadOf(i, f);
  return [
    `project: ${i.name}`,
    ...kinds.map((k) => `kind signal: ${k.label} (${k.why})`),
    ...(kinds.length ? [] : ["kind signal: none found by code; say what the parts show"]),
    st.languages.length ? `languages: ${st.languages.slice(0, 5).map((l) => `${l.lang} ${Math.round(l.pct)}%`).join(", ")}` : "",
    st.frameworks.length ? `built with: ${st.frameworks.slice(0, 14).join(", ")}` : "",
    `size: ${st.fileCount} files`,
    st.monorepo ? `packages: ${st.monorepo.packages.slice(0, 10).map((p) => `${p.path}${p.name ? ` (${p.name})` : ""}`).join(", ")}` : "",
    ...st.entryPoints.slice(0, 6).map((e) => `entry: ${e.path} (${e.why})`),
    st.docker.services.length ? `runs as services: ${st.docker.services.slice(0, 8).join(", ")}` : "",
    ...namesLines(i),
    ...trajectoryLines(i),
    ...readmeLines(i),
    st.about?.text ? `manifest says: ${one(`${st.about.product ? `${st.about.product}: ` : ""}${st.about.text}`, 300)}` : "",
    ...(i.owner?.for ? [`the owner says it is: ${one(i.owner.for, 400)}`] : []),
    ...(i.owner?.next ? [`the owner says next: ${one(i.owner.next, 300)}`] : []),
    ...(i.owner?.keep ? [`the owner says must not change: ${one(i.owner.keep, 200)}`] : []),
    ...i.features.slice(0, 12).map((f) => `part: ${f.name} | ${one(f.summary, 160)} | ${f.fileCount} files${f.routes.length ? `, routes ${f.routes.slice(0, 4).join(" ")}` : ""} | starts: ${lead(f)}`),
    ...i.messages.slice(0, 20).map((m) => `latest commit: ${one(m.split("\n")[0]!, 110)}`),
    ...i.messages.slice(20).filter((_, k) => k % 6 === 0).slice(0, 8).map((m) => `older commit: ${one(m.split("\n")[0]!, 110)}`),
  ].filter(Boolean).join("\n");
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;
/**
 * The names the product goes by on its own screens; and, when its README, manifest and folders call it something its screens do not, that
 * plainly: what its people see is its name now.
 */
function namesLines(i: OverviewInput): string[] {
  const n = namesIn(i.texts ?? []);
  if (!n.length) return [];
  const st = i.structure;
  const elsewhere = [st.readme?.title ?? "", st.about?.product ?? "", i.name.split("/").pop() ?? ""].filter(Boolean);
  const top = n[0]!.name;
  const other = elsewhere.find((x) => !x.toLowerCase().includes(top.toLowerCase()) && !top.toLowerCase().includes(x.toLowerCase()));
  // Where each name is said most: "Xode, mostly in Code" is the coding bot; "Blip, mostly in Experience" is the mascot, not the bot.
  const partOf = new Map<string, string>();
  for (const f of i.features) for (const p of f.files) partOf.set(p, f.name);
  const where = (name: string): string => {
    const tally = new Map<string, number>();
    for (const t of i.texts ?? []) if (t.path && partOf.has(t.path) && t.text.includes(name)) tally.set(partOf.get(t.path)!, (tally.get(partOf.get(t.path)!) ?? 0) + 1);
    const best = [...tally].sort((a, b) => b[1] - a[1])[0];
    return best ? `, mostly in ${best[0]}` : "";
  };
  return [
    `names its own screens and messages use most (what its people call it, and the services it names): ${n.map((x) => `${x.name} (${x.count}${where(x.name)})`).join(", ")}`,
    ...(other && n[0]!.count >= 10 ? [`its own screens call it ${top}; its README or folders call it ${other}: what its people see is its name now`] : []),
  ];
}
/** Where the work went, the newest commits against the ones before: what the project is becoming. */
function trajectoryLines(i: OverviewInput): string[] {
  const t = trajectoryOf(i.features, i.history);
  if (!t.recentCommits) return [];
  return [
    `where the latest work went (${t.recentCommits} commits): ${t.recent.slice(0, 6).map((x) => `${x.part} ${pct(x.share)}`).join(", ")}`,
    ...(t.earlierCommits ? [`where the work went before that (${t.earlierCommits} commits): ${t.earlier.slice(0, 6).map((x) => `${x.part} ${pct(x.share)}`).join(", ")}`] : []),
    ...(t.rising.length ? [`rising: ${t.rising.join(", ")}`] : []),
    ...(t.fresh.length ? [`new: ${t.fresh.join(", ")}`] : []),
    ...(t.fading.length ? [`fading: ${t.fading.join(", ")}`] : []),
  ];
}
/** The README as what it is: a claim, of an age, that the latest work may have left behind. */
function readmeLines(i: OverviewInput): string[] {
  const st = i.structure;
  if (!st.readme) return [];
  const age = readmeAge(i);
  const stale = !!age && age.away.length > 0 && age.since >= 10;
  return [
    `readme says: ${one(`${st.readme.title}. ${st.readme.blurb}`, 600)}`,
    ...(age ? [`readme last changed: ${age.since >= i.history.length ? `before the latest ${age.since} commits` : `${age.since} commits ago`}${stale ? `; most of the work since went to ${age.away.join(", ")}, which it does not name: it may be out of date` : ""}`] : []),
  ];
}

// ---------------------------------------------------------------- with no model

/** The code's own overview: the kinds, what the README or manifest says, the parts as the index named them. */
export function fallbackOverview(i: OverviewInput, basis: OverviewBasis, commit: string, at: number, earlier: Overview["earlier"] = []): Overview {
  const kinds = kindsOf(i);
  const st = i.structure;
  const said = i.owner?.for || st.readme?.blurb || st.about?.text || "";
  const lead = (f: Feature) => leadOf(i, f);
  const name = namesIn(i.texts ?? [])[0]?.name ?? st.about?.product ?? st.readme?.title ?? i.name.split("/").pop() ?? "";
  const first = said.split(/(?<=[.!?])\s+/)[0] ?? "";
  return {
    essence: one(first ? (first.toLowerCase().includes(name.toLowerCase()) ? first : `${name}: ${first}`) : name, 300),
    kind: kinds.length ? kinds.map((k) => k.label).join(", and ") : "",
    what: one(said, 500),
    parts: i.features.slice(0, 8).map((f) => ({ name: f.name, does: one(f.summary, 200), start: lead(f) })),
    flows: [], direction: "", via: "code", at, commit, basis, earlier,
  };
}

// ---------------------------------------------------------------- the model's answer, checked

export interface OverviewDraft { essence: string; kind: string; what: string; parts: Array<{ name: string; does: string; start: string }>; flows: string[]; direction: string }

/**
 * The model's overview, kept to what can be stood behind: each part's file a path the project has (or the folder's lead file when it named a
 * folder; nothing when neither), the lengths cut, empty parts and flows dropped. Null when it says nothing usable.
 */
export function checkedOverview(d: OverviewDraft, paths: readonly string[]): Omit<Overview, "via" | "at" | "commit" | "basis" | "earlier"> | null {
  const known = new Set(paths);
  const startOf = (s: string): string => {
    const p = s.trim().replace(/^\.\//, "").replace(/[`'"]/g, "").replace(/:\d+(?:-\d+)?$/, "");
    if (!p) return "";
    if (known.has(p)) return p;
    const named = paths.filter((x) => baseName(x) === baseName(p));
    if (named.length === 1) return named[0]!;
    const inFolder = paths.filter((x) => x.startsWith(`${p.replace(/\/+$/, "")}/`));
    return inFolder.find((x) => /(?:^|\/)(?:index|main|app|server|mod|__init__)\.[a-z]+$/i.test(x)) ?? "";
  };
  const parts = d.parts.map((p) => ({ name: one(p.name, 60), does: one(p.does, 220), start: startOf(p.start) })).filter((p) => p.name && p.does).slice(0, 8);
  const kind = one(d.kind, 160);
  const what = one(d.what, 600);
  const essence = one(d.essence ?? "", 300);
  if (!kind && !what && !essence) return null;
  // A model that echoes its instructions ("with before: it was...") is taken at its words, not at the echo.
  const direction = one(d.direction.replace(/^\s*(?:with\s+)?<?before>?\s*[:,-]\s*/i, ""), 300);
  return { essence, kind, what, parts, flows: d.flows.map((f) => one(f, 260)).filter(Boolean).slice(0, 3), direction: direction ? `${direction[0]!.toUpperCase()}${direction.slice(1)}` : "" };
}

// ---------------------------------------------------------------- the card

/** The overview as the project card shows it: what kind, what it does, the parts, how they connect, how its course changed. */
export function overviewLines(o: Overview): string[] {
  return [
    ...(o.essence ? [`- ${o.essence}`] : []),
    `- ${[o.kind && `${o.kind[0]!.toUpperCase()}${o.kind.slice(1)}`, o.what].filter(Boolean).join(". ").replace(/\.\./g, ".")}`,
    ...o.parts.map((p) => `- ${p.name}: ${p.does}${p.start ? ` (starts at ${p.start})` : ""}`),
    ...o.flows.map((f) => `- How it flows: ${f}`),
    ...(o.direction ? [`- How its course changed: ${o.direction}`] : []),
  ];
}

// ---------------------------------------------------------------- writing and tuning

/**
 * What tuning the overview outside a build may spend (one call, at the owner's new words). The gateway prices a call at its worst case before
 * it is made (all the input, every answer token), so this bounds that worst case; one costs about 3 paise.
 */
export const OVERVIEW_PAISE = 150;
/** The index's texts read for the names a project's screens use. */
export const OVERVIEW_TEXTS = 4_000;

/**
 * Writes the overview, or tunes the one there is with what moved (`changed`). The one it replaces is kept in `earlier` when it said something
 * else. No answer: the one there is stays as it was (its basis too, so the next build tries again), or the code's own when there is none.
 */
/** Words of the trade, true of any project of its kind: an overview made of them says nothing of this one. */
const TRADE = new Set([
  "app", "apps", "application", "applications", "api", "apis", "web", "website", "service", "services", "server", "backend", "frontend", "client",
  "user", "users", "data", "code", "project", "projects", "system", "platform", "tool", "tools", "software", "stack", "full", "starter", "template",
  "framework", "library", "database", "feature", "features", "module", "modules", "component", "components", "management", "core", "main", "src",
]);

/** The project's own words: the names its screens use, its manifest's and README's names, its parts' names, its routes' words. */
export function ownWords(i: OverviewInput): Set<string> {
  const st = i.structure;
  const out = new Set<string>();
  const add = (s: string) => { for (const w of words(s)) if (!TRADE.has(w) && !/^\d+$/.test(w)) out.add(w); };
  for (const n of namesIn(i.texts ?? [])) add(n.name);
  add(`${st.about?.product ?? ""} ${st.readme?.title ?? ""} ${i.name.split("/").pop() ?? ""}`);
  for (const f of i.features) { add(f.name); for (const r of f.routes) add(r.replace(/^[A-Z]+\s+/, "").replace(/[/:{}]/g, " ")); }
  for (const p of st.monorepo?.packages ?? []) add(p.name ?? "");
  return out;
}

/** The project's own words an overview's essence and summary use: fewer than two, and it could be said of any project of its kind. */
export function ownUsed(o: Pick<Overview, "essence" | "what">, own: ReadonlySet<string>): string[] {
  return [...words(`${o.essence} ${o.what}`)].filter((w) => own.has(w));
}

/**
 * Writes the overview, or tunes the one there is with what moved (`changed`). One that says what any project of its kind is (fewer than two of
 * the project's own words in what it is) is asked again, once, with those words named. The one it replaces is kept in `earlier` when it said
 * something else. No answer: the one there is stays as it was (its basis too, so the next build tries again), or the code's own when there is none.
 */
export async function tuneOverview(ctx: SummaryCtx, i: OverviewInput, prior: Overview | null, changed: readonly string[], commit: string, at: number, cap: number): Promise<Overview> {
  const basis = basisOf(i);
  const before = prior && prior.via === "model" ? { essence: prior.essence ?? "", kind: prior.kind, what: prior.what, parts: prior.parts, flows: prior.flows, direction: prior.direction } : null;
  const facts = overviewFacts(i);
  let checked = await writeOverview(ctx, facts, before, changed, cap).catch(() => null).then((d) => (d ? checkedOverview(d, i.paths) : null));
  const own = ownWords(i);
  if (checked && own.size >= 4 && ownUsed(checked, own).length < 2) {
    const named = [...own].slice(0, 12).join(", ");
    const again = await writeOverview(ctx, facts, before, changed, cap, `That says what any project of its kind is. Say what this one really is, in its own words (${named}), and what only it does.`)
      .catch(() => null).then((d) => (d ? checkedOverview(d, i.paths) : null));
    if (again && ownUsed(again, own).length > ownUsed(checked, own).length) checked = again;
  }
  if (!checked) return prior ?? fallbackOverview(i, basis, commit, at);
  const moved = !!prior && (prior.kind !== checked.kind || prior.what !== checked.what || (prior.essence ?? "") !== checked.essence);
  const earlier = moved
    ? [{ at: prior!.at, commit: prior!.commit, kind: prior!.kind, what: prior!.what, ...(prior!.essence ? { essence: prior!.essence } : {}) }, ...prior!.earlier].slice(0, EARLIER_KEPT)
    : prior?.earlier ?? [];
  // A kind that came or went is a change of course however the model words it.
  const kindsMoved = !!prior && prior.basis.kinds.join() !== basis.kinds.join();
  const direction = checked.direction || (kindsMoved && prior!.kind && prior!.kind !== checked.kind ? `It was ${prior!.kind}; it is now ${checked.kind}.` : before ? prior!.direction : "");
  return { ...checked, direction, via: "model", at, commit, basis, earlier };
}
