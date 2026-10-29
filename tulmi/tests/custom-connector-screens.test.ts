/**
 * Apps added by link, on the screens (experience/assistant.ts for the phone,
 * experience/desk.ts for the desk): Add an app by link, an added app's own
 * sheet or row, what it can do tool by tool, "This app changed", and More
 * apps. All of it only while CUSTOM_CONNECTORS is on (assistant.custom), every
 * word from connectors/words.ts in both voices, and every word of the app's
 * own (its name, host, tools) drawn from state, never written into a node.
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
const { DESK_SCREENS } = await import("../src/experience/desk.js");
const { EN, HG } = await import("../src/connectors/words.js");

type AnyNode = { type?: string; props?: Record<string, any>; on?: Record<string, any>; bind?: Record<string, string>; visibleIf?: any; children?: AnyNode[] };
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
/** Every word drawn: a Text's content, a desk Button's label. */
const texts = (root: unknown) => nodes(root, (n) => n.type === "Text" || n.type === "Button").map((n) => (n.props?.content ?? n.props?.label) as string);
const binds = (root: unknown) => nodes(root, (n) => !!n.bind?.content).map((n) => n.bind!.content);
const calls = (root: unknown) => actions(root).filter((a) => a.kind === "callEndpoint");

const ID = "c_00000000-0000-4000-8000-000000000001";
const PENDING = "c_00000000-0000-4000-8000-000000000002";
const app = (o: Record<string, unknown>) => ({
  id: "notion", name: "Notion", category: "Docs", oneLine: "Pages.", auth: "oauth", connected: false, level: "look", auto: [], ...o,
});
const mine = app({ id: ID, name: "Acme Notes", category: "Added by you", connected: true, custom: true, host: "mcp.acme.example" });
const pending = app({ id: PENDING, name: "Beta Tasks", category: "Added by you", custom: true, host: "mcp.beta.example", signInHost: "auth.beta.example" });
const apps = [app({}), mine, pending];
const names = { notion: "Notion", [ID]: "Acme Notes", [PENDING]: "Beta Tasks" };
const tool = (o: Record<string, unknown>) => ({ name: "search_notes", description: "Search notes.", risk: "read", policy: "allow", choices: ["allow", "ask", "off"], ...o });
const tools = [
  tool({}),
  tool({ name: "delete_note", title: "Delete a note", description: "Deletes it.", risk: "destructive", policy: "ask", choices: ["ask", "off"], changed: true }),
];
const appView = (o: Record<string, unknown> = {}) => ({ info: { ...mine, toolsChanged: 1 }, tools, version: "v-123", ...o });

const phone = (id: string, assistant: Record<string, unknown>, can = ["ActionUrl"], params?: Record<string, unknown>) =>
  buildScreen(id, { personality: {}, language: "en", formFactor: "phone", can: new Set(can), assistant, ...(params ? { params } : {}) } as never)!;
const desk = (id: string, assistant: Record<string, unknown>, params?: Record<string, unknown>) =>
  buildScreen(id, { personality: {}, language: "en", formFactor: "desktop", can: new Set(["DeskShell", "DeskConnectors"]), assistant, ...(params ? { params } : {}) } as never)!;

const NEW_PARTS = [EN["add.tile"], EN["add.h"], EN["add.trust"], EN["dir.p"], EN["dir.go"]];

describe("the phone, with apps added by link switched off", () => {
  it("has no Add tile, no add sheet and no search", () => {
    const s = phone("assistant_apps", { apps: [app({})], names });
    const t = texts(s.root);
    for (const w of NEW_PARTS) expect(t, w).not.toContain(w);
    expect(calls(s.root).some((c) => c.path.startsWith("/v1/connectors/custom") || c.path.startsWith("/v1/connectors/directory"))).toBe(false);
    expect(s.state).not.toHaveProperty("dir");
  });

  it("an added app's tools page is not there either", () => {
    const s = phone("assistant_app_tools", { names, app: appView() }, ["ActionUrl"], { id: ID });
    expect(texts(s.root)).toContain(EN["apps.off"]);
    expect(calls(s.root)).toHaveLength(0);
  });
});

