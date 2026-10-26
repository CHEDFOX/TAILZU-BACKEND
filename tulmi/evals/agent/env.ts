/**
 * WHO THE BENCH IS TO THE SERVER, AND WHAT IT CAN NEVER REACH.
 *
 * Each trial is a person of its own: a static bearer token
 * (STATIC_BEARER_TOKENS, as the desktop and the quality harness sign in), so
 * nothing a trial leaves behind, a question waiting for its answer, a row in
 * the run ledger, a rate count, can be read by the next one. The tokens are
 * read once, with the rest of the config, so they are all made up front:
 * one per trial the process will run.
 *
 * Everything else here pins the config to a server with no database and no
 * real keys. DEV_SKIP_AUTH stays off (the route authenticates as it does in
 * production); Supabase points at a port nothing listens on and its service
 * key is set, empty, so every store is its in-memory twin (dotenv never
 * overrides a variable that is set, so a developer's .env cannot hand the
 * bench a real database); and in the offline modes the model key is a
 * placeholder, so a call that somehow reached OpenRouter would be refused
 * rather than paid for.
 *
 * Imports nothing from the server: a test file and run.ts both set these
 * before the config is first read.
 */

/** "roz-bench-person-" and fifteen digits: 32 characters (a static token is taken from 16 up). */
export function benchTokens(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `roz-bench-person-${String(i + 1).padStart(15, "0")}`);
}

/** 32 bytes, base64: the key the trial's Google tokens are stored under (connectors/crypto.ts). */
export const BENCH_TOKEN_KEY = Buffer.from("roz-bench: tokens at rest, 32 b.").toString("base64");

/** Written to OPENROUTER_API_KEY in the offline modes, where nothing may call a model. */
export const OFFLINE_KEY = "roz-bench-offline-no-model-calls";

/**
 * The environment a bench process runs with. `people`: how many trials it
 * may run. `offline`: scripted and replay, which never call a model; live
 * leaves OPENROUTER_API_KEY to the environment (and .env).
 */
export function benchEnv(o: { people: number; offline: boolean }): Record<string, string> {
  return {
    NODE_ENV: "test",
    DEV_SKIP_AUTH: "false",
    SUPABASE_URL: "http://127.0.0.1:1",
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_KEY: "",
    STT_PROVIDER: "groq",
    GROQ_API_KEY: "roz-bench-no-speech",
    CONNECTOR_TOKEN_KEY: BENCH_TOKEN_KEY,
    STATIC_BEARER_TOKENS: benchTokens(o.people).join(","),
    ...(o.offline ? { OPENROUTER_API_KEY: OFFLINE_KEY } : {}),
  };
}

/** One token per trial, handed out in order; running out is the bench's bug, said plainly. */
export class People {
  private next = 0;
  constructor(private readonly tokens: readonly string[]) {}
  take(): string {
    const t = this.tokens[this.next++];
    if (!t) throw new Error(`The bench has run out of people (${this.tokens.length}): give benchEnv a larger "people" for this many trials.`);
    return t;
  }
}
