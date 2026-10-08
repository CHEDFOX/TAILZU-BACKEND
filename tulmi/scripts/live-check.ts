/**
 * Does OpenAI's live recognizer send text WHILE someone talks, or only after
 * they pause? And what does a pause in the middle of a sentence come back as?
 * Run it and see.
 *
 *   npx tsx scripts/live-check.ts
 *   npx tsx scripts/live-check.ts --say "I was going to the" --say "market tomorrow" --gap 1.2
 *
 * In the production container (tsx is not installed there; the script is
 * compiled with the server):
 *
 *   docker compose exec backend node dist/tulmi/scripts/live-check.js
 *
 * It speaks each --say with OPENAI_TTS_MODEL, leaves --gap seconds of silence
 * between them, and streams that audio at real-time pace through the same
 * openOpenAI() the keyboards' live dictation uses, with the server's own
 * session settings (OPENAI_LIVE_STT_MODEL, OPENAI_LIVE_SILENCE_MS). Every event
 * the API sends is printed at the second it arrived, on the audio's clock:
 *
 *    2.95s  committed            turn 1
 *    3.21s  delta                turn 1  "So I was going"
 *    3.40s  completed            turn 1  "So I was going to the."
 *
 * Reading it: if every delta of a turn arrives after that turn's "committed",
 * the engine sends text in a burst at each pause, not word by word as they
 * speak. A turn that ends in a full stop where the sentence carries on is
 * the full stop the writer is told to remove (assistPrompt.ts).
 */
import WebSocket from "ws";
import { getConfig } from "../src/config.js";
import { synthesize } from "../src/pipeline/tts.js";
import { OPENAI_RATE, openOpenAI } from "../src/routes/live-engines.js";

function args(): { say: string[]; gap: number } {
  const a = process.argv.slice(2);
  const say: string[] = [];
  let gap = 1.2;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--say" && a[i + 1]) say.push(a[++i]!);
    else if (a[i] === "--gap" && a[i + 1]) gap = Number(a[++i]);
  }
  if (!say.length) say.push("So I was going to the", "market tomorrow and then maybe the pharmacy");
  return { say, gap: Number.isFinite(gap) && gap >= 0 ? gap : 1.2 };
}

const silence = (seconds: number) => Buffer.alloc(Math.round(OPENAI_RATE * seconds) * 2);

