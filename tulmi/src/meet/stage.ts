/**
 * THE STAGE, THE MEETING BOT'S VOICE (docs/meet.md). Recall's bot shows a web page of ours as its camera (Output Media), and the sound of
 * that page is what the call hears. This file is the page and the in-memory hub that feeds it.
 *
 *   MemoryStageHub     per meeting: the pages that are open (one server-sent event stream each), the spoken answers waiting to be fetched,
 *                      and the one answer playing now. play() tells every page to fetch a clip and resolves when a page says it ended,
 *                      when it is stopped, or after its length plus some slack (the length guessed from the mp3's size at 48 kbit/s);
 *                      a play() while another clip is playing waits its turn. Clips are forgotten five minutes after they were made,
 *                      or a minute after they were done. A page whose send fails is dropped, never an error for the others.
 *   stageHub()         the server's shared hub (routes and the meeting engine both use it)
 *   stageHtml(o)       the page itself: one self-contained document for a 1280x720 camera, with the bot's mark, its name, what it is doing
 *                      and, while it speaks, what it says. It listens on <base>/events and reports each clip's end to <base>/clips/<id>/done.
 */
import { randomBytes } from "node:crypto";
import type { ClipInput, StageHub } from "./types.js";

type Send = (event: "say" | "stop" | "state", data: Record<string, unknown>) => void;
type Result = "played" | "stopped" | "no_stage";

interface Options { now?: () => number; clipTtlMs?: number; slackMs?: number; maxPlayMs?: number }

interface Kept { audio: Buffer; contentType: string; expires: number }
interface Playing { id: string; resolve: (r: Result) => void; timer: ReturnType<typeof setTimeout> }
interface Waiting { clip: ClipInput; resolve: (r: Result) => void }
interface Meeting {
  pages: Set<Send>;
  label: string | null;
  clips: Map<string, Kept>;
  current: Playing | null;
  queue: Waiting[];
}

/** An mp3 at 48 kbit/s is 6000 bytes a second. */
const BYTES_PER_SECOND = 6000;
const AFTER_DONE_MS = 60_000;

export class MemoryStageHub implements StageHub {
  private readonly meetings = new Map<string, Meeting>();
  private readonly now: () => number;
  private readonly clipTtlMs: number;
  private readonly slackMs: number;
  private readonly maxPlayMs: number;

  constructor(o: Options = {}) {
    this.now = o.now ?? Date.now;
    this.clipTtlMs = o.clipTtlMs ?? 5 * 60_000;
    this.slackMs = o.slackMs ?? 5000;
    this.maxPlayMs = o.maxPlayMs ?? 90_000;
  }

  private get(id: string): Meeting {
    let m = this.meetings.get(id);
    if (!m) { m = { pages: new Set(), label: null, clips: new Map(), current: null, queue: [] }; this.meetings.set(id, m); }
    return m;
  }

  /** Forgets the clips whose time is up, in every meeting. */
  private prune(): void {
    const t = this.now();
    for (const m of this.meetings.values()) {
      for (const [id, k] of m.clips) if (k.expires <= t) m.clips.delete(id);
    }
  }

  /** Writes one event to every page; a page that throws is dropped. */
  private broadcast(m: Meeting, event: "say" | "stop" | "state", data: Record<string, unknown>): void {
    for (const send of [...m.pages]) {
      try { send(event, data); } catch { m.pages.delete(send); }
    }
  }

  connected(meetingId: string): boolean {
    return (this.meetings.get(meetingId)?.pages.size ?? 0) > 0;
  }

  speaking(meetingId: string): boolean {
    return this.meetings.get(meetingId)?.current != null;
  }

