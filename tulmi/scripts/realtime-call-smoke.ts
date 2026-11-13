/**
 * THE REALTIME CALL, AGAINST THE REAL MODEL, WITHOUT A PHONE (S7; botsBots/planCallLiveWords.ts). It opens a plain WebSocket session
 * with the SAME session config a call uses — the same instructions, the same tools, the same voice — and sends text turns instead of
 * audio, so the call's rules can be checked on a dev box before a single phone has the native client.
 *
 *   npx tsx scripts/realtime-call-smoke.ts                 effort from OPENAI_REALTIME_EFFORT
 *   npx tsx scripts/realtime-call-smoke.ts --effort minimal
 *
 * The key comes from the .env (OPENAI_API_KEY) and is never printed, nor is anything the model said. It prints counts and the checks
 * that failed. What it asserts, on a sample bill call:
 *   - the opening is in English and starts with "Hello"
 *   - "I've paid it" gets a read-back, and only then does "haan, paid" call mark_paid
 *   - "main pay kar dunga" calls nothing
 *   - "remind me later" calls remind_later; "bye" calls end_call
 *   - every tool's arguments are valid JSON
 *   - no "₹" and no amount is ever said out loud
 *   - usage prices to a non-zero sum (the record, never a cap)
 * It also prints, as a count and not a check, how many `session.update` went out against how many `session.updated` came back: whether
 * the service echoes on its own, which is what the live call's own `unasked` count on `[calls] live` would be counting.
 * Exit 0 when every check passes, 1 when one failed, 2 when it could not run.
 */
import WebSocket from "ws";
import { getConfig } from "../src/config.js";
import { realtimeVoice } from "../src/realtime/voices.js";
import {
  autoTurnsOn, callInstructions, callTools, pricesOf, sessionConfig, usdOfUsage, type RealtimeUsage,
} from "../src/botsBots/planCallLiveWords.js";

const BILL = {
  source: "due" as const, item: "pt:t1", taskId: "t1", day: "2026-11-12", tz: 330,
  title: "Electricity bill", payee: "BESCOM", pay: true,
};
const FACTS = [
  "What: Electricity bill",
  "Kind: bill due today",
  "To-do id: t1",
  "Due: 2026-11-12",
  "Payee: BESCOM",
  "Pay link: yes",
  "Why it matters: The connection is cut if it is late.",
].join("\n");

/** One turn: what to say, and what must (or must not) come of it. */
interface Turn { say: string; wants?: string; forbids?: string; readBack?: true }
const TURNS: Turn[] = [
  { say: "I've paid it already.", forbids: "mark_paid", readBack: true },
  { say: "Haan, paid.", wants: "mark_paid" },
  { say: "Main pay kar dunga.", forbids: "mark_paid" },
  { say: "Remind me later.", wants: "remind_later" },
  { say: "Bye.", wants: "end_call" },
];

const AMOUNT = /₹|\brs\.?\s*\d|\d{1,3}(,\d{3})+|\b\d+\s*(rupees|rupaye)\b/i;