describe("the phone, with apps added by link switched on", () => {
  const s = phone("assistant_apps", { apps, names, custom: true });

  it("puts the added apps with the connected ones, and the Add tile and the search under More apps", () => {
    const t = texts(s.root);
    for (const w of [...NEW_PARTS, EN["s6.more"], EN["custom.tag"]]) expect(t, w).toContain(w);
    const grids = nodes(s.root, (n) => n.type === "Grid");
    // Suggested (Notion), then Connected apps (both added apps), then More apps (the Add tile).
    expect(grids.map((g) => g.children!.length)).toEqual([1, 2, 1]);
    expect(texts(grids[2])).toEqual(["+", EN["add.tile"]]);
  });

  it("the add sheet: Name, Link, a folded Advanced, the trust line, then Add app", () => {
    const sheet = nodes(s.root, (n) => n.type === "BottomSheet" && n.bind?.open === "addOpen")[0]!;
    const fields = nodes(sheet, (n) => n.type === "TextField").map((n) => n.bind!.value);
    expect(fields).toEqual(["add.name", "add.url", "add.clientId", "add.clientSecret"]);
    const advanced = nodes(sheet, (n) => n.type === "Stack" && n.visibleIf?.truthy === "add.adv")[0]!;
    expect(nodes(advanced, (n) => n.type === "TextField").map((n) => n.props!.placeholder)).toEqual([EN["add.cid"], EN["add.csec"]]);
    for (const w of [EN["add.name"], EN["add.link"], EN["add.adv"], EN["add.trust"], EN["add.go"]]) expect(texts(sheet), w).toContain(w);
    const add = calls(sheet).find((c) => c.path === "/v1/connectors/custom")!;
    expect(add).toMatchObject({
      method: "POST", assignTo: "added",
      body: { name: "$state.add.name", url: "$state.add.url", clientId: "$state.add.clientId", clientSecret: "$state.add.clientSecret" },
      onSuccess: { kind: "condition", if: { truthy: "added.refused" }, else: { kind: "condition", if: { truthy: "added.connected" } } },
    });
    expect(s.state).toMatchObject({ addOpen: false, added: {}, add: { name: "", url: "", clientId: "", clientSecret: "", adv: false } });
  });

  it("says the server's own reason when it would not add one, from the sheet and from More apps", () => {
    const adds = calls(s.root).filter((c) => c.path === "/v1/connectors/custom");
    expect(adds.length).toBe(1 + 20);
    for (const add of adds) {
      // A no is a 200 with `refused`: its words are drawn from state, and the sheet is left as it was typed.
      expect(add.onSuccess.then).toEqual({ kind: "sequence", actions: [
        { kind: "haptic", style: "error" }, { kind: "toast", message: "$state.added.refused.message", tone: "error" },
      ] });
      expect(actions(add.onSuccess.then).some((a) => a.kind === "setState")).toBe(false);
      // The fixed line is only for an answer with no reason in it.
      expect(actions(add.onError).find((a) => a.kind === "toast")).toMatchObject({ message: EN["err.add"] });
    }
    expect(EN["err.add"]).not.toMatch(/link/i);
  });

  it("says where they will sign in before anything opens", () => {
    const sheet = nodes(s.root, (n) => n.type === "BottomSheet" && n.bind?.open === "addOpen")[0]!;
    const step = nodes(sheet, (n) => n.visibleIf?.truthy === "added.authorizeUrl")[0]!;
    expect(texts(step)).toContain(EN["add.at"]);
    expect(binds(step)).toContain("added.signInHost");
    const go = actions(step).find((a) => a.kind === "openUrl");
    expect(go).toEqual({ kind: "openUrl", url: "$state.added.authorizeUrl" });
    // The form hides once the server has it.
    expect(nodes(sheet, (n) => n.visibleIf?.falsy === "added.authorizeUrl")).toHaveLength(1);
  });

  it("an added app's sheet: Unverified and its host from state, where it signs in, what it can do, Remove", () => {
    const on = nodes(s.root, (n) => n.type === "BottomSheet" && n.bind?.open === `sheet.${ID}`)[0]!;
    expect(texts(on)).toEqual(expect.arrayContaining([EN["custom.tag"], EN["custom.note"], EN["tools.h"], EN["custom.remove"]]));
    expect(binds(on)).toEqual(expect.arrayContaining([`n.${ID}`, `host.${ID}`]));
    expect(actions(on).find((a) => a.kind === "navigate")).toEqual({ kind: "navigate", screenId: "assistant_app_tools", params: { id: ID } });
    expect(calls(on).find((c) => c.method === "DELETE")!.path).toBe(`/v1/connectors/custom/${ID}`);
    // No level: an added app is set tool by tool.
    expect(calls(on).some((c) => /\/level$/.test(c.path))).toBe(false);

    const wait = nodes(s.root, (n) => n.type === "BottomSheet" && n.bind?.open === `sheet.${PENDING}`)[0]!;
    expect(texts(wait)).toContain(EN["add.at"]);
    expect(binds(wait)).toContain(`si.${PENDING}`);
    expect(calls(wait).find((c) => c.path === `/v1/connectors/${PENDING}/connect`)).toMatchObject({ method: "POST", assignTo: "link" });
    // The person's own words never sit in a node.
    const json = JSON.stringify(s.root);
    for (const w of ["Acme Notes", "mcp.acme.example", "auth.beta.example"]) expect(json, w).not.toContain(w);
    expect(s.state).toMatchObject({ n: { [ID]: "Acme Notes" }, host: { [ID]: "mcp.acme.example" }, si: { [PENDING]: "auth.beta.example" } });
  });

  it("an app whose tools changed says so on its tile and in its sheet", () => {
    const changed = phone("assistant_apps", { apps: [{ ...mine, toolsChanged: 2 }], names, custom: true });
    const sheet = nodes(changed.root, (n) => n.type === "BottomSheet" && n.bind?.open === `sheet.${ID}`)[0]!;
    expect(texts(sheet)).toEqual(expect.arrayContaining([EN["changed.h"], EN["changed.p"], EN["changed.look"]]));
    expect(texts(changed.root)).toContain(EN["changed.tag"]);
  });

  it("More apps: a search into state and twenty slots, ours pointing to their tile, the rest Unverified with Add", () => {
    const search = calls(s.root).find((c) => c.path.startsWith("/v1/connectors/directory"))!;
    expect(search).toMatchObject({ method: "GET", path: "/v1/connectors/directory?q=$state.q", assignTo: "dir" });
    const slots = nodes(s.root, (n) => typeof n.visibleIf?.truthy === "string" && /^dir\.apps\.\d+\.id$/.test(n.visibleIf.truthy));
    expect(slots).toHaveLength(20);
    const first = slots[0]!;
    expect(binds(first)).toEqual(expect.arrayContaining(["dir.apps.0.name", "dir.apps.0.host", "dir.apps.0.description", "dir.apps.0.initial"]));
    expect(calls(first)[0]).toMatchObject({
      method: "POST", path: "/v1/connectors/custom", assignTo: "added",
      body: { name: "$state.dir.apps.0.name", url: "$state.dir.apps.0.url", from: "$state.dir.apps.0.id" },
    });
    expect(texts(first)).toEqual(expect.arrayContaining([EN["custom.tag"], EN["dir.ours"], EN["dir.ours.d"], EN["dir.add"]]));
    expect(nodes(s.root, (n) => n.visibleIf?.eq?.[0] === "dir.count")).toHaveLength(1);
  });

  it("a build that cannot open a sign-in page is told so instead of being given the sheet", () => {
    const old = phone("assistant_apps", { apps, names, custom: true }, []);
    expect(nodes(old.root, (n) => n.type === "BottomSheet" && n.bind?.open === "addOpen")).toHaveLength(0);
    expect(texts(old.root)).toContain(EN["apps.update"]);
    expect(actions(old.root).some((a) => a.kind === "openUrl")).toBe(false);
  });
});

