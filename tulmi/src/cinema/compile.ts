/**
 * FROM A SHOT CARD TO THE WORDS A MODEL READS. One card, written once by the director, becomes these prompts:
 *
 *   the LOOK    (lookPrompt) one key-art frame of the whole film, made once: every still gets it as its style reference, so the colour and
 *               the light do not drift from one still to the next
 *   the STILL   (stillPrompt) the opening frame, composed like a film still. Each person's and the place's reference sheet go with it as
 *               reference images, each named by its number and given ONE role in the words ("the face and clothes of Ravi"; "the look only:
 *               do not copy what is in it"), so a face is the same face in every shot
 *   the MOTION  (motionPrompt) for the video model, which starts from that approved still. It says what CHANGES (the camera's one move, the
 *               action in order, the lines, the sound) and where the shot ENDS, and almost nothing of what is already in the picture:
 *               re-describing the still is what makes faces drift and clothes change half-way through a shot
 *
 * The rules every motion prompt follows (from what the video models weigh, and what the open prompting guides for them agree on):
 *   - the subject and the action first: a model weighs the start of a prompt most
 *   - one camera move and its lens; never a list of moves
 *   - the shot's last moment named ("Ends on: ..."): a model animates towards the ending it is given
 *   - the words that make a picture worse taken out (cinematic, epic, stunning, masterpiece...): they push towards a generic look
 *   - no model names, durations or aspect ratios in the words: those are the request's fields
 *   - the sound said in the model's own way, and "no music" wherever it makes its own sound: the film's music is added in the cut
 *
 * Each family reads its prompt a little differently (models.ts Dialect):
 *   veo       camera first; lines as `Ravi says: "..."`; `Audio:` and `SFX:` set apart
 *   kling     short and motion-led; lines as `[Ravi]: "..."` after a visible action
 *   seedance  labelled parts; a long or busy shot is written as a timeline (STARTING STATE, TIMELINE with every second covered, ENDING STATE)
 *   runway    very short: camera, then motion; no sound
 *   wan, hailuo, generic   subject and action, camera, ending, sound
 * When a prompt is over its model's cap, the least important parts go first (light, then sound), never the action or the ending.
 *
 * Fingerprints. `stillPrint` is what is seen in the first frame, `takePrint` adds what moves, `voicePrint` is what a voice-over is recorded
 * from. A change to a card makes again only what it touches: a new line of dialogue is a new take from the same still; a new wardrobe is a
 * new still and then a new take.
 */
import { createHash } from "node:crypto";
import type { Dialect } from "./models.js";
import type { Aspect, Bible, Character, Move, Place, ShotCard } from "./types.js";

const SIZE_WORDS: Record<ShotCard["size"], string> = {
  "extreme-wide": "extreme wide shot",
  wide: "wide shot",
  full: "full shot",
  medium: "medium shot",
  "medium-close": "medium close-up",
  close: "close-up",
  "extreme-close": "extreme close-up",
  insert: "insert shot",
};

const ANGLE_WORDS: Record<ShotCard["angle"], string> = {
  eye: "eye-level",
  low: "low angle",
  high: "high angle",
  overhead: "overhead top-down",
  dutch: "dutch angle",
  pov: "point-of-view",
};

const MOVE_WORDS: Record<Move, string> = {
  static: "the camera holds completely still",
  pan: "a slow pan",
  tilt: "a slow tilt",
  "dolly-in": "a slow dolly in",
  "dolly-out": "a slow dolly out",
  truck: "a lateral truck move",
  tracking: "the camera tracks with the subject",
  crane: "a rising crane move",
  orbit: "a slow orbit around the subject",
  handheld: "handheld, with subtle natural shake",
  zoom: "a slow push-in zoom",
  drone: "a smooth aerial drone glide",
};

const PACE = ["almost still, only subtle movement", "gentle, unhurried movement", "steady, purposeful movement", "fast, energetic movement"] as const;

