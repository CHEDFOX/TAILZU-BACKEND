/**
 * Which engine is actually better, and by how much — measured, not argued.
 *
 *   npm run bench:stt -- ./test-assets
 *   npm run bench:stt -- ./test-assets --engines sarvam,deepgram --repeat 3
 *   npm run bench:stt -- ./test-assets --flow           # + the writing step
 *
 * WHY THIS EXISTS. The keyboard mic and the in-app mic take different roads —
 * one streams to STT_LIVE_PROVIDER, the other posts a clip to STT_PROVIDER —
 * and a user reported the keyboard was worse on Indian languages. That is a
 * claim about two engines on the same audio, and the only honest way to settle
 * it is to give both engines the same audio and look. The defaults in config.ts
 * should be answerable from this script's output rather than from anyone's
 * impression.
 *
 * INPUT. Point it at a folder of clips. Put a reference transcript next to a
 * clip as `<name>.txt` and the run scores accuracy as well as speed; without
 * one you still get latency and the transcripts side by side, which is enough
 * to judge a language you can read.
 *
 *   test-assets/hindi-01.m4a
 *   test-assets/hindi-01.txt      ← what was actually said
 *
 * WHAT IT REPORTS.
 *   • median and slowest wall time per engine, over --repeat runs
 *   • WER and CER against the reference, when there is one
 *   • the script each engine came back in — the tell for the failure this was
 *     written for, where one engine returns Devanagari and the other returns
 *     romanized guesswork or English
 *   • with --flow, the same for the whole road: STT → the writing model → the
 *     text that would land at the user's cursor
 *
 * Results are printed and written to bench-<timestamp>.json so two runs can be
 * compared after a config change.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { STT_ENGINES, detectScript, type SttEngineName } from "../src/pipeline/stt.js";
import { assist } from "../src/pipeline/cleanup.js";
import { getConfig } from "../src/config.js";
import { score } from "../src/pipeline/wer.js";
import type { AudioFormat } from "../../shared/types/api.js";

const AUDIO_EXT: Record<string, AudioFormat> = {
  ".wav": "wav", ".m4a": "m4a", ".mp4": "m4a", ".webm": "webm",
  ".mp3": "mp3", ".ogg": "ogg", ".flac": "flac",
};

interface Args {
  dir: string;
  engines: SttEngineName[];
  repeat: number;
  flow: boolean;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let engines: SttEngineName[] = ["sarvam", "generalist", "deepgram"];
  let repeat = 3;
  let flow = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--engines") engines = argv[++i].split(",").map((s) => s.trim()) as SttEngineName[];
    else if (a === "--repeat") repeat = Math.max(1, Number(argv[++i]) || 1);
    else if (a === "--flow") flow = true;
    else positional.push(a);
  }
  return { dir: positional[0] ?? "./test-assets", engines, repeat, flow };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const pad = (s: string, n: number) => s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);

interface Row {
  clip: string;
  engine: string;
  ok: boolean;
  error?: string;
  medianMs: number;
  slowestMs: number;
  script: string;
  detectedLanguage?: string;
  transcript: string;
  wer?: number;
  cer?: number;
  flowMs?: number;
  flowText?: string;
}

async function main(): Promise<void> {
  const { dir, engines, repeat, flow } = parseArgs(process.argv.slice(2));
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`Not a folder: ${root}\n\n  npm run bench:stt -- ./test-assets\n`);
    process.exit(1);
  }

  const clips = readdirSync(root)
    .filter((f) => AUDIO_EXT[extname(f).toLowerCase()])
    .sort();
  if (!clips.length) {
    console.error(
      `No audio in ${root}. Drop a few clips in and, next to each, a .txt of\n` +
      `what was actually said if you want accuracy scored too.\n`,
    );
    process.exit(1);
  }

  // Say what is configured before spending money on calls. An engine with no
  // key produces a whole column of failures that look like quality findings.
  const cfg = getConfig();
  const keyed: Record<string, boolean> = {
    sarvam: !!cfg.SARVAM_API_KEY,
    deepgram: !!cfg.DEEPGRAM_API_KEY,
    generalist: !!(cfg.GROQ_API_KEY || cfg.OPENAI_API_KEY),
    groq: !!cfg.GROQ_API_KEY,
    openai: !!cfg.OPENAI_API_KEY,
  };
  const missing = engines.filter((e) => keyed[e] === false);
  if (missing.length) {
    console.error(`No API key for: ${missing.join(", ")} — skipping.\n`);
  }
  const run = engines.filter((e) => keyed[e] !== false && STT_ENGINES[e]);
  if (!run.length) { console.error("Nothing left to run."); process.exit(1); }

  console.log(
    `${clips.length} clip(s) × ${run.length} engine(s) × ${repeat} run(s)` +
    `${flow ? " + the writing step" : ""}\n`,
  );

  const rows: Row[] = [];
  for (const file of clips) {
    const path = join(root, file);
    const name = basename(file, extname(file));
    const format = AUDIO_EXT[extname(file).toLowerCase()];
    const audio = readFileSync(path);
    const refPath = join(root, `${name}.txt`);
    const ref = existsSync(refPath) ? readFileSync(refPath, "utf8").trim() : "";

    console.log(`── ${file}${ref ? "  (scored)" : "  (no reference — speed + read-it-yourself)"}`);
    for (const engine of run) {
      const times: number[] = [];
      let last: Awaited<ReturnType<(typeof STT_ENGINES)[SttEngineName]>> | null = null;
      let error: string | undefined;
      for (let i = 0; i < repeat; i++) {
        const t0 = Date.now();
        try {
          last = await STT_ENGINES[engine]({ audio, format });
          times.push(Date.now() - t0);
        } catch (err) {
          error = (err as Error).message;
          break;
        }
      }
      if (error || !last) {
        rows.push({ clip: file, engine, ok: false, error, medianMs: 0, slowestMs: 0, script: "-", transcript: "" });
        console.log(`   ${pad(engine, 12)} FAILED  ${error}`);
        continue;
      }
      const text = last.text.trim();
      const row: Row = {
        clip: file, engine, ok: true,
        medianMs: median(times),
        slowestMs: Math.max(...times),
        script: detectScript(text),
        detectedLanguage: last.detectedLanguage,
        transcript: text,
        ...(ref ? score(ref, text) : {}),
      };

      // The full road, not just the recognizer. A transcript that scores well
      // and then confuses the writing model is not a win, and that interaction
      // is invisible if you only ever measure STT.
      if (flow && text) {
        const t1 = Date.now();
        try {
          row.flowText = await assist(text, { script: last.script, language: "auto" });
          row.flowMs = Date.now() - t1;
        } catch (err) {
          row.flowText = `(writing step failed: ${(err as Error).message})`;
        }
      }

      rows.push(row);
      const acc = ref ? `  WER ${pct(row.wer!)}  CER ${pct(row.cer!)}` : "";
      console.log(
        `   ${pad(engine, 12)} ${pad(`${row.medianMs}ms`, 8)}` +
        `${pad(row.script, 12)}${acc}${row.detectedLanguage ? `  [${row.detectedLanguage}]` : ""}`,
      );
      console.log(`   ${" ".repeat(12)} ${text.slice(0, 140)}${text.length > 140 ? "…" : ""}`);
      if (row.flowText) {
        console.log(`   ${" ".repeat(12)} → ${row.flowMs}ms  ${row.flowText.slice(0, 140)}`);
      }
    }
    console.log("");
  }

  // Per-engine roll-up. Averaging WER across clips of different lengths is
  // crude, but the alternative — a corpus-level rate — hides the case this was
  // written to find, where one engine is fine on English clips and falls apart
  // on the Hindi one. Per-clip lines above are the real evidence.
  console.log("── summary");
  console.log(`   ${pad("engine", 12)}${pad("median", 9)}${pad("slowest", 9)}${pad("WER", 9)}${pad("CER", 9)}failed`);
  for (const engine of run) {
    const mine = rows.filter((r) => r.engine === engine);
    const ok = mine.filter((r) => r.ok);
    const scored = ok.filter((r) => r.wer !== undefined);
    console.log(
      `   ${pad(engine, 12)}` +
      `${pad(ok.length ? `${median(ok.map((r) => r.medianMs))}ms` : "-", 9)}` +
      `${pad(ok.length ? `${Math.max(...ok.map((r) => r.slowestMs))}ms` : "-", 9)}` +
      `${pad(scored.length ? pct(scored.reduce((s, r) => s + r.wer!, 0) / scored.length) : "-", 9)}` +
      `${pad(scored.length ? pct(scored.reduce((s, r) => s + r.cer!, 0) / scored.length) : "-", 9)}` +
      `${mine.length - ok.length}`,
    );
  }

  const out = `bench-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify({
    at: new Date().toISOString(),
    config: {
      sttProvider: cfg.STT_PROVIDER,
      liveProvider: cfg.STT_LIVE_PROVIDER,
      liveDual: cfg.STT_LIVE_DUAL,
      sarvamModel: cfg.SARVAM_STT_MODEL,
      sarvamMode: cfg.SARVAM_STT_MODE,
      deepgramModel: cfg.DEEPGRAM_STT_MODEL,
      generalist: cfg.GROQ_API_KEY ? cfg.GROQ_STT_MODEL : cfg.OPENAI_STT_MODEL,
      cleanupModel: cfg.CLEANUP_MODEL,
    },
    repeat, flow, rows,
  }, null, 2));
  console.log(`\n   written to ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