  open(meetingId: string, send: Send): () => void {
    this.prune();
    const m = this.get(meetingId);
    m.pages.add(send);
    if (m.label != null) {
      try { send("state", { label: m.label }); } catch { m.pages.delete(send); }
    }
    return () => {
      const mm = this.meetings.get(meetingId);
      if (!mm) return;
      mm.pages.delete(send);
      if (mm.pages.size === 0 && mm.current) this.finish(mm, mm.current.id, "stopped");
    };
  }

  play(meetingId: string, clip: ClipInput): Promise<Result> {
    this.prune();
    const m = this.get(meetingId);
    if (m.pages.size === 0) return Promise.resolve("no_stage");
    return new Promise<Result>((resolve) => {
      if (m.current) m.queue.push({ clip, resolve });
      else this.start(m, clip, resolve);
    });
  }

  /** Makes the clip current: kept for the pages to fetch, announced to them, and timed out after its length plus slack. */
  private start(m: Meeting, clip: ClipInput, resolve: (r: Result) => void): void {
    if (m.pages.size === 0) { resolve("no_stage"); this.next(m); return; }
    const id = randomBytes(8).toString("hex");
    m.clips.set(id, { audio: clip.audio, contentType: clip.contentType, expires: this.now() + this.clipTtlMs });
    const estimate = Math.ceil(clip.audio.length / BYTES_PER_SECOND) * 1000 + this.slackMs;
    const timer = setTimeout(() => this.finish(m, id, "played"), Math.min(estimate, this.maxPlayMs));
    if (typeof timer === "object" && "unref" in timer) timer.unref();
    m.current = { id, resolve, timer };
    this.broadcast(m, "say", { id, text: clip.text });
  }

  /** Ends the current clip if it is this one, then lets the next waiting clip go. */
  private finish(m: Meeting, id: string, result: Result, startNext = true): void {
    const cur = m.current;
    if (!cur || cur.id !== id) return;
    clearTimeout(cur.timer);
    m.current = null;
    const kept = m.clips.get(id);
    if (kept) kept.expires = Math.min(kept.expires, this.now() + AFTER_DONE_MS);
    cur.resolve(result);
    if (startNext) this.next(m);
  }

  private next(m: Meeting): void {
    while (!m.current) {
      const w = m.queue.shift();
      if (!w) return;
      this.start(m, w.clip, w.resolve);
    }
  }

  stop(meetingId: string): void {
    const m = this.meetings.get(meetingId);
    if (!m) return;
    this.broadcast(m, "stop", {});
    const dropped = m.queue.splice(0);
    if (m.current) this.finish(m, m.current.id, "stopped", false);
    for (const w of dropped) w.resolve("stopped");
  }

  state(meetingId: string, label: string): void {
    const m = this.get(meetingId);
    m.label = label;
    this.broadcast(m, "state", { label });
  }

  clip(meetingId: string, clipId: string): { audio: Buffer; contentType: string } | null {
    this.prune();
    const k = this.meetings.get(meetingId)?.clips.get(clipId);
    return k ? { audio: k.audio, contentType: k.contentType } : null;
  }

  done(meetingId: string, clipId: string, how: "ended" | "stopped"): void {
    this.prune();
    const m = this.meetings.get(meetingId);
    if (!m) return;
    this.finish(m, clipId, how === "ended" ? "played" : "stopped");
  }

  close(meetingId: string): void {
    const m = this.meetings.get(meetingId);
    if (!m) return;
    this.broadcast(m, "stop", {});
    const dropped = m.queue.splice(0);
    if (m.current) this.finish(m, m.current.id, "stopped", false);
    for (const w of dropped) w.resolve("stopped");
    this.meetings.delete(meetingId);
  }
}