/** Words that make a generated picture more generic, not better. */
const EMPTY_WORDS = /\b(cinematic|epic|stunning|masterpiece|breathtaking|award[- ]winning|beautiful lighting|dynamic camera|ultra[- ]realistic|hyper[- ]realistic|8k|4k)\b,?\s*/gi;

/** Takes the empty words out, and tidies what is left. */
export function plain(s: string): string {
  return s.replace(EMPTY_WORDS, "").replace(/\s+([,.;:])/g, "$1").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ").trim();
}

const castOf = (card: ShotCard, bible: Bible): Character[] => card.cast.map((k) => bible.characters.find((c) => c.key === k)).filter((c): c is Character => !!c);
const placeOf = (card: ShotCard, bible: Bible): Place | null => bible.places.find((p) => p.key === card.place) ?? null;
const sentence = (s: string): string => {
  const t = s.trim();
  return t ? `${t[0]!.toUpperCase()}${t.slice(1)}${/[.!?"]$/.test(t) ? "" : "."}` : "";
};

/** A reference image and the one thing it is for. */
export interface Ref { key: string; role: string }

/** The reference images a still is made with, in the order its prompt names them: each person in the shot, the place, then the look frame. */
export function stillRefs(card: ShotCard, bible: Bible, max: number): Ref[] {
  const out: Ref[] = [];
  for (const c of castOf(card, bible)) if (c.ref) out.push({ key: c.ref, role: `the face, hair, build and clothes of ${c.name}; not the background or the pose` });
  const p = placeOf(card, bible);
  if (p?.ref) out.push({ key: p.ref, role: `the place, ${p.name}; not any people in it` });
  if (bible.lookRef) out.push({ key: bible.lookRef, role: "the colour grade, the light and the film texture only; do not copy anything in it" });
  return out.slice(0, Math.max(0, max));
}

/** The look frame: one key-art picture of the whole film. */
export function lookPrompt(bible: Bible): string {
  const kind = bible.style === "animated" ? `Key art in the style of ${bible.look.stock}` : `Key art still, ${bible.look.stock}`;
  return plain(`${kind}, for a ${bible.genre || "short film"}: ${bible.logline} Palette: ${bible.look.palette}. Light: ${bible.look.light}. Lens: ${bible.look.lens}. Mood: ${bible.tone}. No text, logos or watermarks.`);
}

/** The still: the opening frame as a film still, each reference image named by its number and its role. */
export function stillPrompt(card: ShotCard, bible: Bible, maxRefs: number): string {
  const refs = stillRefs(card, bible, maxRefs);
  const kind = bible.style === "animated" ? `Animated film frame, ${bible.look.stock}` : `Film still, ${bible.look.stock}`;
  const parts = [
    `${kind}. ${sentence(`${SIZE_WORDS[card.size]}, ${ANGLE_WORDS[card.angle]}, ${card.lens}mm lens, ${bible.look.lens}`)}`,
    sentence(card.frame),
  ];
  for (const c of castOf(card, bible)) parts.push(sentence(`${c.name}: ${c.look}; wearing ${c.wardrobe}`));
  const p = placeOf(card, bible);
  if (p) parts.push(sentence(`Setting: ${p.name}, ${p.look}`));
  parts.push(sentence(`Light: ${card.light}; ${bible.look.light}. Palette: ${bible.look.palette}`));
  refs.forEach((r, i) => parts.push(`Reference image ${i + 1}: ${r.role}.`));
  if (refs.some((r) => r.role.startsWith("the face"))) parts.push("Keep each person exactly as in their reference image.");
  parts.push(card.text ? `The words "${card.text}" are clearly readable in frame; no other text.` : "No text, captions, logos or watermarks.");
  return plain(parts.filter(Boolean).join(" "));
}

