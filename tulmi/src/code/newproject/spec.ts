/**
 * THE SPEC, AND THE STACK: WHAT TO BUILD, WRITTEN BY THE STRONG TIER, AND WHAT TO BUILD IT WITH, CHOSEN BY RULES.
 *
 *   buildSpec(intake, { model }) -> Spec     the strong tier turns the request and the answers into
 *                                            { name, summary, users, platforms, features, nonGoals, dataModel,
 *                                              surfaces: { screens, endpoints }, risks, assumptions, needs }
 *   chooseStack(spec, intake)    -> Stack    rules first, each with its reason, and no model
 *
 * THE SPEC is the one place a new project needs a strong model: turning a vague wish into
 * a small, concrete, buildable list. The model is told to prefer the smallest thing that
 * works, to put every guess in `assumptions` instead of passing it off as a requirement,
 * and to keep the first version to six must-haves. What comes back is checked and cut to
 * size. If no model can be had (it is down, or the money is out) the spec is what the
 * person's answers say, plainly (specFromIntake, `source: "rules"`), so planning is never
 * blocked on a model; it is just less clever, and says so.
 *
 * THE STACK is not a model's taste. The rules, in this order:
 *
 *   1. what the person said they want wins: "Next.js", "Flutter", "FastAPI", "on Vercel".
 *      A framework Tailzu cannot set up yet (Rails, Laravel, Go...) is named, and the
 *      nearest one it can is used, said plainly.
 *   2. phones (iOS, Android) and not the web: Expo, one TypeScript codebase for both
 *   3. a website that search engines should find (public pages, a shop, a blog): Next.js
 *   4. a website behind a login, a dashboard, a tool: Vite + React, a plain single-page app
 *   5. an API: FastAPI when the work is Python's (data, AI, documents, scraping), else Fastify
 *   6. people sign in or data is kept: Supabase (Postgres and sign-in, with row-level security)
 *   7. hosting, free tiers first: Vercel for Next.js, Cloudflare Pages for a single-page
 *      app, Supabase free for the data, Render's free web service for an API, Expo's free
 *      build tier for an app; hosting they already have wins
 *
 * Each rule leaves a reason in plain words, and `preference` records what was asked and
 * whether it was done.
 */
import { z } from "zod";
import { askJson, cut, fence, forModel, oneLine, type ModelCtx } from "../work/model.js";
import { FEATURE_CUE_WORDS } from "./words.js";
import { PLATFORMS, type Needs, type Platform, type Priority, type Spec, type SpecFeature, type Stack, type StackKind, type StackPart } from "./types.js";

export interface IntakeText { request: string; answers: Partial<Record<string, string>> }

const NONE = "(no preference: you decide)";
const given = (v: string | undefined): string => (v && v !== NONE ? v : "");

// --------------------------------------------------------------------- the spec

const SpecReply = z.object({
  name: z.string().min(1),
  summary: z.string().min(1),
  users: z.array(z.string()).max(8),
  platforms: z.array(z.string()).max(6),
  features: z.array(z.object({ name: z.string().min(1), description: z.string(), priority: z.string() })).max(16),
  nonGoals: z.array(z.string()).max(10),
  dataModel: z.array(z.object({ entity: z.string(), fields: z.array(z.string()).max(20) })).max(12),
  screens: z.array(z.object({ name: z.string(), purpose: z.string() })).max(15).optional(),
  endpoints: z.array(z.object({ method: z.string(), path: z.string(), purpose: z.string() })).max(20).optional(),
  risks: z.array(z.string()).max(6),
  assumptions: z.array(z.string()).max(10),
  needs: z.object({ auth: z.boolean(), database: z.boolean(), payments: z.boolean(), seo: z.boolean(), realtime: z.boolean(), files: z.boolean(), ai: z.boolean() }),
});
type SpecReply = z.infer<typeof SpecReply>;

