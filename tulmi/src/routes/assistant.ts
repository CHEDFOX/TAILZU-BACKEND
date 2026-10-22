/**
 * THE PHONE'S ASK, over HTTP.
 *
 *   POST /v1/assistant/ask  { text, lang?, platform? } -> { say, open?, taskId? }
 *
 * One command typed or said into Tailzu on the phone, run by the same planner
 * and connected apps as the desktop's Ask (agent/run.ts runCommand) with no
 * screen behind it. The answer is one object the phone's screen acts on with
 * the actions it already runs (experience/assistant.ts, assistant_ask): show
 * `say`, open `open.url` when there is one, and go to the confirm sheet when
 * there is a `taskId`.
 *
 * The run's events become that object here. What it said, and a question it
 * asked back, is `say`; a hand-off is `open` (with its one line as `say`); an
 * approval is `taskId`, with a line to go with it; and a line that would act
 * on a computer's screen is a sentence saying so, never an action.
 *
 * A question back ("What's their UPI ID?"), the planner's or a tool's, is kept
 * for a few minutes, per person, so that their answer, asked next, is read
 * with it: the desktop sends the run so far with every step, and the phone,
 * which sends only its words, has this instead. Each kept turn is held to the
 * limits /v1/agent holds a turn of history to, and a request asked back about
 * FOLLOW_UPS_CHAIN times starts afresh. Anything that is not a question
 * clears it.
 *
 * Authenticates like the rest of /v1, holds to Ask's rate limit, and answers
 * 404 while CONNECTORS is off, as the other assistant routes do.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AgentEvent, AgentTurn, AssistantAskResponse } from "../../../shared/types/api.js";
import { resolveUser, type AuthedUser } from "../auth/supabase.js";
import { EventSink, LIMITS, oneLine } from "../agent/protocol.js";
import { runCommand, type StepDeps, type StepResult } from "../agent/run.js";
import type { Connectors } from "../connectors/index.js";
import { isHinglish, wordsFor } from "../connectors/words.js";

export interface AssistantRoutesDeps {
  /** Ask's own limit (AGENT_RATE_LIMIT_*): each ask is a model call. */
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  /** Null when CONNECTORS is off. */
  connectors: Connectors | null;
  /** The planner's streamed answer (llm.planStream). Tests hand in a fake. */
  plan: StepDeps["plan"];
  /** The profile's language: a Hinglish profile is answered in Hinglish. */
  profileLanguage?: (user: AuthedUser) => Promise<string | undefined>;
  /** The plan's allowance: a reason to refuse (429), or null. */
  quota?: (user: AuthedUser) => Promise<string | null>;
  /** Metered after the answer has gone, like an Ask step. */
  record?: (user: AuthedUser, result: StepResult) => Promise<void>;
  now?: () => number;
}

/** How long a question back waits for its answer. */
export const FOLLOW_UP_MS = 5 * 60_000;
/** Questions back one request may run to; the answer to the last is read with all of them, and a question after it starts afresh. */
export const FOLLOW_UPS_CHAIN = 3;
const FOLLOW_UPS_MAX = 5000;

type Words = ReturnType<typeof wordsFor>;

/**
 * The phone's answer, from the events of its run. Several sentences are one
 * line; with nothing said, the line that fits what happened.
 */
export function answerOf(events: AgentEvent[], w: Words): AssistantAskResponse {
  const said: string[] = [];
  let open: AssistantAskResponse["open"];
  let taskId: string | undefined;
  let screen = false;
  for (const e of events) {
    if (e.t === "say" || e.t === "ask") said.push(e.text);
    else if (e.t === "done" && e.text) said.push(e.text);
    else if (e.t === "error") said.push(e.message);
    else if (e.t === "open") open = { url: e.url, label: e.label, ...(e.fallback ? { fallback: e.fallback } : {}) };
    else if (e.t === "approve") taskId = e.taskId;
    else if (e.t === "action" || e.t === "look") screen = true;
  }
  if (taskId) said.push(w("ask.approve"));
  if (screen && !said.length) said.push(w("ask.desk"));
  const say = said.join(" ").replace(/\s+/g, " ").trim() || w("ask.none");
  return { say, ...(open ? { open } : {}), ...(taskId ? { taskId } : {}) };
}

