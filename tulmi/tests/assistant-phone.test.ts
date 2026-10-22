/**
 * The assistant on the phone (experience/assistant.ts): Connected apps, Tasks
 * and the confirm sheet are built here and only drawn by the app.
 */
import { describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ items: [] as string[] }));
vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async (body: { messages: Array<{ content: string }> }) => {
          const input = body.messages[1]!.content;
          const items = JSON.parse(input.slice(input.indexOf("Input JSON:") + "Input JSON:".length)) as string[];
          seen.items.push(...items);
          return { choices: [{ message: { content: JSON.stringify({ items: items.map((s) => "MODEL:" + s) }) } }] };
        },
      },
    };
  },
}));
// The translation cache stays in memory: nothing is read from or written to the working directory.
vi.mock("node:fs/promises", () => ({
  readFile: async () => { throw new Error("no cache here"); },
  writeFile: async () => {},
  mkdir: async () => {},
}));

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

const { buildScreen } = await import("../src/experience/catalog.js");
const { localize } = await import("../src/experience/i18n.js");
const { ASSISTANT_SCREENS } = await import("../src/experience/assistant.js");
const { EN, HG } = await import("../src/connectors/words.js");

type AnyNode = { type?: string; props?: Record<string, any>; on?: Record<string, any>; bind?: Record<string, string>; visibleIf?: unknown; children?: AnyNode[] };
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
/** Every action spec anywhere in a tree, nested ones included. */
function actions(root: unknown): any[] {
  const out: any[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const o = v as Record<string, unknown>;
    if (typeof o.kind === "string") out.push(o);
    for (const c of Object.values(o)) walk(c);
  };
  walk(root);
  return out;
}
const texts = (root: unknown) => nodes(root, (n) => n.type === "Text").map((n) => n.props?.content as string);
const pressing = (root: unknown, text: string) =>
  nodes(root, (n) => !!n.on?.onPress && texts(n.children).includes(text))[0];

const names = { notion: "Notion", linear: "Linear", zapier: "Zapier", github: "GitHub" };
const app = (o: Record<string, unknown>) => ({
  id: "notion", name: "Notion", category: "Docs", oneLine: "Pages.", auth: "oauth", connected: false, level: "look", auto: [], ...o,
});
const apps = [
  app({}),
  app({ id: "linear", name: "Linear", connected: true, level: "draft" }),
  app({ id: "zapier", name: "Zapier", auth: "url" }),
  app({ id: "github", name: "GitHub", connected: true, needsSignIn: true }),
];
const PREVIEW = "Add comment in Notion — page: \"Launch checklist\"; text: \"Standup: shipped onboarding. Rahul reviews pricing copy.\"";
const task = (o: Record<string, unknown>) => ({ id: "t1", state: "done", title: "Post the standup summary", steps: [], approval: null, createdAt: 1, updatedAt: 2, ...o });
const tasks = [
  task({ id: "w1", state: "waiting", steps: [{ at: 1, text: "Waiting for you: Add comment in Notion" }],
    approval: { id: "ap1", connector: "notion", tool: "add_comment", risk: "send", preview: PREVIEW } }),
  task({ id: "r1", state: "running", title: "Collect this week's issues", steps: [{ at: 1, text: "Linear: List issues" }] }),
  task({ id: "d1", state: "done", title: "Reply to Priya", steps: [{ at: 1, text: "Gmail: Send email (you approved)" }] }),
  task({ id: "d2", state: "cancelled", title: "Delete the page", steps: [{ at: 1, text: "You said no to Delete page" }] }),
];

const build = (id: string, extra: Record<string, unknown>, can: string[] = ["ActionUrl"]) =>
  buildScreen(id, { personality: {}, language: "en", formFactor: "phone", can: new Set(can), ...extra } as never)!;

