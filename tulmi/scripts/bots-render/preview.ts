/**
 * THE LIVE PREVIEW: the Bots app as it will look and move, on the phone and in the window, as a folder of static files
 * (a private claude.ai Artifact, or any static server).
 *
 *   cd tulmi && npx tsx scripts/bots-render/preview.ts            # writes scripts/bots-render/out/preview/
 *
 * The renderers are the real ones, as in render.ts: the phone's sdui renderer (RenderNode, its components, runAction)
 * through react-native-web, with a navigator around it (phone/preview.jsx); the window's app.html + sdui.js, with the
 * Electron bridge stood in (preview/desk-bridge.js). Motions are on (the viewer's own Reduce Motion still counts).
 *
 * The screens are the real ones too, built here once: the bootstrap (BOTS_APP on, BotsKit declared) and, per client,
 * every sample screen (samples/), then every navigate target (screen id + params) found in their trees, built with the
 * same sample day, breadth first, at most --max (300) a client. In the page a stand-in API (preview/shim.js) answers the
 * renderers from these files: the bootstrap, a screen by its canonical key (an unknown one: a kit page saying it is not
 * in this preview), the sample day's GETs, and an ok for every write.
 *
 * Writes, in --out (default scripts/bots-render/out/preview/, gitignored):
 *   index.html                the page: the device frames, Phone / Desktop, jump to a screen, start over. No doctype,
 *                             html, head or body: an Artifact wraps it. (preview/serve.ts wraps it to try it locally.)
 *   phone.html  phone.js      the phone (phone.js: the renderer bundle)
 *   desk.html   sdui.js …     the window (TAILZU-DESKTOP's app.html, its scripts and its faces)
 *   shim.js  desk-bridge.js   the stand-in API, the stand-in bridge
 *   data/<client>.json        the bootstrap, the answers, the "not in this preview" page, which chunk has which screen
 *   data/<client>-<n>.json    the screens, by key
 *   fonts/ blip/              the typefaces and pictures the screens name (their https://… addresses made relative)
 *   files.txt                 every file, with its size
 *
 * Options: --out <dir>   --max <screens per client, default 300>
 */
import fs from "node:fs";
import path from "node:path";

// buildBootstrap reads the server's config, which wants its keys present (never used here).
process.env.PUBLIC_ORIGIN = "https://api.local";
process.env.BOTS_APP = "true";
for (const k of ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "SUPABASE_ANON_KEY"]) process.env[k] ||= "preview";
process.env.SUPABASE_URL ||= "http://127.0.0.1:1";

const R = await import("./render.js");
const { SAMPLES, apiFor, areaApis } = await import("./samples/index.js");
const { buildBotsScreen } = await import("../../src/experience/bots/index.js");
const { fakeDeps, ctxFor, IST } = await import("../../src/experience/bots/fixtures.js");
const { loadLive } = await import("../../src/experience/bots/live.js");
const kit = await import("../../src/experience/bots/kit.js");
const { buildBootstrap } = await import("../../src/experience/catalog.js");
const { BLIP_LOOPS } = await import("../../src/experience/blipLoops.js");
type Sample = (typeof SAMPLES)[number];
type Client = "phone" | "desktop";
type Params = Record<string, string | number | boolean>;

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = path.resolve(flag("out") ?? path.join(R.HERE, "out/preview"));
const MAX = Math.max(1, Number(flag("max") ?? 300));
const TULMI = path.resolve(R.HERE, "../..");
const DESKTOP = path.resolve(TULMI, "../../TAILZU-DESKTOP");
const SRC = path.join(R.HERE, "preview");
const CHUNK_BYTES = 8 * 1024 * 1024;
const USER = { id: "00000000-0000-4000-8000-00000000aaaa", name: "Aanya Sharma", email: "aanya@example.in" };
const CLIENTS: Client[] = ["phone", "desktop"];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "data"), { recursive: true });

// ------------------------------------------------------------------ keys, targets, addresses