/** The phone asking: what the screen says, else its HTTP client (OkHttp is Android's), else iOS. */
export function phoneOf(said: unknown, userAgent: unknown): "ios" | "android" {
  if (said === "ios" || said === "android") return said;
  return /okhttp|dalvik|android/i.test(String(userAgent ?? "")) ? "android" : "ios";
}

export function registerAssistantRoutes(app: FastifyInstance, deps: AssistantRoutesDeps): void {
  const c = deps.connectors;
  const now = deps.now ?? Date.now;
  /** user id -> the run so far: what they said, and each question asked back. */
  const followUps = new Map<string, { turns: AgentTurn[]; at: number }>();

  app.post<{ Body: { text?: unknown; lang?: unknown; platform?: unknown } }>("/v1/assistant/ask", { config: deps.rateLimit }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    if (!c) return reply.code(404).send({ code: "connectors_off", message: "Connected apps are not switched on." });
    const body = req.body ?? {};
    const text = oneLine(body.text, LIMITS.utterance);
    if (!text) return reply.code(400).send({ code: "bad_request", message: "text is what they asked, up to 1000 characters" });
    const refused = await deps.quota?.(user);
    if (refused) return reply.code(429).send({ code: "quota_exceeded", message: refused });

    const header = req.headers["x-app-language"];
    const lang = oneLine(typeof body.lang === "string" ? body.lang : typeof header === "string" ? header : "", 32) || undefined;
    const profile = deps.profileLanguage ? () => deps.profileLanguage!(user) : undefined;
    const voice = isHinglish(lang) ? lang : (await profile?.().catch(() => undefined)) ?? lang;
    const w = wordsFor(voice);

    // Their answer to the question asked last, read with it.
    const last = followUps.get(user.id);
    followUps.delete(user.id);
    const history: AgentTurn[] = last && now() - last.at < FOLLOW_UP_MS ? last.turns : [];

    const events: AgentEvent[] = [];
    const sink = new EventSink((l) => events.push(JSON.parse(l) as AgentEvent));
    let result: StepResult | undefined;
    try {
      result = await runCommand(
        {
          runId: `ask_${randomUUID().replace(/-/g, "")}`, said: text, platform: phoneOf(body.platform, req.headers["user-agent"]),
          ...(lang && lang !== "auto" ? { language: lang } : {}), history, nothing: w("ask.none"),
        },
        {
          plan: deps.plan,
          // Nothing on a phone is written into a field: the reader never asks for these.
          write: async () => "", rewrite: async () => "",
          connectors: c.runtimeFor(user.id, profile),
        },
        sink,
      );
    } catch (err) {
      req.log.error({ err }, "assistant ask failed");
      return reply.code(500).send({ code: "internal", message: "Something went wrong. Try again in a moment." });
    }

    const asked = events.find((e): e is Extract<AgentEvent, { t: "ask" }> => e.t === "ask");
    if (asked && history.length < FOLLOW_UPS_CHAIN) {
      if (followUps.size >= FOLLOW_UPS_MAX) followUps.delete(followUps.keys().next().value!);
      const turn: AgentTurn = { said: oneLine(text, LIMITS.said), did: "ASK", note: oneLine(asked.text, LIMITS.note) };
      followUps.set(user.id, { turns: [...history, turn], at: now() });
    }
    const answer = answerOf(events, w);
    // Metered on the side: a slow write must not hold the phone's answer.
    if (result && deps.record) void deps.record(user, result).catch((err) => req.log.error({ err }, "assistant ask usage not recorded"));
    // One line per ask, with none of what was said or answered.
    req.log.info({
      ask: { path: result?.path, model: result?.model, ending: sink.ending, open: !!answer.open, approval: !!answer.taskId, followUp: history.length > 0 },
    }, "assistant ask");
    return reply.send(answer);
  });
}
