/**
 * The one key's brain (src/askDecide, docs/ask-decide.md).
 *
 *   POST /v1/ask/decide { words, app?, title?, field?, ours?, last?, grants?, notesOn?, tz? }
 *     -> AskDecision { do, goal, to?, via?, bot?, notes?, screen, web, sure, risk, needs, missing, by }
 *
 * What the person meant by what they said with the key held: write, send, answer, task, routine, notes or a bot, in any
 * language. The computer does it without asking which. The person's bots are read here, never sent by the computer. Counted
 * on the person's front-door day like "who answers" (/v1/shell/route): nothing left, and the answer is the safe one, no model.
 * Never a 5xx for a model that could not be reached: decideAsk never throws for that.
 *
 * The person's context (src/context) goes into the prompt, so a follow-up and "message Riya" work from any of their computers; the
 * computer's own `last` is used only while the server has kept no asks. The decided ask is kept after the answer is sent (not from a
 * private field, X0 Bot's own window or a sensitive app).
 */
import type { FastifyInstance } from "fastify";
import { resolveUser } from "../../auth/supabase.js";
import type { Bots } from "../../bots/index.js";
import { defaultGuard } from "../../guard/index.js";
import { ASK_DOS, GRANTS, decideAsk, type AskTurn, type DecideInput, type GrantState } from "../../askDecide/index.js";
import { tzOf } from "../../calendar/words.js";
import type { PersonContext } from "../../context/index.js";

export interface AskDecideRouteDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  bots: Bots | null;
  /** The person's context; null when CONTEXT is off. */
  context?: PersonContext | null;
}

const WORDS_MAX = 2000;
const STATES = new Set<GrantState>(["on", "off", "na", "never", "restart"]);
const str = (v: unknown, n: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);

/** The body, kept to what it may hold. Anything else is dropped, never refused: an older build sends less. */
export function readDecideBody(b: Record<string, unknown>): DecideInput | null {
  const words = str(b.words, WORDS_MAX);
  if (!words) return null;
  const f = b.field;
  const field: DecideInput["field"] = f === null ? null : f && typeof f === "object" && !Array.isArray(f)
    ? { ...(str((f as Record<string, unknown>).selection, 2000) ? { selection: str((f as Record<string, unknown>).selection, 2000)! } : {}), ...((f as Record<string, unknown>).private === true ? { private: true } : {}) }
    : undefined;
  const last: AskTurn[] = Array.isArray(b.last) ? b.last.slice(-3).flatMap((t) => {
    if (!t || typeof t !== "object") return [];
    const r = t as Record<string, unknown>;
    const said = str(r.said, 400);
    const did = (ASK_DOS as readonly string[]).includes(String(r.did)) ? (r.did as AskTurn["did"]) : undefined;
    return said && did ? [{ said, did, ...(str(r.to, 80) ? { to: str(r.to, 80)! } : {}) }] : [];
  }) : [];
  const g = b.grants && typeof b.grants === "object" ? (b.grants as Record<string, unknown>) : {};
  const grants = Object.fromEntries(GRANTS.flatMap((k) => (STATES.has(g[k] as GrantState) ? [[k, g[k]]] : [])));
  return {
    words,
    ...(str(b.app, 80) ? { app: str(b.app, 80)! } : {}),
    ...(str(b.title, 200) ? { title: str(b.title, 200)! } : {}),
    ...(field !== undefined ? { field } : {}),
    ...(b.ours === true ? { ours: true } : {}),
    ...(last.length ? { last } : {}),
    ...(Object.keys(grants).length ? { grants } : {}),
    ...(b.notesOn === true ? { notesOn: true } : {}),
    ...(b.tz !== undefined && b.tz !== null && Number.isFinite(Number(b.tz)) ? { tz: tzOf(b.tz) } : {}),
  };
}

export function registerAskDecideRoutes(app: FastifyInstance, deps: AskDecideRouteDeps): void {
  const rl = { config: { rateLimit: { max: Math.min(120, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } };
  app.post("/v1/ask/decide", rl, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]).catch(() => null);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    const input = readDecideBody((req.body ?? {}) as Record<string, unknown>);
    if (!input) return reply.code(400).send({ code: "bad_request", message: "words is what the person said." });
    // Nothing is read for words that never leave: a private field or X0 Bot's own window.
    const safeOnly = input.ours || !!input.field?.private;
    const [bots, ctx] = await Promise.all([
      deps.bots ? deps.bots.defs(user.id).then((list) => list.map((b) => ({ slug: b.slug, name: b.name, purpose: b.purpose })), () => []) : Promise.resolve([]),
      deps.context && !safeOnly ? deps.context.for(user, { about: input.words, ...(input.tz !== undefined ? { tz: input.tz } : {}) }).catch(() => null) : Promise.resolve(null),
    ]);
    const daily = defaultGuard().daily;
    const context = ctx?.text ? { context: { text: ctx.text, turns: ctx.turns } } : {};
    const d = await decideAsk({ ...input, ...context, ...(bots.length ? { bots } : {}) }, user.id, { leftPaise: daily.leftPaise(user.id) });
    if (d.paise) daily.add(user.id, d.paise);
    if (deps.context) void deps.context.keepAsk(user.id, input, d).catch((err) => req.log.warn({ err: (err as Error)?.message }, "context: ask not kept"));
    return reply.send(d);
  });
}
