// Businesses ("companies" in the code, as in Xooteq Mail): one per domain, each a Stalwart account (its primary address) with the
// other addresses as aliases, each owned by one X0 account (`owner`, a hash X0 Bot's server makes; every call it makes names it).
// Every address gets a folder its mail is filed into (besides Inbox), and may have an auto-reply and an AI mode. Stalwart holds the
// account and its aliases; the database holds the rest; sieve.ts turns both into the filing and replies the server runs.
//
// From Xooteq Mail's dashboard (dashboard/server/companies.ts). Changed here: an owner and a daily AI allowance per business; a domain
// already on the mail server is refused, never adopted (it may be one of Xooteq Mail's own companies, on the same server); new
// addresses start in Draft (the AI writes, a person sends); a business removed takes its mailbox with it; no admin views of
// mailboxes made elsewhere.
import { db, json, now, tx } from "./db.ts";
import { mailboxPassword } from "./crypto.ts";
import { accounts, admin, domains, Mailbox, StalwartError, type StalwartAlias } from "./stalwart.ts";
import { compile, deploy, type Address, type AutoReply, type Rule } from "./sieve.ts";

export type AiMode = "off" | "draft" | "send";

export type CompanyAddress = Address & { id: number; email: string; aiMode: AiMode; displayName: string };
export type Company = {
  id: string;
  /** The X0 account it belongs to. */
  owner: string;
  name: string;
  domain: string;
  email: string;
  accountId: string;
  color: string;
  signature: string;
  /** Its own daily AI allowance in US dollars (X0 Bot sets the plan's); null: the server's (MAIL_DAILY_USD). */
  dailyUsd: number | null;
  addresses: CompanyAddress[];
};

const COLORS = ["#E8A23C", "#3B82F6", "#10B981", "#EF4444", "#8B5CF6", "#F59E0B", "#06B6D4", "#EC4899", "#84CC16", "#F97316"];

export class InputError extends Error {}

const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const LOCAL_RE = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/;

