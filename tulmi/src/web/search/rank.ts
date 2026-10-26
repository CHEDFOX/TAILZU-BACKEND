/**
 * MERGING, DEDUPING AND RANKING WHAT THE SOURCES FOUND.
 *
 * Many sources answer one question, and the same page comes back from several
 * (a package from npm and from a search engine; a repository from GitHub and
 * from DuckDuckGo). Two results are the SAME when their addresses normalise to
 * one (lower-case host, no www, no #fragment, no tracking parameters, sorted
 * query, no trailing slash), or when they are one package or one repository
 * under two addresses (npmjs.com/package/x and the registry's own link;
 * github.com/o/r and github.com/o/r/). The copy with the better score is kept,
 * and the others add a little to it: a page that two independent sources both
 * found is more likely to be the right one.
 *
 * SCORE = source weight x intent fit x authority x freshness x position
 *
 *   source weight  how far the source is trusted in general (catalog.ts)
 *   intent fit     how well this KIND of result (package, repo, issue, question,
 *                  doc, story, article, page) answers this KIND of question:
 *                  an issue for an error, a registry entry for a package
 *   authority      the best evidence of who is speaking: the official docs host
 *                  (the documentation map), a registry, a GitHub repository with
 *                  stars, an issue that was closed after a discussion, an accepted
 *                  Stack Overflow answer; and less for padding sites (a mild
 *                  downrank), a deprecated package, an archived repository, a
 *                  question nobody answered
 *   freshness      only when the plan asks for it (year or month); a page
 *                  with no date is not punished much, and documentation and a
 *                  registry entry, which are kept up to date, not at all
 *   position       where the source itself put it, so a source's own order
 *                  still counts
 *
 * Every ranked result carries its score and the reasons in short phrases, so
 * a caller (or a person reading a log) can see why one page beat another.
 */
import { docsMatch, INTENT_FIT, isContentFarm, REGISTRY_HOSTS, SOURCE_WEIGHT } from "./catalog.js";
import { kindOfUrl } from "./sources/util.js";
import type { Ranked, Result, ResultSource, SearchPlan } from "./types.js";

/** A score at or over this counts as a strong result (enough to stop short of asking a search engine). */
export const STRONG_SCORE = 0.8;

const DAY = 86_400_000;

// ------------------------------------------------------------------ identity

const TRACKING = /^(?:utm_|fbclid$|gclid$|mc_|igshid$|_hs|ref$|ref_src$|cmpid$|source$|spm$)/i;

