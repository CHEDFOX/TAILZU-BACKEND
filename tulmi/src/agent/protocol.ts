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
 * where reset links, session ids and one-time tokens live. A selection in an
 * address bar, or with such a URL in it, is dropped whole, since a rewrite of
 * it is pasted back. The desktop does the same before sending; this is the
 * second lock.
 *
 * A step may also carry one picture, read here too: its type is taken from
 * its bytes as well as its label, since the label is only the client's word
 * for it, and the model it goes to refuses a picture that is not what it is
 * called.
 */
import type {
  AgentElement, AgentEvent, AgentPicture, AgentRegion, AgentStepRequest, AgentTurn, AudioFormat,
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
/** e for the tree's elements, o for a line of text read off the window's
 *  pixels. Five digits is forty times the most elements a step may carry. */
const ELEMENT_ID = /^[eo]\d{1,5}$/;
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

/**
 * Some URL in the text has a query or a fragment with something in it. A
 * scheme or "www." is enough to call it a URL; a bare host needs a path, or a
 * query that reads key=value, so "Did you get report.pdf?" and "Done.Ok?Sure"
 * are not taken for one.
 */
const URL_WITH_TAIL = /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.)[^\s?#<>"']*[?#][^\s<>"']|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d+)?(?:\/[^\s?#<>"']*[?#][^\s<>"']|[?#][^\s<>"'=&]+=)/i;

/**
 * The selected text as the planner may see it, or "" when it must not.
 * A browser selects the whole address when its address bar takes focus, so a
 * selection there is the page's URL with its tokens. Any other selection with
 * a URL's query or fragment in it goes too. Neither is cut down instead: a
 * rewrite is pasted over the whole selection, and a copy with the query taken
 * off would paste the link back broken. The desktop drops both before
 * sending; this is the second lock.
 */
function readSelection(selection: string, field: AgentStepRequest["screen"]["field"], elements: AgentElement[]): string {
  const focused = elements.find((e) => e.focused);
  const inAddressBar = field?.kind === "url" || isAddressBar(field?.label)
    || (!!focused && (focused.role === "field" || focused.role === "combo") && isAddressBar(focused.label));
  if (inAddressBar || URL_WITH_TAIL.test(selection)) return "";
  return selection;
}

function readElement(v: unknown): AgentElement | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !ELEMENT_ID.test(o.id)) return null;
  if (o.id.startsWith("o")) return readOcrLine(o.id, o);
  const role = oneLine(o.role, LIMITS.role).toLowerCase().replace(/[^a-z]/g, "");
  if (!role) return null;
  const el: AgentElement = { id: o.id, role };
  // A window's label is its title, and its value the file it has open: both
  // name what the person is working on, which never leaves their computer.
  // The desktop sends a window bare; this is the second lock.
  const aWindow = role === "window";
  const label = aWindow ? "" : withoutUrlSecrets(oneLine(o.label, LIMITS.label));
  if (label) el.label = label;
  const value = aWindow ? "" : withoutUrlSecrets(oneLine(o.value, LIMITS.value));
  if (value && !isAddressBar(label)) el.value = value;
  if (typeof o.region === "string" && REGIONS.has(o.region as AgentRegion)) el.region = o.region as AgentRegion;
  if (o.focused === true) el.focused = true;
  if (o.disabled === true) el.disabled = true;
  if (o.selected === true) el.selected = true;
  if (typeof o.checked === "boolean") el.checked = o.checked;
  return el;
}

/**
 * A line the device read off the window's picture: its words and where it
 * is, and nothing else. It is text whatever the client called it, and it has
 * no value or state, because OCR sees neither; a line with no words in it is
 * nothing to point at.
 */