export function cleanDomain(d: unknown): string {
  const s = String(d ?? "").trim().toLowerCase().replace(/^@/, "");
  if (!DOMAIN_RE.test(s)) throw new InputError(`"${s}" is not a domain name (like tailzu.space)`);
  return s;
}
export function cleanLocal(l: unknown): string {
  const s = String(l ?? "").trim().toLowerCase().replace(/@.*$/, "");
  if (!LOCAL_RE.test(s)) throw new InputError(`"${s}" is not an address name (letters, digits, dots, dashes)`);
  return s;
}
const titled = (local: string) => local.replace(/[._+-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "company";

type CompanyRow = { id: string; owner: string; name: string; domain: string; local: string; account_id: string; color: string; signature: string; daily_usd: number | null };
type AddressRow = { id: number; company_id: string; local: string; label: string; is_primary: number; auto_reply: string | null; ai_mode: AiMode; display_name: string };
type RuleRow = { id: number; company_id: string; name: string; enabled: number; match: "all" | "any"; conditions: string; actions: string; position: number };

function toAddress(r: AddressRow, domain: string): CompanyAddress {
  return {
    id: r.id, local: r.local, email: `${r.local}@${domain}`, label: r.label, isPrimary: !!r.is_primary,
    autoReply: json<AutoReply | null>(r.auto_reply, null), aiMode: r.ai_mode, displayName: r.display_name ?? "",
  };
}

function toCompany(c: CompanyRow): Company {
  const rows = db.prepare("SELECT * FROM addresses WHERE company_id = ? ORDER BY is_primary DESC, local").all(c.id) as AddressRow[];
  return {
    id: c.id, owner: c.owner, name: c.name, domain: c.domain, email: `${c.local}@${c.domain}`, accountId: c.account_id,
    color: c.color, signature: c.signature, dailyUsd: c.daily_usd ?? null, addresses: rows.map((r) => toAddress(r, c.domain)),
  };
}

/** One X0 account's businesses (every business, with no owner: the webhook's and the scheduler's view). */
export function listCompanies(owner?: string): Company[] {
  const rows = owner === undefined
    ? db.prepare("SELECT * FROM companies ORDER BY position, created_at").all()
    : db.prepare("SELECT * FROM companies WHERE owner = ? ORDER BY position, created_at").all(owner);
  return (rows as CompanyRow[]).map(toCompany);
}

/** A business by id; with an owner, only that account's (another's is "no such business", never "not yours"). */
export function getCompany(id: string, owner?: string): Company {
  const row = db.prepare("SELECT * FROM companies WHERE id = ?").get(id) as CompanyRow | undefined;
  if (!row || (owner !== undefined && row.owner !== owner)) throw new InputError("No such business.");
  return toCompany(row);
}

export function companyForAddress(email: string): { company: Company; address: CompanyAddress } | null {
  const [local, domain] = email.toLowerCase().split("@");
  const row = db.prepare("SELECT * FROM companies WHERE domain = ?").get(domain ?? "") as CompanyRow | undefined;
  if (!row) return null;
  const company = toCompany(row);
  const address = company.addresses.find((a) => a.local === local.split("+")[0]);
  return address ? { company, address } : null;
}

export function listRules(companyId: string): Rule[] {
  return (db.prepare("SELECT * FROM rules WHERE company_id = ? ORDER BY position, id").all(companyId) as RuleRow[]).map((r) => ({
    id: r.id, name: r.name, enabled: !!r.enabled, match: r.match,
    conditions: json(r.conditions, []), actions: json(r.actions, []),
  }));
}

/** Rebuilds and installs the company's Sieve script from the database. */
export async function redeploy(companyId: string): Promise<void> {
  const c = getCompany(companyId);
  await deploy(c.email, compile(c.domain, c.addresses, listRules(companyId)));
}

/** The folders a company's addresses and rules file into, made ahead of the first message. */
async function ensureFolders(c: Company, names: string[]): Promise<void> {
  const wanted = [...new Set(names.filter(Boolean))];
  if (!wanted.length) return;
  const box = new Mailbox(c.email);
  const have = new Set(((await box.call("Mailbox/get", { properties: ["name", "parentId"] })).list as { name: string; parentId: string | null }[])
    .filter((m) => !m.parentId).map((m) => m.name.toLowerCase()));
  const create = Object.fromEntries(wanted.filter((n) => !have.has(n.toLowerCase())).map((n, i) => [`f${i}`, { name: n, parentId: null }]));
  if (Object.keys(create).length) await box.call("Mailbox/set", { create });
}

async function renameFolder(c: Company, from: string, to: string): Promise<void> {
  if (!from || !to || from === to) return;
  const box = new Mailbox(c.email);
  const list = (await box.call("Mailbox/get", { properties: ["name", "parentId"] })).list as { id: string; name: string; parentId: string | null }[];
  const found = list.find((m) => !m.parentId && m.name === from);
  if (found && !list.some((m) => !m.parentId && m.name.toLowerCase() === to.toLowerCase())) {
    await box.call("Mailbox/set", { update: { [found.id]: { name: to } } });
  }
}

async function pushAliases(c: Company): Promise<void> {
  const acct = await accounts.get(c.accountId);
  if (!acct) throw new InputError(`The mailbox ${c.email} is gone from the mail server.`);
  const domainId = acct.domainId;
  // Keep aliases on other domains as they are; ours are the company's addresses.
  const foreign = Object.values(acct.aliases ?? {}).filter((a) => a.domainId !== domainId);
  const ours: StalwartAlias[] = c.addresses.filter((a) => !a.isPrimary).map((a) => ({ name: a.local, domainId, enabled: true }));
  await accounts.setAliases(c.accountId, [...ours, ...foreign]);
}

export async function createCompany(input: { owner: string; name: unknown; domain: unknown; local?: unknown; color?: unknown; aliases?: unknown; dailyUsd?: unknown }): Promise<Company> {
  const owner = String(input.owner ?? "").trim();
  if (!/^[A-Za-z0-9:_-]{8,80}$/.test(owner)) throw new InputError("Whose business is it? (no owner)");
  const name = String(input.name ?? "").trim().slice(0, 60);
  if (!name) throw new InputError("Give the business a name.");
  const domain = cleanDomain(input.domain);
  const local = cleanLocal(input.local || "hello");
  if (db.prepare("SELECT 1 FROM companies WHERE domain = ?").get(domain)) throw new InputError(`${domain} is already set up here.`);
  // Never adopt: a domain the mail server already has may be one of Xooteq Mail's own companies, on the same server.
  if ((await domains.list()).some((d) => d.name.toLowerCase() === domain)) throw new InputError(`${domain} is already on the mail server. Write to support to move it here.`);
  const aliasList = (Array.isArray(input.aliases) ? input.aliases : [])
    .map((a) => (typeof a === "string" ? { local: a, label: "" } : a as { local: unknown; label?: unknown }))
    .map((a) => ({ local: cleanLocal(a.local), label: String(a.label ?? "").trim().slice(0, 40) }))
    .filter((a, i, all) => a.local !== local && all.findIndex((b) => b.local === a.local) === i);

  const domainId = await domains.ensure(domain);
  const aliases: StalwartAlias[] = aliasList.map((a) => ({ name: a.local, domainId, enabled: true }));
  const accountId = await accounts.create({ name: local, domainId, password: mailboxPassword(), description: name, aliases });
  const dailyUsd = cleanDailyUsd(input.dailyUsd);

  let id = slug(name);
  for (let i = 2; db.prepare("SELECT 1 FROM companies WHERE id = ?").get(id); i++) id = `${slug(name)}-${i}`;
  const count = (db.prepare("SELECT COUNT(*) AS n FROM companies").get() as { n: number }).n;
  const color = /^#[0-9a-f]{6}$/i.test(String(input.color ?? "")) ? String(input.color) : COLORS[count % COLORS.length];
  tx(() => {
    db.prepare("INSERT INTO companies (id, owner, name, domain, local, account_id, color, daily_usd, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, owner, name, domain, local, accountId, color, dailyUsd, count, now());
    db.prepare("INSERT INTO addresses (company_id, local, label, is_primary, ai_mode, created_at) VALUES (?, ?, '', 1, 'draft', ?)").run(id, local, now());
    for (const a of aliasList) {
      db.prepare("INSERT INTO addresses (company_id, local, label, is_primary, ai_mode, created_at) VALUES (?, ?, ?, 0, 'draft', ?)").run(id, a.local, a.label || titled(a.local), now());
    }
  });
  const c = getCompany(id);
  await ensureFolders(c, c.addresses.map((a) => a.label));
  await redeploy(id);
  return getCompany(id);
}

/** A daily allowance in US dollars, 0 to 100; anything else is null (the server's). */
export function cleanDailyUsd(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : null;
}

export async function updateCompany(id: string, patch: { name?: unknown; color?: unknown; signature?: unknown; dailyUsd?: unknown }): Promise<Company> {
  const c = getCompany(id);
  const name = patch.name !== undefined ? String(patch.name).trim().slice(0, 60) || c.name : c.name;
  const color = /^#[0-9a-f]{6}$/i.test(String(patch.color ?? "")) ? String(patch.color) : c.color;
  const signature = patch.signature !== undefined ? String(patch.signature).slice(0, 4000) : c.signature;
  const dailyUsd = patch.dailyUsd !== undefined ? cleanDailyUsd(patch.dailyUsd) : c.dailyUsd;
  db.prepare("UPDATE companies SET name = ?, color = ?, signature = ?, daily_usd = ? WHERE id = ?").run(name, color, signature, dailyUsd, id);
  return getCompany(id);
}

/** Removes the business and its mail: the mailbox on the mail server (and the domain, once no mailbox is left on it), then its records. */
export async function deleteCompany(id: string): Promise<void> {
  const c = getCompany(id);
  try { await admin.destroy("Account", c.accountId); } catch (e) { if (!(e instanceof StalwartError && /not ?found/i.test(e.message))) throw e; }
  const domain = (await domains.list()).find((d) => d.name.toLowerCase() === c.domain);
  if (domain && !(await accounts.list()).some((a) => a.domainId === domain.id)) {
    try { await admin.destroy("Domain", domain.id); } catch { /* still in use: it stays */ }
  }
  db.prepare("DELETE FROM companies WHERE id = ?").run(id);
}

export async function addAddress(companyId: string, input: { local: unknown; label?: unknown }): Promise<Company> {
  const c = getCompany(companyId);
  const local = cleanLocal(input.local);
  if (c.addresses.some((a) => a.local === local)) throw new InputError(`${local}@${c.domain} is already an address of ${c.name}.`);
  const label = String(input.label ?? "").trim().slice(0, 40) || titled(local);
  db.prepare("INSERT INTO addresses (company_id, local, label, is_primary, ai_mode, created_at) VALUES (?, ?, ?, 0, 'draft', ?)").run(companyId, local, label, now());
  try {
    const next = getCompany(companyId);
    await pushAliases(next);
    await ensureFolders(next, [label]);
    await redeploy(companyId);
  } catch (e) {
    db.prepare("DELETE FROM addresses WHERE company_id = ? AND local = ?").run(companyId, local);
    throw e instanceof StalwartError && /already|exists|duplicate/i.test(e.message)
      ? new InputError(`${local}@${c.domain} is already taken by another mailbox on this server.`) : e;
  }
  return getCompany(companyId);
}

/** A sender name: one line, no quotes or angle brackets (they would break the From header). */
export function cleanDisplayName(v: unknown): string {
  return String(v ?? "").replace(/[\r\n\t"<>\\]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export async function updateAddress(companyId: string, addressId: number, patch: { label?: unknown; autoReply?: unknown; aiMode?: unknown; displayName?: unknown }): Promise<Company> {
  const c = getCompany(companyId);
  const a = c.addresses.find((x) => x.id === addressId);
  if (!a) throw new InputError("No such address.");
  const label = patch.label !== undefined && !a.isPrimary ? String(patch.label).trim().slice(0, 40) || a.label : a.label;
  const aiMode: AiMode = patch.aiMode === "draft" || patch.aiMode === "send" || patch.aiMode === "off" ? patch.aiMode : a.aiMode;
  let autoReply = a.autoReply;
  if (patch.autoReply !== undefined) {
    const r = patch.autoReply as Partial<AutoReply> | null;
    autoReply = r ? {
      enabled: !!r.enabled,
      subject: String(r.subject ?? "").slice(0, 200),
      body: String(r.body ?? "").slice(0, 8000),
      days: Math.max(1, Math.min(365, Number(r.days) || 1)),
      start: /^\d{4}-\d{2}-\d{2}$/.test(String(r.start ?? "")) ? String(r.start) : "",
      end: /^\d{4}-\d{2}-\d{2}$/.test(String(r.end ?? "")) ? String(r.end) : "",
    } : null;
    if (autoReply?.enabled && !autoReply.body.trim()) throw new InputError("Write the auto-reply's message, or turn it off.");
  }
  const displayName = patch.displayName !== undefined ? cleanDisplayName(patch.displayName) : a.displayName;
  db.prepare("UPDATE addresses SET label = ?, ai_mode = ?, auto_reply = ?, display_name = ? WHERE id = ?")
    .run(label, aiMode, autoReply ? JSON.stringify(autoReply) : null, displayName, addressId);
  if (label !== a.label) await renameFolder(c, a.label, label);
  if (label !== a.label || patch.autoReply !== undefined || (displayName !== a.displayName && autoReply?.enabled)) await redeploy(companyId);
  return getCompany(companyId);
}

export async function removeAddress(companyId: string, addressId: number): Promise<Company> {
  const c = getCompany(companyId);
  const a = c.addresses.find((x) => x.id === addressId);
  if (!a) throw new InputError("No such address.");
  if (a.isPrimary) throw new InputError("The primary address is the mailbox itself and stays.");
  db.prepare("DELETE FROM addresses WHERE id = ?").run(addressId);
  const next = getCompany(companyId);
  await pushAliases(next);
  await redeploy(companyId);
  return next;
}

export async function saveRules(companyId: string, rules: unknown): Promise<Rule[]> {
  getCompany(companyId);
  if (!Array.isArray(rules)) throw new InputError("Rules must be a list.");
  const fields = ["from", "to", "subject", "body", "header", "attachment"];
  const ops = ["contains", "is", "starts", "ends", "not-contains"];
  const types = ["move", "label", "read", "star", "forward", "delete", "stop"];
  const clean = rules.slice(0, 200).map((r: Record<string, unknown>, i) => {
    const conditions = (Array.isArray(r.conditions) ? r.conditions : []).slice(0, 20)
      .filter((c: Record<string, unknown>) => fields.includes(String(c.field)) && ops.includes(String(c.op)))
      .map((c: Record<string, unknown>) => ({ field: c.field, op: c.op, value: String(c.value ?? "").slice(0, 500), ...(c.field === "header" ? { header: String(c.header ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 80) } : {}) }));
    const actions = (Array.isArray(r.actions) ? r.actions : []).slice(0, 10)
      .filter((a: Record<string, unknown>) => types.includes(String(a.type)))
      .map((a: Record<string, unknown>) => ({ type: a.type, ...(a.value !== undefined ? { value: String(a.value).slice(0, 200) } : {}) }));
    for (const a of actions as { type: string; value?: string }[]) {
      if ((a.type === "move" || a.type === "label") && !a.value?.trim()) throw new InputError(`Rule ${i + 1}: name the folder.`);
      if (a.type === "forward" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.value ?? "")) throw new InputError(`Rule ${i + 1}: forward to an email address.`);
    }
    return { name: String(r.name ?? "").trim().slice(0, 80) || `Rule ${i + 1}`, enabled: r.enabled !== false, match: r.match === "any" ? "any" : "all", conditions, actions };
  });
  const before = listRules(companyId);
  tx(() => {
    db.prepare("DELETE FROM rules WHERE company_id = ?").run(companyId);
    clean.forEach((r, i) => db.prepare("INSERT INTO rules (company_id, name, enabled, match, conditions, actions, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(companyId, r.name, r.enabled ? 1 : 0, r.match, JSON.stringify(r.conditions), JSON.stringify(r.actions), i, now()));
  });
  try {
    await redeploy(companyId);
  } catch (e) {
    tx(() => {
      db.prepare("DELETE FROM rules WHERE company_id = ?").run(companyId);
      before.forEach((r, i) => db.prepare("INSERT INTO rules (company_id, name, enabled, match, conditions, actions, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(companyId, r.name, r.enabled ? 1 : 0, r.match, JSON.stringify(r.conditions), JSON.stringify(r.actions), i, now()));
    });
    throw e;
  }
  return listRules(companyId);
}

/** Sets a password so the mailbox can be added to a phone or desktop mail app. */
export async function setMailAppPassword(companyId: string, password: unknown): Promise<void> {
  const c = getCompany(companyId);
  const pw = String(password ?? "");
  if (pw.length < 12) throw new InputError("Use at least 12 characters.");
  await accounts.setPassword(c.accountId, pw);
}