async function main(): Promise<number> {
  const cfg = getConfig();
  if (!cfg.OPENAI_API_KEY) { console.log("Not set: OPENAI_API_KEY in tulmi/.env."); return 2; }
  const effort = process.argv.includes("--effort") ? String(process.argv[process.argv.indexOf("--effort") + 1]) : cfg.OPENAI_REALTIME_EFFORT;
  const tools = callTools(BILL, []);
  const i = {
    model: cfg.OPENAI_REALTIME_MODEL, effort, voice: realtimeVoice("nova"), tools, keywords: ["BESCOM"],
    instructions: callInstructions({
      name: "Zara", system: "You are Plan Ease, the person's planning bot in X0. You are plain, warm and short.",
      facts: FACTS, context: "",
    }),
  };
  const session = sessionConfig(i) as Record<string, unknown>;
  // A text-only session: there is no phone here, so the model writes instead of speaking.
  (session as { output_modalities: string[] }).output_modalities = ["text"];
  (session as { audio: { input: { turn_detection: unknown } } }).audio.input.turn_detection = autoTurnsOn();

  const ws = new WebSocket(`${cfg.OPENAI_REALTIME_SIDEBAND_URL}?model=${encodeURIComponent(cfg.OPENAI_REALTIME_MODEL)}`, {
    headers: { authorization: `Bearer ${cfg.OPENAI_API_KEY}` },
  });
  const failures: string[] = [];
  let usd = 0;
  let responses = 0;
  let cached = 0;
  /** The session updates we sent, and the echoes that came back: a count, not a check. The live call logs the extra ones as `unasked`. */
  let updates = 0;
  let echoes = 0;

  /** Sends one turn and waits for its response.done, collecting what the model said and which tools it called. */
  const turn = (text: string | null, directive?: string): Promise<{ said: string; tools: string[]; badArgs: string[] }> =>
    new Promise((resolve, reject) => {
      const said: string[] = [];
      const called: string[] = [];
      const badArgs: string[] = [];
      const timer = setTimeout(() => reject(new Error("the model did not answer")), 60_000);
      const onMessage = (raw: WebSocket.RawData) => {
        let e: Record<string, any>;
        try { e = JSON.parse(String(raw)) as Record<string, any>; } catch { return; }
        if (e.type === "response.output_text.delta" && typeof e.delta === "string") said.push(e.delta);
        if (e.type === "error") { clearTimeout(timer); ws.off("message", onMessage); reject(new Error(String(e.error?.code ?? "error"))); return; }
        if (e.type !== "response.done") return;
        clearTimeout(timer);
        ws.off("message", onMessage);
        responses += 1;
        const r = (e.response ?? {}) as Record<string, any>;
        usd += usdOfUsage((r.usage ?? null) as RealtimeUsage | null, cfg.OPENAI_REALTIME_MODEL, pricesOf(cfg.OPENAI_REALTIME_PRICES)).usd;
        if (Number(r.usage?.cached_tokens_details?.text_tokens) > 0) cached += 1;
        for (const o of (Array.isArray(r.output) ? r.output : []) as Array<Record<string, any>>) {
          if (String(o.type) !== "function_call") continue;
          called.push(String(o.name));
          try { JSON.parse(String(o.arguments || "{}")); } catch { badArgs.push(String(o.name)); }
        }
        // A tool call needs an answer, or the next turn never starts.
        for (const o of (Array.isArray(r.output) ? r.output : []) as Array<Record<string, any>>) {
          if (String(o.type) !== "function_call") continue;
          ws.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: o.call_id, output: JSON.stringify({ ok: true, result: "done" }) } }));
        }
        resolve({ said: said.join(""), tools: called, badArgs });
      };
      ws.on("message", onMessage);
      if (directive) ws.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: directive }] } }));
      if (text) ws.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } }));
      ws.send(JSON.stringify({ type: "response.create", response: directive ? { tool_choice: "none", max_output_tokens: 300 } : {} }));
    });

  try {
    await new Promise<void>((res, rej) => {
      ws.once("open", res);
      ws.once("error", () => rej(new Error("could not reach the realtime service")));
    });
    // Counts every echo for the whole run, so an echo the service sends of its own accord shows up against what we asked for.
    ws.on("message", (raw) => {
      try { if ((JSON.parse(String(raw)) as { type?: unknown }).type === "session.updated") echoes += 1; } catch { /* not ours */ }
    });
    ws.send(JSON.stringify({ type: "session.update", session }));
    updates += 1;

    const opening = await turn(null, 'Say this to start the call, exactly, in English, and nothing else: "Hello. Electricity bill is due today. Want me to do anything?"');
    if (!/^\s*hello/i.test(opening.said)) failures.push("the opening does not start with Hello");
    if (AMOUNT.test(opening.said)) failures.push("the opening said an amount");

    let sawReadBack = false;
    for (const t of TURNS) {
      const r = await turn(t.say);
      if (t.wants && !r.tools.includes(t.wants)) failures.push(`"${t.say}" did not call ${t.wants}`);
      if (t.forbids && r.tools.includes(t.forbids)) failures.push(`"${t.say}" called ${t.forbids}`);
      if (r.badArgs.length) failures.push(`arguments that are not JSON: ${r.badArgs.join(", ")}`);
      if (AMOUNT.test(r.said)) failures.push(`an amount was said out loud after "${t.say}"`);
      if (t.readBack && /\bpaid\b|\bmark\b|tick/i.test(r.said) && /\?/.test(r.said)) sawReadBack = true;
    }
    if (!sawReadBack) failures.push("no read-back before marking the bill paid");
    if (!(usd > 0)) failures.push("usage priced to nothing");
    if (!cached) failures.push("no response hit the prompt cache (the system-item rule may be broken)");
  } catch (err) {
    console.log(`could not run: ${(err as Error).message}`);
    try { ws.close(); } catch { /* going */ }
    return 2;
  }
  try { ws.close(); } catch { /* going */ }

  for (const f of failures) console.log(`- ${f}`);
  console.log(`${responses} responses, ${cached} cached, ${updates} session.update, ${echoes} session.updated, effort ${effort}, recorded ${Math.ceil(usd * cfg.CODE_USD_INR * 100)} paise, ${failures.length} checks failed.`);
  return failures.length ? 1 : 0;
}

process.exit(await main());
