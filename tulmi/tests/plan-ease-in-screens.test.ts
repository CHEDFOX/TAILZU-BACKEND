/**
 * PLAN EASE, STEPS 2 AND 3, AS DRAWN (screens/bots/planIn.ts, planItem.ts, the share-in screen, the hand-off screen): the capture card,
 * the link page, a work meeting's and a bill's details, and a notification's Pay. Lint-clean on the phone and the window, and nothing
 * of the newer kit reaches an older build.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id, email: "aanya.sharma@example.in" } : null; } };
});

const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST, FIXED_NOW } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { sampleApi } = await import("./bots-bots-data.js");
const Fastify = (await import("fastify")).default;
const { registerBotsBotsRoutes } = await import("../src/routes/bots/botsBots.js");

const A = "/v1/botsapp/bots";
const U = "aaaaaaaa-0000-4000-8000-000000000001";
const NEW = ["BotsKit", "BotsMotion", "KitExtras", "PersonBot", "FontBricolage", "FileUpload"];
const OLD = ["BotsKit"];

async function draw(screenId: string, client: "phone" | "desktop", o: { can?: string[]; params?: Record<string, string>; api?: Record<string, unknown> } = {}) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const s = await buildBotsScreen(
    { screenId, client, params: o.params ?? {}, tzOffsetMinutes: IST, user: { id: U, name: "Aanya" }, can: new Set(o.can ?? NEW), desk: { pages: client === "desktop", notes: false } },
    fakeDeps({ api: { ...(await sampleApi()), ...(o.api ?? {}) }, calls, now: FIXED_NOW }),
  );
  const nodes = walk(s.root!);
  return { s, nodes, texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? "")), calls };
}

/** Every action in a tree, flattened. */
function actions(x: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(x)) { for (const v of x) actions(v, out); return out; }
  if (!x || typeof x !== "object") return out;
  const o = x as Record<string, unknown>;
  if (typeof o.kind === "string") out.push(o);
  for (const v of Object.values(o)) actions(v, out);
  return out;
}

const CAPTURE = {
  id: "11111111-2222-4333-8444-555555555555", state: "ready", label: "school circular", title: "4 things from the school circular",
  rows: [
    { id: "i1", tick: true, title: "Dress-up day: fruits", line: "Fri 13 Nov · buy fruit costume by Wed", dateAsk: false },
    { id: "i2", tick: true, title: "Field trip money · ₹300", line: "Pay by Wed 11 Nov", dateAsk: false },
    { id: "i3", tick: true, title: "Parent-teacher meeting", line: "Sat 14 Nov · 9:30 am · School hall", dateAsk: false, person: { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Mom" } },
    { id: "i4", tick: false, title: "Sports day", line: "", dateAsk: true },
  ],
  already: "Already on your plan: PTM", button: "Add 3",
};

describe("the capture card", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`draws one title, its rows, "Date?" on the unsure one and one button (${client})`, async () => {
      const d = await draw("bots.plan.capture", client, { params: { id: CAPTURE.id }, api: { [`GET ${A}/plan/capture/${CAPTURE.id}`]: { capture: CAPTURE } } });
      expect(lintTree(d.s.root!)).toEqual([]);
      expect(d.texts).toContain("4 things from the school circular");
      expect(d.texts).toContain("Field trip money · ₹300");
      expect(d.texts).toContain("Date?");
      expect(d.texts).toContain("Already on your plan: PTM");
      expect(d.nodes.filter((n) => n.type === "PersonBot")).toHaveLength(1);
      const add = actions(d.s.root).find((a) => a.kind === "callEndpoint" && (a.body as Record<string, unknown> | undefined)?.action === "addall");
      expect(add).toMatchObject({ path: "/v1/widgets/act", body: { item: `pc:${CAPTURE.id}` } });
      // No "Not now": leaving the card is not now.
      expect(d.texts.some((t) => /not now|later/i.test(t))).toBe(false);
    });
  }

  it("reads the share-in screen as the card when what was shared is Plan Ease's, with no bot picker", async () => {
    const d = await draw("bots.share-in", "phone", { params: { text: "PTM on Sat 14 Nov at 9:30 am" }, api: { [`POST ${A}/plan/capture/look`]: { capture: CAPTURE } } });
    expect(d.texts).toContain("4 things from the school circular");
    expect(d.texts).not.toContain("Send to a bot");
    const picker = await draw("bots.share-in", "phone", { params: { text: "haha see you" }, api: { [`POST ${A}/plan/capture/look`]: { plan: false } } });
    expect(picker.texts).toContain("Send to a bot");
  });

  it("never asks for AI: without a yes the card is the server's rules card (or one to-do for a photo), with no AI card and no word of AI", async () => {
    const { CAPTURE_API, RULES_ID, PHOTO_ID, CIRCULAR_WORDS } = await import("../scripts/bots-render/samples/planCapture.js");
    const drawn = [
      ...(["phone", "desktop"] as const).map((c) => draw("bots.plan.capture", c, { params: { id: RULES_ID }, api: CAPTURE_API })),
      draw("bots.plan.capture", "phone", { params: { id: PHOTO_ID }, api: CAPTURE_API }),
      draw("bots.share-in", "phone", { params: { text: CIRCULAR_WORDS }, api: CAPTURE_API }),
      // Even handed the old answer that waited on a yes (`consent: true`), the card draws no ask.
      draw("bots.plan.capture", "phone", { params: { id: CAPTURE.id }, api: { [`GET ${A}/plan/capture/${CAPTURE.id}`]: { capture: { ...CAPTURE, state: "consent", consent: true, rows: [], title: "The school circular", button: "" } } } }),
    ];
    for (const d of await Promise.all(drawn)) {
      expect(lintTree(d.s.root!)).toEqual([]);
      expect(d.texts.filter((t) => /\bAI\b|agree|needs your OK|not now|privacy/i.test(t))).toEqual([]);
      expect(d.nodes.some((n) => n.type === "BotCard")).toBe(false);
      expect(actions(d.s.root).filter((a) => a.kind === "callEndpoint" && /ai-consent|\/consent$|\/plain$/.test(String(a.path)))).toEqual([]);
    }
    const [rules, , photo, share] = await Promise.all(drawn);
    expect(rules!.texts).toEqual(expect.arrayContaining(["3 things from the school circular", "Field trip fee · ₹300", "Add all"]));
    expect(share!.texts).toContain("3 things from the school circular");
    expect(photo!.texts).toEqual(expect.arrayContaining(["The photo", "Added: Look at the photo", "Open Plan"]));
  });

  it("gives an older build nothing of the newer kit", async () => {
    const d = await draw("bots.plan.capture", "phone", { can: OLD, params: { id: CAPTURE.id }, api: { [`GET ${A}/plan/capture/${CAPTURE.id}`]: { capture: CAPTURE } } });
    expect(actions(d.s.root).some((a) => "stay" in a)).toBe(false);
    expect(d.nodes.some((n) => n.type === "PersonBot")).toBe(false);
  });
});

