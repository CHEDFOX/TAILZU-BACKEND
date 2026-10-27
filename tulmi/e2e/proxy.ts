/**
 * A LOCAL OPENAI-COMPATIBLE PROXY WITH CASSETTES: POINT ANY AGENT AT IT AS ITS BASE URL.
 *
 *   http://127.0.0.1:8787/v1               the base URL (an agent that wants a key is given any text; it is ignored)
 *   http://127.0.0.1:8787/run/<id>/v1      the same, labelled: calls and cost are counted per <id> (a task, an agent), and replays are matched per run
 *
 *   POST /v1/chat/completions   record: forwarded to OpenRouter and written to the cassette. replay: served from it. mixed: from it, else forwarded
 *   GET  /v1/models             the models the cassette has, so a client that lists models finds them
 *   GET  /stats                 hits, misses, recorded, dollars spent and replayed, per run
 *
 * Environment: E2E_PROXY_PORT (8787), E2E_PROXY_MODE (record | replay | mixed, default replay), E2E_CASSETTE (the cassette's name, default "smoke"),
 * E2E_BUDGET_INR (the hard cap in rupees for record and mixed; 0 = none), E2E_PROXY_LOOSE (1: a miss is tried by the run's call order),
 * OPENROUTER_API_KEY (to record). The same flags work on the command line: `tsx e2e/proxy.ts --mode record --cassette smoke --budget-inr 25`.
 *
 * A request with `stream: true` is answered as a stream built from the whole answer (the upstream is never streamed), with usage in the last chunk when
 * `stream_options.include_usage` asks for it. A leading `openrouter/` on the model name is dropped (Aider, opencode and Codex CLI add it).
 * When the cap is reached the answer is a 402 with `error.code: "budget_exceeded"`; a miss in replay is a 400 with `error.code: "cassette_miss"`.
 */
import "./env.js";
import http from "node:http";
import type { ChatClient } from "../src/code/brain/gateway.js";
import { CassetteClient, CassetteStore, SpendGuard, type CassetteMode, type CassetteStats } from "./adapters/cassette.js";
import { openRouterClient } from "./adapters/upstream.js";

export interface ProxyOptions {
  port?: number;
  mode: CassetteMode;
  cassette: string;
  /** Hard cap on what the upstream may charge, in dollars (0 = none). */
  capUsd?: number;
  loose?: boolean;
  upstream?: ChatClient;
  log?: (s: string) => void;
}

export interface Proxy {
  url: string;
  port: number;
  store: CassetteStore;
  guard: SpendGuard;
  /** Stats per run label ("-" for unlabelled). */
  runs(): Record<string, CassetteStats>;
  total(): CassetteStats;
  close(): Promise<void>;
}

const readBody = (req: http.IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
  const parts: Buffer[] = [];
  req.on("data", (c: Buffer) => parts.push(c));
  req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
  req.on("error", reject);
});

const json = (res: http.ServerResponse, status: number, body: unknown): void => {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
};

/** A whole answer as chat-completion chunks (server-sent events). */
function streamOf(res: http.ServerResponse, answer: Record<string, any>, includeUsage: boolean): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const choice = (answer.choices ?? [])[0] ?? {};
  const msg = choice.message ?? {};
  const base = { id: answer.id ?? "chatcmpl-cassette", object: "chat.completion.chunk", created: answer.created ?? Math.floor(Date.now() / 1000), model: answer.model ?? "" };
  const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  if (typeof msg.content === "string" && msg.content) send({ ...base, choices: [{ index: 0, delta: { content: msg.content }, finish_reason: null }] });
  (msg.tool_calls ?? []).forEach((t: any, i: number) => {
    send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: t.id, type: "function", function: { name: t.function?.name, arguments: "" } }] }, finish_reason: null }] });
    send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: i, function: { arguments: t.function?.arguments ?? "" } }] }, finish_reason: null }] });
  });
  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason ?? "stop" }], ...(includeUsage && answer.usage ? { usage: answer.usage } : {}) });
  res.write("data: [DONE]\n\n");
  res.end();
}