/** The key a screen is stored under; preview/shim.js's canon() is the same. */
function canon(id: string, params: Record<string, unknown> = {}): string {
  const keys = Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== null).sort();
  return `${id === "home" ? "bots.home" : id}?${keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`).join("&")}`;
}

interface Target { id: string; params: Params }

/** Every navigate in a tree whose params are written out (one that reads state is only known in the app). */
function targets(x: unknown, out: Target[] = []): Target[] {
  if (Array.isArray(x)) { for (const v of x) targets(v, out); return out; }
  if (!x || typeof x !== "object") return out;
  const o = x as Record<string, unknown>;
  if (o.kind === "navigate" && typeof o.screenId === "string") {
    const params = (o.params ?? {}) as Params;
    if (!JSON.stringify(params).includes('"$')) out.push({ id: o.screenId === "home" ? "bots.home" : o.screenId, params });
  }
  for (const v of Object.values(o)) targets(v, out);
  return out;
}

/** The files the screens name, by their path under tulmi/ (fonts/…, blip/…). */
const assets = new Set<string>();
/** Pictures from anywhere else (the preview may not fetch them): what they were. */
const foreign = new Set<string>();
/** A transparent stand-in for a picture the preview cannot fetch. */
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** Our own files' addresses (fonts, Blip, media) made relative, the version query dropped; any other picture's source blanked. */
function localize<T>(x: T): T {
  const s = JSON.stringify(x).replace(/https:\/\/api\.local\/((?:fonts|blip|media)\/[^"?\s\\)]+)(\?v=\d+)?/g, (_m, p: string) => { assets.add(p); return p; });
  const out = JSON.parse(s);
  const fix = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(fix); return; }
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if ((o.type === "Image" || o.type === "Video") && o.props && typeof o.props === "object") {
      const src = (o.props as { source?: { url?: string; uri?: string } }).source;
      for (const k of ["url", "uri"] as const) {
        const u = src?.[k];
        if (src && typeof u === "string" && /^[a-z]+:\/\//i.test(u)) { foreign.add(u); src[k] = BLANK; }
      }
    }
    for (const v of Object.values(o)) fix(v);
  };
  fix(out);
  return out;
}

// ------------------------------------------------------------------ building

const params = (s: Sample, c: Client): Params => ((c === "desktop" ? s.deskParams : undefined) ?? s.params ?? {}) as Params;

/** The sample a target is drawn with: the one with these params, else the first for the id, else none (every answer). */
function sampleFor(t: Target, c: Client): Sample | undefined {
  const same = SAMPLES.filter((s) => s.id === t.id);
  const k = canon(t.id, t.params);
  return same.find((s) => canon(s.id, params(s, c)) === k) ?? same.find((s) => canon(s.id, (s.params ?? {}) as Params) === k) ?? same[0];
}

/**
 * What each client declares beyond BotsKit. Both draw the onboarding's stage and its one Blip (the first run walks him
 * from Welcome to Name: the window with its own walker, blip.js; the phone with phone/preview.jsx's stand-in for
 * BlipHost, which needs Skia).
 */
const STAGE = ["OnboardStage", "BlipSpot"];
// The window: its microphone too (desk-bridge.js answers for it), so its first-arrival card asks for it.
const COMPS: Record<Client, string[]> = { phone: [...STAGE, "BotsMotion", "BotBuddy", "WriteOn", "LiveMark", "HeadBar"], desktop: [...R.DESKTOP_COMPONENTS, ...STAGE, "DeskMicAsk"] };

/**
 * The first arrival: Home carries its card (the microphone, then the keyboard, over a blurred Home) as it does the
 * first time someone lands in the app; closed, it stays closed in the preview too (the card remembers it).
 */
const ARRIVAL = { "GET /v1/bots/first-run/arrival": { due: true } };

async function build(t: Target, c: Client): Promise<unknown> {
  const s = sampleFor(t, c);
  const api = { ...(await apiFor(s ?? ({ id: t.id, area: "shell" } as Sample))), ...(t.id === "bots.home" ? ARRIVAL : {}) };
  const deps = fakeDeps({ ...(s?.fake ?? {}), api });
  const comps = COMPS[c];
  return buildBotsScreen({
    screenId: t.id, client: c, params: t.params as Record<string, string>, tzOffsetMinutes: IST, user: USER,
    can: new Set(["BotsKit", ...comps]), desk: { pages: comps.includes("DeskShell"), notes: comps.includes("DeskNotes") },
  }, deps);
}

/** The page for a screen the preview does not have, built with the kit. */
async function missing(c: Client): Promise<unknown> {
  const live = await loadLive(fakeDeps({ api: {} }), IST);
  const ctx = ctxFor("preview.missing", c, live, { can: new Set(["BotsKit", ...COMPS[c]]) });
  return kit.page(ctx, {
    back: true, title: "Not in this preview",
    body: [kit.emptyState({
      pose: "think", title: "Not in this preview",
      body: "This screen needs data the sample day doesn't have, or it's drawn by today's app. In the app it opens as usual.",
      action: { label: "Go back", onPress: kit.back() },
    })],
  });
}

function bootstrap(c: Client): unknown {
  const common = { onboarded: true, landedBefore: true, botsApp: true, entitled: true, signedIn: true, languagesSet: true, profileComplete: true, wordsEver: 5196 };
  const boot = (c === "phone"
    ? buildBootstrap({ ...common, platform: "ios" })
    : buildBootstrap({ ...common, formFactor: "desktop", os: "mac", desk: true, deskNotes: true, deskTasks: true })) as { flags?: Record<string, unknown> };
  // No live channel here: the stand-in API answers from files, and the page may not open a socket.
  boot.flags = { ...(boot.flags ?? {}), "live.enabled": false };
  return boot;
}

// ------------------------------------------------------------------ the crawl

/** The sample answers, every area's, for the GETs and writes the renderers make themselves. */
const ALL_API = localize(Object.assign({}, ...Object.values(await areaApis())) as Record<string, unknown>);

interface Crawl { boot: unknown; screens: Map<string, unknown>; titles: Map<string, string>; outside: Set<string>; unbuilt: number; errors: string[] }

async function crawl(c: Client): Promise<Crawl> {
  const boot = localize(bootstrap(c)) as { initialScreenId?: string; navigation?: { tabs?: Array<{ screenId: string }> } };
  const queue: Target[] = [
    ...(boot.initialScreenId ? [{ id: boot.initialScreenId, params: {} }] : []),
    ...(boot.navigation?.tabs ?? []).map((t) => ({ id: t.screenId, params: {} })),
    ...SAMPLES.map((s) => ({ id: s.id, params: params(s, c) })),
  ];
  const r: Crawl = { boot, screens: new Map(), titles: new Map(), outside: new Set(), unbuilt: 0, errors: [] };
  const seen = new Set<string>();
  while (queue.length) {
    const t = queue.shift()!;
    const k = canon(t.id, t.params);
    if (seen.has(k)) continue;
    seen.add(k);
    // Today's app's own screens (settings, keyboard, the desk's pages…): drawn by today's builders, not in this preview.
    if (!t.id.startsWith("bots.")) { r.outside.add(t.id); continue; }
    if (r.screens.size >= MAX) { r.unbuilt++; continue; }
    try {
      const screen = localize(await build(t, c)) as { title?: string };
      r.screens.set(k, screen);
      if (screen.title) r.titles.set(k, screen.title);
      queue.push(...targets(screen));
    } catch (e) {
      r.errors.push(`${k}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  return r;
}