describe("Connected apps", () => {
  const s = build("assistant_apps", { assistant: { apps, names } });

  it("is the phone's own set of ids, and opts out of the capitalising pass so the words stay the table's", () => {
    expect([...ASSISTANT_SCREENS].sort()).toEqual(["assistant_app_tools", "assistant_approve", "assistant_apps", "assistant_tasks"]);
    expect((s.root as AnyNode).props!.keepCase).toBe(true);
    expect(s.hideHeader).toBe(true);
    const all = texts(s.root);
    for (const w of [EN["s6.sug"], EN["apps.h"], EN["lv.draft"], EN.connect, EN["st.ok"], EN["st.re"]]) expect(all, w).toContain(w);
  });

  it("puts Suggested for you first, then what is connected, as tiles", () => {
    const labels = texts(s.root);
    expect(labels.indexOf(EN["s6.sug"])).toBeGreaterThan(-1);
    // (the head's own title says "Connected apps" too, so the section label is the last of them)
    expect(labels.indexOf(EN["s6.sug"])).toBeLessThan(labels.lastIndexOf(EN["apps.h"]));
    const grids = nodes(s.root, (n) => n.type === "Grid");
    expect(grids).toHaveLength(2);
    expect(grids[0]!.children).toHaveLength(2); // Notion, Zapier not connected yet
    expect(grids[1]!.children).toHaveLength(2); // Linear, GitHub
  });

  it("an app's name and the person's own words are drawn from state, never written into a node", () => {
    expect(JSON.stringify(s.root)).not.toContain("Notion\"");
    expect(s.state!.n).toMatchObject({ notion: "Notion", linear: "Linear" });
    expect(s.state!.lvl).toMatchObject({ linear: "draft" });
  });

  it("Connect asks the server for the sign-in page and opens it in the system browser", () => {
    const tile = nodes(s.root, (n) => n.props?.pressOpacity === 0.7 && n.on?.onPress?.kind === "sequence"
      && actions(n.on.onPress).some((a) => a.kind === "callEndpoint" && a.path === "/v1/connectors/notion/connect"))[0]!;
    const c = actions(tile.on!.onPress).find((a) => a.kind === "callEndpoint");
    expect(c).toMatchObject({ method: "POST", path: "/v1/connectors/notion/connect", body: {}, assignTo: "link", onSuccess: { kind: "openUrl", url: "$state.link.authorizeUrl" } });
  });

  it("a build that cannot open the page is not sent the tap, and is told why", () => {
    const old = build("assistant_apps", { assistant: { apps, names } }, []);
    expect(actions(old.root).filter((a) => a.kind === "openUrl")).toHaveLength(0);
    expect(texts(old.root)).toContain(EN["apps.update"]);
    expect(actions(old.root).some((a) => a.kind === "callEndpoint" && /\/connect$/.test(a.path))).toBe(true); // Zapier's paste sheet still works
  });

  it("a connected app's sheet has the three levels, each calling the level route, and Disconnect", () => {
    const sheet = nodes(s.root, (n) => n.type === "BottomSheet" && n.bind?.open === "sheet.linear")[0]!;
    const t = texts(sheet);
    for (const w of [EN["a2.q"].replace("{app}", "Linear"), EN["lv.look"], EN["lv.look.d"], EN["lv.draft.d"], EN["lv.send"], EN["lv.send.d"], EN["a2.foot"], EN["a2.dis"].replace("{app}", "Linear")]) {
      expect(t, w).toContain(w);
    }
    const levels = actions(sheet).filter((a) => a.kind === "callEndpoint" && a.path === "/v1/connectors/linear/level");
    expect(levels.map((a) => a.body.level).sort()).toEqual(["draft", "look", "send"]);
    expect(actions(sheet).find((a) => a.kind === "callEndpoint" && a.method === "DELETE")).toMatchObject({ path: "/v1/connectors/linear" });
  });

  it("an app that asked for a new sign-in says so and offers it again", () => {
    const sheet = nodes(s.root, (n) => n.type === "BottomSheet" && n.bind?.open === "sheet.github")[0]!;
    expect(texts(sheet)).toContain(EN["st.re"]);
    expect(actions(sheet).some((a) => a.kind === "callEndpoint" && a.path === "/v1/connectors/github/connect")).toBe(true);
  });

  it("an app that takes a link has a field for it; Connect sends what was pasted", () => {
    const sheet = nodes(s.root, (n) => n.type === "BottomSheet" && n.bind?.open === "sheet.zapier")[0]!;
    const field = nodes(sheet, (n) => n.type === "TextField")[0]!;
    expect(field.bind).toEqual({ value: "paste.zapier" });
    expect(field.props!.placeholder).toBe(EN["link.ph"].replace("{app}", "Zapier"));
    expect(actions(sheet).find((a) => a.kind === "callEndpoint")).toMatchObject({ path: "/v1/connectors/zapier/connect", body: { url: "$state.paste.zapier" } });
  });

  it("says so, in the assistant's words, when connected apps are off", () => {
    const off = build("assistant_apps", {});
    expect(texts(off.root)).toContain(EN["apps.off"]);
    expect(nodes(off.root, (n) => n.type === "Grid")).toHaveLength(0);
  });
});

