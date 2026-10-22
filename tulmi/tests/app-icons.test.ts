/**
 * EACH APP, WITH ITS COMPANY'S OWN LOGO (experience/appIcons.ts).
 *
 * What these hold down:
 *   - the PNGs in icons/ are the ones appIconData.ts says, small, square, and
 *     credited (the NOTICE);
 *   - every app in the catalog has a logo or keeps its letter badge, and the
 *     list of those that keep it is decided here, not by accident;
 *   - the screens draw a logo with the Image node both clients draw, with only
 *     the props they read, on the phone's Connected apps, confirm sheet and
 *     Tasks, the onboarding's Connect apps step (the stage's and the store
 *     build's), and the desk's Connected apps and Tasks;
 *   - an app added by link never gets one, and nothing is ever fetched from
 *     anywhere but this server's own /icons/;
 *   - /icons/ is served, immutable.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import fixtureJson from "./fixtures/store-build.json";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.STT_PROVIDER = "groq";
process.env.NODE_ENV = "test";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.DEV_SKIP_AUTH = "false";
process.env.SUPABASE_URL = "http://127.0.0.1:1";
process.env.SUPABASE_ANON_KEY = "anon";
process.env.STATIC_BEARER_TOKENS = "test-static-token-0123456789";
process.env.CONNECTORS = "true";
process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
delete process.env.PUBLIC_ORIGIN;

// Nothing is translated by a model.
vi.mock("openai", () => ({
  default: class {
    audio = { transcriptions: { create: async () => ({ text: "" }) } };
    chat = { completions: { create: async () => ({ choices: [{ message: { content: "{}" } }] }) } };
  },
  toFile: async (b: Buffer, name: string) => ({ b, name }),
}));

const { buildScreen } = await import("../src/experience/catalog.js");
const { CATALOG, ALWAYS_ON } = await import("../src/connectors/catalog.js");
const { newCustomId } = await import("../src/connectors/store.js");
const { APP_ICON_BUILD } = await import("../src/experience/appIconData.js");
const { APP_ICON_IDS, appIconNode, appIconUrl } = await import("../src/experience/appIcons.js");
const { buildApp } = await import("../src/server.js");

const ICONS = path.join(process.cwd(), "icons");
const ORIGIN = "https://api.tailzu.space/icons/";

type N = { type?: string; props?: Record<string, any>; style?: Record<string, any>; children?: N[] };
function all(root: unknown, keep: (n: N) => boolean = () => true): N[] {
  const out: N[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const n = v as N;
    if (typeof n.type === "string" && keep(n)) out.push(n);
    for (const c of Object.values(n)) if (c && typeof c === "object") walk(c);
  };
  walk(root);
  return out;
}
/** The logos a screen draws: the Image nodes that point at /icons/. */
const logos = (root: unknown): N[] => all(root, (n) => n.type === "Image" && String(n.props?.source?.url ?? "").includes("/icons/"));
const logoIds = (root: unknown): string[] => logos(root).map((n) => /\/icons\/([a-z-]+)\.png/.exec(n.props!.source.url)![1]!);
const letters = (root: unknown): string[] => all(root, (n) => n.type === "Text").map((n) => String(n.props?.content ?? "")).filter(Boolean);

// ---------------------------------------------------------------------------
// The files
// ---------------------------------------------------------------------------

describe("the logos on disk", () => {
  const listed = Object.keys(APP_ICON_BUILD.files).sort();
  const onDisk = fs.readdirSync(ICONS).filter((f) => f.endsWith(".png")).map((f) => f.replace(/\.png$/, "")).sort();

  it("are exactly the ones appIconData.ts lists, each a small square PNG of the size it says", () => {
    expect(onDisk).toEqual(listed);
    expect(listed.length).toBeGreaterThanOrEqual(28);
    for (const id of listed) {
      const b = fs.readFileSync(path.join(ICONS, `${id}.png`));
      expect(b.subarray(0, 8).toString("hex"), id).toBe("89504e470d0a1a0a");
      expect(b.length, id).toBe(APP_ICON_BUILD.files[id]!.bytes);
      expect(b.length, `${id} is ${b.length} bytes`).toBeLessThan(8 * 1024);
      // IHDR: width and height.
      expect([b.readUInt32BE(16), b.readUInt32BE(20)], id).toEqual([APP_ICON_BUILD.size, APP_ICON_BUILD.size]);
    }
  });

  it("are credited: their owners' trademarks, used only to identify the apps, from Simple Icons (CC0)", () => {
    const notice = fs.readFileSync(path.join(ICONS, "NOTICE"), "utf8");
    expect(notice).toMatch(/trademarks of their owners/);
    expect(notice).toMatch(/only to identify/);
    expect(notice).toMatch(/Simple Icons/);
    expect(notice).toMatch(/CC0/);
  });

  it("go in the image next to blip/, and are served from /icons/", () => {
    const docker = fs.readFileSync(path.join(process.cwd(), "Dockerfile"), "utf8");
    expect(docker).toContain("COPY --from=build /app/tulmi/icons ./icons");
    expect(fs.readFileSync(path.join(process.cwd(), "scripts", "make-app-icons.ts"), "utf8")).toContain("simple-icons");
  });
});

