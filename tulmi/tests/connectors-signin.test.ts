/**
 * Signing in to apps, and the guard on every request to them: who Tailzu is
 * to a vendor (a pre-registered client, our published client document, or
 * registration), the checks the SDK leaves out (the auth server's issuer,
 * PKCE, the issuer on the way back), the published document itself, and
 * egress.ts refusing private addresses at connect time, through redirects and
 * past its size and time limits.
 *
 * No network: the fake auth server listens on 127.0.0.1 (let through by the
 * test seam), DNS is answered by the seam, and every refused address is
 * refused before a connection is made.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import Fastify, { type FastifyInstance } from "fastify";

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

const { capBody, checkPublicUrl, egressFetch, egressFetchWith, isBlockedAddress, setEgressTestHooks } = await import("../src/connectors/egress.js");
const { UserOAuthProvider, beginOAuth, checkCallbackIssuer, completeOAuth, providerOptions, verifyState } = await import("../src/connectors/oauth.js");
const { MemoryConnectorStore } = await import("../src/connectors/store.js");
const { ConnectorHub, bearerFromUrl } = await import("../src/connectors/client.js");
const { createConnectors } = await import("../src/connectors/index.js");
const { encrypt } = await import("../src/connectors/crypto.js");
const { CATALOG } = await import("../src/connectors/catalog.js");
const { connectorOAuthClients } = await import("../src/config.js");
const { registerConnectorRoutes } = await import("../src/routes/connectors.js");
const { clientMetadataDocument, registerOAuthClientMetadataRoute } = await import("../src/routes/oauthClientMetadata.js");
type ConnectorDef = import("../src/connectors/catalog.js").ConnectorDef;

const CIMD = "https://api.example.com/oauth/client-metadata.json";
const REDIRECT = "https://api.example.com/v1/connectors/callback";

// ------------------------------------------------------- the fake auth server

let server: http.Server;
let base = "";
/** What the auth server's metadata says, over its defaults; reset before each test. */
let asMeta: Record<string, unknown> = {};
/** The auth servers the resource metadata names. Default: this server. */
let asList: string[] | null = null;
const seen = {
  registered: [] as Array<Record<string, unknown>>,
  tokens: [] as Array<{ form: Record<string, string>; authorization?: string }>,
  echo: [] as Array<{ path: string; authorization?: string; method?: string }>,
};

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const redirect = (res: http.ServerResponse, status: number, to: string) => { res.writeHead(status, { location: to }); res.end(); };

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0]!;
    const port = (server.address() as { port: number }).port;
    if (path === "/.well-known/oauth-protected-resource/mcp") {
      return json(res, 200, { resource: `${base}/mcp`, authorization_servers: asList ?? [base] });
    }
    if (path === "/.well-known/oauth-authorization-server") {
      return json(res, 200, Object.fromEntries(Object.entries({
        issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`, response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post"], ...asMeta,
      }).filter(([, v]) => v !== undefined)));
    }
    if (path === "/register" && req.method === "POST") {
      const meta = JSON.parse(await readBody(req));
      seen.registered.push(meta);
      return json(res, 201, { ...meta, client_id: "dcr-1" });
    }
    if (path === "/token" && req.method === "POST") {
      seen.tokens.push({ form: Object.fromEntries(new URLSearchParams(await readBody(req))), authorization: req.headers.authorization });
      return json(res, 200, { access_token: "access-1", token_type: "Bearer", refresh_token: "refresh-1", expires_in: 3600 });
    }
    // Redirect chains for egress: /hop/3 -> /hop/2 -> /hop/1 -> /hop/0.
    const hop = path.match(/^\/hop\/(\d+)$/);
    if (hop) return Number(hop[1]) === 0 ? json(res, 200, { end: true }) : redirect(res, 302, `/hop/${Number(hop[1]) - 1}`);
    if (path === "/to-private") return redirect(res, 302, "http://10.0.0.1/");
    if (path === "/to-inside") return redirect(res, 302, `http://inside.example:${port}/hop/0`);
    if (path === "/to-other") return redirect(res, 302, `http://other.example:${port}/echo`);
    if (path === "/to-same") return redirect(res, 302, "/echo");
    if (path === "/post-other") return redirect(res, 307, `http://other.example:${port}/echo`);
    if (path === "/echo") {
      seen.echo.push({ path, authorization: req.headers.authorization, method: req.method });
      return json(res, 200, { ok: true });
    }
    if (path === "/big") { res.writeHead(200, { "content-type": "application/json" }); res.end("x".repeat(5000)); return; }
    if (path === "/hang") return; // never answers
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { setEgressTestHooks(null); server.closeAllConnections(); await new Promise((r) => server.close(r)); });

/** The local server is let through; named hosts answer 127.0.0.1, except inside.example. */
const local = () => setEgressTestHooks({
  allow: ["127.0.0.1"],
  resolve: (h) => (h === "inside.example" ? ["10.0.0.9"] : ["127.0.0.1"]),
});
beforeEach(() => {
  asMeta = {}; asList = null;
  seen.registered = []; seen.tokens = []; seen.echo = [];
  local();
});
afterEach(() => setEgressTestHooks(null));

const refusal = (reason: string) => expect.objectContaining({ name: "EgressRefused", reason });

// ------------------------------------------------------------ egress: addresses

describe("which addresses are never dialled", () => {
  it("refuses private, loopback, link-local, reserved and IPv4-in-IPv6 addresses", () => {
    for (const ip of [
      "127.0.0.1", "127.255.255.254", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
      "100.64.0.1", "0.0.0.0", "192.0.0.8", "198.18.0.1", "198.19.255.255", "224.0.0.1", "239.1.1.1", "240.0.0.1", "255.255.255.255",
      "::", "::1", "[::1]", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "fec0::1", "ff02::1", "2001:db8::1",
      "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a00:1", "::ffff:0:a00:1", "64:ff9b::a00:1", "64:ff9b::7f00:1", "64:ff9b::169.254.169.254",
      "::7f00:1", "64:ff9b:1::1", "not-an-address", "",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("lets public addresses through, including one inside an IPv6 wrapper", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "100.128.0.1", "198.20.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });
});

describe("checkPublicUrl", () => {
  beforeEach(() => setEgressTestHooks({
    resolve: (h) => ({ "app.example": ["93.184.216.34"], "inside.example": ["10.0.0.5"], "mixed.example": ["93.184.216.34", "127.0.0.1"], "v6.example": ["::1"] } as Record<string, string[]>)[h] ?? [],
  }));

  it("takes a public https address on 443 or 8443", async () => {
    expect((await checkPublicUrl(" https://app.example/mcp ")).href).toBe("https://app.example/mcp");
    expect((await checkPublicUrl("https://app.example:8443/mcp")).port).toBe("8443");
    expect((await checkPublicUrl("https://app.example:443/x")).port).toBe("");
    expect((await checkPublicUrl("https://93.184.216.34/mcp")).hostname).toBe("93.184.216.34");
  });

  it("refuses everything else, each with its reason", async () => {
    const cases: Array<[unknown, string]> = [
      ["nope", "bad_url"], [5, "bad_url"], ["", "bad_url"], [`https://app.example/${"a".repeat(2100)}`, "bad_url"],
      ["http://app.example/mcp", "not_https"], ["ftp://app.example/", "not_https"],
      ["https://app.example:8080/mcp", "bad_port"], ["https://user:pw@app.example/", "userinfo"], ["https://app.example/mcp#x", "fragment"],
      ["https://127.0.0.1/", "private_address"], ["https://0x7f.1/", "private_address"], ["https://2130706433/", "private_address"],
      ["https://[::1]/", "private_address"], ["https://[::ffff:127.0.0.1]/", "private_address"], ["https://[64:ff9b::a00:1]/", "private_address"],
      ["https://169.254.169.254/latest/meta-data", "private_address"],
      ["https://inside.example/", "private_address"], ["https://mixed.example/", "private_address"], ["https://v6.example/", "private_address"],
      ["https://nowhere.example/", "no_address"],
    ];
    for (const [raw, reason] of cases) await expect(checkPublicUrl(raw), String(raw)).rejects.toEqual(refusal(reason));
  });

  it("is only a first look: the address dialled is checked again when the connection is made", async () => {
    let asked = 0;
    // A rebinding name: public for the check, loopback a moment later.
    setEgressTestHooks({ resolve: () => (asked++ === 0 ? ["93.184.216.34"] : ["127.0.0.1"]) });
    const u = await checkPublicUrl("https://rebind.example/mcp");
    await expect(egressFetch(u)).rejects.toEqual(refusal("private_address"));
    expect(asked).toBe(2);
  });

  it("has a seam only a test can open", () => {
    const was = process.env.VITEST;
    delete process.env.VITEST;
    try {
      expect(() => setEgressTestHooks({ allow: ["127.0.0.1"] })).toThrow(/tests only/);
      expect(() => setEgressTestHooks(null)).not.toThrow();
    } finally { process.env.VITEST = was; }
  });
});

// ------------------------------------------------------------- egress: requests

describe("egressFetch", () => {
  it("refuses a named host that resolves to a private address, inside the connection's own lookup", async () => {
    setEgressTestHooks({ resolve: () => ["10.0.0.7"] });
    await expect(egressFetch("https://intranet.example/mcp")).rejects.toEqual(refusal("private_address"));
    await expect(egressFetch("https://intranet.example/mcp")).rejects.not.toBeInstanceOf(TypeError);
    setEgressTestHooks({ resolve: () => [] });
    await expect(egressFetch("https://nowhere.example/")).rejects.toEqual(refusal("no_address"));
  });

  it("refuses an address written into the URL, plain http and other ports, before connecting", async () => {
    setEgressTestHooks(null);
    await expect(egressFetch("https://10.0.0.1/mcp")).rejects.toEqual(refusal("private_address"));
    await expect(egressFetch("https://[::ffff:192.168.0.1]/")).rejects.toEqual(refusal("private_address"));
    await expect(egressFetch("http://mcp.example.com/")).rejects.toEqual(refusal("not_https"));
    await expect(egressFetch("https://mcp.example.com:22/")).rejects.toEqual(refusal("bad_port"));
  });

  it("follows at most three redirects, checking each", async () => {
    expect((await egressFetch(`${base}/hop/3`)).status).toBe(200);
    await expect(egressFetch(`${base}/hop/4`)).rejects.toEqual(refusal("redirects"));
    await expect(egressFetch(`${base}/to-private`)).rejects.toEqual(refusal("private_address"));
    await expect(egressFetch(`${base}/to-inside`)).rejects.toEqual(refusal("private_address"));
  });

  it("hands a manual redirect back as it is (the SDK follows those, through here, one checked hop at a time)", async () => {
    const res = await egressFetch(`${base}/to-private`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://10.0.0.1/");
  });

  it("never carries credentials, or a request's body, to another origin", async () => {
    await egressFetch(`${base}/to-same`, { headers: { Authorization: "Bearer same" } });
    await egressFetch(`${base}/to-other`, { headers: { Authorization: "Bearer secret" } });
    expect(seen.echo.map((e) => e.authorization)).toEqual(["Bearer same", undefined]);
    const post = await egressFetch(`${base}/post-other`, { method: "POST", body: "code=abc&client_secret=s" });
    expect(post.status).toBe(307);
    expect(seen.echo).toHaveLength(2);
  });

  it("cuts a body off past its limit, and a sign-in request off after its time", async () => {
    await expect((await egressFetchWith({ maxBytes: 10_000 })(`${base}/big`)).text()).resolves.toHaveLength(5000);
    await expect((await egressFetchWith({ maxBytes: 1000 })(`${base}/big`)).text()).rejects.toEqual(refusal("too_large"));
    const t0 = Date.now();
    await expect(egressFetchWith({ timeoutMs: 150 })(`${base}/hang`)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("caps a body by its declared length before reading, and leaves an empty answer alone", async () => {
    const declared = new Response("small", { headers: { "content-length": "999999" } });
    await expect(capBody(declared, 100).text()).rejects.toEqual(refusal("too_large"));
    const streamed = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(60)); c.enqueue(new Uint8Array(60)); c.close(); } }));
    await expect(capBody(streamed, 100).arrayBuffer()).rejects.toEqual(refusal("too_large"));
    const empty = new Response(null, { status: 204 });
    expect(capBody(empty, 1)).toBe(empty);
    const ok = capBody(new Response('{"a":1}', { status: 201, headers: { "x-k": "v" } }), 100);
    expect([ok.status, ok.headers.get("x-k"), await ok.json()]).toEqual([201, "v", { a: 1 }]);
  });
});

// ------------------------------------------------------------- the provider

const newStore = () => new MemoryConnectorStore();
const meta = (over: Record<string, unknown> = {}) => ({
  issuer: "https://as.example", authorization_endpoint: "https://as.example/authorize", token_endpoint: "https://as.example/token",
  response_types_supported: ["code"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], ...over,
});
const discovered = (m: Record<string, unknown> | undefined, server = "https://as.example", withResource = true) => ({
  authorizationServerUrl: server,
  authorizationServerMetadata: m as never,
  resourceMetadata: withResource ? { resource: "https://app.example/mcp", authorization_servers: [server] } : undefined,
});

describe("the provider: who we are, and what the auth server must be", () => {
  it("registers as a web app, and offers our published identity only where a client with no secret is let in", () => {
    const p = new UserOAuthProvider(newStore(), "u1", "x", REDIRECT, true, { cimdUrl: CIMD });
    expect(p.clientMetadata).toMatchObject({ application_type: "web", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
    expect(p.clientMetadataUrl).toBeUndefined(); // nothing discovered yet
    p.saveDiscoveryState(discovered(meta({ client_id_metadata_document_supported: true })));
    expect(p.clientMetadataUrl).toBe(CIMD);

    const secretOnly = new UserOAuthProvider(newStore(), "u1", "x", REDIRECT, true, { cimdUrl: CIMD });
    secretOnly.saveDiscoveryState(discovered(meta({ token_endpoint_auth_methods_supported: ["client_secret_basic"] })));
    expect(secretOnly.clientMetadataUrl).toBeUndefined();
    const silent = new UserOAuthProvider(newStore(), "u1", "x", REDIRECT, true, { cimdUrl: CIMD });
    silent.saveDiscoveryState(discovered(meta({ token_endpoint_auth_methods_supported: undefined })));
    expect(silent.clientMetadataUrl).toBeUndefined();
    const off = new UserOAuthProvider(newStore(), "u1", "x", REDIRECT, true, {});
    off.saveDiscoveryState(discovered(meta()));
    expect(off.clientMetadataUrl).toBeUndefined();
  });

  it("presents a pre-registered client and never lets the SDK register over it", async () => {
    const staticClient = { client_id: "pre-1", client_secret: "s3cret", issuer: "https://as.example" };
    const p = new UserOAuthProvider(newStore(), "u1", "x", REDIRECT, true, { cimdUrl: CIMD, staticClient });
    expect(p.saveClientInformation).toBeUndefined();
    expect(await p.clientInformation()).toEqual(staticClient);
    p.saveDiscoveryState(discovered(meta()));
    expect(p.clientMetadataUrl).toBeUndefined();
    expect(new UserOAuthProvider(newStore(), "u1", "x", REDIRECT).saveClientInformation).toBeTypeOf("function");
  });

  it("refuses metadata that names another issuer, for every app", () => {
    for (const strict of [true, false]) {
      const p = new UserOAuthProvider(newStore(), "u1", "x", REDIRECT, true, { strict, name: "Thing" });
      expect(() => p.saveDiscoveryState(discovered(meta({ issuer: "https://evil.example" })))).toThrow(/Thing's sign-in server didn't identify itself/);
      expect(() => p.saveDiscoveryState(discovered(meta({ issuer: "https://as.example/" })))).toThrow();
    }
    // With no resource metadata the SDK makes the server's URL from the origin, with a "/".
    const legacy = new UserOAuthProvider(newStore(), "u1", "x", REDIRECT, true, { strict: true });
    expect(() => legacy.saveDiscoveryState(discovered(meta(), "https://as.example/", false))).not.toThrow();
  });

  it("requires PKCE with S256 of an app outside the catalog, and only logs it for a catalog app", () => {
    const warn = vi.fn();
    for (const m of [meta({ code_challenge_methods_supported: undefined }), meta({ code_challenge_methods_supported: ["plain"] }), undefined]) {
      const strict = new UserOAuthProvider(newStore(), "u1", "x", REDIRECT, true, { strict: true });
      expect(() => strict.saveDiscoveryState(discovered(m))).toThrow(expect.objectContaining({ code: "unsupported" }));
      const lenient = new UserOAuthProvider(newStore(), "u1", "notion", REDIRECT, true, { strict: false, warn });
      expect(() => lenient.saveDiscoveryState(discovered(m))).not.toThrow();
    }
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[0]![0]).toMatch(/notion.*S256/);
  });

  it("is lenient only with a vetted catalog app at its vetted address", () => {
    const notion = CATALOG.find((c) => c.id === "notion")!;
    expect(providerOptions({}, notion).strict).toBe(false);
    expect(providerOptions({}, { ...notion, url: "https://evil.example/mcp" }).strict).toBe(true);
    expect(providerOptions({}, { ...notion, id: "c_123" }).strict).toBe(true);
    const clients = { github: { client_id: "gh", issuer: "https://github.com/login/oauth" } };
    expect(providerOptions({ clients, clientMetadataUrl: "" }, CATALOG.find((c) => c.id === "github")!)).toMatchObject({ staticClient: clients.github, cimdUrl: undefined });
  });

  it("offers our client document only at an https address with a path (the SDK would throw on any other)", () => {
    const notion = CATALOG.find((c) => c.id === "notion")!;
    expect(providerOptions({ clientMetadataUrl: CIMD }, notion).cimdUrl).toBe(CIMD);
    for (const bad of ["http://api.example.com/doc.json", "https://api.example.com/", "https://api.example.com", "nope", ""]) {
      expect(providerOptions({ clientMetadataUrl: bad }, notion).cimdUrl, bad).toBeUndefined();
    }
  });

  it("carries the issuer it found, and whether it promised iss, in the signed state", async () => {
    const p = new UserOAuthProvider(newStore(), "u1", "x", REDIRECT, true, {});
    expect(await verifyState(await p.state())).toEqual({ userId: "u1", connectorId: "x" });
    p.saveDiscoveryState(discovered(meta({ authorization_response_iss_parameter_supported: true })));
    expect(await verifyState(await p.state())).toEqual({ userId: "u1", connectorId: "x", issuer: "https://as.example", issRequired: true });
    const q = new UserOAuthProvider(newStore(), "u1", "x", REDIRECT, true, {});
    q.saveDiscoveryState(discovered(meta()));
    expect(await verifyState(await q.state())).toMatchObject({ issuer: "https://as.example", issRequired: false });
  });

  it("finishes a sign-in only at the auth server it started at", () => {
    const p = new UserOAuthProvider(newStore(), "u1", "x", REDIRECT, false, { expectIssuer: "https://other.example" });
    expect(() => p.saveDiscoveryState(discovered(meta()))).toThrow(expect.objectContaining({ code: "bad_state" }));
  });
});

describe("the issuer on the way back (RFC 9207)", () => {
  const as = "https://as.example";
  it.each([
    [as, false, undefined, true],
    [as, false, as, true],
    [as, true, as, true],
    [as, true, undefined, false],
    [as, true, "", false],
    [as, false, "https://evil.example", false],
    [as, false, "https://as.example/", false],
    [undefined, false, as, false],
    [undefined, false, undefined, true],
  ] as const)("expected %s, required %s, got %s -> ok %s", (expected, required, got, ok) => {
    const run = () => checkCallbackIssuer(expected, required, got);
    if (ok) expect(run).not.toThrow();
    else expect(run).toThrow(expect.objectContaining({ code: "bad_state" }));
  });
});

// ------------------------------------------------------- whole sign-ins

const app = (over: Partial<ConnectorDef> = {}): ConnectorDef => ({
  id: "oapp", name: "OAuth App", category: "Test", oneLine: "A test app.", aliases: [],
  url: `${base}/mcp`, auth: "oauth", verified: false, ...over,
});
const stateOf = (url: string) => new URL(url).searchParams.get("state")!;

describe("signing in, end to end", () => {
  it("uses our published identity where the auth server takes it: no registration, and the client id is the document's URL", async () => {
    asMeta = { client_id_metadata_document_supported: true, authorization_response_iss_parameter_supported: true };
    const store = newStore();
    const url = new URL(await beginOAuth({ store, redirectUrl: REDIRECT, clientMetadataUrl: CIMD }, "u1", app()));
    expect(url.searchParams.get("client_id")).toBe(CIMD);
    expect(seen.registered).toHaveLength(0);
    expect((await store.getConnection("u1", "oapp"))!.clientInfo).toEqual({ client_id: CIMD, issuer: base });

    // The server promised iss: a callback without it, or with another, is refused before any code is exchanged.
    const deps = { store, redirectUrl: REDIRECT, clientMetadataUrl: CIMD };
    await expect(completeOAuth(deps, () => app(), "c", stateOf(url.href))).rejects.toMatchObject({ code: "bad_state" });
    await expect(completeOAuth(deps, () => app(), "c", stateOf(url.href), "https://evil.example")).rejects.toMatchObject({ code: "bad_state" });
    expect(seen.tokens).toHaveLength(0);
    const done = await completeOAuth(deps, () => app(), "the-code", stateOf(url.href), base);
    expect(done.userId).toBe("u1");
    expect(seen.tokens[0]!.form).toMatchObject({ grant_type: "authorization_code", client_id: CIMD, code: "the-code" });
    expect(seen.tokens[0]!.form.client_secret).toBeUndefined();
  });

  it("registers (as a web app) where the auth server takes no client document, or no client without a secret", async () => {
    asMeta = { client_id_metadata_document_supported: true, token_endpoint_auth_methods_supported: ["client_secret_post"] };
    const url = new URL(await beginOAuth({ store: newStore(), redirectUrl: REDIRECT, clientMetadataUrl: CIMD }, "u1", app()));
    expect(url.searchParams.get("client_id")).toBe("dcr-1");
    expect(seen.registered).toHaveLength(1);
    expect(seen.registered[0]).toMatchObject({ application_type: "web", redirect_uris: [REDIRECT] });
  });

  it("signs in with a pre-registered client and its secret, and stores neither", async () => {
    const store = newStore();
    const clients = { oapp: { client_id: "pre-1", client_secret: "s3cret", issuer: base } };
    asMeta = { client_id_metadata_document_supported: true };
    const deps = { store, redirectUrl: REDIRECT, clientMetadataUrl: CIMD, clients };
    const url = new URL(await beginOAuth(deps, "u1", app({ preRegistered: true })));
    expect(url.searchParams.get("client_id")).toBe("pre-1");
    expect(seen.registered).toHaveLength(0);
    expect((await store.getConnection("u1", "oapp"))!.clientInfo).toBeNull();
    await completeOAuth(deps, () => app({ preRegistered: true }), "the-code", stateOf(url.href));
    expect(seen.tokens[0]!.form).toMatchObject({ client_id: "pre-1", client_secret: "s3cret" });
    expect(JSON.stringify(await store.getConnection("u1", "oapp"))).not.toContain("s3cret");
  });

  it("will not show a pre-registered client to another auth server, nor register one there instead", async () => {
    const clients = { oapp: { client_id: "pre-1", issuer: "https://github.com/login/oauth" } };
    await expect(beginOAuth({ store: newStore(), redirectUrl: REDIRECT, clients }, "u1", app())).rejects.toThrow(/bound to authorization server/);
    expect(seen.registered).toHaveLength(0);
  });

  it("answers 'not set up yet' for an app that needs a pre-registered client and has none", async () => {
    await expect(beginOAuth({ store: newStore(), redirectUrl: REDIRECT, clients: {} }, "u1", app({ preRegistered: true, name: "GitHub" })))
      .rejects.toMatchObject({ code: "not_configured", message: "GitHub can't be connected yet: Tailzu's sign-in for it isn't set up." });
  });

  it("stops before sending anyone anywhere when the auth server's metadata is not its own, or it skips PKCE", async () => {
    asMeta = { issuer: "https://login.example" };
    await expect(beginOAuth({ store: newStore(), redirectUrl: REDIRECT }, "u1", app())).rejects.toMatchObject({ code: "unsupported" });
    asMeta = { code_challenge_methods_supported: undefined };
    await expect(beginOAuth({ store: newStore(), redirectUrl: REDIRECT }, "u1", app())).rejects.toMatchObject({ code: "unsupported" });
    expect(seen.registered).toHaveLength(0);
  });

  it("refuses an auth server the resource metadata places on a private address", async () => {
    asList = ["https://10.0.0.7"];
    await expect(beginOAuth({ store: newStore(), redirectUrl: REDIRECT }, "u1", app())).rejects.toMatchObject({ code: "blocked_address" });
  });
});

describe("the routes", () => {
  let api: FastifyInstance;
  let connectors: ReturnType<typeof createConnectors>;
  const as = (user: string) => ({ authorization: `Bearer ${user}` });

  beforeAll(async () => {
    connectors = createConnectors({
      store: newStore(), redirectUrl: REDIRECT, signIn: { clientMetadataUrl: CIMD, clients: {} },
      catalog: [app(), app({ id: "gh", name: "GitHub", preRegistered: true })],
    });
    api = Fastify();
    registerConnectorRoutes(api, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, connectors });
    registerOAuthClientMetadataRoute(api, { clientMetadataUrl: CIMD, redirectUrl: REDIRECT });
    await api.ready();
  });
  afterAll(async () => { await connectors.hub.close(); await api.close(); });

  it("answers Connect on an app with no client set up with 503 and a plain line", async () => {
    const res = await api.inject({ method: "POST", url: "/v1/connectors/gh/connect", headers: as("ann"), payload: {} });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: "not_configured", message: "GitHub can't be connected yet: Tailzu's sign-in for it isn't set up." });
  });

  it("passes the callback's iss along, and a wrong one connects nothing", async () => {
    asMeta = { authorization_response_iss_parameter_supported: true };
    const begin = await api.inject({ method: "POST", url: "/v1/connectors/oapp/connect", headers: as("cy"), payload: {} });
    const state = encodeURIComponent(stateOf(begin.json().authorizeUrl));
    const wrong = await api.inject({ method: "GET", url: `/v1/connectors/callback?code=good&state=${state}&iss=${encodeURIComponent("https://evil.example")}` });
    expect(wrong.statusCode).toBe(400);
    expect(seen.tokens).toHaveLength(0);
    const right = await api.inject({ method: "GET", url: `/v1/connectors/callback?code=good&state=${state}&iss=${encodeURIComponent(base)}` });
    expect(right.statusCode).toBe(200);
    expect((await connectors.store.getConnection("cy", "oapp"))!.tokensEnc).toMatch(/^v1\./);
  });

  it("publishes our client document, exactly as the sign-in describes us", async () => {
    const res = await api.inject({ method: "GET", url: "/oauth/client-metadata.json" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["cache-control"]).toBe("public, max-age=86400");
    expect(res.json()).toEqual({
      client_id: CIMD, client_name: "Tailzu", client_uri: "https://x0bot.com", redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
    });
    expect(clientMetadataDocument({ clientMetadataUrl: CIMD, redirectUrl: REDIRECT })).toEqual(res.json());
  });

  it("publishes nothing when there is no document to publish", async () => {
    const bare = Fastify();
    registerOAuthClientMetadataRoute(bare, { clientMetadataUrl: "", redirectUrl: REDIRECT });
    expect((await bare.inject({ method: "GET", url: "/oauth/client-metadata.json" })).statusCode).toBe(404);
    await bare.close();
  });
});

// ------------------------------------------------- the hub and pasted links

describe("the hub's requests", () => {
  it("refuses an app whose address is private, in plain words", async () => {
    setEgressTestHooks(null);
    const store = newStore();
    const def = app({ id: "z", name: "Zap", auth: "url", url: "https://10.0.0.1/mcp" });
    await store.upsertConnection("u1", "z", { tokensEnc: encrypt(JSON.stringify({ url: "https://10.0.0.1/mcp?token=t" })) });
    const hub = new ConnectorHub({ store, catalog: [def], redirectUrl: REDIRECT });
    expect((await hub.call("u1", "z", "anything", {})).error).toEqual({ code: "blocked_address", message: "Zap is at an address Tailzu won't connect to." });
    await hub.close();
  });

  it("moves a pasted link's ?token= into an Authorization header, and leaves other links alone", () => {
    const moved = bearerFromUrl(new URL("https://mcp.zapier.com/api/v1/connect?token=abc%2Bdef&x=1"));
    expect(moved.url.href).toBe("https://mcp.zapier.com/api/v1/connect?x=1");
    expect(moved.headers).toEqual({ Authorization: "Bearer abc+def" });
    const path = new URL("https://mcp.zapier.com/api/mcp/s/secret/mcp");
    expect(bearerFromUrl(path)).toEqual({ url: path });
    expect(bearerFromUrl(new URL("https://mcp.zapier.com/x?token=")).headers).toBeUndefined();
  });
});

// ---------------------------------------------------------------- the config

describe("CONNECTOR_OAUTH_CLIENTS", () => {
  it("reads clients by id, and ignores what it cannot use with a warning that never repeats a secret", () => {
    const warn = vi.fn();
    expect(connectorOAuthClients(undefined, warn)).toEqual({});
    expect(connectorOAuthClients("  ", warn)).toEqual({});
    expect(connectorOAuthClients('{"GitHub":{"client_id":"gh","client_secret":"s","issuer":"https://github.com/login/oauth"}}', warn))
      .toEqual({ github: { client_id: "gh", client_secret: "s", issuer: "https://github.com/login/oauth" } });
    expect(warn).not.toHaveBeenCalled();

    expect(connectorOAuthClients('{"github":{"client_id":"gh","client_secret":"hunter2"', warn)).toEqual({});
    expect(connectorOAuthClients('["github"]', warn)).toEqual({});
    expect(connectorOAuthClients(JSON.stringify({
      asana: { client_id: "a", client_secret: "hunter2", issuer: "http://app.asana.com" },
      atlassian: { client_secret: "hunter2", issuer: "https://auth.atlassian.com/x" },
      github: { client_id: "gh", issuer: "https://github.com/login/oauth" },
    }), warn)).toEqual({ github: { client_id: "gh", issuer: "https://github.com/login/oauth" } });
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("hunter2");
  });
});