describe("Tasks", () => {
  const s = build("assistant_tasks", { assistant: { tasks, names } });

  it("groups Waiting for you, Running and Done, with what was done in plain words", () => {
    const t = texts(s.root);
    const at = (w: string) => t.indexOf(w);
    expect(at(EN["a4.w"])).toBeGreaterThan(-1);
    expect(at(EN["a4.w"])).toBeLessThan(at(EN["a4.r"]));
    expect(at(EN["a4.r"])).toBeLessThan(at(EN["a4.d"]));
    expect(t).toContain(EN["a4.wm"].replace("{app}", "Notion"));
    expect(t).toContain(EN["a4.end"]);
    const rows = (s.state as { t: Array<{ title: string; step: string }> }).t;
    expect(rows.map((r) => r.title)).toEqual(["Post the standup summary", "Collect this week's issues", "Reply to Priya", "Delete the page"]);
    expect(rows.map((r) => r.step)).toContain("Gmail: Send email (you approved)");
    expect(rows.map((r) => r.step)).toContain("You said no to Delete page");
  });

  it("the exact preview is in state, bound to the row, and in no node a translator could reword", () => {
    expect((s.state as { t: Array<{ preview: string }> }).t[0]!.preview).toBe(PREVIEW);
    expect(JSON.stringify(s.root)).not.toContain("Standup: shipped");
    expect(JSON.stringify(s.root)).not.toContain("Reply to Priya");
    expect(nodes(s.root, (n) => n.bind?.content === "t.0.preview")).toHaveLength(1);
  });

  it("a waiting task has Approve and Not now; Approve is only reachable through Face ID or a fingerprint", () => {
    const approve = pressing(s.root, EN["a3.ok"])!;
    const gate = approve.on!.onPress;
    expect(gate).toMatchObject({ kind: "biometricPrompt", reason: EN["a3.reason"].replace("{app}", "Notion") });
    // The route is behind the check, never beside it.
    expect(actions(gate.onSuccess).find((a) => a.kind === "callEndpoint")).toMatchObject({
      method: "POST", path: "/v1/tasks/w1/approve", body: { approvalId: "ap1" },
    });
    expect(actions(s.root).filter((a) => a.kind === "callEndpoint" && /\/approve$/.test(a.path))).toHaveLength(1);
    // A phone with nothing to check against is taken to the sheet, which says so.
    expect(gate.onUnavailable).toMatchObject({ kind: "navigate", screenId: "assistant_approve", params: { taskId: "w1" } });
    const no = pressing(s.root, EN["a3.later"])!;
    expect(actions(no.on!.onPress).find((a) => a.kind === "callEndpoint")).toMatchObject({ method: "POST", path: "/v1/tasks/w1/deny" });
  });

  it("with nothing yet, says so", () => {
    expect(texts(build("assistant_tasks", { assistant: { tasks: [], names } }).root)).toContain(EN["tasks.empty"]);
  });
});

describe("The confirm sheet", () => {
  const s = build("assistant_approve", { assistant: { tasks, names }, params: { taskId: "w1" } });
  const sheet = nodes(s.root, (n) => n.type === "BottomSheet")[0]!;

  it("is a bottom sheet, open, with the card's own words and the exact preview", () => {
    expect(sheet.bind).toEqual({ open: "open" });
    expect(s.state).toMatchObject({ open: true, plain: false, preview: PREVIEW, app: "Notion" });
    const t = texts(sheet);
    for (const w of [EN["a3.h.send"], EN["a3.lab.send"], EN["a3.wwl"].replace("{app}", "Notion"), EN["a3.ok"], EN["a3.edit"], EN["a3.later"]]) expect(t, w).toContain(w);
    expect(JSON.stringify(sheet)).not.toContain("Standup: shipped");
    expect(nodes(sheet, (n) => n.bind?.content === "preview")).toHaveLength(1);
  });

  it("Approve checks with Face ID or a fingerprint first; the plain tap appears only when the phone has neither", () => {
    const approves = nodes(sheet, (n) => n.on?.onPress && texts(n.children).includes(EN["a3.ok"]));
    expect(approves).toHaveLength(2);
    const [checked, plain] = approves;
    expect(checked!.visibleIf).toEqual({ falsy: "plain" });
    expect(checked!.on!.onPress).toMatchObject({ kind: "biometricPrompt", onUnavailable: { kind: "setState", path: "plain", value: true } });
    expect(plain!.visibleIf).toEqual({ truthy: "plain" });
    expect(plain!.on!.onPress.kind).not.toBe("biometricPrompt");
    expect(nodes(sheet, (n) => (n.visibleIf as { truthy?: string } | undefined)?.truthy === "plain" && texts(n.children).includes(EN["a3.nobio"]))).toHaveLength(0);
    expect(texts(sheet)).toContain(EN["a3.nobio"]);
    // Only the yes can send; every route is the card's.
    const posts = actions(sheet).filter((a) => a.kind === "callEndpoint").map((a) => a.path);
    expect(posts.filter((p) => p.endsWith("/approve"))).toHaveLength(2);
    expect(posts.every((p) => p.startsWith("/v1/tasks/w1/"))).toBe(true);
  });

  it("Not now and Edit say no to this one; leaving it unanswered keeps it waiting", () => {
    const deny = actions(pressing(sheet, EN["a3.later"])!.on!.onPress).find((a) => a.kind === "callEndpoint");
    expect(deny).toMatchObject({ path: "/v1/tasks/w1/deny" });
    const edit = actions(pressing(sheet, EN["a3.edit"])!.on!.onPress);
    expect(edit.find((a) => a.kind === "callEndpoint")).toMatchObject({ path: "/v1/tasks/w1/deny" });
    expect(edit.find((a) => a.kind === "toast")).toMatchObject({ message: EN["a3.change"] });
    expect(sheet.on!.onDismiss).toMatchObject({ kind: "navigate", screenId: "assistant_tasks", replace: true });
    expect(actions(sheet.on!.onDismiss).some((a) => a.kind === "callEndpoint")).toBe(false);
  });

  it("without a task id it shows the one waiting; a task that is no longer waiting is not swapped for another", () => {
    expect(build("assistant_approve", { assistant: { tasks, names } }).state).toMatchObject({ preview: PREVIEW });
    const gone = build("assistant_approve", { assistant: { tasks, names }, params: { taskId: "d1" } });
    expect(texts(gone.root)).toContain(EN["a3.none"]);
    expect(nodes(gone.root, (n) => n.type === "BottomSheet")).toHaveLength(0);
    expect(texts(build("assistant_approve", {}).root)).toContain(EN["a3.none"]);
  });
});