describe("every app in the catalog has a logo or keeps its letter badge", () => {
  // Decided here, so a new app in the catalog is a choice: cut its logo, or add it to this list.
  const BADGE = ["granola", "otter", "fireflies", "monday", "composio", "pipedream", "phone", "upi", "shopping", "play"];

  it("the apps without a logo are the ones Simple Icons has no glyph for, or that are no one company's", () => {
    const every = [...CATALOG, ...ALWAYS_ON].map((c) => c.id);
    expect(every.filter((id) => !appIconUrl(id)).sort()).toEqual([...BADGE].sort());
    for (const id of every) {
      const node = appIconNode(id, 42);
      if (BADGE.includes(id)) expect(node, id).toBeUndefined();
      else expect(fs.existsSync(path.join(ICONS, `${id}.png`)), id).toBe(true);
    }
  });

  it("the ones with a logo name it by catalog id, versioned, on this server's own origin", () => {
    for (const id of ["notion", "linear", "github", "atlassian", "asana", "zapier", "google-calendar", "google-docs", "google-sheets",
      "google-forms", "google-tasks", "google-classroom", "youtube", "todoist", "calendly", "evernote", "clickup", "trello", "calcom",
      "airtable", "make", "email-handoff", "whatsapp", "telegram", "maps", "uber", "threads", "booking"]) {
      expect(appIconUrl(id), id).toBe(`${ORIGIN}${id}.png?v=${APP_ICON_BUILD.v}`);
    }
    // The two services the Play hand-off opens that have a glyph, by their own names.
    expect(APP_ICON_IDS).toEqual(expect.arrayContaining(["spotify", "youtube-music"]));
    expect(appIconUrl("nope")).toBeUndefined();
    expect(appIconUrl("__proto__")).toBeUndefined();
  });

  it("is an Image that fills a box of its size, with only the props both clients read", () => {
    const n = appIconNode("notion", 42)!;
    expect(n.type).toBe("Stack");
    expect(n.style).toMatchObject({ width: 42, height: 42 });
    const [img] = n.children!;
    expect(img!.type).toBe("Image");
    expect(Object.keys(img!.props!).sort()).toEqual(["contentFit", "source"]);
    expect(Object.keys(img!.props!.source)).toEqual(["url"]);
    expect(img!.props!.contentFit).toBe("contain");
    expect(img!.style).toEqual({ width: "100%", height: "100%", borderRadius: 0 });
  });
});

// ---------------------------------------------------------------------------
// The screens
// ---------------------------------------------------------------------------

const app = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id, name, category: "Docs", oneLine: `${name} does things.`, auth: "oauth", connected: false, level: "look", auto: [], ...extra });
const CUSTOM_ID = newCustomId();
const MINE = app(CUSTOM_ID, "Notion", { custom: true, host: "mcp.example.com" });
const APPS = [app("notion", "Notion"), app("linear", "Linear", { connected: true }), app("granola", "Granola"), app("github", "GitHub", { connected: true, needsSignIn: true }), MINE];
const names = { notion: "Notion", granola: "Granola", [CUSTOM_ID]: "Notion" };
const task = (o: Record<string, unknown>) => ({ id: "t1", state: "waiting", title: "Add the page", steps: [], approval: null, createdAt: 1, updatedAt: 1, ...o });
const approval = (connector: string) => ({ id: "ap1", connector, tool: "create_page", risk: "write", preview: "Add the page Gym" });
const TASKS = [task({ id: "t1", approval: approval("notion") }), task({ id: "t2", approval: approval("granola") }), task({ id: "t3", approval: approval(CUSTOM_ID) }), task({ id: "t4", state: "running" })];
const phone = (extra: Record<string, unknown> = {}) => ({ personality: {}, language: "en", platform: "ios", formFactor: "phone", can: new Set(["ActionUrl"]), ...extra }) as never;
const deskCtx = (extra: Record<string, unknown> = {}) => ({ personality: {}, language: "en", formFactor: "desktop", can: new Set(["DeskShell", "DeskConnectors"]), ...extra }) as never;
const view = (apps: unknown[], tasks: unknown[] = []) => ({ apps, names, tasks });