export async function startProxy(o: ProxyOptions): Promise<Proxy> {
  const store = new CassetteStore(o.cassette);
  if (o.mode === "record") store.reset(); else store.load();
  const guard = new SpendGuard(o.capUsd ?? 0);
  const upstream = o.mode === "replay" ? undefined : (o.upstream ?? openRouterClient());
  const clients = new Map<string, CassetteClient>();
  const clientFor = (run: string): CassetteClient => {
    let c = clients.get(run);
    if (!c) {
      c = new CassetteClient({ store, mode: o.mode, ...(upstream ? { upstream } : {}), guard, run, ...(o.loose ? { loose: true } : {}) });
      clients.set(run, c);
    }
    return c;
  };
  const log = o.log ?? (() => undefined);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const m = /^\/run\/([A-Za-z0-9._-]{1,80})(\/.*)$/.exec(url.pathname);
      const run = m ? m[1]! : "-";
      const pathname = m ? m[2]! : url.pathname;
      if (req.method === "GET" && pathname === "/health") return json(res, 200, { ok: true, mode: o.mode, cassette: o.cassette, entries: store.count });
      if (req.method === "GET" && pathname === "/stats") return json(res, 200, { mode: o.mode, spentUsd: guard.spentUsd, capUsd: guard.capUsd, runs: Object.fromEntries([...clients].map(([k, c]) => [k, c.stats])) });
      if (req.method === "GET" && pathname === "/v1/models") {
        const ids = [...new Set(store.entries().map((e) => e.req.model))];
        return json(res, 200, { object: "list", data: ids.map((id) => ({ id, object: "model", owned_by: id.split("/")[0] })) });
      }
      if (req.method === "POST" && pathname === "/v1/chat/completions") {
        const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
        const wantsStream = body.stream === true;
        const includeUsage = (body.stream_options as { include_usage?: boolean } | undefined)?.include_usage === true;
        const { stream: _s, stream_options: _o, ...rest } = body;
        const model = String(rest.model ?? "").replace(/^openrouter\//, "");
        let answer: any;
        try {
          answer = await clientFor(run).create({ ...rest, model });
        } catch (err) {
          const e = err as { status?: number; message?: string; cassetteMiss?: boolean; spendCap?: boolean };
          const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
          log(`${run}: ${status} ${(e.message ?? "").slice(0, 120)}`);
          return json(res, status, { error: { message: e.message ?? "upstream error", code: e.cassetteMiss ? "cassette_miss" : e.spendCap ? "budget_exceeded" : "upstream_error", type: "e2e_proxy" } });
        }
        if (wantsStream) return streamOf(res, answer, includeUsage);
        return json(res, 200, answer);
      }
      json(res, 404, { error: { message: `no such route: ${req.method} ${url.pathname}`, code: "not_found" } });
    } catch (err) {
      json(res, 400, { error: { message: (err as Error).message.slice(0, 200), code: "bad_request" } });
    }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(o.port ?? 8787, "127.0.0.1", () => resolve()); });
  const port = (server.address() as import("node:net").AddressInfo).port;
  const sum = (): CassetteStats => {
    const t: CassetteStats = { hits: 0, misses: [], recorded: 0, spentUsd: 0, replayedUsd: 0, refused: 0 };
    for (const c of clients.values()) { t.hits += c.stats.hits; t.misses.push(...c.stats.misses); t.recorded += c.stats.recorded; t.spentUsd += c.stats.spentUsd; t.replayedUsd += c.stats.replayedUsd; t.refused += c.stats.refused; }
    return t;
  };
  return {
    url: `http://127.0.0.1:${port}/v1`, port, store, guard,
    runs: () => Object.fromEntries([...clients].map(([k, c]) => [k, c.stats])), total: sum,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }),
  };
}

// ------------------------------------------------------------------- command line

async function main(): Promise<void> {
  const a = process.argv.slice(2);
  const arg = (n: string, env: string, d: string): string => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1]! : process.env[env] ?? d; };
  const mode = arg("mode", "E2E_PROXY_MODE", "replay") as CassetteMode;
  if (!["record", "replay", "mixed"].includes(mode)) throw new Error("--mode is record, replay or mixed");
  const fx = Number(process.env.CODE_USD_INR) || 88;
  const capInr = Number(arg("budget-inr", "E2E_BUDGET_INR", "0"));
  if (mode !== "replay" && !(capInr > 0)) throw new Error("recording needs a hard cap: --budget-inr X (or E2E_BUDGET_INR)");
  const p = await startProxy({
    port: Number(arg("port", "E2E_PROXY_PORT", "8787")), mode, cassette: arg("cassette", "E2E_CASSETTE", "smoke"), capUsd: capInr / fx,
    loose: arg("loose", "E2E_PROXY_LOOSE", "0") === "1" || a.includes("--loose"), log: (s) => console.log(s),
  });
  console.log(`proxy ${mode} on ${p.url}  cassette ${p.store.file} (${p.store.count} entries)${capInr ? `  cap ₹${capInr}` : ""}`);
  console.log(`point an agent at it: OPENAI_BASE_URL=${p.url} OPENAI_API_KEY=any    (per-run counting: ${p.url.replace(/\/v1$/, "")}/run/<id>/v1)`);
  const stop = async () => { const t = p.total(); console.log(`\n${t.hits} replayed, ${t.recorded} recorded, ${t.misses.length} miss(es), $${t.spentUsd.toFixed(4)} spent`); await p.close(); process.exit(0); };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

if (process.argv[1] && /e2e\/proxy\.[tj]s$/.test(process.argv[1])) main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
