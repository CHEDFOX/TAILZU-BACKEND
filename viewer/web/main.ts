/**
 * The artifact viewer's runtime. It lives in the page the app embeds in a sandboxed iframe, talks to the app only by postMessage
 * (protocol.ts), and draws the artifact the app sends.
 *
 * This file is the small part that is always loaded: the message loop, the bridge, errors, point-and-change, the renderers for
 * markup that need no libraries. The compiler, React, Mermaid and the rest are imported when a particular artifact needs them.
 */
import { LIMITS, PROTOCOL_VERSION, type ArtifactPayload, type ArtifactType, type DesignKitCss, type FrameMsg, type HostMsg } from "../../tulmi/src/artifacts/protocol.js";
import { OPEN_GAP_MS, openableUrl } from "../lib/links.js";
import { originAllowed, parseOrigins } from "../lib/origins.js";
import { utf8Length } from "../lib/text.js";
import { createBridge } from "./bridge.js";
import { clearSources, createReporter, ViewerError } from "./errors.js";
import { instrument, watchHeight, type SelectState } from "./instrument.js";
import { applyTheme, installKit } from "./kit.js";
import { makeOverlay } from "./overlay.js";
import { createHtmlRenderer } from "./render/html.js";
import { createMarkdownRenderer } from "./render/markdown.js";
import { createMermaidRenderer } from "./render/mermaid.js";
import { createReactRenderer } from "./render/react.js";
import { createSvgRenderer } from "./render/svg.js";
import type { Page, Renderer } from "./render/types.js";

const DEBOUNCE_MS = 150;
const MAX_WAIT_MS = 400;
const TYPES: readonly ArtifactType[] = ["html", "react", "svg", "mermaid", "markdown"];

// ------------------------------------------------------------------------------------------------ who may talk to us

const parents = parseOrigins(document.querySelector('meta[name="tz-parents"]')?.getAttribute("content"), { opaque: true });
let parentOrigin: string | null = null;

/** A message to a parent with an opaque origin ("null") can only be addressed to "*": the browser takes no other target for it. It still goes to window.parent, whoever that is. */
const targetOf = (origin: string): string => (origin === "null" ? "*" : origin);

/**
 * Where `ready` can be sent. The embedding page's origin, when the browser tells us (ancestorOrigins, or the referrer) and it is an
 * allowed one; otherwise every exact origin in the list (the browser delivers it only to the one that matches).
 */
function readyTargets(): string[] {
  const hints = [(location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins?.[0]];
  try {
    if (document.referrer) hints.push(new URL(document.referrer).origin);
  } catch {
    /* no referrer */
  }
  const known = hints.filter((h): h is string => !!h && originAllowed(h, parents));
  return known.length ? [...new Set(known)] : parents.filter((o) => !o.includes("*"));
}

function post(m: FrameMsg): void {
  if (window.parent === window) return; // opened on its own: there is nobody to tell
  for (const o of parentOrigin ? [parentOrigin] : readyTargets()) {
    try {
      window.parent.postMessage(m, targetOf(o));
    } catch {
      /* a target that is not the parent: the browser drops it */
    }
  }
}

// ------------------------------------------------------------------------------------------------ the page

const root = document.getElementById("root") as HTMLElement;
const frames = document.getElementById("tz-frames") as HTMLElement;
const importMapText = document.querySelector('script[type="importmap"]')?.textContent ?? '{"imports":{}}';
const allowed = new Set(Object.keys((JSON.parse(importMapText) as { imports: Record<string, string> }).imports).filter((k) => !k.startsWith("@tz/")));

const reporter = createReporter(post);
const bridge = createBridge(post, (message) => reporter.report("limit", message));
const select: SelectState = { on: false };

const showOverlay = makeOverlay(document);
const hover = (el: Element | null): void => showOverlay(select.on ? el : null);

let stopWatching: (() => void) | null = null;
let watched: Window | null = null;

const page: Page = {
  root,
  frames,
  reporter,
  instrument: { bridge, reporter, select, post, hover },
  allowed,
  importMapText,
  surfaceChanged(win) {
    if (win === watched) return;
    stopWatching?.();
    watched = win;
    stopWatching = watchHeight(win, (height) => post({ t: "resize", height }));
  },
};

instrument(window, page.instrument);

const factories: Record<ArtifactType, (p: Page) => Renderer> = {
  html: createHtmlRenderer,
  react: createReactRenderer,
  svg: createSvgRenderer,
  mermaid: createMermaidRenderer,
  markdown: createMarkdownRenderer,
};
const renderers: Partial<Record<ArtifactType, Renderer>> = {};
const rendererFor = (type: ArtifactType): Renderer => (renderers[type] ??= factories[type](page));

function disposeAll(): void {
  for (const t of TYPES) renderers[t]?.dispose();
  stopWatching?.();
  stopWatching = null;
  watched = null;
  hover(null);
}

// ------------------------------------------------------------------------------------------------ what is shown

interface Session {
  artifact: ArtifactPayload;
  kit: DesignKitCss | undefined;
  theme: "light" | "dark";
  final: boolean;
  /** Changes with every `load`: a render that began under an older one is over. */
  gen: number;
}

let session: Session | null = null;
let gen = 0;
let systemDark = false;
try {
  systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
} catch {
  /* no matchMedia */
}
applyTheme(document, systemDark ? "dark" : "light");

let timer: ReturnType<typeof setTimeout> | undefined;
let firstDirty = 0;
let running = false;
let again = false;
let arrival: number | null = null;

function schedule(immediate: boolean, at: number): void {
  if (immediate) {
    clearTimeout(timer);
    timer = undefined;
    firstDirty = 0;
    arrival = at;
    void kick();
    return;
  }
  const now = performance.now();
  if (!firstDirty) firstDirty = now;
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    firstDirty = 0;
    void kick();
  }, Math.min(DEBOUNCE_MS, Math.max(0, firstDirty + MAX_WAIT_MS - now)));
}

