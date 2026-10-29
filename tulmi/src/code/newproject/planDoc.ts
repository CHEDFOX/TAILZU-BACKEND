/**
 * PLAN.md: THE PLAN A PERSON CAN READ, ARGUE WITH, AND HOLD THE BOT TO.
 *
 *   planMarkdown(spec, stack) -> the text of PLAN.md
 *   planMilestones(spec, stack) -> the milestones in it, as data (milestones.ts runs each on its own branch)
 *
 * Its sections, in order:
 *
 *   Goals           what it is for, who uses it, where it runs; what is in the first version,
 *                   and what is not
 *   Stack           what it is built with, and a reason for each part
 *   Data, Screens   what it keeps and what a person sees (or the endpoints of an API)
 *   Milestones      M0 (scaffold, CI, a preview link) to the last (launch readiness); each has its
 *                   scope, acceptance criteria written as things a person can check, and the
 *                   commands that must pass
 *   Risks           and what was assumed
 *   Definition of done
 *   Hand-off        how to run it on their own host: what to connect, the build settings, the
 *                   environment variables by name, the database, a domain, and how to take
 *                   Tailzu's access away
 *
 * The milestones are made from the spec by a fixed recipe, with no model: M0 is always the
 * scaffold, CI and a preview; then accounts and data when the spec needs them; then the
 * must-haves three at a time; then the should-haves; then launch readiness. A milestone is a
 * branch `tailzu/m<k>-<slug>` and a draft pull request whose body is its acceptance checklist.
 * Pure: the same spec and stack give the same file.
 */
import type { PlanMilestone, Spec, SpecFeature, Stack, StackKind } from "./types.js";

// --------------------------------------------------------------------- checks

/** The commands a milestone of this stack must pass. */
export function checksFor(kind: StackKind): string[] {
  switch (kind) {
    case "next": case "vite-react": return ["npx tsc --noEmit", "npm run lint", "npm test", "npm run build"];
    case "vite-vue": case "vite-svelte": return ["npm run lint", "npm test", "npm run build"];
    case "fastify": case "express": return ["npm run typecheck", "npm test", "npm run build"];
    case "expo": return ["npx tsc --noEmit", "npm test"];
    case "flutter": return ["flutter analyze", "flutter test"];
    case "fastapi": return ["python -m pytest -q"];
    case "django": return ["python manage.py check", "python manage.py test"];
  }
}

const isWeb = (k: StackKind): boolean => k === "next" || k.startsWith("vite");
const isApi = (k: StackKind): boolean => k === "fastapi" || k === "fastify" || k === "express" || k === "django";

// ---------------------------------------------------------------- milestones

const platformWords = (spec: Spec): string => {
  const names: Record<string, string> = { web: "the website", ios: "iPhone", android: "Android", desktop: "the desktop", api: "the API", cli: "the command line" };
  const list = spec.platforms.map((p) => names[p] ?? p);
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0] ?? "the app";
};

