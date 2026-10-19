/**
 * ASK'S WIRE: what one step request may carry, and how its answer is sent.
 *
 * Every field in a step came off somebody's screen or out of their mouth, so
 * it is read rather than trusted. The big ones (the element list, the
 * selection, the window text, the history) are refused with a 413 when they
 * are over their caps, because each is prompt the user would pay for without
 * knowing it. The small ones (a label, a value, a note) are cut to length in
 * place: a 90-character menu title is not worth failing a run over.
 *
 * Two kinds of value never reach the prompt as sent. An address bar's value is
 * dropped, and every URL loses its query string and fragment, because that is
 * where reset links, session ids and one-time tokens live. The desktop does
 * the same before sending; this is the second lock.
 */
import type {
  AgentElement, AgentEvent, AgentRegion, AgentStepRequest, AgentTurn, AudioFormat,
} from "../../../shared/types/api.js";
import { elementLine } from "./prompt.js";

export type { AgentElement, AgentEvent, AgentStepRequest, AgentTurn };

/** The contract's ceilings. The element count and the whole screen's size come
 *  from config (AGENT_MAX_ELEMENTS, AGENT_SCREEN_MAX_CHARS). */
export const LIMITS = {
  utterance: 1000,
  selection: 8000,
  text: 4000,
  history: 16,
  app: 60,
  label: 80,
  value: 120,
  role: 16,
  fieldLabel: 80,
  said: 1000,
  did: 160,
  note: 200,
} as const;

export interface Caps {
  maxElements: number;
  screenMaxChars: number;
}

export interface Refusal {
  status: 400 | 413;
  code: string;
  message: string;
}

const RUN_ID = /^[A-Za-z0-9_-]{6,64}$/;
const ELEMENT_ID = /^e\d{1,6}$/;
const REGIONS = new Set<AgentRegion>(["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"]);
const RESULTS = new Set<NonNullable<AgentTurn["result"]>>(["ok", "failed", "declined", "nochange"]);

/** One line of display text: no control characters, single spaces, cut short. */
export function oneLine(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** A block of text with its lines kept, and nothing else invisible. */
function block(v: string): string {
  return v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ").replace(/[ \t]+\n/g, "\n").trim();
}

/**
 * A URL without its query string or fragment, wherever one appears in the
 * text: "https://x.com/reset?token=…" and a scheme-less "x.com/a?code=…" both
 * keep their host and path. What follows the "?" or "#" is where a page puts
 * the things nobody should read aloud to a model.
 */
const URL_TAIL = /((?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.)[^\s?#<>"']*|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d+)?(?:\/[^\s?#<>"']*)?)[?#][^\s<>"']*/gi;
export function withoutUrlSecrets(s: string): string {
  return s.replace(URL_TAIL, "$1");
}

/** A field that holds the page's address: its value is the URL being visited,
 *  which is the one value on a browser's screen most likely to carry a token. */
const ADDRESS_BAR = /\b(?:address|url|location bar|smart search|omnibox|web address)\b|\bsearch or (?:type|enter)\b/i;
export function isAddressBar(label: string | undefined): boolean {
  return !!label && ADDRESS_BAR.test(label);
}

function readElement(v: unknown): AgentElement | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !ELEMENT_ID.test(o.id)) return null;
  const role = oneLine(o.role, LIMITS.role).toLowerCase().replace(/[^a-z]/g, "");
  if (!role) return null;
  const el: AgentElement = { id: o.id, role };
  const label = withoutUrlSecrets(oneLine(o.label, LIMITS.label));
  if (label) el.label = label;
  const value = withoutUrlSecrets(oneLine(o.value, LIMITS.value));
  if (value && !isAddressBar(label)) el.value = value;
  if (typeof o.region === "string" && REGIONS.has(o.region as AgentRegion)) el.region = o.region as AgentRegion;
  if (o.focused === true) el.focused = true;
  if (o.disabled === true) el.disabled = true;
  if (o.selected === true) el.selected = true;
  if (typeof o.checked === "boolean") el.checked = o.checked;
  return el;
}

function readTurn(v: unknown): AgentTurn | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const turn: AgentTurn = {};
  const said = oneLine(o.said, LIMITS.said);
  if (said) turn.said = said;
  const did = oneLine(o.did, LIMITS.did);
  if (did) turn.did = did;
  if (typeof o.result === "string" && RESULTS.has(o.result as NonNullable<AgentTurn["result"]>)) {
    turn.result = o.result as AgentTurn["result"];
  }
  // A note says what changed on the screen, so it is screen text like any other.
  const note = withoutUrlSecrets(oneLine(o.note, LIMITS.note));
  if (note) turn.note = note;
  return turn.said || turn.did || turn.note ? turn : null;
}