describe("what an added app can do, on the phone", () => {
  const s = phone("assistant_app_tools", { names, custom: true, app: appView() }, ["ActionUrl"], { id: ID });

  it("lists each tool from state with only the choices it may have", () => {
    expect(s.screenId).toBe("assistant_app_tools");
    expect(s.state).toMatchObject({
      tools: [{ label: "search_notes", description: "Search notes." }, { label: "Delete a note", description: "Deletes it." }],
      pol: { 0: "allow", 1: "ask" },
    });
    // Drawn from state only (the name goes in the policy call's body, which nothing shows or translates).
    const drawn = texts(s.root);
    for (const w of ["search_notes", "Search notes.", "Delete a note", "Deletes it."]) expect(drawn, w).not.toContain(w);
    expect(JSON.stringify(s.root)).not.toContain("Deletes it.");
    const policy = calls(s.root).filter((c) => c.path === `/v1/connectors/${ID}/tools/policy`);
    expect(policy.map((c) => c.body)).toEqual([
      { tool: "search_notes", policy: "allow" }, { tool: "search_notes", policy: "ask" }, { tool: "search_notes", policy: "off" },
      { tool: "delete_note", policy: "ask" }, { tool: "delete_note", policy: "off" },
    ]);
    const t = texts(s.root);
    for (const w of [EN["pol.allow"], EN["pol.ask"], EN["pol.off"], EN["tools.always"], EN["changed.tag"]]) expect(t, w).toContain(w);
  });

  it("the banner: This app changed, and Looks right accepts the list it showed", () => {
    expect(texts(s.root)).toEqual(expect.arrayContaining([EN["changed.h"], EN["changed.p"], EN["changed.ok"]]));
    expect(calls(s.root).find((c) => c.path.endsWith("/tools/accept"))).toMatchObject({ method: "POST", body: { version: "v-123" } });
    const calm = phone("assistant_app_tools", { names, custom: true, app: appView({ info: mine }) }, ["ActionUrl"], { id: ID });
    expect(texts(calm.root)).not.toContain(EN["changed.h"]);
  });

  it("says so when the app could not be asked", () => {
    const quiet = phone("assistant_app_tools", { names, custom: true, app: appView({ tools: null }) }, ["ActionUrl"], { id: ID });
    expect(texts(quiet.root)).toContain(EN["tools.err"]);
    expect(calls(quiet.root)).toHaveLength(0);
  });
});