describe("the phone: Connected apps, the confirm sheet and Tasks", () => {
  it("a tile and its sheet wear the company's logo; an app with none keeps its letter; an app added by link keeps its letter", () => {
    const s = buildScreen("assistant_apps", phone({ assistant: view(APPS) }))!;
    // Notion, Linear and GitHub: a tile and a sheet head each. Granola and the added app: none.
    const ids = logoIds(s.root);
    for (const id of ["notion", "linear", "github"]) expect(ids.filter((x) => x === id), id).toHaveLength(2);
    expect(ids.filter((x) => x === "granola")).toHaveLength(0);
    expect(new Set(ids)).toEqual(new Set(["notion", "linear", "github"]));
    // The letter badge reads its letter from state, as it always did, for the ones without a logo.
    const state = (s as any).state;
    expect(state.ini.granola).toBe("G");
    expect(state.ini[CUSTOM_ID]).toBe("N");
    expect(JSON.stringify(s.root)).toContain(`ini.${CUSTOM_ID}`);
    expect(JSON.stringify(s.root)).toContain("ini.granola");
  });

  it("the confirm sheet wears the logo of the app it asks about, and the letter for one added by link or without a logo", () => {
    const sheetOf = (taskId: string) => buildScreen("assistant_approve", phone({ assistant: view(APPS, TASKS), params: { taskId } }))!;
    expect(logoIds(sheetOf("t1").root)).toEqual(["notion"]);
    expect(logoIds(sheetOf("t2").root)).toEqual([]);
    expect(logoIds(sheetOf("t3").root)).toEqual([]);
    expect(JSON.stringify(sheetOf("t3").root)).toContain('"ini"');
  });

  it("Tasks: a row that waits on an app shows that app's logo beside its name", () => {
    const s = buildScreen("assistant_tasks", phone({ assistant: view(APPS, TASKS) }))!;
    expect(logoIds(s.root)).toEqual(["notion"]);
  });

  it("with nothing to draw (the read failed), there is no logo and no error", () => {
    expect(logoIds(buildScreen("assistant_apps", phone({ assistant: undefined }))!.root)).toEqual([]);
  });
});

describe("the onboarding's Connect apps step", () => {
  const BOTH = ["OnboardStage", "BlipSpot"];
  const ctx = (extra: Record<string, unknown> = {}) => phone({ connectorsOn: true, assistant: view([...APPS.filter((a) => a.id !== "granola"), app("granola", "Granola"), app("asana", "Asana")]), can: new Set(BOTH), ...extra });
  const five = ["notion", "linear", "github", "granola", "asana"];

  it("the stage's tiles and sheets wear the logos (the app without one keeps its letter)", () => {
    const s = buildScreen("onboard", ctx())!;
    const ids = logoIds(s.root);
    // A tile and its Connect sheet; Linear and GitHub are connected: a tile only.
    for (const [id, n] of [["notion", 2], ["asana", 2], ["linear", 1], ["github", 1]] as const) expect(ids.filter((x) => x === id), id).toHaveLength(n);
    expect(ids).not.toContain("granola");
    expect(JSON.stringify(s.root)).toContain("ini.granola");
    expect(five.length).toBe(5);
  });

  it("a window's tiles wear them too", () => {
    const s = buildScreen("onboard", ctx({ formFactor: "desktop", platform: "mac" }))!;
    expect(logoIds(s.root)).toEqual(expect.arrayContaining(["notion", "linear", "github", "asana"]));
  });

  it("the store build's tiles and sheets wear them, with the Image it already draws", () => {
    const declared = new Set<string>([...(fixtureJson as unknown as { declared: string[] }).declared, "ActionUrl"]);
    const s = buildScreen("onboard", ctx({ can: declared }))!;
    const ids = logoIds(s.root);
    for (const [id, n] of [["notion", 2], ["asana", 2], ["linear", 1], ["github", 1]] as const) expect(ids.filter((x) => x === id), id).toHaveLength(n);
    for (const n of logos(s.root)) expect(Object.keys(n.props!).sort()).toEqual(["contentFit", "source"]);
  });

  it("never draws an app added by link, which is not one of the tiles", () => {
    expect(logoIds(buildScreen("onboard", ctx({ assistant: view([MINE]) }))!.root)).toEqual([]);
  });
});