const bad = (message: string): { refusal: Refusal } => ({ refusal: { status: 400, code: "bad_request", message } });
const tooBig = (message: string): { refusal: Refusal } => ({ refusal: { status: 413, code: "too_large", message } });

/**
 * A step request as the planner may use it, or the reason it is refused.
 * `hasAudio`: an audio file came with it, which is then the utterance.
 */
export function readStepRequest(
  raw: unknown,
  caps: Caps,
  hasAudio = false,
): { req: AgentStepRequest } | { refusal: Refusal } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("Missing the step request");
  const o = raw as Record<string, unknown>;

  if (typeof o.runId !== "string" || !RUN_ID.test(o.runId)) return bad("runId is 6–64 letters, digits, _ or -");
  if (typeof o.step !== "number" || !Number.isInteger(o.step) || o.step < 0) return bad("step is a whole number from 0");
  if (o.platform !== "mac" && o.platform !== "win") return bad("platform is mac or win");
  if (o.utterance !== undefined && typeof o.utterance !== "string") return bad("utterance is text");
  if (typeof o.utterance === "string" && o.utterance.length > LIMITS.utterance) {
    return tooBig(`utterance exceeds ${LIMITS.utterance} chars`);
  }

  const s = o.screen as Record<string, unknown> | undefined;
  if (!s || typeof s !== "object" || !Array.isArray(s.elements)) return bad("Missing 'screen.elements'");
  if (s.elements.length > caps.maxElements) return tooBig(`screen has more than ${caps.maxElements} elements`);
  if (s.selection !== undefined && typeof s.selection !== "string") return bad("screen.selection is text");
  if (typeof s.selection === "string" && s.selection.length > LIMITS.selection) {
    return tooBig(`screen.selection exceeds ${LIMITS.selection} chars`);
  }
  if (s.text !== undefined && typeof s.text !== "string") return bad("screen.text is text");
  if (typeof s.text === "string" && s.text.length > LIMITS.text) return tooBig(`screen.text exceeds ${LIMITS.text} chars`);
  if (o.history !== undefined && !Array.isArray(o.history)) return bad("history is a list");
  if (Array.isArray(o.history) && o.history.length > LIMITS.history) {
    return tooBig(`history has more than ${LIMITS.history} turns`);
  }

  // Ids are the device's and are only meant to be unique; a repeated one would
  // make "point at e12" mean two things, so the first wins.
  const elements: AgentElement[] = [];
  const seen = new Set<string>();
  for (const v of s.elements) {
    const el = readElement(v);
    if (el && !seen.has(el.id)) { seen.add(el.id); elements.push(el); }
  }
  const screen: AgentStepRequest["screen"] = { elements };
  if (typeof s.selection === "string" && s.selection.trim()) screen.selection = block(s.selection);
  if (typeof s.text === "string" && s.text.trim()) screen.text = withoutUrlSecrets(block(s.text));
  const f = s.field as Record<string, unknown> | undefined;
  if (f && typeof f === "object") {
    const kind = oneLine(f.kind, 16).toLowerCase();
    const label = withoutUrlSecrets(oneLine(f.label, LIMITS.fieldLabel));
    if (kind) screen.field = label ? { kind, label } : { kind };
  }

  // The whole screen, measured as the prompt will carry it, so the cap is on
  // what costs money and not on how the JSON happened to be spelled.
  const screenChars = elements.reduce((n, el) => n + elementLine(el).length + 1, 0) + (screen.text?.length ?? 0);
  if (screenChars > caps.screenMaxChars) return tooBig(`screen exceeds ${caps.screenMaxChars} chars`);

  const history = Array.isArray(o.history) ? o.history.map(readTurn).filter((t): t is AgentTurn => !!t) : [];
  const utterance = typeof o.utterance === "string" ? o.utterance.trim() : "";
  // Something has to say what they want: their words, a recording of them, or
  // on a later step the run so far.
  if (!utterance && !hasAudio && !(o.step > 0 && history.some((t) => t.said))) {
    return bad("Missing 'utterance' or 'audio'");
  }

  const req: AgentStepRequest = {
    runId: o.runId,
    step: o.step,
    platform: o.platform,
    app: oneLine(o.app, LIMITS.app),
    screen,
  };
  if (utterance) req.utterance = utterance;
  if (o.privateField === true) req.privateField = true;
  const language = oneLine(o.language, 16);
  if (/^[A-Za-z][A-Za-z-]*$/.test(language)) req.language = language;
  if (typeof o.tzOffsetMinutes === "number" && Number.isFinite(o.tzOffsetMinutes) && Math.abs(o.tzOffsetMinutes) <= 14 * 60) {
    req.tzOffsetMinutes = Math.round(o.tzOffsetMinutes);
  }
  if (history.length) req.history = history;
  return { req };
}