/** A reference sheet for a character: the same person from the front and at three-quarters, on a plain background. */
export function characterSheetPrompt(c: Character, bible: Bible): string {
  const kind = bible.style === "animated" ? `Character model sheet in the style of ${bible.look.stock}` : "Photographic character reference sheet";
  return plain(`${kind}. ${c.name}: ${c.look}; wearing ${c.wardrobe}. Two views side by side of the same person: front view and three-quarter view, head to waist, neutral expression, even soft studio light, plain light-grey background. No text, no labels.`);
}

/** A reference plate for a place: the location empty, in the film's light and palette. */
export function placeSheetPrompt(p: Place, bible: Bible): string {
  const kind = bible.style === "animated" ? `Background painting in the style of ${bible.look.stock}` : `Location plate, ${bible.look.stock}`;
  return plain(`${kind}. ${p.name}: ${p.look}. Wide view, no people. Light: ${bible.look.light}. Palette: ${bible.look.palette}. No text, no labels.`);
}

interface Part { text: string; weight: number }

export interface MotionOpts {
  dialect: Dialect;
  maxChars: number;
  /** Whether the model makes its own sound for this take (route.ts wantsAudio). */
  audio: boolean;
  seconds: number;
  /** A correction carried from a failed take (qc.ts). */
  fix?: string | null;
}

/** The motion prompt for a dialect: what changes from the approved still, and where the shot ends. */
export function motionPrompt(card: ShotCard, bible: Bible, o: MotionOpts): string {
  const who = (k: string) => bible.characters.find((c) => c.key === k)?.name ?? k;
  const camera = sentence(`${MOVE_WORDS[card.move]}, ${SIZE_WORDS[card.size]}, ${card.lens}mm`);
  const action = `${sentence(card.action)} ${sentence(PACE[card.motion])}`;
  const end = card.end ? `Ends on: ${sentence(card.end)}` : "";
  const keep = card.cast.length ? "Keep every face, hairstyle and piece of clothing exactly as in the first frame." : "";
  const carry = card.link === "continue" ? "Carry the motion on seamlessly from the first frame and arrive exactly at the last frame." : "";
  const fix = o.fix ? `Important: ${sentence(o.fix)}` : "";
  const text = card.text ? `The words "${card.text}" stay sharp and readable.` : "";
  const light = card.light ? `Light: ${sentence(card.light)}` : "";
  const veoLines = card.lines.map((l) => `${who(l.who)} says: "${l.text}"`).join(" ");
  const klingLines = card.lines.map((l) => `[${who(l.who)}]: "${l.text}"`).join(" Immediately, ");
  const ambience = card.sound.trim();

  let parts: Part[];
  switch (o.dialect) {
    case "veo":
      parts = [
        { text: camera, weight: 10 },
        { text: action, weight: 10 },
        { text: veoLines, weight: 9 },
        { text: end, weight: 9 },
        { text: fix, weight: 9 },
        { text: carry, weight: 8 },
        { text: keep, weight: 7 },
        { text, weight: 7 },
        { text: o.audio ? `Audio: ${ambience || "natural room tone"}. SFX: only what is seen. No music, no subtitles.` : "", weight: 4 },
        { text: light, weight: 2 },
      ];
      break;
    case "kling":
      parts = [
        { text: action, weight: 10 },
        { text: camera, weight: 10 },
        { text: klingLines, weight: 9 },
        { text: end, weight: 9 },
        { text: fix, weight: 9 },
        { text: carry, weight: 8 },
        { text: keep, weight: 7 },
        { text, weight: 7 },
      ];
      break;
    case "runway":
      parts = [
        { text: camera, weight: 10 },
        { text: action, weight: 10 },
        { text: end, weight: 9 },
        { text: fix, weight: 9 },
        { text: carry, weight: 8 },
        { text: keep, weight: 7 },
        { text, weight: 7 },
      ];
      break;
    case "seedance":
      parts = card.motion >= 2 || o.seconds >= 8
        ? [
          { text: `STARTING STATE: the first frame as given. CAMERA: ${camera}`, weight: 10 },
          { text: `TIMELINE: ${timeline(card, o.seconds)}`, weight: 10 },
          { text: veoLines, weight: 9 },
          { text: `ENDING STATE: ${card.end ? sentence(card.end) : "the action settles and holds."}`, weight: 9 },
          { text: fix, weight: 9 },
          { text: carry, weight: 8 },
          { text: `CONTINUITY: ${keep || "the place stays as in the first frame."}`, weight: 7 },
          { text, weight: 7 },
          { text: o.audio ? `AUDIO: ${ambience || "natural ambience"}; no music.` : "", weight: 4 },
          { text: light, weight: 2 },
        ]
        : [
          { text: action, weight: 10 },
          { text: `Camera: ${camera}`, weight: 10 },
          { text: veoLines, weight: 9 },
          { text: end, weight: 9 },
          { text: fix, weight: 9 },
          { text: carry, weight: 8 },
          { text: keep, weight: 7 },
          { text, weight: 7 },
          { text: o.audio ? `Audio: ${ambience || "natural ambience"}; no music.` : "", weight: 4 },
          { text: light, weight: 2 },
        ];
      break;
    default:
      parts = [
        { text: action, weight: 10 },
        { text: camera, weight: 10 },
        { text: veoLines, weight: 9 },
        { text: end, weight: 9 },
        { text: fix, weight: 9 },
        { text: carry, weight: 8 },
        { text: keep, weight: 7 },
        { text, weight: 7 },
        { text: o.audio ? `Sound: ${ambience || "natural ambience"}; no music.` : "", weight: 4 },
        { text: light, weight: 2 },
      ];
  }
  return fit(parts.map((p) => ({ ...p, text: plain(p.text) })), o.maxChars);
}

