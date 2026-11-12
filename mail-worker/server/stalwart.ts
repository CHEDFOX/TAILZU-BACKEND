// Talking to Stalwart. Two kinds of session, both JMAP over its HTTP listener:
//
//   admin      the bootstrap admin, for the server's own objects ("x:Domain/set",
//              "x:Account/set", ...): domains, accounts, aliases, passwords.
//   mailbox    one company's mail, opened by impersonation: the admin logs in as
//              "<company address>%<admin>" with the admin's secret, and Stalwart
//              hands back that account's own token (user permissions, not admin).
//              So the dashboard never stores a mailbox password.
import { config } from "./config.ts";

export const MAIL_USING = [
  "urn:ietf:params:jmap:core",
  "urn:ietf:params:jmap:mail",
  "urn:ietf:params:jmap:submission",
  "urn:ietf:params:jmap:sieve",
  "urn:ietf:params:jmap:vacationresponse",
  "urn:ietf:params:jmap:quota",
];
const ADMIN_USING = ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"];

export class StalwartError extends Error {
  detail: unknown;
  status?: number;
  constructor(message: string, detail?: unknown, status?: number) {
    super(message);
    this.detail = detail;
    this.status = status;
  }
}

type Auth = { user: string; pass: string };
const basic = (a: Auth) => "Basic " + Buffer.from(`${a.user}:${a.pass}`).toString("base64");

export async function stalwartFetch(auth: Auth, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", basic(auth));
  let res: Response;
  try {
    res = await fetch(config.stalwartUrl + path, { ...init, headers, redirect: "manual", signal: init.signal ?? AbortSignal.timeout(60_000) });
  } catch (e) {
    throw new StalwartError(`the mail server is not answering (${(e as Error).message})`, undefined, 503);
  }
  // /.well-known/jmap answers with a redirect to /jmap/session on the same host.
  if (res.status >= 300 && res.status < 400 && res.headers.get("location")?.startsWith("/")) {
    return stalwartFetch(auth, res.headers.get("location")!, init);
  }
  if (res.status === 401) throw new StalwartError("the mail server refused the login", undefined, 401);
  return res;
}

type Invocation = [string, Record<string, unknown>, string];

async function jmap(auth: Auth, using: string[], methodCalls: Invocation[]): Promise<Invocation[]> {
  const res = await stalwartFetch(auth, "/jmap/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ using, methodCalls }),
  });
  const body = await res.json().catch(() => null) as { methodResponses?: Invocation[]; detail?: string; title?: string } | null;
  if (!res.ok || !body?.methodResponses) {
    throw new StalwartError(body?.detail || body?.title || `JMAP request failed (${res.status})`, body, res.status);
  }
  return body.methodResponses;
}