async function kick(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      await renderOnce();
    } while (again);
  } finally {
    running = false;
  }
}

async function renderOnce(): Promise<void> {
  const s = session;
  if (!s) return;
  const t0 = arrival ?? performance.now();
  arrival = null;
  const myGen = s.gen;
  const stale = (): boolean => session?.gen !== myGen;
  if (s.artifact.content.trim() === "") {
    // Nothing written yet (a `load` that opens the page before the first `stream`): an empty page, not an error.
    renderers[s.artifact.type]?.dispose();
    stopWatching?.();
    stopWatching = null;
    watched = null;
    post({ t: "rendered", version: s.artifact.version, ms: Math.round(performance.now() - t0) });
    return;
  }
  try {
    await rendererFor(s.artifact.type).render({ src: s.artifact.content, final: s.final, artifact: s.artifact, theme: s.theme, kit: s.kit, t0, isStale: stale });
    if (!stale()) post({ t: "rendered", version: s.artifact.version, ms: Math.round(performance.now() - t0) });
  } catch (e) {
    if (stale()) return;
    // A half-written source fails to compile all the time; that is not news until it is finished.
    if (!s.final && !(e instanceof ViewerError && e.kind === "limit")) return;
    reporter.reportError(e, e instanceof ViewerError ? e.kind : "runtime");
  }
}

// ------------------------------------------------------------------------------------------------ messages from the app

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function tooBig(content: string): boolean {
  if (content.length <= LIMITS.contentBytes / 3 || utf8Length(content) <= LIMITS.contentBytes) return false;
  reporter.report("limit", `The artifact is ${utf8Length(content)} bytes; the limit is ${LIMITS.contentBytes}.`);
  return true;
}

function onLoad(m: Record<string, unknown>, at: number): void {
  const a = m.artifact;
  if (!isObj(a) || typeof a.id !== "string" || typeof a.version !== "number" || typeof a.content !== "string" || !TYPES.includes(a.type as ArtifactType)) {
    reporter.report("runtime", "The app sent a `load` message that is not a valid artifact.");
    return;
  }
  const artifact: ArtifactPayload = { id: a.id, version: a.version, type: a.type as ArtifactType, title: typeof a.title === "string" ? a.title : "", content: a.content };
  const same = session !== null && session.artifact.id === artifact.id && session.artifact.type === artifact.type;
  if (!same) {
    disposeAll();
    bridge.reset();
    clearSources();
  }
  reporter.reset();
  const theme = m.theme === "dark" || m.theme === "light" ? m.theme : session?.theme ?? (systemDark ? "dark" : "light");
  const kit = isObj(m.kit) && typeof m.kit.css === "string" ? (m.kit as unknown as DesignKitCss) : undefined;
  session = { artifact, kit, theme, final: true, gen: ++gen };
  applyTheme(document, theme);
  installKit(document, kit);
  if (tooBig(artifact.content)) {
    session.artifact = { ...artifact, content: "" };
    return;
  }
  schedule(true, at);
}

function onStream(m: Record<string, unknown>, at: number): void {
  if (!session || typeof m.content !== "string") return;
  const done = m.done === true;
  if (tooBig(m.content)) return;
  session.artifact = { ...session.artifact, content: m.content };
  session.final = done;
  schedule(done, at);
}

// ------------------------------------------------------------------------------------------------ html artifacts' frames

/** An html artifact's frame speaks to us (web/frame.ts). What it says for the app is checked here and passed on; it is untrusted. */
const UP_KINDS = new Set(["compile", "runtime", "import", "limit"]);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

let lastOpenRelayed = -Infinity;