async function main(): Promise<void> {
  const cfg = getConfig();
  if (!cfg.OPENAI_API_KEY) {
    console.log("OPENAI_API_KEY is not set: nothing to check.");
    process.exit(1);
  }
  const { say, gap } = args();
  console.log(`model ${cfg.OPENAI_LIVE_STT_MODEL}, turn ends after ${cfg.OPENAI_LIVE_SILENCE_MS} ms of silence`);

  // OpenAI's "pcm" is 16-bit mono at 24 kHz, which the engine takes as is.
  const parts: Buffer[] = [silence(0.3)];
  for (const [i, text] of say.entries()) {
    const { audio } = await synthesize({ text, format: "pcm" });
    const from = parts.reduce((s, b) => s + b.length, 0) / 2 / OPENAI_RATE;
    console.log(`speech ${from.toFixed(2)}–${(from + audio.length / 2 / OPENAI_RATE).toFixed(2)}s  "${text}"`);
    parts.push(audio, silence(i < say.length - 1 ? gap : 1.5));
  }
  const audio = Buffer.concat(parts);
  console.log("");

  let t0 = 0;
  const at = () => (t0 ? ((performance.now() - t0) / 1000).toFixed(2) : "0.00").padStart(6) + "s";
  const turns = new Map<string, number>();
  const turn = (id?: string) => (id ? `turn ${turns.get(id) ?? turns.set(id, turns.size + 1).get(id)}` : "");
  // Per turn: when it was committed, and when its first delta arrived.
  const committed = new Map<string, number>();
  const firstDelta = new Map<string, number>();
  const stopped = new Map<string, number>();

  const engine = openOpenAI({ sampleRate: OPENAI_RATE, channels: 1 }, {
    onReady: () => {
      console.log(`${at()}  ready, streaming ${(audio.length / 2 / OPENAI_RATE).toFixed(1)}s of audio in real time\n`);
      t0 = performance.now();
      const frame = Math.round(OPENAI_RATE * 0.02) * 2;   // 20 ms, as a phone sends
      let sent = 0;
      const tick = setInterval(() => {
        // Paced by the clock, so a slow tick catches up instead of drifting.
        const due = Math.min(audio.length, Math.floor(((performance.now() - t0) / 1000) * OPENAI_RATE) * 2);
        while (sent < due) {
          const end = Math.min(due, sent + frame);
          engine.send(audio.subarray(sent, end));
          sent = end;
        }
        if (sent >= audio.length) {
          clearInterval(tick);
          console.log(`${at()}  audio finished, stop sent`);
          engine.close();
        }
      }, 20);
    },
    onPartial: () => { /* the raw events below show it with its turn */ },
    onFinal: (text) => console.log(`${at()}  → final to client    "${text}"`),
    onError: (m) => console.log(`${at()}  error: ${m}`),
    onClose: (code) => {
      console.log(`${at()}  closed${code ? ` abnormally (${code})` : ""}\n`);
      let live = false;
      for (const [id, n] of turns) {
        const d = firstDelta.get(id), c = committed.get(id), s = stopped.get(id);
        if (d !== undefined && s !== undefined && d < s) live = true;
        console.log(`turn ${n}: committed ${c?.toFixed(2) ?? "-"}s, first delta ${d?.toFixed(2) ?? "never"}${d !== undefined && c !== undefined ? ` (${((d - c) * 1000).toFixed(0)} ms after)` : ""}`);
      }
      console.log(turns.size
        ? live
          ? "\nText arrived while speech was still going on: live, word by word."
          : "\nEvery delta came after its turn ended: text arrives in a burst at each pause, not while they talk."
        : "\nNo turns at all: the session never transcribed anything. Check the key and the model name.");
      process.exit(0);
    },
  }, (url, headers) => {
    const ws = new WebSocket(url, { headers });
    ws.on("message", (raw: Buffer) => {
      let m: any;
      try { m = JSON.parse(raw.toString("utf8")); } catch { return; }
      const now = t0 ? (performance.now() - t0) / 1000 : 0;
      const id: string | undefined = m.item_id;
      switch (m.type) {
        case "input_audio_buffer.speech_started":
          console.log(`${at()}  speech started       ${turn(id)}`);
          return;
        case "input_audio_buffer.speech_stopped":
          if (id) stopped.set(id, now);
          console.log(`${at()}  speech stopped       ${turn(id)}`);
          return;
        case "input_audio_buffer.committed":
          if (id) committed.set(id, now);
          console.log(`${at()}  committed            ${turn(id)}`);
          return;
        case "conversation.item.input_audio_transcription.delta":
          if (id && !firstDelta.has(id)) firstDelta.set(id, now);
          console.log(`${at()}  delta                ${turn(id)}  ${JSON.stringify(m.delta ?? "")}`);
          return;
        case "conversation.item.input_audio_transcription.completed":
          console.log(`${at()}  completed            ${turn(id)}  ${JSON.stringify(m.transcript ?? "")}`);
          return;
        case "error":
          console.log(`${at()}  api error            ${m.error?.code ?? ""} ${m.error?.message ?? ""}`);
          return;
        default:
          if (typeof m.type === "string" && !m.type.startsWith("session.") && !m.type.startsWith("transcription_session.")) {
            console.log(`${at()}  ${m.type}`);
          }
      }
    });
    return ws;
  });
  setTimeout(() => { console.log("gave up after 60 s"); process.exit(1); }, 60_000).unref();
}

main().catch((e) => { console.error(e); process.exit(1); });
