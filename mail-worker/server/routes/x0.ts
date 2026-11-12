/**
 * WHAT X0 BOT'S SERVER ASKS OF THE MAIL WORKER: every route signed (security.ts), every route inside one X0 account (`:owner`, in the
 * signed path, so no call can reach another account's businesses: another's is "no such business").
 *
 *   GET    /v1/o/:owner/businesses                          the account's businesses, their addresses and modes
 *   POST   /v1/o/:owner/businesses                          { name, domain, local?, aliases?, dailyUsd? }: the domain and its mailbox made
 *   GET    /v1/o/:owner/businesses/:id                      one
 *   PATCH  /v1/o/:owner/businesses/:id                      { name?, signature?, dailyUsd? }
 *   DELETE /v1/o/:owner/businesses/:id                      the business and its mailbox (its mail goes with it)
 *   GET    /v1/o/:owner/businesses/:id/dns                  the records to add at the domain's DNS, each checked live
 *   POST   /v1/o/:owner/businesses/:id/addresses            { local, label? }
 *   PATCH  /v1/o/:owner/businesses/:id/addresses/:aid       { label?, aiMode?, displayName?, autoReply? }
 *   DELETE /v1/o/:owner/businesses/:id/addresses/:aid
 *   GET    /v1/o/:owner/businesses/:id/brief                what the AI knows and how it writes
 *   PUT    /v1/o/:owner/businesses/:id/brief                { profile }
 *   GET    /v1/o/:owner/businesses/:id/activity?limit=      every message the AI looked at, what it did and why
 *   GET    /v1/o/:owner/businesses/:id/replies/:run         a draft beside the message it answers
 *   PUT    /v1/o/:owner/businesses/:id/replies/:run         { text }: new words (a scheduled one stops)
 *   POST   /v1/o/:owner/businesses/:id/replies/:run/send    sent now
 *   POST   /v1/o/:owner/businesses/:id/replies/:run/stop    a scheduled one waits as a draft
 *   DELETE /v1/o/:owner/businesses/:id/replies/:run         thrown away
 *   POST   /v1/o/:owner/businesses/:id/mail-app-password    { password }: for a phone or desktop mail app
 *   GET    /v1/o/:owner/spend?since=                        what each business's AI spent per day, for the account's bill
 *   DELETE /v1/o/:owner                                     every business of the account, with its mail (the account was deleted)
 *
 * Errors: { code, message } with the message in words for a person; 400 bad input, 404 not found, 409 too late, 401 not signed.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.ts";
import { createCompany, deleteCompany, getCompany, InputError, listCompanies, setMailAppPassword, updateAddress, updateCompany,
  addAddress, removeAddress, type Company } from "../companies.ts";
import { check, expected } from "../dns.ts";
import { domains, StalwartError } from "../stalwart.ts";
import { getProfile, saveProfile } from "../ai/prompt.ts";
import { AiError } from "../ai/model.ts";
import { allowance, cancelScheduled, discardDraft, draftView, editDraft, listRuns, sendNow, spend } from "../ai/engine.ts";
import { NonceCache, refused } from "../security.ts";

const OWNER = /^[A-Za-z0-9:_-]{8,80}$/;
const nonces = new NonceCache();

type P = { owner: string; id?: string; aid?: string; run?: string };
const params = (req: FastifyRequest) => req.params as P;
const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;
const business = (req: FastifyRequest): Company => getCompany(String(params(req).id), params(req).owner);
const runId = (req: FastifyRequest): number => {
  const n = Number(params(req).run);
  if (!Number.isInteger(n) || n < 1) throw new InputError("No such reply.");
  return n;
};

/** What X0 Bot shows of a business: never the mail server's own ids. */
export function view(c: Company) {
  const a = allowance(c);
  return {
    id: c.id, name: c.name, domain: c.domain, email: c.email, signature: c.signature,
    allowance: { spentUsd: Math.round(a.spentUsd * 10_000) / 10_000, capUsd: a.capUsd },
    addresses: c.addresses.map((x) => ({ id: x.id, email: x.email, label: x.label, isPrimary: x.isPrimary, aiMode: x.aiMode, displayName: x.displayName, autoReply: x.autoReply })),
  };
}

function failed(reply: FastifyReply, e: unknown) {
  if (e instanceof InputError) return reply.code(/no such/i.test(e.message) ? 404 : 400).send({ code: "bad_request", message: e.message });
  if (e instanceof AiError) return reply.code(e.status && e.status >= 400 && e.status < 500 ? e.status : 502).send({ code: "ai", message: e.message });
  if (e instanceof StalwartError) return reply.code(502).send({ code: "mail_server", message: `The mail server said: ${e.message}` });
  console.error("[mail-worker] failed:", (e as Error)?.message);
  return reply.code(500).send({ code: "failed", message: "Something went wrong on the mail server. Try again in a moment." });
}