const crawls = {} as Record<Client, Crawl>;
for (const c of CLIENTS) {
  const t0 = Date.now();
  crawls[c] = await crawl(c);
  const r = crawls[c];
  console.log(`${c}: ${r.screens.size} screens in ${Date.now() - t0} ms${r.unbuilt ? `, ${r.unbuilt} more found past --max ${MAX}` : ""}; outside the Bots app: ${[...r.outside].sort().join(", ") || "none"}`);
  for (const e of r.errors) console.warn(`  ${c}: build failed: ${e}`);
}

// ------------------------------------------------------------------ the data files

for (const c of CLIENTS) {
  const r = crawls[c];
  const index: Record<string, number> = {};
  let n = 0, part: Record<string, unknown> = {}, size = 0;
  const flush = () => {
    if (!Object.keys(part).length) return;
    fs.writeFileSync(path.join(OUT, "data", `${c}-${n}.json`), JSON.stringify(part));
    n++; part = {}; size = 0;
  };
  for (const [k, screen] of r.screens) {
    const len = JSON.stringify(screen).length;
    if (size && size + len > CHUNK_BYTES) flush();
    part[k] = screen; index[k] = n; size += len;
  }
  flush();
  const miss = localize(await missing(c));
  fs.writeFileSync(path.join(OUT, "data", `${c}.json`), JSON.stringify({ boot: r.boot, api: ALL_API, missing: miss, index }));
}