describe("the desk", () => {
  it("Settings has none of it while switched off", () => {
    const json = JSON.stringify(desk("desk_settings", { apps: [app({})], names }));
    for (const w of NEW_PARTS) expect(json, w).not.toContain(w);
  });

  it("Settings, switched on: the added apps' rows, Add an app by link, and More apps", () => {
    const s = desk("desk_settings", { apps, names, custom: true });
    const t = texts(s.root);
    for (const w of [EN["add.h"], EN["add.trust"], EN["s6.more"], EN["dir.p"], EN["custom.tag"], EN["custom.note"], EN["add.at"], EN["custom.remove"], EN["tools.h"]]) {
      expect(t, w).toContain(w);
    }
    const connect = actions(s.root).filter((a) => a.kind === "connector.connect").map((a) => a.id);
    expect(connect).toEqual(["notion", PENDING]);
    expect(actions(s.root).find((a) => a.kind === "navigate" && a.screenId === "desk_connector")).toEqual({ kind: "navigate", screenId: "desk_connector", params: { id: ID } });
    expect(calls(s.root).find((c) => c.path === "/v1/connectors/custom" && c.body.clientId)).toMatchObject({
      body: { name: "$state.add.name", url: "$state.add.url", clientId: "$state.add.clientId", clientSecret: "$state.add.clientSecret" },
    });
    expect(calls(s.root).find((c) => c.method === "GET")).toMatchObject({ path: "/v1/connectors/directory?q=$state.q", assignTo: "dir" });
    expect(nodes(s.root, (n) => typeof n.visibleIf?.truthy === "string" && /^dir\.apps\.\d+\.id$/.test(n.visibleIf.truthy))).toHaveLength(20);
    // No level for an added app, and its name and hosts from state.
    expect(calls(s.root).filter((c) => /\/level$/.test(c.path))).toHaveLength(0);
    expect(binds(s.root)).toEqual(expect.arrayContaining([`n.${ID}`, `host.${ID}`, `si.${PENDING}`]));
    const json = JSON.stringify(s.root);
    for (const w of ["Acme Notes", "mcp.acme.example", "auth.beta.example"]) expect(json, w).not.toContain(w);
    expect(s.state).toMatchObject({ retainHistory: true, addOpen: false, q: "", dir: {}, si: { [PENDING]: "auth.beta.example" } });
  });

  it("Settings says the server's own reason when it would not add one, from the form and from More apps", () => {
    const s = desk("desk_settings", { apps, names, custom: true });
    const adds = calls(s.root).filter((c) => c.path === "/v1/connectors/custom" && c.method === "POST");
    expect(adds.length).toBe(1 + 20);
    for (const add of adds) {
      expect(add).toMatchObject({
        assignTo: "added",
        onSuccess: {
          kind: "condition", if: { truthy: "added.refused" },
          then: { kind: "toast", message: "$state.added.refused.message" }, else: { kind: "toast", message: EN["add.done"] },
        },
        onError: { kind: "toast", message: EN["err.add"] },
      });
    }
  });

  it("an added app's page: Allow, Ask first or Off for each tool, and the banner", () => {
    expect(DESK_SCREENS.has("desk_connector")).toBe(true);
    const s = desk("desk_connector", { names, custom: true, app: appView() }, { id: ID });
    const buttons = nodes(s.root, (n) => n.type === "Button");
    const on = buttons.filter((b) => b.props!.cls === "d-seg-item d-seg-on").map((b) => b.props!.label);
    expect(on).toEqual([EN["pol.allow"], EN["pol.ask"]]);
    expect(calls(s.root).filter((c) => c.path.endsWith("/tools/policy")).map((c) => c.body)).toEqual([
      { tool: "search_notes", policy: "ask" }, { tool: "search_notes", policy: "off" }, { tool: "delete_note", policy: "off" },
    ]);
    expect(calls(s.root).find((c) => c.path.endsWith("/tools/accept"))).toMatchObject({ method: "POST", body: { version: "v-123" } });
    expect(texts(s.root)).toEqual(expect.arrayContaining([EN["changed.h"], EN["changed.ok"], EN["tools.always"], EN["tools.back"]]));
    expect(JSON.stringify(s.root)).not.toContain("Deletes it.");
    expect(s.state).toMatchObject({ n: { [ID]: "Acme Notes" }, tools: [{ label: "search_notes" }, { label: "Delete a note" }] });
    expect(texts(desk("desk_connector", { names, app: appView() }, { id: ID }).root)).toContain(EN["apps.off"]);
  });
});