const group = <T>(xs: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

function featureMilestone(k: number, label: string, fs: readonly SpecFeature[], spec: Spec, stack: Stack): PlanMilestone {
  const acceptance: string[] = [];
  for (const f of fs) {
    acceptance.push(`${f.name}${f.description ? `: ${f.description.replace(/\.$/, "")}` : ""} works from start to finish on ${platformWords(spec)}.`);
  }
  acceptance.push("Each of these has a test for its main path.", "Empty, loading and error states are handled, not left blank.", "No secret, key or password is in the code or in git.");
  if (spec.needs.payments && fs.some((f) => /pay|checkout|subscri|billing|order|cart|buy/i.test(f.name))) acceptance.push("Payments work in test mode only; no real money moves until the launch checklist is done.");
  if (spec.needs.ai && fs.some((f) => /ai|chat|generat|summar|recommend/i.test(f.name))) acceptance.push("Calls to a model have a cost cap per person, and a failure shows a plain message.");
  return {
    k, title: `${label}: ${fs.map((f) => f.name).join(", ")}`.slice(0, 90),
    scope: fs.map((f) => `${f.name}${f.description ? `: ${f.description}` : ""}`), acceptance, checks: checksFor(stack.kind),
  };
}

export function planMilestones(spec: Spec, stack: Stack): PlanMilestone[] {
  const checks = checksFor(stack.kind);
  const ms: PlanMilestone[] = [];
  const host = stack.hosting.name;
  ms.push({
    k: 0, title: "Scaffold, CI and preview",
    scope: [
      `Set up ${stack.label} with its official starter, in this repo.`,
      "Write a README that says how to run it, and keep the project's own checks in scripts (typecheck, lint, test, build).",
      "Add a first test, so the test command has something to run.",
      "Add a continuous-integration workflow that runs those checks on every pull request. (A workflow file is a change X0 Bot asks you to approve.)",
      `Connect ${host} so every pull request gets a preview link${stack.hosting.tier === "free" ? " (on its free tier)" : ""}.`,
    ],
    acceptance: [
      isApi(stack.kind) ? "The server starts locally and answers a health check." : stack.kind === "expo" || stack.kind === "flutter" ? "The app starts in a simulator or on a phone and shows its first screen." : "The app starts locally and shows its first page.",
      "The README's steps work from a fresh clone.",
      "The checks pass locally, and the CI workflow is green on this pull request.",
      "This pull request has a preview link, or the host is connected so the next one will.",
    ],
    checks,
  });
  let k = 1;
  if (spec.needs.auth || spec.needs.database) {
    const entities = spec.dataModel.map((d) => d.entity);
    ms.push({
      k: k++, title: spec.needs.auth ? "Accounts and data" : "Data",
      scope: [
        ...(spec.needs.auth ? ["Set up sign-in (sign up, sign in, sign out) with the provider in the stack."] : []),
        `Create the data model as migrations in the repo${entities.length ? `: ${entities.slice(0, 8).join(", ")}` : ""}, never by hand in a dashboard.`,
        "Add row-level security (or the provider's equivalent) so one person cannot read or change another's data.",
        "Put every key in environment variables, and list their names in .env.example.",
      ],
      acceptance: [
        ...(spec.needs.auth ? ["A person can sign up, sign in and sign out; a signed-out visitor cannot reach signed-in pages."] : []),
        "Data is stored and comes back after a reload.",
        "A test proves one person cannot read another's data.",
        "The schema is in migrations that run from nothing.",
        ".env.example lists every variable the app reads, and no real value is in git.",
      ],
      checks,
    });
  }
  const musts = spec.features.filter((f) => f.priority === "must");
  const shoulds = spec.features.filter((f) => f.priority === "should");
  for (const g of group(musts, 3)) ms.push(featureMilestone(k++, "Core", g, spec, stack));
  for (const g of group(shoulds, 3)) ms.push(featureMilestone(k++, "More", g, spec, stack));
  ms.push({
    k, title: "Launch readiness",
    scope: [
      "Error pages and empty states everywhere a person can land.",
      "An accessibility pass: keyboard, contrast, labels.",
      ...(spec.needs.seo ? ["Page titles, descriptions, a sitemap and share previews, so search engines and chat apps show it properly."] : []),
      ...(spec.needs.payments ? ["The payment launch checklist: live keys in the host's settings (never in git), a test purchase, refunds understood."] : []),
      "Environment variables documented, secrets in the host's settings only.",
      "The hand-off section of this plan followed once, from a clean start, to prove it works.",
    ],
    acceptance: [
      "Every must-have feature is accepted.",
      "The app is deployed to a real address and the checks pass on the main branch.",
      "A stranger can follow the README and the hand-off section to run their own copy.",
    ],
    checks,
  });
  return ms;
}

// --------------------------------------------------------------------- hand-off

/** The environment variable NAMES the project will read, by stack. */
export function envNames(spec: Spec, stack: Stack): string[] {
  const prefix = stack.kind === "next" ? "NEXT_PUBLIC_" : stack.kind.startsWith("vite") ? "VITE_" : stack.kind === "expo" ? "EXPO_PUBLIC_" : "";
  const out: string[] = [];
  const supa = stack.parts.some((p) => p.name.startsWith("Supabase"));
  if (supa) {
    out.push(`${prefix}SUPABASE_URL`, `${prefix}SUPABASE_ANON_KEY`);
    if (isApi(stack.kind) || stack.kind === "next") out.push("SUPABASE_SERVICE_ROLE_KEY (server only)");
  }
  const pay = stack.parts.find((p) => p.role === "payments");
  if (pay?.name === "Razorpay") out.push("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET (server only)");
  else if (pay) out.push(`${prefix}STRIPE_PUBLISHABLE_KEY`, "STRIPE_SECRET_KEY (server only)", "STRIPE_WEBHOOK_SECRET (server only)");
  if (spec.needs.ai) out.push("MODEL_API_KEY (server only)");
  if (isApi(stack.kind)) out.push("PORT");
  return out;
}

function buildSettings(kind: StackKind, host: string): string[] {
  const h = host.toLowerCase();
  switch (kind) {
    case "next": return h.includes("vercel") ? ["Import the repo at vercel.com/new. The framework preset is Next.js; leave the build settings as they are (`npm run build`)."] : ["Build command: `npm run build`. Start command: `npm start`. Node 20 or newer."];
    case "vite-react": case "vite-vue": case "vite-svelte":
      return h.includes("cloudflare") ? ["In Cloudflare, go to Workers & Pages, create a Pages project, and connect the repo.", "Build command: `npm run build`. Build output directory: `dist`."]
        : h.includes("netlify") ? ["On Netlify, add a new site from Git and pick the repo.", "Build command: `npm run build`. Publish directory: `dist`."]
          : ["Build command: `npm run build`. The site is the `dist` folder: any static host serves it."];
    case "expo": return ["Install the EAS command line (`npm i -g eas-cli`) and sign in to Expo.", "Build with `eas build --platform all`, and send to the stores with `eas submit`."];
    case "flutter": return ["Build with `flutter build apk` (Android), `flutter build ipa` (iPhone, on a Mac) or `flutter build web`."];
    case "fastapi": return ["Build command: `pip install -r requirements.txt`.", "Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`."];
    case "fastify": case "express": return ["Build command: `npm install && npm run build`.", "Start command: `npm start`. Node 20 or newer."];
    case "django": return ["Build command: `pip install -r requirements.txt`.", "Start command: `gunicorn config.wsgi` (add gunicorn to requirements.txt)."];
  }
}

function handoff(spec: Spec, stack: Stack): string[] {
  const env = envNames(spec, stack);
  const out: string[] = [
    "This is how to run the project on your own accounts, with no help from X0 Bot. Do it once at the end to be sure it works.",
    "",
    "1. **The code is yours.** It is in your GitHub repo. To move it to another account or organisation: Settings, then General, then Transfer.",
    `2. **Make an account on ${stack.hosting.name}** (${stack.hosting.tier === "free" ? "its free tier is enough to start" : "the one you already have"}) and connect this repo.`,
    ...buildSettings(stack.kind, stack.hosting.name).map((l) => `   - ${l}`),
  ];
  if (env.length) {
    out.push("3. **Set the environment variables** in the host's settings (never in git). Their names:", ...env.map((e) => `   - \`${e}\``));
  } else {
    out.push("3. **Environment variables:** none are needed yet. If one is added, it is listed in `.env.example`.");
  }
  if (spec.needs.auth || spec.needs.database) {
    out.push("4. **The database:** create a Supabase project (free), then run the migrations in the repo's `supabase/migrations` folder, in order, in its SQL editor. Copy the project URL and keys into the variables above.");
  } else {
    out.push("4. **The database:** this project does not keep data yet, so there is nothing to set up.");
  }
  out.push(
    "5. **A domain:** buy one from any registrar, add it in the host's settings, and follow the host's steps for the DNS records. HTTPS is automatic.",
    "6. **Rolling back:** every deploy is kept. Re-deploy the previous one from the host's dashboard if a release goes wrong.",
    "7. **Taking X0 Bot's access away:** GitHub, then Settings, then Applications, then uninstall or revoke X0 Bot. The code, this plan and the history stay in your repo.",
  );
  return out;
}

// ------------------------------------------------------------------- the file

const md = (s: string): string => s.replace(/\s+/g, " ").trim();
const bullet = (xs: readonly string[]): string[] => xs.map((x) => `- ${md(x)}`);

export function planMarkdown(spec: Spec, stack: Stack, o: { date?: string } = {}): string {
  const out: string[] = [];
  out.push(`# ${md(spec.name)}: plan`, "");
  out.push(`_Written by X0 Bot${o.date ? ` on ${o.date}` : ""}${spec.source === "rules" ? ", from your answers alone" : ""}. It is yours: change it, and X0 Bot follows what it says now._`, "");

  out.push("## Goals", "", md(spec.summary), "");
  if (spec.users.length) out.push(`**Who it is for:** ${spec.users.map(md).join("; ")}.`, "");
  out.push(`**Where it runs:** ${platformWords(spec)}.`, "");
  const must = spec.features.filter((f) => f.priority === "must");
  const should = spec.features.filter((f) => f.priority === "should");
  const later = spec.features.filter((f) => f.priority === "later");
  out.push("### In the first version", "");
  out.push(...(must.length ? must.map((f) => `- **${md(f.name)}**${f.description ? `: ${md(f.description)}` : ""}`) : ["- _Nothing was listed. Say what it must do and this section fills in._"]), "");
  if (should.length) out.push("### If time allows", "", ...should.map((f) => `- **${md(f.name)}**${f.description ? `: ${md(f.description)}` : ""}`), "");
  out.push("### Not in the first version", "", ...bullet([...spec.nonGoals, ...later.map((f) => `${f.name} (later)`)]), "");

  out.push("## Stack", "", `**${stack.label}**`, "");
  if (stack.preference) out.push(`_You asked for: ${md(stack.preference.said)}${stack.preference.honoured ? "" : " (not set up yet)"}.${stack.preference.note ? ` ${md(stack.preference.note)}.` : ""}_`, "");
  out.push("Why:", "", ...bullet(stack.reasons), "", "The parts:", "", ...stack.parts.map((p) => `- **${p.name}** (${p.role}): ${md(p.why)}`), "");
  out.push(`**Hosting:** ${stack.hosting.name}. ${md(stack.hosting.note)}.`, "");
  if (stack.later.length) out.push(`**Later:** ${stack.later.join(", ")}.`, "");

  if (spec.dataModel.length) {
    out.push("## Data", "", ...spec.dataModel.map((d) => `- **${md(d.entity)}**: ${d.fields.map(md).join(", ") || "(fields to decide)"}`), "");
  }
  if (spec.surfaces.screens.length) out.push("## Screens", "", ...spec.surfaces.screens.map((s) => `- **${md(s.name)}**: ${md(s.purpose)}`), "");
  if (spec.surfaces.endpoints.length) out.push("## Endpoints", "", ...spec.surfaces.endpoints.map((e) => `- \`${md(e.method)} ${md(e.path)}\`: ${md(e.purpose)}`), "");

  out.push("## Milestones", "", "Each milestone is its own branch (`tailzu/m<number>-<name>`) and its own draft pull request, whose description is the checklist below. You see each one, with a preview link where the host is connected, before the next begins.", "");
  for (const m of planMilestones(spec, stack)) {
    out.push(`### M${m.k}: ${md(m.title)}`, "", "**Scope**", "", ...bullet(m.scope), "", "**Acceptance criteria**", "", ...m.acceptance.map((a) => `- [ ] ${md(a)}`), "", "**Checks**", "", ...m.checks.map((c) => `- \`${c}\``), "");
  }

  if (spec.risks.length || spec.assumptions.length) {
    out.push("## Risks and assumptions", "");
    if (spec.risks.length) out.push("**Risks**", "", ...bullet(spec.risks), "");
    if (spec.assumptions.length) out.push("**Assumed, because it was not said**", "", ...bullet(spec.assumptions), "");
  }

  out.push(
    "## Definition of done", "",
    "- [ ] Every must-have feature has been accepted.",
    "- [ ] The checks pass on the main branch: " + checksFor(stack.kind).map((c) => `\`${c}\``).join(", ") + ".",
    "- [ ] It is deployed to a real address that you control.",
    "- [ ] The README and this plan are up to date.",
    "- [ ] Every environment variable is in `.env.example`, and no secret is in git.",
    "- [ ] The hand-off section below has been followed once, from a clean start.",
    "",
  );
  out.push("## Hand-off: deploying on your own host", "", ...handoff(spec, stack), "");
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

export { isApi, isWeb };