const SYSTEM =
  "You are a product planner. A person has an idea for a software project and has answered a few questions. Write a small, concrete spec for a FIRST version that a developer can build. "
  + "Prefer the smallest thing that works. Do not invent requirements: anything the person did not say that you had to guess goes in `assumptions`, not in the features. "
  + "Features: at most 12, each with priority \"must\" (in the first version; six at most), \"should\" or \"later\". platforms: any of web, ios, android, desktop, api, cli. "
  + "nonGoals: what the first version is NOT. dataModel: the main things the app keeps, with field names only. screens for an app or site, endpoints for an API (a few each). "
  + "risks: real ones (law, safety, privacy, cost, a hard part), five at most. needs: auth (people sign in), database (data is kept), payments, seo (public pages that search engines should find), realtime, files (uploads), ai. "
  + 'Answer with JSON {"name","summary","users":[],"platforms":[],"features":[{"name","description","priority"}],"nonGoals":[],"dataModel":[{"entity","fields":[]}],"screens":[{"name","purpose"}],"endpoints":[{"method","path","purpose"}],"risks":[],"assumptions":[],"needs":{"auth","database","payments","seo","realtime","files","ai"}}.';

const strings = (xs: readonly unknown[], n: number, max: number): string[] => xs.map((x) => oneLine(x, max)).filter(Boolean).slice(0, n);

const PRIORITIES: readonly Priority[] = ["must", "should", "later"];

/** A model's spec as it is kept: sizes cut, the vocabulary held to, at most six musts. */
export function cleanSpec(r: SpecReply): Spec {
  const platforms = [...new Set(r.platforms.map((p) => p.toLowerCase().trim()).filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p)))];
  let musts = 0;
  const features: SpecFeature[] = r.features.map((f): SpecFeature => {
    let priority = (PRIORITIES as readonly string[]).includes(f.priority.toLowerCase()) ? (f.priority.toLowerCase() as Priority) : "should";
    if (priority === "must" && ++musts > 6) priority = "should";
    return { name: oneLine(f.name, 80), description: oneLine(f.description, 240), priority };
  }).filter((f) => f.name);
  return {
    name: oneLine(r.name, 60) || "New project", summary: oneLine(r.summary, 500), users: strings(r.users, 8, 120), platforms: platforms.length ? platforms : ["web"],
    features, nonGoals: strings(r.nonGoals, 10, 200),
    dataModel: r.dataModel.map((d) => ({ entity: oneLine(d.entity, 60), fields: strings(d.fields, 20, 60) })).filter((d) => d.entity),
    surfaces: {
      screens: (r.screens ?? []).map((s) => ({ name: oneLine(s.name, 80), purpose: oneLine(s.purpose, 160) })).filter((s) => s.name).slice(0, 15),
      endpoints: (r.endpoints ?? []).map((e) => ({ method: oneLine(e.method, 10).toUpperCase(), path: oneLine(e.path, 120), purpose: oneLine(e.purpose, 160) })).filter((e) => e.path).slice(0, 20),
    },
    risks: strings(r.risks, 6, 240), assumptions: strings(r.assumptions, 10, 240), needs: { ...r.needs }, source: "model",
  };
}

// ----------------------------------------------------------- the spec by rules

const has = (t: string, re: RegExp): boolean => re.test(t);

/** Platforms a text names. */
export function platformsOf(t: string): Platform[] {
  const out = new Set<Platform>();
  if (has(t, /\b(web ?site|web ?app|webapp|web|browser|pwa|saas|landing page|online store|online shop)\b/i)) out.add("web");
  if (has(t, /\b(ios|iphone|ipad|apple app)\b/i)) out.add("ios");
  if (has(t, /\bandroid\b/i)) out.add("android");
  if (has(t, /\b(mobile|phone app|smartphone)\b/i)) { out.add("ios"); out.add("android"); }
  if (has(t, /\b(desktop|windows app|mac app|macos|electron)\b/i)) out.add("desktop");
  if (has(t, /\b(api|backend|rest|graphql|webhook)\b/i)) out.add("api");
  if (has(t, /\b(cli|command[- ]line|terminal tool)\b/i)) out.add("cli");
  return [...out];
}