describe("the words", () => {
  const KEYS = [
    "add.h", "add.tile", "add.p", "add.name", "add.name.ph", "add.link", "add.link.ph", "add.adv", "add.adv.d", "add.cid", "add.csec",
    "add.trust", "add.go", "add.at", "add.cont", "add.done", "err.add", "custom.tag", "custom.note", "custom.remove", "tools.h", "tools.p",
    "pol.allow", "pol.ask", "pol.off", "tools.always", "tools.err", "tools.none", "tools.back", "changed.h", "changed.p", "changed.ok",
    "changed.tag", "changed.look", "dir.p", "dir.ph", "dir.go", "dir.ours", "dir.ours.d", "dir.none", "dir.add", "dir.err",
  ] as const;

  it("every new line is there in English and in Hinglish, in our voice", () => {
    for (const k of KEYS) {
      expect(EN[k], k).toBeTruthy();
      expect(HG[k], k).toBeTruthy();
    }
    expect(EN["add.trust"]).toBe("X0 Bot hasn’t checked this app. Only add apps you trust.");
    expect(EN["changed.h"]).toBe("This app changed. Have a look.");
    expect(EN["add.at"]).toBe("You’ll sign in at");
    // One English line, one Hinglish line: the translator's seeds are a map.
    const en = KEYS.map((k) => EN[k]);
    expect(new Set(en).size).toBe(en.length);
  });

  it("a Hinglish profile reads the design's words for all of it, and the model is not asked for them", async () => {
    seen.items.length = 0;
    const s = buildScreen("assistant_apps", { personality: {}, language: "hinglish", formFactor: "phone", can: new Set(["ActionUrl"]), assistant: { apps, names, custom: true } } as never)!;
    const json = JSON.stringify(await localize(s, "hinglish"));
    for (const k of ["add.tile", "add.h", "add.trust", "add.at", "custom.tag", "dir.p", "dir.ours", "custom.remove", "tools.h"] as const) {
      expect(json, k).toContain(HG[k]);
      expect(seen.items, k).not.toContain(EN[k]);
    }
  });
});