describe("the desk: Connected apps and Tasks", () => {
  it("each app's row wears its logo beside its name; one without a logo, or added by link, shows the name alone", () => {
    const s = buildScreen("desk_settings", deskCtx({ assistant: { ...view(APPS), custom: true } }))!;
    expect(logoIds(s.root).sort()).toEqual(["github", "linear", "notion"]);
    const json = JSON.stringify(s.root);
    expect(json).toContain('"Granola"');
    expect(json).toContain(`"host.${CUSTOM_ID}"`);
  });

  it("Tasks: a row that waits on an app shows that app's logo beside its name", () => {
    const s = buildScreen("desk_tasks", deskCtx({ assistant: view(APPS, TASKS) }))!;
    expect(logoIds(s.root)).toEqual(["notion"]);
  });

  it("an Image the window draws is a box that fills its parent (no margin of its own), not a free-standing picture", () => {
    const s = buildScreen("desk_settings", deskCtx({ assistant: view([APPS[0]!]) }))!;
    const [img] = logos(s.root);
    expect(img!.style).toEqual({ width: "100%", height: "100%", borderRadius: 0 });
  });
});

describe("an app added by link never gets a logo, and nothing is fetched from anywhere else", () => {
  it("not by its id, and not by its flag, even under a catalog app's own id and name", () => {
    expect(appIconUrl(CUSTOM_ID)).toBeUndefined();
    expect(appIconUrl("c_notion")).toBeUndefined();
    expect(appIconUrl("notion", true)).toBeUndefined();
    expect(appIconNode("notion", 42, true)).toBeUndefined();
    const look = app("notion", "Notion", { custom: true, host: "evil.example.com" });
    for (const [id, screen, c] of [
      ["assistant_apps", "assistant_apps", phone({ assistant: view([look]) })],
      ["desk_settings", "desk_settings", deskCtx({ assistant: { ...view([look]), custom: true } })],
      ["onboard", "onboard", phone({ connectorsOn: true, assistant: view([look, app("linear", "Linear", { custom: true })]), can: new Set(["OnboardStage", "BlipSpot"]) })],
    ] as const) {
      expect(logoIds(buildScreen(screen, c as never)!.root), id).toEqual([]);
    }
  });

  it("every picture any of these screens draws is on this server's /icons/, and never a custom app's own address", () => {
    const urls = new Set<string>();
    const hand = [
      buildScreen("assistant_apps", phone({ assistant: view(APPS, TASKS) })),
      buildScreen("assistant_tasks", phone({ assistant: view(APPS, TASKS) })),
      buildScreen("assistant_approve", phone({ assistant: view(APPS, TASKS), params: { taskId: "t1" } })),
      buildScreen("desk_settings", deskCtx({ assistant: { ...view(APPS), custom: true } })),
      buildScreen("desk_tasks", deskCtx({ assistant: view(APPS, TASKS) })),
      buildScreen("onboard", phone({ connectorsOn: true, assistant: view(APPS), can: new Set(["OnboardStage", "BlipSpot"]) })),
    ];
    for (const s of hand) for (const n of all(s!.root, (x) => x.type === "Image")) urls.add(String(n.props?.source?.url ?? ""));
    const iconUrls = [...urls].filter((u) => u.includes("/icons/"));
    expect(iconUrls.length).toBeGreaterThan(0);
    for (const u of iconUrls) expect(u).toMatch(/^https:\/\/api\.tailzu\.space\/icons\/[a-z-]+\.png\?v=\d+$/);
    expect(JSON.stringify(hand)).not.toContain("example.com/");
  });

  it("an app's letter badge is still what is drawn without a logo (the first letter, from state)", () => {
    const s = buildScreen("assistant_apps", phone({ assistant: view([app("granola", "Granola")]) }))!;
    expect(logoIds(s.root)).toEqual([]);
    expect(letters(s.root).length).toBeGreaterThan(0);
    expect((s as any).state.ini.granola).toBe("G");
  });
});

// ---------------------------------------------------------------------------
// Served
// ---------------------------------------------------------------------------

describe("/icons/", () => {
  let server: FastifyInstance;
  beforeAll(async () => { server = await buildApp(); await server.ready(); });
  afterAll(async () => { await server.close(); });

  it("serves each logo as an immutable PNG, with no sign-in", async () => {
    for (const id of APP_ICON_IDS) {
      const r = await server.inject({ method: "GET", url: `/icons/${id}.png?v=${APP_ICON_BUILD.v}` });
      expect(r.statusCode, id).toBe(200);
      expect(r.headers["content-type"], id).toContain("image/png");
      expect(r.headers["cache-control"], id).toContain("immutable");
      expect(r.rawPayload.length, id).toBe(APP_ICON_BUILD.files[id]!.bytes);
    }
    expect((await server.inject({ method: "GET", url: "/icons/nope.png" })).statusCode).toBe(404);
  });
});