describe("the link page", () => {
  it("has three rows with their steps, one field and one button; the phone sends Google and Outlook to x0bot.com/cal", async () => {
    const d = await draw("bots.plan.link", "phone", { api: { [`GET ${A}/plan/links`]: { links: [{ id: "l1", provider: "google", name: "Google Calendar", hint: "calendar.google.com/…a91f", stopped: false }] } } });
    expect(lintTree(d.s.root!)).toEqual([]);
    for (const t of ["Link your calendar", "Where are your meetings?", "Google Calendar", "Outlook", "iPhone (iCloud)", "Link", "Keep this link private. I keep it locked and only read from it."]) expect(d.texts).toContain(t);
    expect(d.texts.filter((t) => t.startsWith("On your computer, go to x0bot.com/cal"))).toHaveLength(2);
    expect(d.texts).toContain("calendar.google.com/…a91f");
    const desk = await draw("bots.plan.link", "desktop", { api: { [`GET ${A}/plan/links`]: { links: [] } } });
    expect(desk.texts.filter((t) => t === "Open its settings")).toHaveLength(2);
    expect(desk.texts.some((t) => t.includes("x0bot.com/cal"))).toBe(false);
  });
});

describe("details", () => {
  it("a work meeting: from the work calendar, no buttons", async () => {
    const ref = "wk-abcdefghijklmnopqrstuv";
    const d = await draw("bots.plan.item", "phone", { params: { kind: "event", id: ref }, api: { [`GET ${A}/plan/linked/${ref}?tz=${IST}`]: { meeting: { title: "Board call", day: "2026-11-13", start: Date.UTC(2026, 10, 13, 3, 30), end: Date.UTC(2026, 10, 13, 4, 30), allDay: false, people: 6, provider: "google" } } } });
    expect(d.texts).toContain("From your work calendar");
    expect(d.texts).toContain("Change it in your work calendar.");
    for (const t of ["Move", "Done", "Take it out", "Save"]) expect(d.texts).not.toContain(t);
  });

  it("a bill: its amount inside the app, Pay only with a safe link, Paid, Take it out, and the capture's foot", async () => {
    const task = { id: "33333333-2222-4333-8444-555555555555", title: "Electricity", notes: "", list: "", due: "2026-11-14", at: null, done: false, doneAt: null, remindMin: 0, from: "electricity bill", source: "capture", fixed: false, kind: "due", amountPaise: 214000, payee: "BESCOM", captureId: CAPTURE.id };
    const withLink = await draw("bots.plan.item", "phone", { params: { kind: "task", id: task.id }, api: { [`GET /v1/botsapp/calendar/tasks/${task.id}`]: { task: { ...task, payLink: "upi://pay?pa=bescom@hdfcbank" } } } });
    expect(withLink.texts).toContain("Electricity ₹2,140");
    expect(withLink.texts).toContain("BESCOM");
    expect(withLink.texts).toContain("From the electricity bill");
    expect(withLink.texts).toContain("Take out all from the electricity bill");
    const labels = (n: { texts: string[] }) => ["Pay", "Paid", "Take it out"].filter((t) => n.texts.includes(t));
    expect(labels(withLink)).toEqual(["Pay", "Paid", "Take it out"]);
    const noLink = await draw("bots.plan.item", "phone", { params: { kind: "task", id: task.id }, api: { [`GET /v1/botsapp/calendar/tasks/${task.id}`]: { task } } });
    expect(labels(noLink)).toEqual(["Paid", "Take it out"]);
    expect(noLink.texts).toContain("Pay it from your bank or UPI app.");
  });

  it("a notification's Pay opens the bill's own link, read from the server", async () => {
    const id = "33333333-2222-4333-8444-555555555555";
    const d = await draw("bots.plan.go", "phone", { params: { go: "pay", item: `pt:${id}` }, api: { [`GET ${A}/plan/pay/${id}`]: { url: "upi://pay?pa=bescom@hdfcbank" } } });
    expect(actions(d.s.root).find((a) => a.kind === "openUrl")).toMatchObject({ url: "upi://pay?pa=bescom@hdfcbank" });
    const none = await draw("bots.plan.go", "phone", { params: { go: "pay", item: `pt:${id}` } });
    expect(actions(none.s.root).some((a) => a.kind === "openUrl")).toBe(false);
  });

  it("from a notification, only its Pay opens UPI: tapping \"Electricity due today\" to look opens the Plan", async () => {
    const id = "33333333-2222-4333-8444-555555555555";
    const api = { [`GET ${A}/plan/pay/${id}`]: { url: "upi://pay?pa=bescom@hdfcbank" } };
    const tap = await draw("bots.plan.go", "phone", { can: [...NEW, "PushButton"], params: { go: "pay", item: `pt:${id}`, pushId: "p1" }, api });
    expect(actions(tap.s.root).some((a) => a.kind === "openUrl")).toBe(false);
    const pay = await draw("bots.plan.go", "phone", { can: [...NEW, "PushButton"], params: { go: "pay", item: `pt:${id}`, pushId: "p1", button: "p_pay" }, api });
    expect(actions(pay.s.root).find((a) => a.kind === "openUrl")).toMatchObject({ url: "upi://pay?pa=bescom@hdfcbank" });
    // A build that can't say which was pressed: the person taps Pay here.
    const old = await draw("bots.plan.go", "phone", { params: { go: "pay", item: `pt:${id}`, pushId: "p1" }, api });
    expect(old.texts).toContain("Pay");
  });
});