/** Needs a text implies. */
export function needsOf(t: string, platforms: readonly Platform[]): Needs {
  const auth = has(t, /\b(log ?in|sign ?(?:up|in)|accounts?|auth(?:entication)?|passwords?|profiles?|members?)\b/i);
  const payments = has(t, /\b(pay(?:ments?|ing)?|checkout|subscriptions?|billing|invoices?|stripe|razorpay|upi|buy|sell|cart|orders?)\b/i);
  const files = has(t, /\b(upload|photos?|images?|documents?|files?|pdfs?|attachments?)\b/i);
  const ai = has(t, /\b(ai|gpt|llm|chatbot|summari[sz]e|generate|recommend(?:ation)?s?)\b/i);
  const realtime = has(t, /\b(chat|live|real[- ]?time|notifications?|multiplayer)\b/i);
  const database = auth || payments || files || has(t, /\b(save|store|history|bookings?|appointments?|inventory|records?|data|tracker|list of|manage)\b/i);
  const seo = platforms.includes("web") && has(t, /\b(seo|blog|marketplace|store|shop|landing|public|listings?|directory|content|portfolio|magazine|news)\b/i);
  return { auth, database, payments, seo, realtime, files, ai };
}

const split = (s: string): string[] =>
  s.split(/\n|;|,|\band\b|•|(?:^|\s)\d+[.)]\s+|\s[-*]\s/i).map((x) => x.replace(/^[\s\-*•\d.)]+/, "").replace(/\.$/, "").trim()).filter((x) => x.length >= 3 && x.length <= 120);

/** The spec the person's own words make, with no model. Plain, and never more than they said. */
export function specFromIntake(intake: IntakeText): Spec {
  const all = [intake.request, ...Object.values(intake.answers).map((a) => given(a))].filter(Boolean).join("\n");
  const first = given(intake.answers.what) || intake.request;
  const platforms = platformsOf(given(intake.answers.platforms) || all);
  const assumptions: string[] = [];
  if (!platforms.length) { platforms.push("web"); assumptions.push("You did not say where it should run, so this assumes a website."); }
  const wanted = split(given(intake.answers.features) || intake.request).filter((f) => !/^(?:i want|i need|build|make|create)\b/i.test(f)).slice(0, 12);
  const named = wanted.length ? wanted : [...new Set((all.match(FEATURE_CUE_WORDS) ?? []).map((w) => w.toLowerCase()))].slice(0, 6);
  const features: SpecFeature[] = named.map((n, i) => ({ name: cut(n.charAt(0).toUpperCase() + n.slice(1), 80), description: "", priority: i < 6 ? "must" : "later" }));
  if (!features.length) assumptions.push("You did not list features, so the first milestones are the foundation only; say what it must do and the plan grows.");
  const m = /\b(?:an?|the)\s+(?:([a-z][\w'-]*(?:\s+[a-z][\w'-]*){0,3}?)\s+)?(app|application|site|website|platform|tool|marketplace|dashboard|bot|portal|store|tracker|planner|manager|system|game)\b/i.exec(first);
  const audience = /\bfor ((?:\w+ ){0,3}\w+)/i.exec(first)?.[1];
  const needs = needsOf(all, platforms);
  return {
    name: m?.[1] ? cut(`${m[1]} ${m[2]}`.replace(/\b\w/g, (c) => c.toUpperCase()), 40) : "New project", summary: oneLine(first, 500) || "A new project.",
    users: audience ? [oneLine(audience, 120)] : ["the people it is for (not said yet)"], platforms, features,
    nonGoals: ["Anything not listed above: it can come after the first version."], dataModel: [], surfaces: { screens: [], endpoints: [] },
    risks: ["This plan was made from your words alone, without a model's help. Read it, and correct what is wrong before building."],
    assumptions, needs, source: "rules",
  };
}

export interface SpecCtx { model: ModelCtx }