function readOcrLine(id: string, o: Record<string, unknown>): AgentElement | null {
  const label = withoutUrlSecrets(oneLine(o.label, LIMITS.label));
  if (!label) return null;
  const el: AgentElement = { id, role: "text", label };
  if (typeof o.region === "string" && REGIONS.has(o.region as AgentRegion)) el.region = o.region as AgentRegion;
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
 * `hasImage`: a picture came with it, which `picture` then describes; without
 * one, `picture` describes nothing and is dropped.
 */
export function readStepRequest(
  raw: unknown,
  caps: Caps,
  hasAudio = false,
  hasImage = false,
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
  if (typeof s.text === "string" && s.text.trim()) screen.text = withoutUrlSecrets(block(s.text));
  const f = s.field as Record<string, unknown> | undefined;
  if (f && typeof f === "object") {
    const kind = oneLine(f.kind, 16).toLowerCase();
    const label = withoutUrlSecrets(oneLine(f.label, LIMITS.fieldLabel));
    if (kind) screen.field = label ? { kind, label } : { kind };
  }
  // After the field, which says whether the selection is an address bar's.
  if (typeof s.selection === "string" && s.selection.trim()) {
    const selection = readSelection(block(s.selection), screen.field, elements);
    if (selection) screen.selection = selection;
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
  if (hasImage) req.picture = readPictureInfo(o.picture);
  return { req };
}

/** What the picture is a crop of. Anything but one image on the screen is
 *  taken to be the window, which is the larger claim and the safer one. */
function readPictureInfo(v: unknown): AgentPicture {
  const region = v && typeof v === "object" ? (v as Record<string, unknown>).region : undefined;
  return { region: region === "element" ? "element" : "window" };
}

export const PICTURE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PictureType = (typeof PICTURE_TYPES)[number];

/** The one picture a step carries, as read: its type is its bytes'. */
export interface AgentImage {
  mime: PictureType;
  data: Buffer;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A picture's type by its first bytes, or null when it is none of the three. */
export function sniffPicture(b: Buffer): PictureType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(PNG_MAGIC)) return "image/png";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * The `image` part as the picture path may use it, or why it is refused.
 * `data` is null when the part ran past `maxBytes` (it was read to its end
 * and dropped, never held whole). Its declared type must be one of the three,
 * and its bytes must be a picture of one of them; the bytes' type is the one
 * the model is told, so a PNG labelled JPEG still arrives as what it is.
 */
export function readPicture(
  declared: string | undefined,
  data: Buffer | null,
  maxBytes: number,
): { image: AgentImage } | { refusal: Refusal } {
  if (!data) return tooBig(`the picture is over ${maxBytes} bytes`);
  const type = (declared ?? "").split(";")[0]!.trim().toLowerCase();
  if (!(PICTURE_TYPES as readonly string[]).includes(type)) return bad("the picture is a JPEG, PNG or WebP");
  const mime = sniffPicture(data);
  if (!mime) return bad("the picture is not a JPEG, PNG or WebP image");
  return { image: { mime, data } };
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

const TERMINAL = new Set<AgentEvent["t"]>(["action", "ask", "look", "approve", "done", "error"]);

/**
 * The one way events leave a step: in order, one JSON object per line, and
 * never anything after the first terminal event. The route closes the stream
 * once a step has finished; this makes "exactly one terminal" true of every
 * path through the planner rather than a property each path must remember.
 *
 * The same goes for a step's sentences: the first say is the answer, and
 * every say after it is marked `append`, the next sentence of that answer,
 * so the card grows as the model writes instead of each sentence replacing
 * the last. Marked here, on the way out, so a sentence the server adds of its
 * own after the model's is marked like the model's.
 */
export class EventSink {
  private finished = false;
  private sent = 0;
  private says = 0;
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
    if (e.t === "say") {
      e = { t: "say", text: e.text, ...(e.locale ? { locale: e.locale } : {}), ...(this.says > 0 ? { append: true } : {}) };
      this.says += 1;
    }
    if (TERMINAL.has(e.t)) {
      this.finished = true;
      this.ending = e.t === "error" ? `error:${e.code}` : e.t === "action" ? `action:${e.kind}` : e.t;
    }
    this.sent += 1;
    this.write(JSON.stringify(e) + "\n");
  }
}
