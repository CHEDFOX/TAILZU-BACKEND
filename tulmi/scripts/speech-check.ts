/**
 * Does the no-speech gate do the right thing with REAL audio? Run it and see.
 *
 *   npx tsx scripts/speech-check.ts breath.webm speech.webm
 *   npx tsx scripts/speech-check.ts breath.webm --text "जिंदगी में."
 *   npx tsx scripts/speech-check.ts breath.webm speech.webm --stt
 *
 * In the production container (tsx is not installed there; the script is
 * compiled with the server):
 *
 *   docker compose cp ./clips backend:/tmp/clips
 *   docker compose exec backend node dist/tulmi/scripts/speech-check.js /tmp/clips/*.webm --stt
 *
 * For each clip it prints the measured voice (speechPresence), and:
 *   --text "…"  what the gate would do with that transcript on this clip
 *   --stt       the real recognisers' reading (STT_PROVIDER, real keys) and
 *               what transcribe() returns after the gate — the text that
 *               would reach the writer, or "" and why it was withheld
 *
 * "voice: not measured" on a webm/m4a clip means ffmpeg is missing or could
 * not read it; the gate then falls back to the recognisers alone.
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { AudioFormat } from "../../shared/types/api.js";
import { measureSpeech } from "../src/pipeline/speechPresence.js";
import { gateTranscript } from "../src/pipeline/speechGate.js";

const FORMATS: Record<string, AudioFormat> = {
  ".wav": "wav", ".m4a": "m4a", ".mp4": "m4a", ".webm": "webm", ".mp3": "mp3", ".ogg": "ogg", ".flac": "flac",
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const textAt = args.indexOf("--text");
  const text = textAt >= 0 ? args[textAt + 1] : undefined;
  const stt = args.includes("--stt");
  const files = args.filter((a, i) => !a.startsWith("--") && (textAt < 0 || i !== textAt + 1));
  if (!files.length) {
    console.log("usage: speech-check <audio…> [--text \"transcript\"] [--stt]");
    process.exit(1);
  }
  for (const file of files) {
    const format = FORMATS[extname(file).toLowerCase()];
    if (!format) { console.log(`${file}: unknown format`); continue; }
    const audio = readFileSync(file);
    const m = await measureSpeech(audio, format);
    console.log(`\n${file}`);
    console.log(m
      ? `  voice: ${m.voicedSeconds}s voiced, ${m.activeSeconds}s above the room, of ${m.totalSeconds}s${m.truncated ? " (first part only)" : ""}`
      : "  voice: not measured (no ffmpeg, or unreadable)");
    if (text !== undefined) {
      const g = gateTranscript(text, { measure: m, clipBytes: audio.length });
      console.log(`  gate on ${JSON.stringify(text)}: ${g.dropped ? `withheld (${g.dropped})` : `kept → ${JSON.stringify(g.text)}`}`);
    }
    if (stt) {
      // Imported late: it reads the config, which needs the real environment.
      const { transcribe } = await import("../src/pipeline/stt.js");
      const r = await transcribe({ audio, format });
      console.log(`  ${r.engine}: ${r.dropped ? `withheld (${r.dropped})` : JSON.stringify(r.text)}`
        + (r.alternative ? `  | alternative ${JSON.stringify(r.alternative)}` : ""));
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
