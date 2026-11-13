/**
 * NOTHING OF A PERSON'S REACHES AN AI SERVICE UNTIL THEY HAVE SAID YES (App Review 5.1.2(i): "clearly disclose where personal data
 * will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so").
 *
 * This file is the gate itself, and has no imports beyond Node's: the jobs Worker bundles the clients that call through it, and a test
 * that never installs a check is never stopped. The check (whether a person has said yes) is privacy/aiConsent.ts's, installed by the
 * server at start (installAiCheck).
 *
 *   aiScopeHook          Fastify preHandler: the request's sign-in is remembered for everything its handler awaits
 *   asPerson(id, work)   work outside a request (a routine, a job) runs as its owner
 *   asService(work)      work that is nobody's: it sends nothing of a person's and must run even after they said no. ONE use only:
 *                        hanging up a realtime call (realtime/openaiCalls.ts), which is what a withdrawal has to do
 *   aiAllowed()          whether the person this work is for may have it sent to an AI service (no check installed, or no person: yes)
 *   aiAllowedFor(id)     the same for a named person
 *   guardClient(c)       an OpenAI SDK client (OpenRouter, OpenAI) whose every call asks aiAllowed() first; a "no" is a 403 the SDK
 *                        does not retry, with the code ai_consent_needed
 *   installAiFetchGuard  the server's own fetch, for the AI services' hosts (AI_HOSTS): a raw call (Deepgram, Sarvam, Groq…) asks too
 *   isAiConsentError     whether an error is that "no", so the error handler answers 403 { code: "ai_consent_needed", message }
 *
 * The live sockets (dictation, Ask's voice) sign in inside a message, not a header: they ask aiAllowedFor themselves as they start.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const AI_CONSENT_CODE = "ai_consent_needed";
/**
 * What a person is told when something they asked for was not sent. Points only at You › Privacy (Home's card is asked once). Its first
 * 40 characters never change: older clients, and isAiConsentError, know it by them.
 */
export const AI_CONSENT_TEXT = "X0 Bot needs your OK before it sends anything to AI services. Turn it on in You › Privacy.";

/** Who receives it, as the Home card and the privacy policy name them (section 3). */
export const AI_SERVICES = [
  "OpenAI", "Anthropic", "Google (Gemini)", "Groq", "Deepgram", "Sarvam AI",
  "OpenRouter, which passes it to the model's maker or host (such as DeepSeek, Moonshot AI or Z.ai)",
] as const;

/** The services that receive a person's words, voice, pictures or files to answer them (privacy policy, section 3). */
export const AI_HOSTS: readonly string[] = [
  "openrouter.ai", "api.openai.com", "api.groq.com", "api.deepgram.com", "api.sarvam.ai", "generativelanguage.googleapis.com",
  "api.anthropic.com", "api.deepseek.com", "api.z.ai", "open.bigmodel.cn", "api.moonshot.ai", "api.mistral.ai",
];

interface Who { auth?: string; userId?: string }
/** Whether this person may have their data sent to an AI service. */
export type AiCheck = (who: Who) => Promise<boolean>;

const scope = new AsyncLocalStorage<Who>();
let check: AiCheck | null = null;

/** The server installs privacy/aiConsent.ts's check at start; null takes it away (tests). */
export function installAiCheck(c: AiCheck | null): void { check = c; }

/**
 * Fastify's preHandler hook, callback style, like the cost tally's (usage/cost.ts): the handler, and everything it awaits, runs knowing
 * whose request this is. (preHandler, not onRequest: a request with a body is handled in the body's async context.)
 */
export function aiScopeHook(req: { headers: Record<string, unknown> }, _reply: unknown, done: () => void): void {
  const auth = req.headers["authorization"];
  scope.run(typeof auth === "string" && auth ? { auth } : {}, done);
}

/** `work` as `userId`'s: what it sends to an AI service is theirs (a routine, a job, a note organised later). */
export function asPerson<T>(userId: string, work: () => T): T { return scope.run({ userId }, work); }

/**
 * `work` as nobody's: no sign-in, no person, so the gate has nothing to ask and lets it through. It is for the one request that
 * carries no personal data and must still go out after a person takes their permission back: hanging up their live call
 * (realtime/openaiCalls.ts). Nothing else may use it — anything with a person's words, voice or facts in it goes through asPerson.
 */
export function asService<T>(work: () => T): T { return scope.run({}, work); }

export async function aiAllowed(): Promise<boolean> {
  const who = scope.getStore();
  if (!check || !who || (!who.auth && !who.userId)) return true;
  return check(who);
}

export async function aiAllowedFor(userId: string | undefined | null): Promise<boolean> {
  if (!check || !userId) return true;
  return check({ userId });
}

/** The "no": what an AI service would answer a call it refused, so the caller fails at once (a 403 is never retried). */
function refused(): Response {
  return new Response(JSON.stringify({ error: { code: AI_CONSENT_CODE, message: AI_CONSENT_TEXT, type: AI_CONSENT_CODE } }), {
    status: 403, headers: { "content-type": "application/json" },
  });
}

type FetchLike = (url: unknown, init?: unknown) => Promise<unknown>;

/** An OpenAI SDK client whose calls ask first. The SDK keeps its own fetch; this wraps it in place. */
export function guardClient<T extends object>(client: T): T {
  const c = client as unknown as { fetch?: FetchLike };
  const inner = c.fetch;
  if (typeof inner !== "function") return client;
  c.fetch = async (url, init) => ((await aiAllowed()) ? inner(url, init) : refused());
  return client;
}

const hostOf = (input: unknown): string => {
  try {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : (input as { url?: string })?.url ?? "";
    return new URL(u).hostname.toLowerCase();
  } catch { return ""; }
};
export const isAiHost = (input: unknown): boolean => {
  const h = hostOf(input);
  return !!h && AI_HOSTS.some((a) => h === a || h.endsWith(`.${a}`));
};

let installed = false;
/** The server's global fetch asks first for the AI services' hosts. Once; everything else goes straight through. */
export function installAiFetchGuard(): void {
  if (installed) return;
  installed = true;
  const inner = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    (isAiHost(input) && !(await aiAllowed()) ? refused() : inner(input, init))) as typeof fetch;
}

/** Whether `err` is the gate's "no" (as the SDK throws it, or a raw call's caller made it). */
export function isAiConsentError(err: unknown): boolean {
  const e = err as { status?: number; code?: string; error?: { code?: string }; message?: string } | null;
  if (!e) return false;
  return e.code === AI_CONSENT_CODE || e.error?.code === AI_CONSENT_CODE || (e.status === 403 && typeof e.message === "string" && e.message.includes(AI_CONSENT_TEXT.slice(0, 40)));
}

/** A "no" a raw caller can throw: the error handler answers it 403. */
export class AiConsentNeeded extends Error {
  readonly statusCode = 403;
  readonly code = AI_CONSENT_CODE;
  constructor() { super(AI_CONSENT_TEXT); }
}