export async function x0Routes(app: FastifyInstance) {
  // Signed by X0 Bot's server, and inside one account, before anything else is read.
  app.addHook("preHandler", async (req, reply) => {
    const why = refused(config.workerSecret, req.headers, req.method, req.url, (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0), nonces);
    if (why) return reply.code(401).send({ code: "auth", message: "Not signed." });
    if (!OWNER.test(params(req).owner ?? "")) return reply.code(400).send({ code: "bad_request", message: "No such account." });
  });
  const route = (fn: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown) =>
    async (req: FastifyRequest, reply: FastifyReply) => { try { return await fn(req, reply); } catch (e) { return failed(reply, e); } };

  app.get("/v1/o/:owner/businesses", route((req) => ({ businesses: listCompanies(params(req).owner).map(view) })));
  app.post("/v1/o/:owner/businesses", route(async (req, reply) => {
    const b = body(req);
    const c = await createCompany({ owner: params(req).owner, name: b.name, domain: b.domain, local: b.local, aliases: b.aliases, dailyUsd: b.dailyUsd });
    return reply.code(201).send({ business: view(c) });
  }));
  app.get("/v1/o/:owner/businesses/:id", route((req) => ({ business: view(business(req)) })));
  app.patch("/v1/o/:owner/businesses/:id", route(async (req) => {
    const c = business(req);
    const b = body(req);
    return { business: view(await updateCompany(c.id, { name: b.name, signature: b.signature, dailyUsd: b.dailyUsd })) };
  }));
  app.delete("/v1/o/:owner/businesses/:id", route(async (req) => {
    await deleteCompany(business(req).id);
    return { ok: true };
  }));

  app.get("/v1/o/:owner/businesses/:id/dns", route(async (req) => {
    const c = business(req);
    const d = (await domains.list()).find((x) => x.name.toLowerCase() === c.domain);
    const zone = d ? (await domains.get(d.id))?.dnsZoneFile ?? "" : "";
    return { domain: c.domain, records: await check(expected(c.domain, zone)) };
  }));

  app.post("/v1/o/:owner/businesses/:id/addresses", route(async (req) => {
    const b = body(req);
    return { business: view(await addAddress(business(req).id, { local: b.local, label: b.label })) };
  }));
  app.patch("/v1/o/:owner/businesses/:id/addresses/:aid", route(async (req) => {
    const b = body(req);
    return { business: view(await updateAddress(business(req).id, Number(params(req).aid), { label: b.label, aiMode: b.aiMode, displayName: b.displayName, autoReply: b.autoReply })) };
  }));
  app.delete("/v1/o/:owner/businesses/:id/addresses/:aid", route(async (req) => ({ business: view(await removeAddress(business(req).id, Number(params(req).aid))) })));

  app.get("/v1/o/:owner/businesses/:id/brief", route((req) => getProfile(business(req).id)));
  app.put("/v1/o/:owner/businesses/:id/brief", route((req) => ({ profile: saveProfile(business(req).id, (body(req).profile ?? {}) as Record<string, unknown>) })));

  app.get("/v1/o/:owner/businesses/:id/activity", route((req) => {
    const limit = Math.min(200, Math.max(1, Number((req.query as { limit?: string }).limit) || 50));
    return { runs: listRuns(business(req).id, limit) };
  }));
  app.get("/v1/o/:owner/businesses/:id/replies/:run", route(async (req) => draftView(business(req).id, runId(req))));
  app.put("/v1/o/:owner/businesses/:id/replies/:run", route(async (req) => {
    await editDraft(business(req).id, runId(req), String(body(req).text ?? ""));
    return { ok: true };
  }));
  app.post("/v1/o/:owner/businesses/:id/replies/:run/send", route(async (req) => {
    await sendNow(business(req).id, runId(req));
    return { ok: true };
  }));
  app.post("/v1/o/:owner/businesses/:id/replies/:run/stop", route(async (req) => {
    await cancelScheduled(business(req).id, runId(req));
    return { ok: true };
  }));
  app.delete("/v1/o/:owner/businesses/:id/replies/:run", route(async (req) => {
    await discardDraft(business(req).id, runId(req));
    return { ok: true };
  }));

  app.post("/v1/o/:owner/businesses/:id/mail-app-password", route(async (req) => {
    await setMailAppPassword(business(req).id, body(req).password);
    return { ok: true };
  }));

  app.get("/v1/o/:owner/spend", route((req) => {
    const since = Math.max(0, Number((req.query as { since?: string }).since) || Date.now() - 31 * 86_400_000);
    return { days: spend(listCompanies(params(req).owner).map((c) => c.id), since) };
  }));
  app.delete("/v1/o/:owner", route(async (req) => {
    for (const c of listCompanies(params(req).owner)) await deleteCompany(c.id);
    return { ok: true };
  }));
}
