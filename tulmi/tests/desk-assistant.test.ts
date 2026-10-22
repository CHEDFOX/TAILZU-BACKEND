import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

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
process.env.CONNECTORS_ENABLED_IDS = "notion, zapier";
process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");

const seen = vi.hoisted(() => ({ items: [] as string[] }));
vi.mock("openai", () => ({
  default: class {
    audio = { transcriptions: { create: async () => ({ text: "" }) } };
    chat = {
      completions: {
        create: async (body: { messages: Array<{ content: string }> }) => {
          const input = String(body.messages[1]?.content ?? "");
          const at = input.indexOf("Input JSON:");
          if (at < 0) return { choices: [{ message: { content: "{}" } }] };
          const items = JSON.parse(input.slice(at + "Input JSON:".length)) as string[];
          seen.items.push(...items);
          return { choices: [{ message: { content: JSON.stringify({ items: items.map((s) => "MODEL:" + s) }) } }] };
        },
      },
    };
  },
  toFile: async (b: Buffer, name: string) => ({ b, name }),
}));

const { buildScreen, buildBootstrap } = await import("../src/experience/catalog.js");
const { DESK_SCREENS, deskNav } = await import("../src/experience/desk.js");
const { approvalCard } = await import("../src/connectors/card.js");
const { buildApp } = await import("../src/server.js");

type AnyNode = { type?: string; props?: Record<string, any>; on?: Record<string, any>; children?: AnyNode[] };
function nodes(root: unknown, keep: (n: AnyNode) => boolean): AnyNode[] {
  const out: AnyNode[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const n = v as AnyNode;
    if (typeof n.type === "string" && keep(n)) out.push(n);
    for (const c of Object.values(n)) if (c && typeof c === "object") walk(c);
  };
  walk(root);
  return out;
}
const buttons = (root: unknown) => nodes(root, (n) => n.type === "Button");
const labelled = (root: unknown, label: string) => buttons(root).filter((b) => b.props?.label === label);
const ids = (nav: unknown) => (nav as { tabs: Array<{ id: string }> }).tabs.map((t) => t.id);

const CAN = ["DeskShell", "DeskConnectors"];
const ctx = (extra: Record<string, unknown>, can = CAN) =>
  ({ personality: {}, language: "en", formFactor: "desktop", can: new Set(can), ...extra }) as never;
const names = { notion: "Notion", zapier: "Zapier" };
const app = (o: Record<string, unknown>) => ({
  id: "notion", name: "Notion", category: "Docs", oneLine: "Search, read and write pages.", auth: "oauth",
  connected: false, level: "look", auto: [], ...o,
});

describe("Connected apps in the desk's Settings", () => {
  it("is not there without the apps to show", () => {
    expect(JSON.stringify(buildScreen("desk_settings", ctx({}, ["DeskShell"])))).not.toContain("Connected apps");
    expect(JSON.stringify(buildScreen("desk_settings", ctx({ assistant: { apps: [], names } })))).not.toContain("Connected apps");
  });

  it("an app that is not connected says so and has Connect, which signs in through the connect route", () => {
    const s = buildScreen("desk_settings", ctx({ assistant: { apps: [app({})], names } }))!;
    const json = JSON.stringify(s);
    for (const w of ["Connected apps", "What I can reach, and how far I can go.", "Not connected"]) expect(json, w).toContain(w);
    const [connect] = labelled(s.root, "Connect");
    expect(connect!.on!.onPress).toMatchObject({ kind: "connector.connect", id: "notion" });
    expect(connect!.on!.onPress).not.toHaveProperty("urlPath");
    // Nothing to set until it is connected.
    expect(json).not.toContain("How far can I go in Notion?");
    expect(labelled(s.root, "Can look")).toHaveLength(0);
  });

  it("a connected app shows its level as a choice of three, and Disconnect", () => {
    const s = buildScreen("desk_settings", ctx({ assistant: { apps: [app({ connected: true, level: "draft" })], names } }))!;
    const json = JSON.stringify(s);
    expect(json).toContain("Connected");
    expect(json).toContain("How far can I go in Notion?");
    expect(json).toContain("I write drafts for you. Nothing goes out.");
    expect(labelled(s.root, "Connect")).toHaveLength(0);
    const on = labelled(s.root, "Can draft")[0]!;
    expect(on.props!.cls).toBe("d-seg-item d-seg-on");
    expect(on.on).toBeUndefined();
    for (const [label, level] of [["Can look", "look"], ["Can send", "send"]] as const) {
      const b = labelled(s.root, label)[0]!;
      expect(b.props!.cls).toBe("d-seg-item");
      expect(b.on!.onPress).toMatchObject({ kind: "callEndpoint", method: "POST", path: "/v1/connectors/notion/level", body: { level } });
    }
    expect(labelled(s.root, "Disconnect Notion")[0]!.on!.onPress).toMatchObject({ kind: "callEndpoint", method: "DELETE", path: "/v1/connectors/notion" });
  });

  it("an app that asked for a new sign-in says so and offers Connect again", () => {
    const s = buildScreen("desk_settings", ctx({ assistant: { apps: [app({ connected: true, needsSignIn: true })], names } }))!;
    expect(JSON.stringify(s)).toContain("Sign in again");
    expect(labelled(s.root, "Connect")).toHaveLength(1);
  });

  it("an app that takes a pasted link has a field for it, and Connect reads it", () => {
    const z = app({ id: "zapier", name: "Zapier", auth: "url" });
    const s = buildScreen("desk_settings", ctx({ assistant: { apps: [z], names } }))!;
    const [field] = nodes(s.root, (n) => n.type === "TextField");
    expect(field!.props!.placeholder).toBe("Paste the link Zapier gave you");
    expect(labelled(s.root, "Connect")[0]!.on!.onPress).toMatchObject({ kind: "connector.connect", id: "zapier", urlPath: "link.zapier" });
  });
});