/** A busy shot as a timeline with every second covered: the action, then a settling moment, so the ending does not drift. */
function timeline(card: ShotCard, seconds: number): string {
  const settle = Math.min(2, Math.max(1, Math.round(seconds * 0.2)));
  const act = Math.max(1, seconds - settle);
  return `[0-${act}s] ${sentence(card.action)} [${act}-${seconds}s] the movement settles and holds.`;
}

/** Joins the parts in their order, dropping the lightest until it fits; the heaviest part is cut at a word if it alone is over. */
function fit(parts: Part[], maxChars: number): string {
  let keep = parts.filter((p) => p.text.trim());
  const join = (ps: Part[]) => ps.map((p) => p.text.trim()).join(" ");
  while (join(keep).length > maxChars && keep.length > 1) {
    const lightest = keep.reduce((a, b) => (b.weight < a.weight ? b : a));
    keep = keep.filter((p) => p !== lightest);
  }
  const out = join(keep);
  if (out.length <= maxChars) return out;
  const cut = out.slice(0, maxChars);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), maxChars - 20)).trim();
}

const print = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

/** What is seen in a shot's first frame: a change here needs a new still. */
export function stillPrint(card: ShotCard, bible: Bible, aspect: Aspect): string {
  const cast = castOf(card, bible).map((c) => [c.key, c.look, c.wardrobe]);
  const place = placeOf(card, bible);
  return print([aspect, bible.style, bible.look, card.size, card.angle, card.lens, card.frame, card.light, card.text, cast, place ? [place.key, place.look] : null]);
}

/** What a take is made from: its still and what moves. `before` is the chosen take of the shot before, for a shot that continues it. */
export function takePrint(card: ShotCard, bible: Bible, aspect: Aspect, before: string | null): string {
  return print([stillPrint(card, bible, aspect), card.move, card.action, card.end, card.seconds, card.lines, card.sound, card.link, card.motion, card.physics, card.pin, card.link === "continue" ? before : null]);
}

/** What a voice-over is recorded from. */
export function voicePrint(card: ShotCard, bible: Bible, voice: string): string | null {
  return card.vo ? print([card.vo, bible.language, voice]) : null;
}