/** The result of one call, or a StalwartError carrying what was refused. */
function unwrap(name: string, inv: Invocation): Record<string, unknown> {
  const [kind, res] = inv;
  if (kind === "error") throw new StalwartError(`${name}: ${String(res.description ?? res.type)}`, res);
  for (const k of ["notCreated", "notUpdated", "notDestroyed"]) {
    const bad = res[k] as Record<string, { type?: string; description?: string; properties?: string[] }> | undefined;
    if (bad && Object.keys(bad).length) {
      const first = Object.values(bad)[0];
      const what = first.description || first.type || "refused";
      throw new StalwartError(`${name}: ${what}${first.properties ? ` (${first.properties.join(", ")})` : ""}`, bad);
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// Admin: the server's own objects.

class Admin {
  private accountId?: string;
  auth(): Auth {
    return { user: config.stalwartAdminUser, pass: config.stalwartAdminSecret };
  }
  private async account(): Promise<string> {
    if (this.accountId) return this.accountId;
    const res = await stalwartFetch(this.auth(), "/.well-known/jmap");
    const s = await res.json() as { primaryAccounts: Record<string, string>; accounts: Record<string, unknown> };
    this.accountId = s.primaryAccounts["urn:stalwart:jmap"] ?? Object.keys(s.accounts)[0];
    return this.accountId;
  }
  async call(method: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const accountId = await this.account();
    const [inv] = await jmap(this.auth(), ADMIN_USING, [[method, { accountId, ...args }, "0"]]);
    return unwrap(method, inv);
  }
  async get<T = Record<string, unknown>>(obj: string, ids?: string[], properties?: string[]): Promise<T[]> {
    const res = await this.call(`x:${obj}/get`, { ...(ids ? { ids } : {}), ...(properties ? { properties } : {}) });
    return res.list as T[];
  }
  async create(obj: string, value: Record<string, unknown>): Promise<string> {
    const res = await this.call(`x:${obj}/set`, { create: { n: value } });
    return ((res.created as Record<string, { id: string }>).n).id;
  }
  async update(obj: string, id: string, patch: Record<string, unknown>): Promise<void> {
    await this.call(`x:${obj}/set`, { update: { [id]: patch } });
  }
  async destroy(obj: string, id: string): Promise<void> {
    await this.call(`x:${obj}/set`, { destroy: [id] });
  }
}

export const admin = new Admin();

export type StalwartDomain = { id: string; name: string; dnsZoneFile?: string; isEnabled?: boolean };
export type StalwartAlias = { name: string; domainId: string; enabled?: boolean; description?: string | null };
export type StalwartAccount = {
  id: string; name: string; domainId: string; emailAddress?: string;
  aliases?: Record<string, StalwartAlias>; description?: string | null; usedDiskQuota?: number;
};

export const domains = {
  list: () => admin.get<StalwartDomain>("Domain", undefined, ["name", "isEnabled"]),
  get: async (id: string) => (await admin.get<StalwartDomain>("Domain", [id], ["name", "dnsZoneFile"]))[0],
  async ensure(name: string): Promise<string> {
    const found = (await domains.list()).find((d) => d.name.toLowerCase() === name.toLowerCase());
    return found ? found.id : admin.create("Domain", { name: name.toLowerCase() });
  },
};

export const accounts = {
  list: () => admin.call("x:Account/get", {
    properties: ["name", "domainId", "emailAddress", "aliases", "description", "usedDiskQuota"],
  }).then((r) => r.list as StalwartAccount[]),
  get: async (id: string) => (await accounts.list()).find((a) => a.id === id),
  create: (v: { name: string; domainId: string; password: string; description?: string; aliases: StalwartAlias[] }) =>
    admin.create("Account", {
      "@type": "User", name: v.name, domainId: v.domainId, description: v.description ?? null,
      credentials: { "0": { "@type": "Password", secret: v.password } },
      aliases: Object.fromEntries(v.aliases.map((a, i) => [String(i), a])),
    }),
  setAliases: (id: string, aliases: StalwartAlias[]) =>
    admin.update("Account", id, { aliases: Object.fromEntries(aliases.map((a, i) => [String(i), a])) }),
  /** Replaces the account's credentials with one password (for mail apps). */
  setPassword: (id: string, password: string) =>
    admin.update("Account", id, { credentials: { "0": { "@type": "Password", secret: password } } }),
};

// ---------------------------------------------------------------------------
// One company's mailbox, by impersonation.

export type MailSession = {
  accountId: string;
  username: string;
  capabilities: Record<string, unknown>;
};

const sessions = new Map<string, { at: number; s: MailSession }>();

export function mailboxAuth(address: string): Auth {
  return { user: `${address}%${config.stalwartAdminUser}`, pass: config.stalwartAdminSecret };
}

export async function mailSession(address: string): Promise<MailSession> {
  const cached = sessions.get(address);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.s;
  const res = await stalwartFetch(mailboxAuth(address), "/.well-known/jmap");
  if (!res.ok) throw new StalwartError(`no mailbox for ${address}`, undefined, res.status);
  const s = await res.json() as { username: string; primaryAccounts: Record<string, string>; accounts: Record<string, unknown>; capabilities: Record<string, unknown> };
  const session = {
    accountId: s.primaryAccounts["urn:ietf:params:jmap:mail"] ?? Object.keys(s.accounts)[0],
    username: s.username,
    capabilities: s.capabilities,
  };
  sessions.set(address, { at: Date.now(), s: session });
  return session;
}

export class Mailbox {
  readonly address: string;
  constructor(address: string) {
    this.address = address;
  }
  async accountId(): Promise<string> {
    return (await mailSession(this.address)).accountId;
  }
  /** Raw JMAP: method calls in, method responses out (accountId filled in when absent). */
  async request(methodCalls: Invocation[], using = MAIL_USING): Promise<Invocation[]> {
    const accountId = await this.accountId();
    const calls = methodCalls.map(([m, a, id]) => [m, { accountId, ...a }, id] as Invocation);
    return jmap(mailboxAuth(this.address), using, calls);
  }
  /** One call, unwrapped. */
  async call(method: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const [inv] = await this.request([[method, args, "0"]]);
    return unwrap(method, inv);
  }
  async upload(body: Buffer | Uint8Array, type: string): Promise<{ blobId: string; size: number; type: string }> {
    const accountId = await this.accountId();
    const res = await stalwartFetch(mailboxAuth(this.address), `/jmap/upload/${accountId}/`, {
      method: "POST", headers: { "content-type": type || "application/octet-stream" }, body: new Uint8Array(body),
    });
    if (!res.ok) throw new StalwartError(`upload failed (${res.status})`, await res.text(), res.status);
    return res.json() as Promise<{ blobId: string; size: number; type: string }>;
  }
  async download(blobId: string, name: string, type: string): Promise<Response> {
    const accountId = await this.accountId();
    const q = new URLSearchParams({ accept: type || "application/octet-stream" });
    return stalwartFetch(mailboxAuth(this.address),
      `/jmap/download/${encodeURIComponent(accountId)}/${encodeURIComponent(blobId)}/${encodeURIComponent(name || "file")}?${q}`);
  }
  /** Stalwart's push stream for this account (server-sent events), unbuffered. */
  async events(signal: AbortSignal): Promise<Response> {
    return stalwartFetch(mailboxAuth(this.address),
      "/jmap/eventsource/?types=Email,Mailbox,Thread,EmailDelivery&closeafter=no&ping=30", { signal });
  }
}