/** The recording's container, from its file name, else its MIME type. The
 *  desktop records webm, so that is what an unnamed part is taken to be. */
export function audioFormatOf(filename: string | undefined, mime: string | undefined): AudioFormat {
  const ext = filename?.split(".").pop()?.toLowerCase();
  const byExt: Record<string, AudioFormat> = { wav: "wav", m4a: "m4a", mp4: "m4a", webm: "webm", mp3: "mp3", ogg: "ogg", oga: "ogg", flac: "flac" };
  if (ext && byExt[ext]) return byExt[ext]!;
  const m = (mime ?? "").toLowerCase();
  if (m.includes("wav") || m.includes("wave")) return "wav";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("flac")) return "flac";
  return "webm";
}

const TERMINAL = new Set<AgentEvent["t"]>(["action", "ask", "done", "error"]);

/**
 * The one way events leave a step: in order, one JSON object per line, and
 * never anything after the first terminal event. The route closes the stream
 * once a step has finished; this makes "exactly one terminal" true of every
 * path through the planner rather than a property each path must remember.
 */
export class EventSink {
  private finished = false;
  private sent = 0;
  /** How the step ended, for the log: "action", "done", "error:private"… */
  ending: string | undefined;
  /** The run's mode, from its heard event: in show mode nothing acts. */
  mode: "show" | "do" | undefined;

  constructor(private readonly write: (line: string) => void) {}

  get ended(): boolean { return this.finished; }
  /** Events sent so far, the heard event included. */
  get count(): number { return this.sent; }

  emit(e: AgentEvent): void {
    if (this.finished) return;
    if (e.t === "heard") this.mode = e.mode;
    // The planner never builds an action in show mode; this is what makes that
    // a guarantee and not a habit.
    if (e.t === "action" && this.mode === "show") e = { t: "done" };
    if (TERMINAL.has(e.t)) {
      this.finished = true;
      this.ending = e.t === "error" ? `error:${e.code}` : e.t === "action" ? `action:${e.kind}` : e.t;
    }
    this.sent += 1;
    this.write(JSON.stringify(e) + "\n");
  }
}