describe("opened by a push or a link", () => {
  it("has no back arrow, since nothing is under it, and keeps it that way after the answer", () => {
    const arrows = (s: any) => nodes(s.root, (n) => n.type === "SVG").length;
    expect(arrows(build("assistant_tasks", { assistant: { tasks, names } }))).toBe(1);
    const pushed = build("assistant_approve", { assistant: { tasks, names }, params: { pushId: "p1", taskId: "w1" } });
    expect(arrows(pushed)).toBe(0);
    expect(nodes(pushed.root, (n) => n.type === "BottomSheet")[0]!.on!.onDismiss).toMatchObject({ screenId: "assistant_tasks", replace: true, params: { alone: "1" } });
    expect(arrows(build("assistant_apps", { assistant: { apps, names }, params: { entry: "link" } }))).toBe(0);
    expect(arrows(build("assistant_tasks", { assistant: { tasks, names }, params: { alone: "1" } }))).toBe(0);
  });
});

describe("where they are reached", () => {
  it("Settings offers Connected apps and Tasks only while connected apps are on", () => {
    const row = (s: any, id: string) => actions(s.root).find((a) => a.kind === "navigate" && a.screenId === id);
    expect(row(build("settings", { connectorsOn: true }), "assistant_apps")).toBeTruthy();
    expect(row(build("settings", { connectorsOn: true }), "assistant_tasks")).toBeTruthy();
    expect(row(build("settings", {}), "assistant_apps")).toBeFalsy();
  });
});

describe("in Hinglish", () => {
  it("every line of ours is the design's own Hinglish and none of it, nor anything of the person's, goes to the model", async () => {
    seen.items.length = 0;
    const done = [
      await localize(build("assistant_apps", { assistant: { apps, names } }), "hinglish"),
      await localize(build("assistant_tasks", { assistant: { tasks, names } }), "hinglish"),
      await localize(build("assistant_approve", { assistant: { tasks, names }, params: { taskId: "w1" } }), "hinglish"),
    ];
    const json = JSON.stringify(done);
    const want = [
      HG["s6.sug"], HG["apps.h"], HG["lv.look"], HG["lv.draft"], HG["lv.send"], HG["st.ok"], HG.connect,
      HG["a2.q"].replace("{app}", "Linear"), HG["a2.dis"].replace("{app}", "Linear"),
      HG["a4.w"], HG["a4.r"], HG["a4.d"], HG["a4.wm"].replace("{app}", "Notion"), HG["a4.end"],
      HG["a3.h.send"], HG["a3.lab.send"], HG["a3.wwl"].replace("{app}", "Notion"), HG["a3.ok"], HG["a3.edit"], HG["a3.later"],
      HG["a3.reason"].replace("{app}", "Notion"), HG["a3.nobio"], HG["a3.left"], HG["a3.change"],
    ];
    for (const w of want) expect(json, w).toContain(w);
    // The model is asked for nothing that is ours, and for nothing that is theirs.
    const ours = [...Object.values(EN)].filter((x) => !x.includes("{app}"));
    for (const w of ours) expect(seen.items, w).not.toContain(w);
    for (const w of [PREVIEW, "Post the standup summary", "Reply to Priya", "Notion", "Linear"]) expect(seen.items, w).not.toContain(w);
    expect(seen.items.filter((x) => /Standup|shipped/.test(x))).toEqual([]);
  });
});