let shared: StageHub | null = null;
/** The server's shared hub. */
export function stageHub(): StageHub {
  return (shared ??= new MemoryStageHub());
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** A string as a JavaScript literal that is safe inside a script element. */
function jsString(s: string): string {
  return JSON.stringify(s).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Eight dots round a circle, a little different in size, as the bot's mark. */
function mark(): string {
  const sizes = [11, 14, 10, 13, 12, 15, 10, 13];
  const dots = sizes.map((r, i) => {
    const a = (Math.PI * 2 * i) / sizes.length - Math.PI / 2;
    const x = (90 + 66 * Math.cos(a)).toFixed(1);
    const y = (90 + 66 * Math.sin(a)).toFixed(1);
    return `<circle class="dot" style="animation-delay:${(i * 0.12).toFixed(2)}s" cx="${x}" cy="${y}" r="${r}"/>`;
  }).join("");
  return `<svg id="mark" width="180" height="180" viewBox="0 0 180 180" fill="#111110" aria-hidden="true">${dots}</svg>`;
}

/** The page Recall's bot shows as its camera. */
export function stageHtml(o: { token: string; botName: string; owner: string }): string {
  const idle = o.owner ? `Taking notes for ${o.owner}` : "Taking notes";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1280, initial-scale=1">
<title>${esc(o.botName)}</title>
<style>
  html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; background: #f6f5f2; color: #111110; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  #mark { display: block; margin-bottom: 18px; }
  #name { font-size: 68px; font-weight: 800; line-height: 1.1; max-width: 1180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #status { margin-top: 10px; font-size: 42px; font-weight: 500; line-height: 1.2; color: #6d6a63; max-width: 1180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #caption { margin-top: 22px; max-width: 1120px; font-size: 46px; font-weight: 800; line-height: 1.2;
    overflow: hidden; text-overflow: ellipsis; display: none; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
  #caption.on { display: -webkit-box; }
  .dot { transform-box: fill-box; transform-origin: center; }
  body.speaking .dot { animation: pulse 1.1s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.35); opacity: 0.7; } }
</style>
</head>
<body>
${mark()}
<div id="name">${esc(o.botName)}</div>
<div id="status">${esc(idle)}</div>
<div id="caption"></div>
<script>
(function () {
  var TOKEN = ${jsString(o.token)};
  var IDLE = ${jsString(idle)};
  var base = "/v1/meet/stage/" + TOKEN;
  var statusEl = document.getElementById("status");
  var captionEl = document.getElementById("caption");
  var label = IDLE;
  var audio = null;
  var playingId = null;

  function show() {
    document.body.className = playingId ? "speaking" : "";
    statusEl.textContent = playingId ? "Speaking" : label;
    if (!playingId) { captionEl.className = ""; captionEl.textContent = ""; }
  }
  function report(id, how) {
    try {
      fetch(base + "/clips/" + id + "/done", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ how: how }) }).catch(function () {});
    } catch (e) {}
  }
  function finish(id, how) {
    if (playingId !== id) return;
    playingId = null;
    audio = null;
    report(id, how);
    show();
  }

  var source = new EventSource(base + "/events");
  source.addEventListener("say", function (ev) {
    var d;
    try { d = JSON.parse(ev.data); } catch (e) { return; }
    if (!d || !d.id) return;
    if (audio) { try { audio.pause(); } catch (e) {} if (playingId) report(playingId, "stopped"); }
    var id = d.id;
    playingId = id;
    captionEl.textContent = d.text || "";
    captionEl.className = d.text ? "on" : "";
    show();
    var a = new Audio(base + "/clips/" + id);
    audio = a;
    a.addEventListener("ended", function () { finish(id, "ended"); });
    a.addEventListener("error", function () { finish(id, "stopped"); });
    var p = a.play();
    if (p && p.catch) p.catch(function () { finish(id, "stopped"); });
  });
  source.addEventListener("stop", function () {
    if (audio) { try { audio.pause(); } catch (e) {} }
    if (playingId) finish(playingId, "stopped");
    else show();
  });
  source.addEventListener("state", function (ev) {
    try { var d = JSON.parse(ev.data); if (d && typeof d.label === "string") { label = d.label; show(); } } catch (e) {}
  });
})();
</script>
</body>
</html>
`;
}