function relayUp(raw: unknown, visible: boolean): void {
  if (!isObj(raw)) return;
  switch (raw.t) {
    case "open": {
      // An address to open, from a frame the artifact controls: the frame has checked it, and the shell does it again, once in a while, for the visible frame only.
      const url = visible ? openableUrl(raw.url) : null;
      const now = performance.now();
      if (url && now - lastOpenRelayed >= OPEN_GAP_MS) {
        lastOpenRelayed = now;
        post({ t: "open", url });
      }
      break;
    }
    case "error":
      if (typeof raw.message === "string" && typeof raw.kind === "string" && UP_KINDS.has(raw.kind)) {
        reporter.report(raw.kind as "compile", raw.message, { line: num(raw.line), col: num(raw.col), stack: typeof raw.stack === "string" ? raw.stack : undefined });
      }
      break;
    case "select":
      if (typeof raw.elementId === "string" && typeof raw.tag === "string" && typeof raw.text === "string" && isObj(raw.rect)) {
        const r = raw.rect;
        post({ t: "select", elementId: raw.elementId.slice(0, 64), tag: raw.tag.slice(0, 64), text: raw.text.slice(0, 200), rect: { x: num(r.x) ?? 0, y: num(r.y) ?? 0, w: num(r.w) ?? 0, h: num(r.h) ?? 0 } });
      }
      break;
    case "storage":
      if (typeof raw.reqId === "string" && (raw.op === "get" || raw.op === "set" || raw.op === "delete" || raw.op === "list")) {
        const json = raw.op === "set" ? JSON.stringify(raw.value) : "";
        if (json !== undefined && utf8Length(json) > LIMITS.storageValueBytes) {
          reporter.report("limit", `Storage value is ${utf8Length(json)} bytes; the limit is ${LIMITS.storageValueBytes}.`);
          break;
        }
        post({ t: "storage", reqId: raw.reqId.slice(0, 64), op: raw.op, ...(typeof raw.key === "string" ? { key: raw.key.slice(0, 256) } : {}), ...(raw.op === "set" ? { value: raw.value } : {}), shared: raw.shared === true });
      }
      break;
    case "ask":
      if (typeof raw.reqId === "string" && typeof raw.prompt === "string" && raw.prompt.length <= LIMITS.askChars) post({ t: "ask", reqId: raw.reqId.slice(0, 64), prompt: raw.prompt });
      break;
    case "download":
      if (typeof raw.name === "string" && typeof raw.mime === "string" && typeof raw.dataBase64 === "string" && raw.dataBase64.length <= Math.ceil((LIMITS.downloadBytes * 4) / 3) + 8) {
        post({ t: "download", name: raw.name.slice(0, 120), mime: raw.mime.slice(0, 100), dataBase64: raw.dataBase64 });
      }
      break;
    case "resize":
      if (visible && num(raw.height) !== undefined) post({ t: "resize", height: Math.ceil(num(raw.height)!) });
      break;
  }
}

function frameFor(source: MessageEventSource | null): HTMLIFrameElement | null {
  for (const f of Array.from(frames.children)) if ((f as HTMLIFrameElement).contentWindow === source) return f as HTMLIFrameElement;
  return null;
}

function toFrames(message: object): void {
  for (const f of Array.from(frames.children)) (f as HTMLIFrameElement).contentWindow?.postMessage({ tz: 1, ...message }, "*");
}

window.addEventListener("message", (e: MessageEvent) => {
  const at = performance.now();
  const frame = frameFor(e.source);
  if (frame) {
    const d = e.data as { tz?: number; k?: string; msg?: unknown } | null;
    if (d?.tz === 1 && d.k === "up") relayUp(d.msg, frame.style.visibility === "visible");
    return;
  }
  if (e.source !== window.parent || !originAllowed(e.origin, parents)) return;
  if (parentOrigin && e.origin !== parentOrigin) return;
  const m = e.data as unknown;
  if (!isObj(m) || typeof m.t !== "string") return;
  parentOrigin = e.origin;
  switch ((m as HostMsg).t) {
    case "load":
      onLoad(m, at);
      break;
    case "stream":
      onStream(m, at);
      break;
    case "select-mode":
      select.on = m.on === true;
      document.documentElement.toggleAttribute("data-tz-select", select.on);
      toFrames({ k: "select", on: select.on });
      if (!select.on) hover(null);
      break;
    case "storage-result":
    case "ask-result":
      if (typeof m.reqId === "string") {
        bridge.handle(m as Extract<HostMsg, { t: "storage-result" | "ask-result" }>);
        toFrames({ k: "down", msg: m }); // an html artifact's frame has its own pending calls
      }
      break;
  }
});

// An artifact that sends this frame somewhere else (location.href = …) takes it out of the viewer's hands: the app must not trust the
// frame afterwards, and is told so while the old page can still speak.
window.addEventListener("pagehide", (e) => {
  if (!e.persisted) reporter.report("runtime", "The artifact navigated the viewer away from itself. This frame can no longer be trusted: discard it and open the artifact in a new one.");
});

// Tell the app we are here. It answers with `load`.
for (const o of readyTargets()) {
  try {
    if (window.parent !== window) window.parent.postMessage({ t: "ready", protocol: PROTOCOL_VERSION } satisfies FrameMsg, targetOf(o));
  } catch {
    /* not the parent's origin */
  }
}