describe("the routes", () => {
  async function served() {
    const app = Fastify();
    registerBotsBotsRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, bots: null, code: null, jobs: null, connectors: null, media: null, artifacts: null });
    await app.ready();
    return app;
  }

  it("x0bot.com/cal: one field, then a 6-number code; nothing is fetched and the link is never in the page", async () => {
    const app = await served();
    const page = await app.inject({ method: "GET", url: "/cal" });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-security-policy"]).toContain("form-action 'self'");
    expect(page.body).toContain("Paste the link here");
    const link = "https://calendar.google.com/calendar/ical/me%40work.com/private-a91fsecret/basic.ics";
    const got = await app.inject({ method: "POST", url: "/cal", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: `link=${encodeURIComponent(link)}` });
    expect(got.statusCode).toBe(200);
    expect(got.body).toMatch(/class="code">\d{3} \d{3}</);
    expect(got.body).not.toContain("a91fsecret");
    const wrong = await app.inject({ method: "POST", url: "/cal", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "link=not-a-link" });
    expect(wrong.body).toContain("look like a calendar link");
    await app.close();
  });

  it("the share-in ask says no to a plain chat, and the link page lists nothing yet", async () => {
    const app = await served();
    const auth = { authorization: `Bearer ${U}` };
    const look = await app.inject({ method: "POST", url: `${A}/plan/capture/look`, headers: auth, payload: { text: "haha see you tonight" } });
    expect(look.json()).toEqual({ plan: false });
    expect((await app.inject({ method: "GET", url: `${A}/plan/links`, headers: auth })).json()).toEqual({ links: [] });
    expect((await app.inject({ method: "GET", url: `${A}/plan/links` })).statusCode).toBe(401);
    await app.close();
  });
});
