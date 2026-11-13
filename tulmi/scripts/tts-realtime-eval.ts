/**
 * DOES THE REALTIME MODEL READ TEXT ALOUD, WORD FOR WORD? (S0; pipeline/tts.ts synthesizeRealtime.) OpenAI removes gpt-4o-mini-tts,
 * tts-1 and tts-1-hd on 2027-01-06, so every read-aloud moves to the realtime model. This reads 30 lines aloud and transcribes each
 * one back, so a model that answers the text instead of saying it, or adds a sentence of its own, is caught before the switch.
 *
 *   npx tsx scripts/tts-realtime-eval.ts            every line
 *   npx tsx scripts/tts-realtime-eval.ts --only 3   one line, by its number
 *
 * The key comes from the .env (OPENAI_API_KEY) and is never printed. It prints counts only: no key, no audio, no transcript beyond the
 * words that did not match. It passes when every line matches at least 95 % of its words, nothing was added, and a two-sentence line is
 * fully spoken within 2 seconds. Exit 0 when it passes, 1 when a line failed, 2 when it could not run.
 */
import fs from "node:fs";
import OpenAI from "openai";
import { getConfig } from "../src/config.js";
import { synthesizeRealtime } from "../src/pipeline/tts.js";
import { isRealtimeModel } from "../src/realtime/voices.js";

/** English, Hindi, Hinglish, Tamil, numbers, times and names: what a read-aloud really meets. */
const LINES: string[] = [
  "It's time to leave for the parent-teacher meeting at Green Valley School.",
  "Hello. Electricity bill is due today.",
  "I'll leave it there. It's all on your Plan.",
  "Your appointment is at a quarter past five.",
  "Two things are waiting on someone else.",
  "कल सुबह याद दिला देना।",
  "बिजली का बिल आज देना है।",
  "अभी निकलने का समय हो गया है।",
  "मीटिंग शाम साढ़े पांच बजे है।",
  "ठीक है, मैंने वह कर दिया।",
  "Kal subah yaad dila dena.",
  "Meeting 5:30 pm pe hai, nikal jao.",
  "Main yeh Plan par add kar deta hoon.",
  "Bill aaj due hai, pay kar dena.",
  "Theek hai, done.",
  "நாளை காலை நினைவுபடுத்து.",
  "கூட்டம் மாலை ஐந்தரை மணிக்கு.",
  "இது முடிந்தது.",
  "Rent is due on Friday the fourteenth.",
  "Twenty-five minutes by car.",
  "One thousand two hundred and forty.",
  "At 6:10 am, from terminal two.",
  "Between 9:30 and 11:00.",
  "Kabir's school meeting is at 4:45 pm.",
  "Meera will pick up the documents.",
  "Dr Mehta's clinic is on the second floor.",
  "BESCOM, VFS Global and Kempegowda Airport.",
  "Rahul asked me to remind you about the forms.",
  "That's all for today. Talk soon.",
  "I moved it to six. You'll leave at five thirty-five.",
];

/** The words of a line, folded for comparison: case and punctuation are not what we are measuring. */
const words = (s: string): string[] => s.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);

/** How much of the line came back, and how much came back that was never in it. */
function compare(said: string, heard: string): { match: number; added: number } {
  const want = words(said);
  const got = words(heard);
  const left = [...got];
  let hit = 0;
  for (const w of want) {
    const i = left.indexOf(w);
    if (i >= 0) { hit += 1; left.splice(i, 1); }
  }
  return { match: want.length ? hit / want.length : 1, added: left.length };
}

async function main(): Promise<number> {
  const cfg = getConfig();
  if (!cfg.OPENAI_API_KEY) { console.log("Not set: OPENAI_API_KEY in tulmi/.env."); return 2; }
  if (!isRealtimeModel(cfg.OPENAI_TTS_MODEL)) { console.log(`OPENAI_TTS_MODEL is ${cfg.OPENAI_TTS_MODEL}, which is not a realtime model.`); return 2; }
  const only = Number(process.argv[process.argv.indexOf("--only") + 1]);
  const pick = Number.isInteger(only) && only > 0 ? [LINES[only - 1]!] : LINES;
  const openai = new OpenAI({ apiKey: cfg.OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 });

  let passed = 0;
  const failed: Array<{ n: number; match: number; added: number; ms: number }> = [];
  for (const [i, line] of pick.entries()) {
    const t0 = Date.now();
    let heard = "";
    let ms = 0;
    try {
      const out = await synthesizeRealtime({ text: line, format: "mp3" });
      ms = Date.now() - t0;
      const file = new File([new Uint8Array(out.audio)], "line.mp3", { type: "audio/mpeg" });
      const back = await openai.audio.transcriptions.create({ file, model: "gpt-transcribe" } as never);
      heard = String((back as { text?: unknown }).text ?? "");
    } catch (err) {
      failed.push({ n: i + 1, match: 0, added: 0, ms: Date.now() - t0 });
      console.log(`line ${i + 1}: could not be read (${(err as Error).name})`);
      continue;
    }
    const { match, added } = compare(line, heard);
    const sentences = (line.match(/[.!?।]/g) ?? []).length;
    const slow = sentences <= 2 && ms > 2_000;
    if (match >= 0.95 && added === 0 && !slow) { passed += 1; continue; }
    failed.push({ n: i + 1, match, added, ms });
    console.log(`line ${i + 1}: ${Math.round(match * 100)} % of its words, ${added} added, ${ms} ms`);
  }
  console.log(`${passed}/${pick.length} lines read word for word, in time.`);
  return failed.length ? 1 : 0;
}

// A dev box only: it needs a real key, which never leaves the .env.
if (!fs.existsSync(new URL("../.env", import.meta.url))) console.log("No tulmi/.env here: the key must come from the environment.");
process.exit(await main());
