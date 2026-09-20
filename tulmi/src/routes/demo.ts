/**
 * The landing page, and the one thing on it that is not a page.
 *
 *   GET  /            → SITE_DIR/index.html, or /download until one exists
 *   GET  /v1/site     → every word on the page, plus what can be downloaded
 *   POST /v1/demo/transcribe → a visitor's own voice, written clean
 *
 * WHY THE DEMO EXISTS. A dictation product's hardest job is explaining
 * itself, and no sentence does it as well as the visitor's own sentence
 * coming back finished. So the page has a microphone and no sign-up: press,
 * talk, watch. The download button is asked for AFTER that, on top of proof
 * the visitor just made.
 *
 * WHY IT IS BOUNDED THE WAY IT IS. It is an unauthenticated route that spends
 * a recogniser call and a model call per press. Three limits, each about a
 * different way of being expensive:
 *
 *   DEMO_ENABLED       a kill switch, off by default — turning it on is a
 *                      decision about money and belongs in .env, not code
 *   DEMO_MAX_SECONDS   a pitch, not a dictation; nothing long gets in
 *   DEMO_PER_MINUTE    per address, so a script cannot make it a faucet
 *
 * Nothing is remembered. No history row, no personality, no usage record —
 * a demo is not an account, and a visitor who never signs up should leave
 * nothing behind.
 */
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import type { AudioFormat } from "../../../shared/types/api.js";
import { getConfig } from "../config.js";
import { runPipeline } from "../pipeline/index.js";
import { estimateDurationSeconds } from "../pipeline/stt.js";
import { SITE_UI } from "../experience/catalog.js";

const FORMATS: AudioFormat[] = ["wav", "m4a", "webm", "mp3", "ogg", "flac"];

/** Fifteen seconds of anything a browser records, with room to spare. A cap
 *  in bytes as well as seconds, because the seconds cannot be read from every
 *  container and a byte count can be read from all of them. */
const DEMO_MAX_BYTES = 768 * 1024;

const INSTALLERS = {
  win: "Tailzu-Setup.exe",
  mac: "Tailzu.dmg",
  linux: "Tailzu.AppImage",
} as const;

/**
 * A page from the published site, or null if that file is not there.
 *
 * THE SITE WINS OVER THE BUILT-IN COPY. /privacy, /terms and /download have
 * lived in this repo as HTML strings since before there was a site, and they
 * still do — but once a file of the same name is published they are the
 * fallback, not the answer. That makes the whole site editable in one place
 * and one language, without the legal text ever being unreachable: delete the
 * file and the built-in page is back.
 *
 * Read per request rather than cached, because the point of the bind mount is
 * that an scp is live without a restart, and these are a few kilobytes.
 */
export function sitePage(siteDir: string, name: string): string | null {
  // The names are ours, never a request's, but path.join with something that
  // climbs is the kind of thing that only stays safe while nobody edits it.
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  try {
    return fs.readFileSync(path.join(siteDir, `${name}.html`), "utf8");
  } catch {
    return null;
  }
}

/**
 * Where the auth callback page hands the session to the app. The one scheme
 * every build has always claimed — the keyboard opens the app on it — so it
 * is the one that can be relied on without a new binary.
 */
export const AUTH_RESUME_SCHEME_URL = "tulmi://auth/callback";

/**
 * THE LANDING PAGE FOR GOOGLE SIGN-IN ON ANDROID.
 *
 * Supabase finishes Google and redirects here with the session in the URL
 * FRAGMENT. A fragment never leaves the browser: this server does not receive
 * it, does not log it, and cannot — the page is a static string with nothing
 * of the request interpolated into it, which a test holds it to. The script
 * reads the fragment on the device and hands it to the app on tulmi://, where
 * the deep-link router already knows how to adopt a session.
 *
 * It bounces by script AND offers a button, because a custom-scheme
 * navigation without a tap is the one thing some browsers refuse; the tap is
 * the way through when they do.
 */