/** The spec: the strong tier's, or the plain one if no model can be had. Never throws. */
export async function buildSpec(intake: IntakeText, ctx: SpecCtx): Promise<Spec> {
  const answers = Object.entries(intake.answers).filter(([, v]) => v).map(([k, v]) => `<answer question="${k}">${fence(cut(forModel(v!), 1200))}</answer>`).join("\n");
  const r = await askJson(ctx.model, {
    tier: "strong", purpose: "work.spec", schema: SpecReply, maxTokens: 3500, system: SYSTEM,
    user: `<request>\n${fence(cut(forModel(intake.request), 2000))}\n</request>\n${answers}`,
  });
  if (!r.ok) return specFromIntake(intake);
  const spec = cleanSpec(r.value);
  // A spec with nothing to build is no better than the plain one.
  return spec.features.length ? spec : { ...specFromIntake(intake), name: spec.name, summary: spec.summary || specFromIntake(intake).summary };
}

// -------------------------------------------------------------------- the stack

interface Preference { kind?: StackKind; said?: string; unsupported?: string; python?: boolean; hosting?: string; database?: string }

const KINDS: Array<[RegExp, StackKind, string, string?]> = [
  [/\bnext(?:\.?js)?\b/i, "next", "Next.js"],
  [/\bnuxt(?:\.?js)?\b/i, "vite-vue", "Nuxt", "Nuxt"],
  [/\bsvelte(?:kit)?\b/i, "vite-svelte", "Svelte"],
  [/\bvue(?:\.?js)?\b/i, "vite-vue", "Vue"],
  [/\b(?:expo|react[- ]native)\b/i, "expo", "React Native with Expo"],
  [/\bflutter\b/i, "flutter", "Flutter"],
  [/\bfastapi\b/i, "fastapi", "FastAPI"],
  [/\bdjango\b/i, "django", "Django"],
  [/\bflask\b/i, "fastapi", "Flask", "Flask"],
  [/\bfastify\b/i, "fastify", "Fastify"],
  [/\bexpress(?:\.?js)?\b/i, "express", "Express"],
  [/\bnest(?:\.?js)?\b/i, "fastify", "NestJS", "NestJS"],
  [/\bangular\b/i, "vite-react", "Angular", "Angular"],
  [/\b(?:ruby on rails|rails)\b/i, "fastify", "Rails", "Rails"],
  [/\blaravel\b|\bphp\b/i, "fastify", "PHP", "PHP"],
  [/\bspring(?: boot)?\b|\bjava\b/i, "fastify", "Java", "Java"],
  [/\bgolang\b|\bgo (?:lang|api|backend|service)\b/i, "fastify", "Go", "Go"],
  [/\brust\b/i, "fastify", "Rust", "Rust"],
  [/\b(?:\.net|dotnet|c#|asp\.net)\b/i, "fastify", ".NET", ".NET"],
  [/\breact\b/i, "vite-react", "React"],
];
const HOSTS: Array<[RegExp, string]> = [
  [/\bvercel\b/i, "Vercel"], [/\bnetlify\b/i, "Netlify"], [/\bcloudflare\b/i, "Cloudflare"], [/\brender\b/i, "Render"], [/\brailway\b/i, "Railway"], [/\bfly\.?io\b/i, "Fly.io"],
  [/\bheroku\b/i, "Heroku"], [/\baws\b|\bamazon web services\b/i, "AWS"], [/\bgcp\b|\bgoogle cloud\b/i, "Google Cloud"], [/\bazure\b/i, "Azure"], [/\bdigital ?ocean\b/i, "DigitalOcean"],
  [/\bhostinger\b/i, "Hostinger"], [/\b(?:my own|own) (?:server|vps)\b|\bvps\b/i, "your own server"],
];
const DATABASES: Array<[RegExp, string]> = [
  [/\bsupabase\b/i, "Supabase"], [/\bfirebase\b|\bfirestore\b/i, "Firebase"], [/\bmongo(?:db)?\b/i, "MongoDB"], [/\bmysql\b/i, "MySQL"], [/\bpostgres(?:ql)?\b/i, "PostgreSQL"], [/\bsqlite\b/i, "SQLite"],
];

/** What a text says about the stack the person wants. */
export function preferenceOf(text: string): Preference {
  const out: Preference = {};
  for (const [re, kind, said, unsupported] of KINDS) {
    if (re.test(text)) { out.kind = kind; out.said = said; if (unsupported) out.unsupported = unsupported; break; }
  }
  if (/\bpython\b/i.test(text)) out.python = true;
  const host = HOSTS.find(([re]) => re.test(text));
  if (host) out.hosting = host[1];
  const db = DATABASES.find(([re]) => re.test(text));
  if (db) out.database = db[1];
  return out;
}

const LABEL: Record<StackKind, { label: string; language: Stack["language"]; app: StackPart["role"]; tests: string }> = {
  next: { label: "Next.js (App Router, TypeScript)", language: "TypeScript", app: "app", tests: "Vitest" },
  "vite-react": { label: "Vite + React (TypeScript)", language: "TypeScript", app: "app", tests: "Vitest" },
  "vite-vue": { label: "Vite + Vue (TypeScript)", language: "TypeScript", app: "app", tests: "Vitest" },
  "vite-svelte": { label: "Vite + Svelte (TypeScript)", language: "TypeScript", app: "app", tests: "Vitest" },
  expo: { label: "React Native with Expo (TypeScript)", language: "TypeScript", app: "mobile", tests: "Jest" },
  flutter: { label: "Flutter (Dart)", language: "Dart", app: "mobile", tests: "flutter_test" },
  fastapi: { label: "FastAPI (Python)", language: "Python", app: "api", tests: "pytest" },
  fastify: { label: "Fastify (TypeScript)", language: "TypeScript", app: "api", tests: "Vitest" },
  express: { label: "Express (TypeScript)", language: "TypeScript", app: "api", tests: "Vitest" },
  django: { label: "Django (Python)", language: "Python", app: "api", tests: "Django's test runner" },
};

const PY_WORK = /\b(data|ml|machine learning|ai|pdf|scrap\w*|analytics|pandas|numpy|nlp|ocr|science|etl|automation|documents?)\b/i;

/** The first stack the spec and the person's words point to, with the reasons. */
export function chooseStack(spec: Spec, intake: Partial<IntakeText> = {}): Stack {
  const said = [intake.request ?? "", given(intake.answers?.constraints), given(intake.answers?.platforms)].filter(Boolean).join("\n");
  const pref = preferenceOf(said);
  const platforms = spec.platforms;
  const mobile = platforms.includes("ios") || platforms.includes("android");
  const web = platforms.includes("web");
  const reasons: string[] = [];
  let kind: StackKind;
  let preference: Stack["preference"] = null;
  let later: StackKind[] = [];

  if (pref.kind) {
    kind = pref.kind;
    const note = pref.unsupported ? `Tailzu cannot set up ${pref.unsupported} yet, so ${LABEL[kind].label} is the nearest it can` : undefined;
    preference = { said: pref.said ?? LABEL[kind].label, honoured: !pref.unsupported, ...(note ? { note } : {}) };
    reasons.push(pref.unsupported
      ? `You said you would like ${pref.unsupported}. Tailzu cannot set that up yet, so it starts with ${LABEL[kind].label}, the nearest it can.`
      : `You said you would like ${pref.said}, so that is what it is built with.`);
    if (mobile && !web && (kind === "next" || kind.startsWith("vite"))) reasons.push("That is a website framework: it will work on phones in the browser. For an installable app on iPhone and Android, Expo would be the next step.");
  } else if (mobile && !web) {
    kind = "expo";
    reasons.push("It has to run on phones, and Expo builds iPhone and Android apps from one TypeScript codebase, with free builds to start.");
  } else if (web) {
    if (spec.needs.seo) {
      kind = "next";
      reasons.push("It is a website that people should find on Google. Next.js draws its pages on the server, so search engines can read them, and it is the most common choice for this.");
    } else {
      kind = "vite-react";
      reasons.push("It is an app people use after they arrive (not pages for search engines to find), so a plain single-page app with Vite and React is the simplest thing that works, and it is cheap to host.");
    }
    if (mobile) { later = ["expo"]; reasons.push("The phone apps come after the website, with Expo, sharing what the website learned."); }
  } else if (platforms.includes("api") || platforms.includes("cli") || platforms.includes("desktop")) {
    const python = pref.python || PY_WORK.test(`${spec.summary} ${spec.features.map((f) => f.name).join(" ")}`) || spec.needs.ai;
    if (platforms.includes("desktop") && !platforms.includes("api")) {
      kind = "vite-react";
      reasons.push("A desktop app starts well as a web app in the same technology, which can be wrapped as a desktop app later (with Tauri or Electron) once it works.");
    } else {
      kind = python ? "fastapi" : "fastify";
      reasons.push(python
        ? "It is an API, and the work is the kind Python does best (data, documents, AI), so FastAPI: fast to write, and it documents itself."
        : "It is an API, and Fastify is a fast, small TypeScript server with good defaults.");
    }
  } else {
    kind = "vite-react";
    reasons.push("Nothing says where it should run, so it starts as a website with Vite and React, the simplest thing that works.");
  }

  const info = LABEL[kind];
  const parts: StackPart[] = [{ role: info.app, name: info.label, why: reasons[0]! }];
  parts.push({ role: "tests", name: info.tests, why: "so each milestone can be checked by running the tests, not by taking anyone's word" });

  const needsData = spec.needs.auth || spec.needs.database;
  if (needsData) {
    const db = pref.database && pref.database !== "Supabase" ? pref.database : "Supabase";
    if (db === "Supabase") {
      parts.push({ role: "database", name: "Supabase (Postgres)", why: "free to start, real Postgres you can leave with, and row-level security keeps one person's data from another's" });
      if (spec.needs.auth) parts.push({ role: "auth", name: "Supabase Auth", why: "sign-in is already built and safe, so you do not build passwords yourself" });
      reasons.push("Data and sign-in go in Supabase: Postgres and ready-made sign-in on a free tier, with row-level security.");
    } else {
      parts.push({ role: "database", name: db, why: `you asked for it${["Firebase", "MongoDB", "MySQL"].includes(db) ? "; Tailzu does not set it up for you yet, so that part is wired by hand in a milestone" : ""}` });
      reasons.push(`Data goes in ${db}, as you asked.`);
      if (preference) preference = { ...preference, note: preference.note ?? `${db} is not set up automatically yet` };
      else preference = { said: db, honoured: true, note: `${db} is not set up automatically yet` };
    }
  }
  if (spec.needs.payments) {
    const india = /\b(india|inr|₹|rs\.?|upi|razorpay)\b/i.test(`${said} ${spec.summary}`);
    parts.push({ role: "payments", name: india ? "Razorpay" : "Stripe", why: india ? "it takes UPI and Indian cards, and has a test mode to build against" : "the standard way to take cards, with a test mode to build against" });
  }

  // Hosting: what they already have, else a free tier.
  let hosting: Stack["hosting"];
  if (pref.hosting) {
    hosting = { name: pref.hosting, tier: "yours", note: "the hosting you said you already have" };
    reasons.push(`It is set up to run on ${pref.hosting}, which you said you already have.`);
  } else if (kind === "next") {
    hosting = { name: "Vercel", tier: "free", note: "free on the Hobby plan, which is for personal projects: a business should check Vercel's terms, or use Cloudflare or Render instead" };
  } else if (kind.startsWith("vite")) {
    hosting = { name: "Cloudflare Pages", tier: "free", note: "free, with no limit on traffic for a static site, and fine for a business; Netlify's free plan is the same idea" };
  } else if (kind === "expo" || kind === "flutter") {
    hosting = { name: "Expo EAS (builds) and the app stores", tier: "free", note: "builds are free to start; the stores charge you, not Tailzu: $25 once for Google Play, $99 a year for Apple" };
  } else {
    hosting = { name: "Render", tier: "free", note: "a free web service that sleeps when nobody is using it and takes a few seconds to wake" };
  }
  if (hosting.tier === "free" && !reasons.some((r) => r.includes("free"))) reasons.push(`It runs on ${hosting.name}'s free tier to start, so it costs nothing until it has users.`);
  parts.push({ role: "hosting", name: hosting.name, why: hosting.note });

  return { kind, label: info.label, language: info.language, later, parts, hosting, preference, reasons };
}