describe("the Tasks page", () => {
  const task = (o: Record<string, unknown>) => ({ id: "t1", state: "done", title: "Post standup summary", steps: [], approval: null, createdAt: 1, updatedAt: 2, ...o });
  const tasks = [
    task({ id: "w1", state: "waiting", title: "Post to #design", steps: [{ at: 1, text: "Waiting for you: Post message in Notion" }], approval: { id: "ap1", connector: "notion", tool: "post", risk: "send", preview: "Post message in Notion - text: Ready" } }),
    task({ id: "r1", state: "running", title: "Collect issues", steps: [{ at: 1, text: "Linear: List issues" }] }),
    task({ id: "d1", state: "done", title: "Reply to Priya", steps: [{ at: 1, text: "Gmail: Send email (you approved)" }] }),
    task({ id: "d2", state: "cancelled", title: "Delete the page", steps: [{ at: 1, text: "You said no to Delete page" }] }),
  ];

  it("groups Waiting for you, Running and Done, in plain words", () => {
    const s = buildScreen("desk_tasks", ctx({ assistant: { tasks, names } }))!;
    const json = JSON.stringify(s);
    const at = (w: string) => json.indexOf(w);
    expect(at("Waiting for you")).toBeGreaterThan(-1);
    expect(at("Waiting for you")).toBeLessThan(at("\"Running\""));
    expect(at("\"Running\"")).toBeLessThan(at("\"Done\""));
    for (const w of ["Post to #design", "Notion · needs your OK", "Collect issues", "Linear: List issues", "Done ✓ Gmail: Send email (you approved)", "You said no to Delete page", "That’s everything."]) {
      expect(json, w).toContain(w);
    }
  });

  it("Approve and Not now call the task routes; the exact words are on the page", () => {
    const s = buildScreen("desk_tasks", ctx({ assistant: { tasks, names } }))!;
    expect(JSON.stringify(s)).toContain("Post message in Notion - text: Ready");
    expect(labelled(s.root, "Approve")[0]!.on!.onPress).toMatchObject({ kind: "callEndpoint", method: "POST", path: "/v1/tasks/w1/approve", body: { approvalId: "ap1" } });
    expect(labelled(s.root, "Not now")[0]!.on!.onPress).toMatchObject({ kind: "callEndpoint", method: "POST", path: "/v1/tasks/w1/deny" });
    // Only the waiting one can be answered.
    expect(labelled(s.root, "Approve")).toHaveLength(1);
  });

  it("says so when there is nothing yet", () => {
    const s = buildScreen("desk_tasks", ctx({ assistant: { tasks: [], names } }))!;
    expect(JSON.stringify(s)).toContain("Nothing yet.");
    expect(buttons(s.root)).toHaveLength(0);
  });

  it("is a desk page, and its tab is in the masthead only for a window that can show it", () => {
    expect(DESK_SCREENS.has("desk_tasks")).toBe(true);
    expect(ids(deskNav(true, true)).slice(0, 3)).toEqual(["desk_today", "desk_notes", "desk_tasks"]);
    expect(ids(deskNav(false, true))).toContain("desk_tasks");
    expect(ids(deskNav(false, false))).not.toContain("desk_tasks");
    const b = buildBootstrap({ formFactor: "desktop", desk: true, deskTasks: true } as never) as { navigation: unknown };
    expect(ids(b.navigation)).toContain("desk_tasks");
  });
});