export const AUTH_CALLBACK_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>Tailzu</title>
<style>
  html { background: #0F0D0B; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #F3E2C6; background: #0F0D0B; }
  .w { text-align: center; padding: 24px; }
  p { margin: 0 0 18px; color: rgba(243,226,198,.62); }
  a { display: inline-block; padding: 14px 26px; border-radius: 999px; background: #F3E2C6; color: #0F0D0B;
      font-weight: 600; text-decoration: none; }
</style>
</head>
<body>
<div class="w">
  <p id="m">Signed in. Opening Tailzu.</p>
  <a id="go" href="${AUTH_RESUME_SCHEME_URL}">Open Tailzu</a>
</div>
<script>
(function () {
  var t = "${AUTH_RESUME_SCHEME_URL}" + location.search + location.hash;
  document.getElementById("go").href = t;
  try { location.replace(t); } catch (e) {}
  setTimeout(function () {
    document.getElementById("m").textContent = "Tap to return to Tailzu.";
  }, 1800);
})();
</script>
</body>
</html>
`;

export function registerDemoRoutes(app: FastifyInstance, opts: {
  downloadsDir: string;
  siteDir: string;
}): void {
  const { downloadsDir, siteDir } = opts;

  // --- Google sign-in's way back into the app --------------------------
  // Served whether or not AUTH_GOOGLE_WEB is on: the switch decides whether
  // the app is SENT here, and a page that is reachable a minute before the
  // switch is flipped costs nothing. no-store, because whatever is in the
  // URL is a session and must not sit in a cache.
  app.get("/auth/callback", async (_req, reply) => {
    reply.type("text/html; charset=utf-8");
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    return AUTH_CALLBACK_HTML;
  });

  // --- The page ----------------------------------------------------------
  app.get("/", async (_req, reply) => {
    const file = path.join(siteDir, "index.html");
    let html: string | null = null;
    try { html = fs.readFileSync(file, "utf8"); } catch { html = null; }
    if (html === null) {
      // Until a site is published the apex is not a blank page and not a
      // 404; it is the one page that already exists.
      return reply.redirect("/download", 302);
    }
    reply.type("text/html; charset=utf-8");
    // Short, so a republished page is live within a minute without anyone
    // having to remember a cache bump for a static file.
    reply.header("Cache-Control", "public, max-age=60");
    return html;
  });

  // The one stylesheet the published pages share. Served by hand rather than
  // through a static mount at "/" so it cannot shadow an API route.
  app.get("/site.css", async (_req, reply) => {
    let css: string | null = null;
    try { css = fs.readFileSync(path.join(siteDir, "site.css"), "utf8"); } catch { css = null; }
    if (css === null) return reply.code(404).send({ code: "not_found" });
    reply.type("text/css; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=60");
    return css;
  });

  // --- The words, and what is on the shelf ---------------------------------
  app.get("/v1/site", async (_req, reply) => {
    const cfg = getConfig();
    const downloads: Record<string, boolean> = {};
    for (const [key, name] of Object.entries(INSTALLERS)) {
      downloads[key] = fs.existsSync(path.join(downloadsDir, name));
    }
    reply.header("Cache-Control", "public, max-age=60");
    return {
      copy: SITE_UI,
      freeWords: Math.max(0, cfg.FREE_MONTHLY_WORDS),
      downloads,
      demo: cfg.DEMO_ENABLED,
      maxSeconds: cfg.DEMO_MAX_SECONDS,
      // The rate the demo route enforces, so the developers' card can say
      // it rather than guess it.
      perMinute: Math.max(1, cfg.DEMO_PER_MINUTE),
    };
  });

  // --- The demo ------------------------------------------------------------
  const cfg = getConfig();
  app.post("/v1/demo/transcribe", {
    config: { rateLimit: { max: Math.max(1, cfg.DEMO_PER_MINUTE), timeWindow: 60_000 } },
  }, async (req, reply) => {
    if (!getConfig().DEMO_ENABLED) {
      return reply.code(404).send({ code: "demo_off", message: "The live demo is off." });
    }

    let audio: Buffer | null = null;
    let format: AudioFormat | null = null;
    for await (const part of req.parts()) {
      if (part.type !== "file") continue;
      const ext = part.filename?.split(".").pop()?.toLowerCase() as AudioFormat | undefined;
      format = ext && FORMATS.includes(ext) ? ext : "webm";
      audio = await part.toBuffer();
      break;
    }
    if (!audio || !format) {
      return reply.code(400).send({ code: "bad_request", message: "Missing 'audio' file" });
    }
    if (audio.length > DEMO_MAX_BYTES) {
      return reply.code(413).send({ code: "too_long", message: "Keep it under fifteen seconds." });
    }
    const seconds = estimateDurationSeconds(audio, format);
    if (seconds > getConfig().DEMO_MAX_SECONDS) {
      return reply.code(413).send({ code: "too_long", message: "Keep it under fifteen seconds." });
    }

    const t0 = Date.now();
    try {
      const result = await runPipeline({
        audio,
        format,
        targetApp: "Generic",
        language: "auto",
        tone: "none",
      });
      return reply.send({
        transcript: result.transcript,
        cleanedText: result.cleanedText,
        ms: Date.now() - t0,
      });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "internal", message: "Pipeline failed" });
    }
  });
}