// ------------------------------------------------------------------ the pages

const read = (f: string) => fs.readFileSync(f, "utf8");
const write = (f: string, s: string | Buffer) => { fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true }); fs.writeFileSync(path.join(OUT, f), s); };
const copy = (from: string, to: string) => { fs.mkdirSync(path.dirname(path.join(OUT, to)), { recursive: true }); fs.copyFileSync(from, path.join(OUT, to)); };

write("shim.js", read(path.join(SRC, "shim.js")));
write("desk-bridge.js", read(path.join(SRC, "desk-bridge.js")));

// The phone: the renderer bundle, its faces (the bootstrap's `fonts`), a 390 x 844 phone's insets.
write("phone.js", await R.buildPhoneBundle(path.join(R.HERE, "phone/preview.jsx")));
const phoneFonts = ((crawls.phone.boot as { fonts?: Record<string, string | { url?: string; uri?: string }> }).fonts) ?? {};
const faces = Object.entries(phoneFonts).map(([name, f]) => {
  const url = typeof f === "string" ? f : f.url ?? f.uri;
  return url ? `@font-face{font-family:${JSON.stringify(name)};src:url(${JSON.stringify(url)});font-display:block}` : "";
}).join("\n");
write("phone.html", `<!doctype html>
<html lang="en" data-client="phone">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=390, initial-scale=1">
<title>Tailzu on a phone</title>
<style>
html,body,#root{margin:0;height:100%;overflow:hidden;background:#fff}
${faces}
</style>
</head>
<body>
<div id="root"></div>
<script>window.__INSETS__ = { top: 47, bottom: 34, left: 0, right: 0 };</script>
<script src="shim.js"></script>
<script src="phone.js"></script>
</body>
</html>
`);

// The window: app.html as it ships, with the stand-ins before its scripts. Its own policy goes (the page it sits in
// sets the policy); everything else is untouched.
let desk = read(path.join(DESKTOP, "app.html"));
desk = desk.replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?>/, "")
  .replace(/<html([^>]*)>/, '<html$1 data-client="desktop">')
  .replace('<script src="knobs.js"></script>', '<script src="shim.js"></script>\n  <script src="desk-bridge.js"></script>\n  <script src="knobs.js"></script>');