describe("the confirm card", () => {
  const approval = { id: "ap1", connector: "slack", tool: "post_message", risk: "send" as const, preview: "Post message in Slack - channel: #design" };

  it("carries its words, its buttons and the routes they call", () => {
    const c = approvalCard("task-1", approval, "Slack")!;
    expect(c).toMatchObject({
      title: "Ready to send?", app: "Slack", label: "The exact message", preview: approval.preview,
      note: "Approve once, and I’ll do this in Slack without asking again. Deleting always asks.",
      after: { done: "Done ✓", left: "Okay, I left it.", failed: "That didn’t go through.", change: "What should I change?" },
    });
    expect(c.buttons).toEqual([
      { id: "approve", label: "Approve", call: { method: "POST", path: "/v1/tasks/task-1/approve", body: { approvalId: "ap1" } } },
      { id: "edit", label: "Edit", call: { method: "POST", path: "/v1/tasks/task-1/deny" }, then: "listen" },
      { id: "deny", label: "Not now", call: { method: "POST", path: "/v1/tasks/task-1/deny" } },
    ]);
  });

  it("is worded for what is being done", () => {
    expect(approvalCard("t", { ...approval, risk: "destructive" }, "Slack")!.title).toBe("Ready to delete this?");
    expect(approvalCard("t", { ...approval, risk: "write" }, "Slack")!.label).toBe("The exact change");
  });

  it("speaks Hinglish for a Hinglish profile, in the design's words", () => {
    const c = approvalCard("t", approval, "Slack", "hinglish")!;
    expect(c.title).toBe("Bhejne ke liye taiyaar?");
    expect(c.buttons.map((b) => b.label)).toEqual(["Approve karo", "Badlo", "Abhi nahi"]);
    expect(approvalCard("t", approval, "Slack", "hi")!.title).toBe("Ready to send?");
  });

  it("puts no id it did not make into a path", () => {
    expect(approvalCard("../../x", approval, "Slack")).toBeUndefined();
    expect(approvalCard("a b", approval, "Slack")).toBeUndefined();
  });
});

describe("through the server", () => {
  let server: FastifyInstance;
  beforeAll(async () => { server = await buildApp(); await server.ready(); });
  afterAll(async () => { await server.close(); });
  const auth = { authorization: "Bearer test-static-token-0123456789" };
  const caps = (components: string[]) => ({
    platform: "ios", appVersion: "0.5.0", components,
    device: { formFactor: "desktop", os: "mac", width: 1100, height: 760 },
  });

  it("sends Connected apps and the Tasks tab to a window that said DeskConnectors", async () => {
    const page = await server.inject({ method: "POST", url: "/v1/app/screen", headers: auth, payload: { screenId: "desk_settings", capabilities: caps(CAN) } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Connected apps");
    expect(page.body).toContain("Notion");
    expect(page.body).toContain("Zapier");
    expect(page.body).toContain('"kind":"connector.connect"');
    const tasks = await server.inject({ method: "POST", url: "/v1/app/screen", headers: auth, payload: { screenId: "desk_tasks", capabilities: caps(CAN) } });
    expect(tasks.body).toContain("Nothing yet.");
    const boot = await server.inject({ method: "POST", url: "/v1/app/bootstrap", headers: auth, payload: { capabilities: caps(CAN) } });
    expect(boot.body).toContain('"id":"desk_tasks"');
  });

  it("sends neither to a window that did not", async () => {
    const page = await server.inject({ method: "POST", url: "/v1/app/screen", headers: auth, payload: { screenId: "desk_settings", capabilities: caps(["DeskShell"]) } });
    expect(page.body).not.toContain("Connected apps");
    const boot = await server.inject({ method: "POST", url: "/v1/app/bootstrap", headers: auth, payload: { capabilities: caps(["DeskShell"]) } });
    expect(boot.body).not.toContain('"id":"desk_tasks"');
  });
});