/** The address with every difference that does not change the page taken out. For comparing, not for fetching. */
export function normalizeResultUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const q = params.map(([k, v]) => `${k}=${v}`).join("&");
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : "";
    return `${host}${path}${q ? `?${q}` : ""}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** One key for one package or one repository, whichever of its addresses was found; else the normalised address. */
export function canonicalKey(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const segs = u.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
    if (host === "npmjs.com" && segs[0] === "package" && segs[1]) {
      return `npm:${(segs[1]!.startsWith("@") && segs[2] ? `${segs[1]}/${segs[2]}` : segs[1]!).toLowerCase()}`;
    }
    if (host === "pypi.org" && segs[0] === "project" && segs[1]) return `pypi:${segs[1]!.toLowerCase().replace(/[-_.]+/g, "-")}`;
    if (host === "crates.io" && segs[0] === "crates" && segs[1]) return `crates:${segs[1]!.toLowerCase()}`;
    if (host === "github.com" && segs.length === 2) return `gh:${segs[0]!.toLowerCase()}/${segs[1]!.toLowerCase().replace(/\.git$/, "")}`;
  } catch {
    /* fall through to the address */
  }
  return normalizeResultUrl(raw);
}

// ------------------------------------------------------------------- the score

const bareHost = (raw: string) => { try { return new URL(raw).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function kindOf(r: Result): string {
  const k = r.meta?.kind;
  return typeof k === "string" && k ? k : kindOfUrl(r.url);
}

function planNamesHost(plan: SearchPlan, url: string): boolean {
  const host = bareHost(url);
  let path = "";
  try { path = new URL(url).pathname; } catch { /* host only */ }
  return (plan.site ?? []).some((s) => {
    const slash = s.indexOf("/");
    const h = (slash < 0 ? s : s.slice(0, slash)).replace(/^www\./, "");
    const p = slash < 0 ? "" : s.slice(slash);
    return host === h && (!p || path === p || path.startsWith(`${p}/`));
  });
}

interface Weighed { v: number; why: string[] }

function authority(r: Result, kind: string, plan: SearchPlan): Weighed {
  const why: string[] = [];
  let v = 1;
  const m = r.meta ?? {};
  const docs = docsMatch(r.url);

  if (docs) { v = planNamesHost(plan, r.url) ? 1.45 : 1.35; why.push(planNamesHost(plan, r.url) ? "official docs the plan asked for" : "official docs"); }
  else if (r.source === "mdn") { v = 1.3; why.push("MDN"); }
  else if (kind === "package" && (r.source === "npm" || r.source === "pypi" || r.source === "crates" || REGISTRY_HOSTS.includes(bareHost(r.url)))) { v = 1.2; why.push("registry"); }
  else if (kind === "question") {
    if (m.accepted === true) { v = 1.25; why.push("accepted answer"); }
    else if (m.answered === true) { v = 1.1; why.push("answered"); }
    else { v = 0.85; why.push("unanswered"); }
    if (num(m.score) >= 20) { v += 0.05; why.push("well voted"); }
  } else if (kind === "issue") {
    const comments = num(m.comments);
    if (m.answered === true && comments >= 3) { v = 1.2; why.push("closed after discussion"); }
    else if (m.answered === true || m.state === "closed") { v = 1.1; why.push("closed issue"); }
    else { v = 0.95; }
    if (num(m.reactions) >= 5) v += 0.05;
  } else if (kind === "repo") {
    const stars = num(m.stars);
    v = stars >= 10_000 ? 1.2 : stars >= 1_000 ? 1.1 : 1;
    if (stars >= 1_000) why.push(`${stars >= 10_000 ? "10k+" : "1k+"} stars`);
  } else if (r.source === "wikipedia" || r.source === "hn") {
    v = 0.9;
  }

  if (isContentFarm(r.url)) { v *= 0.8; why.push("content farm"); }
  if (typeof m.deprecated === "string" && m.deprecated) { v *= m.deprecated.includes("archived") ? 0.6 : 0.5; why.push(m.deprecated.includes("archived") ? "archived" : "deprecated"); }
  return { v, why };
}

function freshness(plan: SearchPlan, r: Result, kind: string, now: number): Weighed {
  if (plan.freshness === "any") return { v: 1, why: [] };
  // Documentation and registry entries are kept current by their owners; their date, when there is one, is not their age.
  if (docsMatch(r.url) || r.source === "mdn" || (kind === "package" && r.published === undefined)) return { v: 1, why: [] };
  if (r.published === undefined) return { v: 0.85, why: [] };
  const age = (now - r.published) / DAY;
  const month = plan.freshness === "month";
  const steps: Array<[number, number]> = month ? [[30, 1], [90, 0.85], [365, 0.7]] : [[365, 1], [730, 0.8]];
  for (const [limit, v] of steps) if (age <= limit) return { v, why: v === 1 ? ["recent"] : [] };
  return { v: month ? 0.55 : 0.6, why: ["old"] };
}

function fit(plan: SearchPlan, kind: string): number {
  return INTENT_FIT[plan.intent][kind] ?? 0.6;
}

function exactName(plan: SearchPlan, r: Result): boolean {
  if (plan.intent !== "package_lookup" || typeof r.meta?.name !== "string") return false;
  const name = (r.meta.name as string).toLowerCase();
  return plan.queries.some((q) => q.trim().toLowerCase() === name);
}

/** One result's score and why, before duplicates are merged. */
export function scoreResult(plan: SearchPlan, r: Result, position: number, now: number): Ranked {
  const kind = kindOf(r);
  const a = authority(r, kind, plan);
  const f = freshness(plan, r, kind, now);
  const pos = Math.max(0.55, 1 / (1 + 0.07 * position));
  const exact = exactName(plan, r);
  const score = SOURCE_WEIGHT[r.source] * fit(plan, kind) * a.v * f.v * pos * (exact ? 1.25 : 1);
  return { ...r, score: round3(score), reasons: [...(exact ? ["exact name"] : []), ...a.why, ...f.why] };
}

// ------------------------------------------------------------------ the merge

export interface Group {
  source: ResultSource;
  results: Result[];
}

/**
 * Every group's results scored, the same page found twice merged into one, and
 * the best `limit` returned in order. Equal scores keep the order the groups
 * were given in (the more specific source first).
 */
export function rankResults(plan: SearchPlan, groups: Group[], now: number, limit: number): Ranked[] {
  const byKey = new Map<string, Ranked & { seen: ResultSource[] }>();
  const order: string[] = [];
  for (const g of groups) {
    g.results.forEach((r, i) => {
      if (!/^https?:\/\//i.test(r.url)) return;
      const scored = scoreResult(plan, r, i, now);
      const key = canonicalKey(r.url);
      const have = byKey.get(key);
      if (!have) {
        byKey.set(key, { ...scored, seen: [r.source] });
        order.push(key);
        return;
      }
      if (!have.seen.includes(r.source)) have.seen.push(r.source);
      // The better copy is kept, with the other's facts filling what it lacks.
      const [best, other] = scored.score > have.score ? [scored, have] : [have, scored];
      byKey.set(key, {
        ...best,
        snippet: best.snippet || other.snippet,
        meta: { ...(other.meta ?? {}), ...(best.meta ?? {}) },
        ...(best.published === undefined && other.published !== undefined ? { published: other.published } : {}),
        seen: have.seen,
      });
    });
  }
  const merged = order.map((k) => {
    const { seen, ...r } = byKey.get(k)!;
    const extra = seen.length - 1;
    if (extra <= 0) return r;
    return { ...r, score: round3(r.score * (1 + 0.06 * Math.min(extra, 3))), reasons: [...r.reasons, `also found via ${seen.filter((s) => s !== r.source).join(", ")}`] };
  });
  return merged
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.score - a.r.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.r);
}