write("desk.html", desk);
// Every script the window loads, as app.html names them (sdui.js and the abilities loaded after it).
for (const m of desk.matchAll(/<script src="([\w.-]+\.js)"><\/script>/g)) {
  const f = m[1]!;
  if (f !== "shim.js" && f !== "desk-bridge.js" && fs.existsSync(path.join(DESKTOP, f))) copy(path.join(DESKTOP, f), f);
}
for (const m of desk.matchAll(/url\((assets\/[^)"']+)\)/g)) if (fs.existsSync(path.join(DESKTOP, m[1]!))) copy(path.join(DESKTOP, m[1]!), m[1]!);

// What the screens name, and the faces the page around them is set in; and every one of Blip's loops, which the
// phone's stand-in for BlipHost draws by pose.
for (const f of ["fonts/geist.ttf", "fonts/geist-semibold.ttf", "fonts/geist-mono.ttf"]) assets.add(f);
for (const loop of BLIP_LOOPS) assets.add(`blip/${loop}.webp`);
for (const a of assets) {
  const from = path.join(TULMI, a);
  if (fs.existsSync(from)) copy(from, a);
  else console.warn(`  missing asset: ${a}`);
}
if (foreign.size) console.warn(`  pictures from elsewhere, blanked: ${[...foreign].slice(0, 8).join(" ")}`);

// ------------------------------------------------------------------ the page around them

/** The jump list: every sample, grouped as the app is. */
const GROUP: Record<string, string> = {
  firstrun: "First run", bots: "Bots", keybot: "Keylessbord", code: "Xode", codework: "Xode", you: "Activity and You",
};
const ACTIVITY = new Set(["bots.activity", "bots.tasks", "bots.approve"]);
const GROUPS = ["First run", "Bots", "Keylessbord", "Xode", "Activity and You", "Desktop pages"];
/** The first run's old pages, listed where the app reaches them now. */
const REACHED_FROM: Record<string, string> = {
  "bots.keybot.on": "Keylessbord", "bots.first-words": "Keylessbord", "bots.language": "Activity and You", "bots.plans": "Activity and You",
};
const groupOf = (s: Sample) => REACHED_FROM[s.id] ?? (!s.board && s.deskBoard ? "Desktop pages" : s.area === "shell" ? (ACTIVITY.has(s.id) ? "Activity and You" : "Bots") : GROUP[s.area] ?? "Bots");
/** A screen's own title, or its board's name when it has none of its own yet ("On its way"). */
const titleOf = (s: Sample) => {
  const t = crawls.phone.titles.get(canon(s.id, params(s, "phone"))) ?? crawls.desktop.titles.get(canon(s.id, params(s, "desktop")));
  return !t || t === "On its way" ? s.board ?? s.deskBoard ?? s.id : t;
};
const label = (s: Sample) => `${titleOf(s)}${s.variant ? ` · ${s.variant}` : ""}`;
const jumps = GROUPS.map((g) => ({
  group: g,
  items: SAMPLES.filter((s) => groupOf(s) === g).map((s) => ({
    // Two screens with one title (Your bots, and the first day's): the board tells them apart.
    label: SAMPLES.some((o) => o !== s && label(o) === label(s)) ? `${label(s)} (${s.board ?? s.deskBoard})` : label(s),
    id: s.id, phone: params(s, "phone"), desktop: params(s, "desktop"),
    on: [...(s.board ? ["phone"] : []), ...(s.deskBoard ? ["desktop"] : [])],
  })),
})).filter((g) => g.items.length);

write("index.html", read(path.join(SRC, "index.html")).replace("/*JUMPS*/[]", JSON.stringify(jumps).replace(/</g, "\\u003c")));

// ------------------------------------------------------------------ the list

const files: Array<[string, number]> = [];
const list = (d: string) => {
  for (const f of fs.readdirSync(path.join(OUT, d), { withFileTypes: true })) {
    const rel = path.posix.join(d, f.name);
    if (f.isDirectory()) list(rel);
    else files.push([rel, fs.statSync(path.join(OUT, rel)).size]);
  }
};
list(".");
files.sort((a, b) => a[0].localeCompare(b[0]));
const total = files.reduce((t, [, s]) => t + s, 0) + 1;
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(2)} MB`;
fs.writeFileSync(path.join(OUT, "files.txt"), files.map(([f, s]) => `${String(s).padStart(10)}  ${f.replace(/^\.\//, "")}`).join("\n") + "\n");
const big = files.filter(([, s]) => s > 15 * 1024 * 1024);
console.log(`\n${files.length + 1} files, ${mb(total)} in ${path.relative(process.cwd(), OUT)}/ (largest ${files.reduce((a, b) => (b[1] > a[1] ? b : a))[0]} ${mb(Math.max(...files.map(([, s]) => s)))})`);
if (files.length + 1 > 200 || total > 60 * 1024 * 1024 || big.length) console.error("  over an Artifact's limits (200 files, 15 MB each, 60 MB in all)");
