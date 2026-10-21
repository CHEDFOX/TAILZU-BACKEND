/**
 * Connected apps against a real MCP server, in process: the SDK's own McpServer
 * on a local port over Streamable HTTP, with a read-only tool, tools that send,
 * create and delete, a slow one and a broken one. No network beyond 127.0.0.1.
 *
 * Covers the hub (tool cache, calls, timeout, the one error shape), the OAuth
 * flow (against a small fake authorization server), the run (a USE line for a
 * read is called and its result fed back; a change ends the step with an
 * approval, and approve/deny do what they say), the routes, and that with
 * connectors off the planner is sent exactly what it always was.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { randomBytes } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

// Whoever the test says is calling: the token is the user id; none is nobody.
vi.mock("../src/auth/supabase.js", async (orig) => ({
  ...(await orig<typeof import("../src/auth/supabase.js")>()),
  resolveUser: async (h: string | undefined) => {
    const id = h?.replace(/^Bearer\s+/i, "").trim();
    return id ? { id } : null;
  },
}));

const { AGENT_SYSTEM, agentUserMessage } = await import("../src/agent/prompt.js");
const { runStep } = await import("../src/agent/run.js");
const { EventSink } = await import("../src/agent/protocol.js");
const { encrypt, decrypt } = await import("../src/connectors/crypto.js");
const { createConnectors } = await import("../src/connectors/index.js");
const { beginOAuth, completeOAuth, ConnectorError } = await import("../src/connectors/oauth.js");
const { MemoryConnectorStore } = await import("../src/connectors/store.js");
const { ConnectorHub } = await import("../src/connectors/client.js");
const { registerConnectorRoutes } = await import("../src/routes/connectors.js");
type ConnectorDef = import("../src/connectors/catalog.js").ConnectorDef;
type Task = import("../src/connectors/store.js").Task;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------- the test server

const seen = { lists: 0, calls: [] as Array<{ tool: string; args: Record<string, unknown> }> };
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

function buildMcp(): McpServer {
  const s = new McpServer({ name: "fake-notes", version: "1.0.0" });
  s.registerTool("search_notes", {
    description: "Search notes by text. Returns titles.", inputSchema: { query: z.string() }, annotations: { readOnlyHint: true },
  }, async ({ query }) => {
    seen.calls.push({ tool: "search_notes", args: { query } });
    return text(`Found: Launch checklist (3 open items) for "${query}"`);
  });
  s.registerTool("post_message", {
    description: "Send a message to a channel.", inputSchema: { channel: z.string(), text: z.string() },
  }, async (args) => { seen.calls.push({ tool: "post_message", args }); return text("Message posted."); });
  s.registerTool("create_note", {
    description: "Creates a note.", inputSchema: { title: z.string() },
  }, async (args) => { seen.calls.push({ tool: "create_note", args }); return text("Note created."); });
  s.registerTool("delete_note", {
    description: "Delete a note.", inputSchema: { id: z.string() }, annotations: { destructiveHint: true },
  }, async (args) => { seen.calls.push({ tool: "delete_note", args }); return text("Note deleted."); });
  s.registerTool("slow_lookup", {
    description: "Looks something up, slowly.", inputSchema: {}, annotations: { readOnlyHint: true },
  }, async () => { await sleep(700); return text("late"); });
  s.registerTool("broken_lookup", {
    description: "Always fails.", inputSchema: {}, annotations: { readOnlyHint: true },
  }, async () => ({ isError: true, content: [{ type: "text" as const, text: "No such page" }] }));
  return s;
}

let server: http.Server;
let base = "";
/** When set, /mcp wants this bearer token (the OAuth tests). */
let wantBearer: string | null = null;
const oauth = { registered: 0, tokenRequests: [] as Array<Record<string, string>> };

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0]!;
    if (path === "/.well-known/oauth-protected-resource/mcp" || path === "/.well-known/oauth-protected-resource") {
      return json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
    }
    if (path.startsWith("/.well-known/oauth-authorization-server")) {
      return json(res, 200, {
        issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`, response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }
    if (path === "/register" && req.method === "POST") {
      oauth.registered += 1;
      const meta = JSON.parse(await readBody(req));
      return json(res, 201, { ...meta, client_id: "client-1" });
    }
    if (path === "/token" && req.method === "POST") {
      const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
      oauth.tokenRequests.push(form);
      return json(res, 200, { access_token: "access-1", token_type: "Bearer", refresh_token: "refresh-1", expires_in: 3600 });
    }
    if (path === "/mcp") {
      if (wantBearer && req.headers.authorization !== `Bearer ${wantBearer}`) {
        return json(res, 401, { error: "unauthorized" }, { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
      }
      if (req.method !== "POST") { res.writeHead(405).end(); return; }
      const body = JSON.parse(await readBody(req));
      if (body?.method === "tools/list") seen.lists += 1;
      const mcp = buildMcp();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { void transport.close(); void mcp.close(); });
      await mcp.connect(transport);
      return transport.handleRequest(req, res, body);
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); });
beforeEach(() => { seen.lists = 0; seen.calls = []; wantBearer = null; oauth.registered = 0; oauth.tokenRequests = []; });

const def = (over: Partial<ConnectorDef> = {}): ConnectorDef => ({
  id: "testapp", name: "Test App", category: "Test",
  oneLine: "Search notes and send messages in the test app.",
  aliases: ["notes", "slack", "checklist", "channel"], url: `${base}/mcp`, auth: "url", verified: false, ...over,
});

/** A person with the test app connected at a level; returns the pieces. */
async function setup(opts: { level?: "look" | "draft" | "send"; autoOk?: string[]; callTimeoutMs?: number; user?: string } = {}) {
  const store = new MemoryConnectorStore();
  const pushes: string[] = [];
  const connectors = createConnectors({
    store, catalog: [def()], redirectUrl: "https://api.example.com/v1/connectors/callback",
    callTimeoutMs: opts.callTimeoutMs ?? 5000,
    notify: async (userId, task, a) => { pushes.push(`${userId}:${task.id}:${a.tool}`); },
  });
  const user = opts.user ?? "u1";
  await store.upsertConnection(user, "testapp", {
    tokensEnc: encrypt(JSON.stringify({ url: `${base}/mcp` })), level: opts.level ?? "send", autoOk: opts.autoOk ?? [],
  });
  return { store, connectors, user, pushes };
}

// ---------------------------------------------------------------------- the hub

describe("the hub", () => {
  it("lists a connector's tools and keeps the list five minutes", async () => {
    const { store } = await setup();
    let t = 1_000_000;
    const hub = new ConnectorHub({ store, catalog: [def()], redirectUrl: "x", now: () => t });
    const first = await hub.tools("u1", "testapp");
    expect(first.map((x) => x.name)).toEqual(["search_notes", "post_message", "create_note", "delete_note", "slow_lookup", "broken_lookup"]);
    expect(first[0]!.annotations?.readOnlyHint).toBe(true);
    await hub.tools("u1", "testapp");
    expect(seen.lists).toBe(1);
    t += 4 * 60_000;
    await hub.tools("u1", "testapp");
    expect(seen.lists).toBe(1);
    t += 2 * 60_000;
    await hub.tools("u1", "testapp");
    expect(seen.lists).toBe(2);
    await hub.close();
  });

  it("calls a tool and notes the use", async () => {
    const { store } = await setup();
    const hub = new ConnectorHub({ store, catalog: [def()], redirectUrl: "x" });
    const out = await hub.call("u1", "testapp", "search_notes", { query: "launch" });
    expect(out).toEqual({ ok: true, text: 'Found: Launch checklist (3 open items) for "launch"' });
    await sleep(20);
    expect((await store.getConnection("u1", "testapp"))!.lastUsedAt).toBeGreaterThan(0);
    await hub.close();
  });

  it("gives a slow call twenty seconds (here: 150 ms) and then says so in plain words", async () => {
    const { store } = await setup();
    const hub = new ConnectorHub({ store, catalog: [def()], redirectUrl: "x", callTimeoutMs: 150 });
    const out = await hub.call("u1", "testapp", "slow_lookup", {});
    expect(out).toEqual({ ok: false, text: "", error: { code: "timeout", message: "Test App took too long to answer." } });
    await hub.close();
  });

  it("turns every failure into one { code, message } shape", async () => {
    const { store } = await setup();
    const hub = new ConnectorHub({ store, catalog: [def()], redirectUrl: "x" });
    const broken = await hub.call("u1", "testapp", "broken_lookup", {});
    expect(broken.error).toEqual({ code: "tool_error", message: "Test App said: No such page" });
    const unknown = await hub.call("u1", "testapp", "no_such_tool", {});
    expect(unknown.error).toMatchObject({ code: "tool_error", message: expect.stringContaining("not found") });
    expect(unknown.error!.message).not.toMatch(/MCP error/);
    expect(Object.keys(unknown.error!).sort()).toEqual(["code", "message"]);

    await store.upsertConnection("u1", "testapp", { tokensEnc: encrypt(JSON.stringify({ url: "http://127.0.0.1:1/mcp" })) });
    await hub.forget("u1", "testapp");
    const down = await hub.call("u1", "testapp", "search_notes", { query: "x" });
    expect(down.error).toEqual({ code: "unreachable", message: "I couldn't reach Test App just now." });
    await expect(hub.tools("u1", "testapp")).rejects.toMatchObject({ code: "unreachable" });

    expect((await hub.call("nobody", "testapp", "search_notes", {})).error).toEqual({ code: "not_connected", message: "Test App isn't connected." });
    expect((await hub.call("u1", "nope", "x", {})).error?.code).toBe("not_connected");
    await hub.close();
  });
});

// ------------------------------------------------------------------- OAuth flow

describe("signing in (OAuth with dynamic client registration)", () => {
  const redirectUrl = "https://api.example.com/v1/connectors/callback";

  it("sends the person to the vendor, keeps the verifier and client encrypted, and finishes on the callback", async () => {
    wantBearer = "access-1";
    const store = new MemoryConnectorStore();
    const oa = def({ id: "oapp", name: "OAuth App", auth: "oauth" });
    const url = new URL(await beginOAuth({ store, redirectUrl }, "u1", oa));
    expect(url.origin + url.pathname).toBe(`${base}/authorize`);
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUrl);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const state = url.searchParams.get("state")!;

    const mid = (await store.getConnection("u1", "oapp"))!;
    expect(mid.tokensEnc).toBeNull();
    expect(mid.clientInfo).toMatchObject({ client_id: "client-1" });
    expect(mid.verifierEnc).toMatch(/^v1\./);
    expect(oauth.registered).toBe(1);

    const done = await completeOAuth({ store, redirectUrl }, (id) => (id === "oapp" ? oa : undefined), "the-code", state);
    expect(done.userId).toBe("u1");
    const after = (await store.getConnection("u1", "oapp"))!;
    expect(after.verifierEnc).toBeNull();
    expect(after.tokensEnc).toMatch(/^v1\./);
    expect(after.tokensEnc).not.toContain("access-1");
    expect(JSON.parse(decrypt(after.tokensEnc!))).toMatchObject({ access_token: "access-1", refresh_token: "refresh-1" });
    expect(oauth.tokenRequests[0]).toMatchObject({ grant_type: "authorization_code", code: "the-code", client_id: "client-1" });
    expect(oauth.tokenRequests[0]!.code_verifier).toBeTruthy();

    // The stored token is what the client then signs its calls with.
    const hub = new ConnectorHub({ store, catalog: [oa], redirectUrl });
    expect((await hub.tools("u1", "oapp")).map((t) => t.name)).toContain("search_notes");
    await hub.close();

    // A second use of the same callback has no verifier left to exchange with.
    await expect(completeOAuth({ store, redirectUrl }, () => oa, "the-code", state)).rejects.toBeInstanceOf(ConnectorError);
  });

  it("refuses a callback whose state is for another app, forged, or missing", async () => {
    const store = new MemoryConnectorStore();
    const oa = def({ id: "oapp", name: "OAuth App", auth: "oauth" });
    const state = new URL(await beginOAuth({ store, redirectUrl }, "u1", oa)).searchParams.get("state")!;
    await expect(completeOAuth({ store, redirectUrl }, () => undefined, "c", state)).rejects.toMatchObject({ code: "bad_state" });
    await expect(completeOAuth({ store, redirectUrl }, () => oa, "c", state + "x")).rejects.toMatchObject({ code: "bad_state" });
    expect((await store.getConnection("u1", "oapp"))!.tokensEnc).toBeNull();
  });

  it("says a token that cannot refresh needs a new sign-in, instead of sending anyone to a browser", async () => {
    wantBearer = "something-else";
    const store = new MemoryConnectorStore();
    const oa = def({ id: "oapp", name: "OAuth App", auth: "oauth" });
    await store.upsertConnection("u1", "oapp", { tokensEnc: encrypt(JSON.stringify({ access_token: "stale", token_type: "Bearer" })), clientInfo: { client_id: "client-1" } });
    const hub = new ConnectorHub({ store, catalog: [oa], redirectUrl });
    await expect(hub.tools("u1", "oapp")).rejects.toMatchObject({ code: "needs_reconnect", message: "OAuth App needs you to sign in again." });
    await hub.close();
  });
});

// -------------------------------------------------------------------- the run

type Ev = Record<string, any>;

function req(over: Record<string, unknown> = {}) {
  return {
    runId: "run_abc123", step: 0, platform: "mac" as const, app: "Slack", screen: { elements: [] },
    utterance: "tell the team in slack that the demo moved to 4pm", ...over,
  };
}

/** One step through runStep with a scripted planner, one script per planner call. */
async function runWith(
  scripts: string[], r: ReturnType<typeof req>, runtime: ReturnType<ReturnType<typeof createConnectors>["runtimeFor"]> | undefined,
) {
  const lines: string[] = [];
  const sink = new EventSink((l) => lines.push(l));
  const calls: Array<{ system: string; user: string }> = [];
  let i = 0;
  const result = await runStep(
    { req: r as any, maxSteps: 8 },
    {
      write: async () => "", rewrite: async () => "",
      plan: (system, user) => {
        calls.push({ system: typeof system === "string" ? system : system("m"), user: typeof user === "string" ? user : "" });
        const script = scripts[Math.min(i++, scripts.length - 1)] ?? "DONE\n";
        return (async function* () { yield { model: "m", delta: script }; })();
      },
      connectors: runtime,
    },
    sink,
  );
  return { events: lines.map((l) => JSON.parse(l) as Ev), calls, result, sink };
}

describe("a run that uses a connected app", () => {
  it("calls a read tool, feeds the result back, and carries on to the answer", async () => {
    const { connectors, user, store } = await setup();
    const r = await runWith(
      ['USE testapp.search_notes {"query":"launch checklist"}\n', "SAY You have three open items on the launch checklist.\nDONE\n"],
      req({ utterance: "what is on my launch checklist in my notes" }), connectors.runtimeFor(user),
    );
    expect(r.events.map((e) => e.t)).toEqual(["heard", "say", "done"]);
    expect(r.events[1]!.text).toContain("three open items");
    expect(r.calls).toHaveLength(2);
    // The first call was shown the tools, and taught USE after the unchanged system prompt.
    expect(r.calls[0]!.system.startsWith(AGENT_SYSTEM)).toBe(true);
    expect(r.calls[0]!.system).toContain("USE <connector>.<tool>");
    expect(r.calls[0]!.user).toContain("<tools>");
    expect(r.calls[0]!.user).toContain("testapp.search_notes");
    expect(r.calls[0]!.user).not.toContain("<result>");
    // The second was shown what the tool returned, as data, before the person's words.
    expect(r.calls[1]!.user).toContain("<result>\ntestapp.search_notes: Found: Launch checklist");
    expect(r.calls[1]!.user.endsWith("</said>")).toBe(true);
    expect(seen.calls).toEqual([{ tool: "search_notes", args: { query: "launch checklist" } }]);

    // One task for the run, finished; one audit row, with no content in it.
    const tasks = await store.listTasks(user, 10);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ state: "done", runId: "run_abc123" });
    const audit = await store.listAudit(user, tasks[0]!.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ connectorId: "testapp", tool: "search_notes", risk: "read", outcome: "ok" });
    expect(JSON.stringify(audit)).not.toMatch(/launch|checklist|three open/i);
  });

  it("stops a planner that keeps calling tools, after three, with an answer", async () => {
    const { connectors, user } = await setup();
    const r = await runWith(['USE testapp.search_notes {"query":"x"}\n'], req({ utterance: "look in my notes" }), connectors.runtimeFor(user));
    expect(r.calls).toHaveLength(4);
    expect(seen.calls).toHaveLength(3);
    expect(r.events.at(-1)!.t).toBe("done");
  });

  it("ends a change with an approval card and does nothing until it is approved", async () => {
    const { connectors, user, store, pushes } = await setup();
    const r = await runWith(
      ['USE testapp.post_message {"channel":"#team","text":"The demo moved to 4pm"}\n'], req(), connectors.runtimeFor(user),
    );
    const last = r.events.at(-1)!;
    expect(last.t).toBe("approve");
    expect(r.events.filter((e) => ["action", "ask", "look", "approve", "done", "error"].includes(e.t))).toHaveLength(1);
    expect(r.sink.ending).toBe("approve");
    expect(last.approval).toMatchObject({ connector: "testapp", tool: "post_message", risk: "send" });
    expect(last.approval.preview).toContain("The demo moved to 4pm");
    expect(last.approval.preview).toContain("#team");
    expect(last.approval).not.toHaveProperty("args");
    expect(seen.calls).toEqual([]);

    const task = (await store.getTask(user, last.taskId))!;
    expect(task.state).toBe("waiting");
    expect(task.approval!.args).toEqual({ channel: "#team", text: "The demo moved to 4pm" });
    await sleep(10);
    expect(pushes).toEqual([`u1:${task.id}:post_message`]);

    // Yes: it runs once, an audit row is written, the task is done, a second tap does nothing.
    const yes = await connectors.tasks.approve(user, task.id, last.approval.id);
    expect(yes).toMatchObject({ status: "ok", result: "Message posted." });
    expect(seen.calls).toEqual([{ tool: "post_message", args: { channel: "#team", text: "The demo moved to 4pm" } }]);
    const after = (await store.getTask(user, task.id))!;
    expect(after).toMatchObject({ state: "done", approval: null });
    const audit = await store.listAudit(user, task.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ tool: "post_message", risk: "send", outcome: "ok" });
    expect(JSON.stringify(audit)).not.toMatch(/4pm|#team/);
    expect((await connectors.tasks.approve(user, task.id)).status).toBe("not_waiting");
    expect(seen.calls).toHaveLength(1);
  });

  it("runs a waiting call only once when two devices say yes at the same moment", async () => {
    const { connectors, user } = await setup();
    const r = await runWith(['USE testapp.post_message {"channel":"#team","text":"hi"}\n'], req(), connectors.runtimeFor(user));
    const id = r.events.at(-1)!.taskId;
    const both = await Promise.all([connectors.tasks.approve(user, id), connectors.tasks.approve(user, id)]);
    expect(both.map((b) => b.status).sort()).toEqual(["not_waiting", "ok"]);
    expect(seen.calls).toHaveLength(1);
  });

  it("calls nothing on a no, and writes the refusal down", async () => {
    const { connectors, user, store } = await setup();
    const r = await runWith(['USE testapp.post_message {"channel":"#team","text":"hi"}\n'], req(), connectors.runtimeFor(user));
    const id = r.events.at(-1)!.taskId;
    const no = await connectors.tasks.deny(user, id);
    expect(no.status).toBe("ok");
    expect(seen.calls).toEqual([]);
    expect((await store.getTask(user, id))).toMatchObject({ state: "cancelled", approval: null });
    expect((await store.listAudit(user, id)).map((a) => a.outcome)).toEqual(["denied"]);
    expect((await connectors.tasks.approve(user, id)).status).toBe("not_waiting");
  });

  it("lets nobody else answer for someone's task", async () => {
    const { connectors, user } = await setup();
    const r = await runWith(['USE testapp.post_message {"channel":"#team","text":"hi"}\n'], req(), connectors.runtimeFor(user));
    const id = r.events.at(-1)!.taskId;
    expect((await connectors.tasks.approve("intruder", id)).status).toBe("not_found");
    expect((await connectors.tasks.deny("intruder", id)).status).toBe("not_found");
    expect(seen.calls).toEqual([]);
  });

  it("lets an approval go stale: a yes an hour later runs nothing", async () => {
    let t = Date.now();
    const store = new MemoryConnectorStore();
    const connectors = createConnectors({ store, catalog: [def()], redirectUrl: "x", now: () => t });
    await store.upsertConnection("u1", "testapp", { tokensEnc: encrypt(JSON.stringify({ url: `${base}/mcp` })), level: "send" });
    const r = await runWith(['USE testapp.post_message {"channel":"#team","text":"hi"}\n'], req(), connectors.runtimeFor("u1"));
    t += 61 * 60_000;
    expect((await connectors.tasks.approve("u1", r.events.at(-1)!.taskId)).status).toBe("expired");
    expect(seen.calls).toEqual([]);
  });

  it("holds every level to its limits", async () => {
    // look: nothing but reads, and the person is told why.
    const look = await setup({ level: "look" });
    const a = await runWith(['USE testapp.post_message {"channel":"#team","text":"hi"}\n'], req(), look.connectors.runtimeFor("u1"));
    expect(a.events.at(-1)).toEqual({ t: "done" });
    expect(a.events.find((e) => e.t === "say")!.text).toContain("look only");
    expect(await look.store.listTasks("u1", 5)).toEqual([]);

    // draft: a write is asked first; a send is not possible at all.
    const draft = await setup({ level: "draft" });
    const w = await runWith(['USE testapp.create_note {"title":"Plan"}\n'], req({ utterance: "make a note called Plan in my notes" }), draft.connectors.runtimeFor("u1"));
    expect(w.events.at(-1)!.t).toBe("approve");
    const s = await runWith(['USE testapp.post_message {"channel":"#team","text":"hi"}\n'], req({ runId: "run_other1" }), draft.connectors.runtimeFor("u1"));
    expect(s.events.at(-1)).toEqual({ t: "done" });
    expect(s.events.find((e) => e.t === "say")!.text).toContain("drafts only");

    // send + auto: the chosen tool just runs; a delete is still asked, auto or not.
    const send = await setup({ level: "send", autoOk: ["post_message", "delete_note"] });
    const auto = await runWith(['USE testapp.post_message {"channel":"#team","text":"hi"}\n', "SAY Sent.\nDONE\n"], req(), send.connectors.runtimeFor("u1"));
    expect(auto.events.map((e) => e.t)).toEqual(["heard", "say", "done"]);
    expect(seen.calls).toEqual([{ tool: "post_message", args: { channel: "#team", text: "hi" } }]);
    const del = await runWith(['USE testapp.delete_note {"id":"n1"}\n'], req({ runId: "run_other2", utterance: "delete the note n1 from my notes" }), send.connectors.runtimeFor("u1"));
    expect(del.events.at(-1)!.t).toBe("approve");
    expect(seen.calls).toHaveLength(1);
  });

  it("only looks things up when the run is a question, never changes anything", async () => {
    const { connectors, user } = await setup();
    const r = await runWith(['USE testapp.post_message {"channel":"#team","text":"hi"}\n'], req({ utterance: "what did the team say in slack today" }), connectors.runtimeFor(user));
    expect(r.events.find((e) => e.t === "heard")!.mode).toBe("show");
    expect(r.events.map((e) => e.t)).not.toContain("approve");
    expect(seen.calls).toEqual([]);
  });

  it("says plainly what went wrong when the app fails or the tool is not there", async () => {
    const { connectors, user } = await setup();
    const a = await runWith(['USE testapp.broken_lookup {}\n'], req({ utterance: "look in my notes" }), connectors.runtimeFor(user));
    expect(a.events.find((e) => e.t === "say")!.text).toBe("Test App said: No such page");
    expect(a.events.at(-1)!.t).toBe("done");
    const b = await runWith(['USE testapp.no_such {}\n'], req({ utterance: "look in my notes", runId: "run_other3" }), connectors.runtimeFor(user));
    expect(b.events.find((e) => e.t === "say")!.text).toContain("doesn't have an action");
  });
});

describe("with connected apps off or out of the picture, the planner is sent what it always was", () => {
  const said = "tell the team in slack that the demo moved to 4pm";

  it("sends the same system prompt and user message when the feature is off", async () => {
    const r = await runWith(["SAY ok\nDONE\n"], req(), undefined);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.system).toBe(AGENT_SYSTEM);
    expect(r.calls[0]!.user).toBe(agentUserMessage(req() as any, said, "do", 8));
    // A USE line from a model on its own is read as the prose it is.
    const stray = await runWith(['USE testapp.post_message {"channel":"a","text":"b"}\n', "DONE\n"], req(), undefined);
    expect(stray.events.map((e) => e.t)).toEqual(["heard", "say", "done"]);
    expect(seen.calls).toEqual([]);
  });

  it("is identical when the feature is on but the person has connected nothing", async () => {
    const store = new MemoryConnectorStore();
    const connectors = createConnectors({ store, catalog: [def()], redirectUrl: "x" });
    const r = await runWith(["SAY ok\nDONE\n"], req(), connectors.runtimeFor("fresh-user"));
    expect(r.calls[0]!.system).toBe(AGENT_SYSTEM);
    expect(r.calls[0]!.user).toBe(agentUserMessage(req() as any, said, "do", 8));
  });

  it("is identical when what was said has nothing to do with the connected apps", async () => {
    const { connectors, user } = await setup();
    const r = await runWith(["SAY ok\nDONE\n"], req({ app: "Finder", utterance: "make this window bigger" }), connectors.runtimeFor(user));
    expect(r.calls[0]!.system).toBe(AGENT_SYSTEM);
    expect(r.calls[0]!.user).toBe(agentUserMessage(req({ app: "Finder", utterance: "make this window bigger" }) as any, "make this window bigger", "do", 8));
  });
});

// ------------------------------------------------------------------ the routes

describe("the routes", () => {
  let app: FastifyInstance;
  let connectors: ReturnType<typeof createConnectors>;
  let store: InstanceType<typeof MemoryConnectorStore>;
  const as = (user: string) => ({ authorization: `Bearer ${user}` });

  beforeAll(async () => {
    store = new MemoryConnectorStore();
    connectors = createConnectors({
      store, redirectUrl: "https://api.example.com/v1/connectors/callback",
      catalog: [def(), def({ id: "oapp", name: "OAuth App", auth: "oauth" })],
    });
    app = Fastify();
    registerConnectorRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, connectors });
    await app.ready();
  });
  afterAll(async () => { await connectors.hub.close(); await app.close(); });

  it("wants a session on every route but the vendor's callback", async () => {
    const calls: Array<[string, string]> = [
      ["GET", "/v1/connectors"], ["POST", "/v1/connectors/testapp/connect"], ["POST", "/v1/connectors/testapp/level"],
      ["POST", "/v1/connectors/testapp/auto"], ["DELETE", "/v1/connectors/testapp"], ["GET", "/v1/tasks"],
      ["POST", "/v1/tasks/abc/approve"], ["POST", "/v1/tasks/abc/deny"],
    ];
    for (const [method, url] of calls) {
      const res = await app.inject({ method: method as "GET", url, payload: method === "POST" ? {} : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.json()).toEqual({ code: "unauthorized", message: "Missing or invalid token" });
    }
  });

  it("lists the enabled apps with this person's state, and connects a pasted link after trying it", async () => {
    let res = await app.inject({ method: "GET", url: "/v1/connectors", headers: as("ann") });
    expect(res.json()).toMatchObject({ enabled: true, connectors: [
      { id: "testapp", connected: false, level: "look", auto: [] },
      { id: "oapp", auth: "oauth", connected: false },
    ] });

    const wrongHost = await app.inject({ method: "POST", url: "/v1/connectors/testapp/connect", headers: as("ann"), payload: { url: "https://evil.example.com/mcp" } });
    expect(wrongHost.statusCode).toBe(400);
    const dead = await app.inject({ method: "POST", url: "/v1/connectors/testapp/connect", headers: as("ann"), payload: { url: "http://127.0.0.1:1/mcp" } });
    expect(dead.statusCode).toBe(400);
    expect((await store.getConnection("ann", "testapp"))!.tokensEnc).toBeNull();

    const ok = await app.inject({ method: "POST", url: "/v1/connectors/testapp/connect", headers: as("ann"), payload: { url: `${base}/mcp` } });
    expect(ok.json()).toEqual({ connected: true });
    const row = (await store.getConnection("ann", "testapp"))!;
    expect(row.tokensEnc).toMatch(/^v1\./);
    expect(row.tokensEnc).not.toContain("127.0.0.1");
    expect(row.level).toBe("look");

    res = await app.inject({ method: "GET", url: "/v1/connectors", headers: as("ann") });
    expect(res.json().connectors[0]).toMatchObject({ id: "testapp", connected: true, level: "look" });
    // Bob sees none of Ann's.
    expect((await app.inject({ method: "GET", url: "/v1/connectors", headers: as("bob") })).json().connectors[0].connected).toBe(false);
  });

  it("starts an OAuth sign-in and answers with the vendor's address", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/connectors/oapp/connect", headers: as("ann"), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().authorizeUrl).toContain(`${base}/authorize?`);
    expect((await app.inject({ method: "POST", url: "/v1/connectors/nope/connect", headers: as("ann"), payload: {} })).statusCode).toBe(404);
  });

  it("sets the level and the auto list, and checks what it is given", async () => {
    const lvl = (level: unknown, user = "ann") => app.inject({ method: "POST", url: "/v1/connectors/testapp/level", headers: as(user), payload: { level } });
    expect((await lvl("draft")).json()).toEqual({ ok: true, level: "draft" });
    expect((await store.getConnection("ann", "testapp"))!.level).toBe("draft");
    expect((await lvl("admin")).statusCode).toBe(400);
    expect((await lvl("send", "bob")).statusCode).toBe(404);

    const auto = (payload: unknown) => app.inject({ method: "POST", url: "/v1/connectors/testapp/auto", headers: as("ann"), payload: payload as object });
    expect((await auto({ tool: "post_message", on: true })).json().auto).toEqual(["post_message"]);
    expect((await auto({ tool: "post_message", on: true })).json().auto).toEqual(["post_message"]);
    expect((await auto({ tool: "create_note", on: true })).json().auto).toEqual(["post_message", "create_note"]);
    expect((await auto({ tool: "post_message", on: false })).json().auto).toEqual(["create_note"]);
    expect((await auto({ tool: "create_note", on: false })).json().auto).toEqual([]);
    expect((await auto({ tool: 5, on: true })).statusCode).toBe(400);
    expect((await auto({ tool: "x" })).statusCode).toBe(400);
  });

  it("shows tasks without their arguments, approves and denies them, and disconnects", async () => {
    await app.inject({ method: "POST", url: "/v1/connectors/testapp/level", headers: as("ann"), payload: { level: "send" } });
    const r1 = await runWith(['USE testapp.create_note {"title":"Plan"}\n'], req({ runId: "run_route1", utterance: "make a note called Plan in my notes" }), connectors.runtimeFor("ann"));
    const r2 = await runWith(['USE testapp.delete_note {"id":"n1"}\n'], req({ runId: "run_route2", utterance: "delete note n1 from my notes" }), connectors.runtimeFor("ann"));
    const [t1, t2] = [r1.events.at(-1)!.taskId, r2.events.at(-1)!.taskId];

    const list = await app.inject({ method: "GET", url: "/v1/tasks", headers: as("ann") });
    const tasks = list.json().tasks as Array<{ id: string; state: string; approval: Record<string, unknown> | null }>;
    expect(tasks.map((t) => t.state)).toEqual(expect.arrayContaining(["waiting", "waiting"]));
    expect(list.body).not.toContain('"args"');
    expect(tasks.find((t) => t.id === t1)!.approval).toMatchObject({ tool: "create_note", risk: "write" });
    expect((await app.inject({ method: "GET", url: "/v1/tasks", headers: as("bob") })).json().tasks).toEqual([]);

    expect((await app.inject({ method: "POST", url: `/v1/tasks/${t1}/approve`, headers: as("bob"), payload: {} })).statusCode).toBe(404);
    const yes = await app.inject({ method: "POST", url: `/v1/tasks/${t1}/approve`, headers: as("ann"), payload: {} });
    expect(yes.json()).toMatchObject({ ok: true, result: "Note created.", task: { id: t1, state: "done" } });
    expect(seen.calls).toEqual([{ tool: "create_note", args: { title: "Plan" } }]);
    expect((await app.inject({ method: "POST", url: `/v1/tasks/${t1}/approve`, headers: as("ann"), payload: {} })).statusCode).toBe(409);

    const no = await app.inject({ method: "POST", url: `/v1/tasks/${t2}/deny`, headers: as("ann"), payload: {} });
    expect(no.json()).toMatchObject({ ok: true, task: { state: "cancelled" } });
    expect(seen.calls).toHaveLength(1);

    expect((await app.inject({ method: "DELETE", url: "/v1/connectors/testapp", headers: as("ann") })).json()).toEqual({ ok: true });
    expect(await store.getConnection("ann", "testapp")).toBeNull();
  });

  it("answers the vendor's redirect with a small page and never a detail", async () => {
    const bad = await app.inject({ method: "GET", url: "/v1/connectors/callback?code=abc&state=forged" });
    expect(bad.statusCode).toBe(400);
    expect(bad.headers["content-type"]).toContain("text/html");
    expect(bad.headers["referrer-policy"]).toBe("no-referrer");
    expect(bad.body).not.toMatch(/forged|abc|bad_state/);
    expect((await app.inject({ method: "GET", url: "/v1/connectors/callback" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/connectors/callback?error=access_denied" })).body).toContain("Nothing was connected");

    // A real round trip: begin, then the vendor's redirect with the code.
    const begin = await app.inject({ method: "POST", url: "/v1/connectors/oapp/connect", headers: as("cy"), payload: {} });
    const state = new URL(begin.json().authorizeUrl).searchParams.get("state")!;
    wantBearer = "access-1";
    const done = await app.inject({ method: "GET", url: `/v1/connectors/callback?code=good&state=${encodeURIComponent(state)}` });
    expect(done.statusCode).toBe(200);
    expect(done.body).toContain("You can go back to Tailzu");
    expect((await store.getConnection("cy", "oapp"))!.tokensEnc).toMatch(/^v1\./);
  });

  it("says it is off, once, when connectors are not switched on", async () => {
    const off = Fastify();
    registerConnectorRoutes(off, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, connectors: null });
    expect((await off.inject({ method: "GET", url: "/v1/connectors", headers: as("ann") })).json()).toEqual({ enabled: false, connectors: [] });
    expect((await off.inject({ method: "GET", url: "/v1/tasks", headers: as("ann") })).statusCode).toBe(404);
    expect((await off.inject({ method: "GET", url: "/v1/connectors" })).statusCode).toBe(401);
    await off.close();
  });
});

describe("a task in the store", () => {
  it("keeps what is needed to run a waiting call out of everything but the task", async () => {
    const { connectors, user, store } = await setup();
    const r = await runWith(['USE testapp.post_message {"channel":"#team","text":"secret plans"}\n'], req(), connectors.runtimeFor(user));
    const task = (await store.getTask(user, r.events.at(-1)!.taskId)) as Task;
    expect(task.steps.map((s) => s.text).join(" ")).not.toContain("secret plans");
    expect(JSON.stringify(await store.listAudit(user, task.id))).not.toContain("secret plans");
    expect(randomBytes(1)).toBeTruthy();
  });
});
