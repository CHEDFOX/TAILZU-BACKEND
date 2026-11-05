/**
 * THE SPACES TESTS' RIG (spaces-join, spaces-feed, spaces-work): the spaces routes and Work in space on memory tables, a clock, a mail
 * outbox with no mailer, files in memory, and a family made the way the new Spaces screen makes one (the admin invites each address;
 * each accepts the invitation waiting for them, having seen the line about the admin).
 *
 * The test file mocks resolveUser (with PEOPLE: who signs in with which address, confirmed or not) and the push engine (into its own
 * list) before it imports this; everything here is imported after, so it gets the mocks.
 */
export const A_ = "11111111-1111-4111-8111-111111111111"; // Aanya, who makes Home: its admin
export const M_ = "22222222-2222-4222-8222-222222222222"; // Mom
export const R_ = "33333333-3333-4333-8333-333333333333"; // Rohan
export const X_ = "44444444-4444-4444-8444-444444444444"; // a stranger with the code
export const D_ = "55555555-5555-4555-8555-555555555555"; // Dev, another member
export const K_ = "66666666-6666-4666-8666-666666666666"; // Mom K., a second "Mom"
export const AREA = "/v1/botsapp/bots";

/** Who signs in with which address (the names come from it: mom@ is "Mom"), and whether it is confirmed. */
export const PEOPLE: Record<string, { email: string; confirmed: boolean }> = {
  [A_]: { email: "aanya.sharma@example.in", confirmed: true },
  [M_]: { email: "mom@example.in", confirmed: true },
  [R_]: { email: "rohan@example.in", confirmed: true },
  [X_]: { email: "x@example.in", confirmed: true },
  [D_]: { email: "dev@example.in", confirmed: true },
  [K_]: { email: "mom.k@example.in", confirmed: true },
};

/** The mocked resolveUser: the bearer is the person's id. */
export function signedIn(h: string | undefined): { id: string; email: string; emailConfirmed: boolean } | null {
  const id = h?.replace(/^Bearer\s+/i, "").trim();
  const p = id ? PEOPLE[id] : undefined;
  return id && p ? { id, email: p.email, emailConfirmed: p.confirmed } : null;
}

export interface Push { userId: string; kind: string; vars: Record<string, string>; data: Record<string, string> }

export const FILE_M = "aaaaaaaa-0000-4000-8000-00000000000b";

export interface OwnItem { id: string; title: string; line: string; at: number | null }

export async function spacesServer(o: { pushes: Push[]; clock?: { t: number }; sources?: Record<string, { list(userId: string): Promise<OwnItem[]> }> } ) {
  const Fastify = (await import("fastify")).default;
  const { Spaces } = await import("../src/botsBots/spaces.js");
  const { MailOutbox, NOT_CONFIGURED } = await import("../src/botsBots/mail.js");
  const { MemoryPaged, resetSpaceTablesForTests } = await import("../src/botsBots/spaceRows.js");
  const { resetAreaTablesForTests } = await import("../src/botsBots/rows.js");
  const { registerSpacesRoutes, spaceParts } = await import("../src/routes/bots/botsSpaces.js");
  const { registerWorkRoutes } = await import("../src/routes/bots/work.js");
  const { resetCalendarForTests } = await import("../src/calendar/index.js");
  resetAreaTablesForTests();
  resetSpaceTablesForTests();
  resetCalendarForTests();
  o.pushes.length = 0;
  const clock = o.clock ?? { t: Date.UTC(2026, 10, 10, 6, 0) };
  const now = () => clock.t;
  const outbox = new MailOutbox(new MemoryPaged(), now);
  const spaces = new Spaces(null, now, { outbox, mailer: NOT_CONFIGURED, origin: () => "https://app.example.in" });
  const files = new Map([[FILE_M, { id: FILE_M, userId: M_, name: "menu.jpg", mime: "image/jpeg", bytes: 1200, kind: "image", keep: false }]]);
  const media = {
    store: { get: async (u: string, id: string) => { const f = files.get(id); return f && f.userId === u ? { ...f } : null; } },
    keep: async (u: string, id: string, k: boolean) => { const f = files.get(id); if (f && f.userId === u) f.keep = k; return f ?? null; },
    bytesOf: async (i: { id: string }) => Buffer.from(`bytes of ${i.id}`),
  };
  const app = Fastify();
  const deps = { rateLimit: { rateLimit: { max: 10_000, timeWindow: 60_000 } }, bots: null, code: null, jobs: null, connectors: null, media: media as never, artifacts: null } as never;
  // Every part on the test's clock.
  const parts = spaceParts(spaces, { now, media: media as never, origin: "https://api.example.in", ...(o.sources ? { sources: o.sources as never } : {}) });
  registerSpacesRoutes(app, deps, { spaces, parts });
  registerWorkRoutes(app, deps, parts);
  await app.ready();
  const call = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, user: string | null = A_, payload?: unknown) => {
    const r = await app.inject({ method, url: url.replace(/^https?:\/\/[^/]+/, ""), headers: user ? { authorization: `Bearer ${user}` } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: r.statusCode, body: r.body ? (() => { try { return r.json(); } catch { return r.body; } })() : null, headers: r.headers };
  };

  /** The admin invites `who`'s address; they accept the invitation waiting for them (consent: they saw the line about the admin). */
  const bringIn = async (spaceId: string, who: string, o2: { consent?: boolean; by?: string } = {}) => {
    const by = o2.by ?? A_;
    const r = await call("POST", `${AREA}/spaces/${spaceId}/invite`, by, { email: PEOPLE[who]!.email });
    if (r.status !== 200) throw new Error(`invite failed: ${JSON.stringify(r.body)}`);
    const acc = await call("PUT", `${AREA}/spaces/invitations/${r.body.code}`, who, { decision: "accept", consent: o2.consent !== false });
    if (acc.status !== 200 || acc.body.status !== "joined") throw new Error(`accept failed: ${JSON.stringify(acc.body)}`);
  };

  /** Home: Aanya (admin) and `members` (Mom and Rohan unless said), each in by their invitation. */
  const family = async (members: string[] = [M_, R_], o2: { consent?: boolean } = {}) => {
    const id = (await call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id as string;
    for (const m of members) await bringIn(id, m, o2);
    return id;
  };

  return { app, call, clock, outbox, spaces, parts, bringIn, family };
}
