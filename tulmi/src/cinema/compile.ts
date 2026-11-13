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
 * Detail is where the result comes from: the director writes every shot card in full (the intent, the acting as visible cues, the camera
 * move with its speed and focus, the composition in layers, the light setup, the atmosphere, the ending, the sound, each person's voice;
 * plan.ts), and every field reaches the model that can use it:
 *   - the STILL carries everything that is SEEN: the shot, lens and depth of field, the scene and its layers, each person in full (face, hair,
 *     marks, build, every garment), the place, the atmosphere, the light setup, the palette, the grade, the texture, the mood, the purpose,
 *     the references' roles and a quality lock (skin, eyes, hands, perspective). Image models read long, labelled prompts well
 *   - the MOTION carries everything that MOVES, in the words each video model weighs: the action and its pace, the acting cues, the one
 *     camera move with its speed, direction and focus, the atmosphere moving, the physics, the lines with how they are spoken, the sound, the
 *     ending, the purpose. Never a re-description of the still: that is what makes faces drift and clothes change
 *
 * The rules every motion prompt follows (from what the video models weigh, and what the open prompting guides for them agree on):
 *   - the subject and the action first: a model weighs the start of a prompt most
 *   - one camera move, its speed and its lens; never a list of moves
 *   - the shot's last moment named ("Ends on: ..."): a model animates towards the ending it is given
 *   - the words that make a picture worse taken out (cinematic, epic, stunning, masterpiece...): they push towards a generic look
 *   - no model names, durations or aspect ratios in the words: those are the request's fields
 *   - the sound said in the model's own way, and "no music" wherever it makes its own sound: the film's music is added in the cut
 *
 * Each family reads its prompt a little differently (models.ts Dialect), and each has the length it reads best (models.ts maxPrompt):
 *   veo       camera first, then the action and the acting; lines as `Ravi says in a low, warm voice: "..."`; `Audio:` set apart
 *   kling     motion-led and tighter; lines as `[Ravi, low warm voice]: "..."` after a visible action
 *   seedance  labelled parts; a long or busy shot as a timeline (STARTING STATE, beats with every second covered and a settling moment,
 *             ENDING STATE, CONTINUITY, AUDIO)
 *   runway    camera, then motion, then the ending; no sound
 *   wan, hailuo, generic   the action and the acting, the camera, the ending, the atmosphere, the sound
 * When a prompt is over its model's cap, the least important parts go first (light, sound, purpose, atmosphere), never the action, the
 * camera or the ending.
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

/** Depth of field by shot size: a wide holds everything sharp; a close-up lets the background fall away. */
const DEPTH: Record<ShotCard["size"], string> = {
  "extreme-wide": "deep focus, everything sharp from foreground to horizon",
  wide: "deep focus",
  full: "deep focus with a gently softened background",
  medium: "moderate depth of field, the background slightly soft",
  "medium-close": "shallow depth of field, the background in soft bokeh",
  close: "shallow depth of field, focus on the eyes, the background melting into bokeh",
  "extreme-close": "very shallow depth of field, a thin plane of focus",
  insert: "shallow depth of field, the object crisp, everything else soft",
};

/** Words that make a generated picture more generic, not better. */
const EMPTY_WORDS = /\b(cinematic|epic|stunning|masterpiece|breathtaking|award[- ]winning|beautiful lighting|dynamic camera|ultra[- ]realistic|hyper[- ]realistic|8k|4k)\b,?\s*/gi;

/** Takes the empty words out, and tidies what is left. */
export function plain(s: string): string {
  return s.replace(EMPTY_WORDS, "").replace(/\s+([,.;:])/g, "$1").replace(/,\s*,/g, ",").replace(/([.:;])\s*[.:;]+/g, "$1").replace(/\s{2,}/g, " ").trim();
}

const castOf = (card: ShotCard, bible: Bible): Character[] => card.cast.map((k) => bible.characters.find((c) => c.key === k)).filter((c): c is Character => !!c);
const placeOf = (card: ShotCard, bible: Bible): Place | null => bible.places.find((p) => p.key === card.place) ?? null;
/** A field that films written before it existed do not have. */
const f = (s: string | null | undefined): string => (s ?? "").trim();
const sentence = (s: string): string => {
  const t = s.trim();
  return t ? `${t[0]!.toUpperCase()}${t.slice(1)}${/[.!?"]$/.test(t) ? "" : "."}` : "";
};
/** A description carried on after a name: "the chai stall, a tin-roofed stall…". */
const after = (s: string): string => (s && /^[A-Z][a-z]/.test(s) ? `${s[0]!.toLowerCase()}${s.slice(1)}` : s);
/** "Label: text." or nothing when the text is empty. */
const labelled = (label: string, s: string | null | undefined): string => (f(s) ? `${label}: ${sentence(f(s))}` : "");

/** What makes a picture hold up, by style: skin, eyes, hands, perspective; or clean, on-model drawing. */
const QUALITY: Record<Bible["style"], string> = {
  live: "Quality: photographic realism, natural skin texture with pores and fine detail, realistic eyes with catchlights, anatomically correct hands with five fingers, true-to-life fabric and materials, coherent perspective and scale.",
  animated: "Quality: clean, consistent character design and line work, on-model proportions, readable silhouettes, coherent perspective, no stray marks.",
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

const lookLines = (b: Bible): string[] => [
  labelled("Palette", b.look.palette),
  labelled("Colour grade", f(b.look.grade)),
  labelled("Texture", [b.look.stock, f(b.look.texture)].filter(Boolean).join("; ")),
];

/** The look frame: one key-art picture of the whole film, the reference every still takes its colour, light and texture from. */
export function lookPrompt(bible: Bible): string {
  const kind = bible.style === "animated" ? `Key art for the ${bible.genre || "film"}, in the style of ${bible.look.stock}` : `Key art film still for the ${bible.genre || "film"}, ${bible.look.stock}`;
  return plain([
    `${kind}. ${sentence(bible.logline)}`,
    "One striking composition with clear depth: a foreground element, the heart of the story in the middle, the world behind.",
    labelled("Light", bible.look.light),
    labelled("Lens", bible.look.lens),
    ...lookLines(bible),
    labelled("Mood", bible.tone),
    QUALITY[bible.style],
    "No text, logos or watermarks.",
  ].filter(Boolean).join(" "));
}

/** The still: the opening frame as a film still, in full, each reference image named by its number and its role. */
export function stillPrompt(card: ShotCard, bible: Bible, maxRefs: number): string {
  const refs = stillRefs(card, bible, maxRefs);
  const kind = bible.style === "animated" ? `Animated film frame, ${bible.look.stock}` : `Film still, ${bible.look.stock}`;
  const p = placeOf(card, bible);
  const parts = [
    `${kind}. ${sentence(`${SIZE_WORDS[card.size]}, ${ANGLE_WORDS[card.angle]}, ${card.lens}mm lens, ${DEPTH[card.size]}${bible.look.lens ? `; ${bible.look.lens}` : ""}`)}`,
    labelled("Scene", card.frame),
    labelled("Composition", f(card.composition)),
    ...castOf(card, bible).map((c) => `${c.name}: ${sentence(c.look)} Wearing: ${sentence(c.wardrobe)}`),
    p ? `Setting: ${sentence(`${p.name}, ${after(p.look)}`)}` : "",
    labelled("Atmosphere", f(card.atmosphere)),
    labelled("Lighting", [card.light, bible.look.light].filter(Boolean).join("; overall ")),
    ...lookLines(bible),
    labelled("Mood", bible.tone),
    labelled("Purpose", f(card.intent)),
    ...refs.map((r, i) => `Reference image ${i + 1}: ${r.role}.`),
    refs.some((r) => r.role.startsWith("the face")) ? "Keep each person exactly as in their reference image: the same face, hair, marks, build and clothes." : "",
    QUALITY[bible.style],
    card.text ? `The words "${card.text}" are clearly readable in frame, spelled exactly; no other text.` : "No text, captions, logos or watermarks.",
  ];
  return plain(parts.filter(Boolean).join(" "));
}

/** A reference sheet for a character: the same person from the front and at three-quarters, on a plain background, in full detail. */
export function characterSheetPrompt(c: Character, bible: Bible): string {
  const kind = bible.style === "animated" ? `Character model sheet in the style of ${bible.look.stock}` : "Photographic character reference sheet";
  return plain([
    `${kind} of ${c.name}: two views side by side of the same person on one sheet, a front view and a three-quarter view, head to mid-thigh, relaxed neutral pose, neutral expression, eyes to camera.`,
    labelled("Look", c.look),
    labelled("Wearing", c.wardrobe),
    bible.style === "animated"
      ? "Flat, even light; clean line work; identical design, colours and proportions in both views."
      : "85mm lens at f/8, soft even studio key light from front left with a gentle fill, true-to-life skin tones and fabric texture, identical face, hair and clothes in both views.",
    "Plain light-grey seamless background. No text, no labels, no props.",
  ].filter(Boolean).join(" "));
}

/** A reference plate for a place: the location empty, in the film's light, palette and grade, every material and prop in view. */
export function placeSheetPrompt(p: Place, bible: Bible): string {
  const kind = bible.style === "animated" ? `Background painting of ${p.name}, in the style of ${bible.look.stock}` : `Location plate of ${p.name}, ${bible.look.stock}`;
  return plain([
    `${kind}. ${sentence(p.look)}`,
    "Wide establishing view at eye level, 24mm lens, deep focus, no people; every material, prop and texture described clearly visible.",
    labelled("Light", bible.look.light),
    ...lookLines(bible),
    QUALITY[bible.style].replace(/realistic eyes with catchlights, anatomically correct hands with five fingers, /, ""),
    "No text, no labels.",
  ].filter(Boolean).join(" "));
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

/** The motion prompt for a dialect: what changes from the approved still, how it is acted and filmed, how it sounds, where it ends. */
export function motionPrompt(card: ShotCard, bible: Bible, o: MotionOpts): string {
  const person = (k: string) => bible.characters.find((c) => c.key === k);
  const camera = sentence(`${f(card.camera) || MOVE_WORDS[card.move]}; ${SIZE_WORDS[card.size]}, ${card.lens}mm`);
  const action = `${sentence(card.action)} ${sentence(PACE[card.motion])}`;
  const acting = f(card.performance);
  const end = f(card.end) ? `Ends on: ${sentence(f(card.end))}` : "";
  const keep = card.cast.length ? "Keep every face, hairstyle and piece of clothing exactly as in the first frame; the same people throughout." : "";
  const carry = card.link === "continue" ? "Carry the motion on seamlessly from the first frame and arrive exactly at the last frame." : "";
  const fix = o.fix ? `Important: ${sentence(o.fix)}` : "";
  const text = card.text ? `The words "${card.text}" stay sharp and readable.` : "";
  const light = f(card.light) ? `Light: ${sentence(f(card.light))}` : "";
  const air = f(card.atmosphere);
  const physics = card.physics ? "Physics: real weight and momentum; water, cloth, hair and smoke move naturally and stay consistent." : "";
  const crowd = card.crowd ? "Background people move naturally and independently; no merging or repeated faces." : "";
  const intent = f(card.intent) ? `Purpose: ${sentence(f(card.intent))}` : "";
  const sound = f(card.sound);
  const said = (l: { who: string; text: string }) => {
    const c = person(l.who);
    const voice = f(c?.voice);
    return `${c?.name ?? l.who} says${voice ? ` in a ${voice.replace(/\.$/, "")} voice` : ""}: "${l.text}"`;
  };
  const veoLines = card.lines.map(said).join(" ");
  const klingLines = card.lines.map((l) => {
    const c = person(l.who);
    const voice = f(c?.voice);
    return `[${c?.name ?? l.who}${voice ? `, ${voice.replace(/\.$/, "")}` : ""}]: "${l.text}"`;
  }).join(" Immediately, ");

  let parts: Part[];
  switch (o.dialect) {
    case "veo":
      parts = [
        { text: `Camera: ${camera}`, weight: 10 },
        { text: action, weight: 10 },
        { text: acting ? `Performance: ${sentence(acting)}` : "", weight: 8 },
        { text: veoLines, weight: 9 },
        { text: end, weight: 9 },
        { text: fix, weight: 9 },
        { text: carry, weight: 8 },
        { text: keep, weight: 7 },
        { text, weight: 7 },
        { text: air ? `Atmosphere: ${sentence(air)}` : "", weight: 6 },
        { text: physics, weight: 6 },
        { text: crowd, weight: 5 },
        { text: intent, weight: 5 },
        { text: o.audio ? `Audio: ${sound ? sentence(sound).replace(/\.$/, "") : "natural room tone and only the sounds of what is seen"}. No music, no subtitles.` : "", weight: 4 },
        { text: light, weight: 3 },
      ];
      break;
    case "kling":
      parts = [
        { text: action, weight: 10 },
        { text: acting ? sentence(acting) : "", weight: 8 },
        { text: `Camera: ${camera}`, weight: 10 },
        { text: klingLines, weight: 9 },
        { text: end, weight: 9 },
        { text: fix, weight: 9 },
        { text: carry, weight: 8 },
        { text: keep, weight: 7 },
        { text, weight: 7 },
        { text: air ? sentence(air) : "", weight: 6 },
        { text: physics, weight: 6 },
        { text: crowd, weight: 5 },
      ];
      break;
    case "runway":
      parts = [
        { text: `Camera: ${camera}`, weight: 10 },
        { text: action, weight: 10 },
        { text: acting ? sentence(acting) : "", weight: 8 },
        { text: end, weight: 9 },
        { text: fix, weight: 9 },
        { text: carry, weight: 8 },
        { text: keep, weight: 7 },
        { text, weight: 7 },
        { text: air ? sentence(air) : "", weight: 6 },
        { text: physics, weight: 6 },
      ];
      break;
    case "seedance":
      parts = card.motion >= 2 || o.seconds >= 8 || card.action.split(/[.;]/).filter((x) => x.trim()).length > 1
        ? [
          { text: `STARTING STATE: the first frame as given. CAMERA: ${camera}`, weight: 10 },
          { text: `TIMELINE: ${timeline(card, o.seconds)}`, weight: 10 },
          { text: acting ? `PERFORMANCE: ${sentence(acting)}` : "", weight: 8 },
          { text: veoLines, weight: 9 },
          { text: `ENDING STATE: ${f(card.end) ? sentence(f(card.end)) : "the action settles and holds."}`, weight: 9 },
          { text: fix, weight: 9 },
          { text: carry, weight: 8 },
          { text: `CONTINUITY: ${keep || "the place and its light stay as in the first frame."}`, weight: 7 },
          { text, weight: 7 },
          { text: air ? `ATMOSPHERE: ${sentence(air)}` : "", weight: 6 },
          { text: physics.replace(/^Physics:/, "PHYSICS:"), weight: 6 },
          { text: crowd, weight: 5 },
          { text: intent.replace(/^Purpose:/, "PURPOSE:"), weight: 5 },
          { text: o.audio ? `AUDIO: ${sound ? sentence(sound).replace(/\.$/, "") : "natural ambience"}; no music.` : "", weight: 4 },
          { text: light.replace(/^Light:/, "LIGHT:"), weight: 3 },
        ]
        : [
          { text: action, weight: 10 },
          { text: acting ? `Performance: ${sentence(acting)}` : "", weight: 8 },
          { text: `Camera: ${camera}`, weight: 10 },
          { text: veoLines, weight: 9 },
          { text: end, weight: 9 },
          { text: fix, weight: 9 },
          { text: carry, weight: 8 },
          { text: keep, weight: 7 },
          { text, weight: 7 },
          { text: air ? `Atmosphere: ${sentence(air)}` : "", weight: 6 },
          { text: physics, weight: 6 },
          { text: crowd, weight: 5 },
          { text: intent, weight: 5 },
          { text: o.audio ? `Audio: ${sound ? sentence(sound).replace(/\.$/, "") : "natural ambience"}; no music.` : "", weight: 4 },
          { text: light, weight: 3 },
        ];
      break;
    default:
      parts = [
        { text: action, weight: 10 },
        { text: acting ? `Performance: ${sentence(acting)}` : "", weight: 8 },
        { text: `Camera: ${camera}`, weight: 10 },
        { text: veoLines, weight: 9 },
        { text: end, weight: 9 },
        { text: fix, weight: 9 },
        { text: carry, weight: 8 },
        { text: keep, weight: 7 },
        { text, weight: 7 },
        { text: air ? `Atmosphere: ${sentence(air)}` : "", weight: 6 },
        { text: physics, weight: 6 },
        { text: crowd, weight: 5 },
        { text: intent, weight: 5 },
        { text: o.audio ? `Sound: ${sound ? sentence(sound).replace(/\.$/, "") : "natural ambience"}; no music.` : "", weight: 4 },
        { text: light, weight: 3 },
      ];
  }
  return fit(parts.map((p) => ({ ...p, text: plain(p.text) })), o.maxChars);
}

/** The action's beats, in order: its sentences (each keeps its own subject). At most three. */
export function beatsOf(action: string): string[] {
  const out = action.split(/(?<=[.;])\s+/).map((s) => s.trim().replace(/[.;,]+$/, "")).filter(Boolean);
  if (out.length <= 3) return out;
  return [out[0]!, out.slice(1, -1).join(", "), out.at(-1)!];
}

/** A busy shot as a timeline with every second covered: each beat its share of the time, then a settling moment, so the ending does not drift. */
function timeline(card: ShotCard, seconds: number): string {
  const beats = beatsOf(card.action);
  const settle = Math.min(2, Math.max(1, Math.round(seconds * 0.2)));
  const act = Math.max(1, seconds - settle);
  const each = act / Math.max(1, beats.length);
  const at = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  const parts = beats.map((b, i) => `[${at(Math.round(i * each * 10) / 10)}-${at(Math.round((i + 1) * each * 10) / 10)}s] ${sentence(b)}`);
  return `${parts.join(" ")} [${at(act)}-${seconds}s] The movement settles and holds.`;
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
  return print([aspect, bible.style, bible.look, bible.tone, card.size, card.angle, card.lens, card.frame, f(card.composition), f(card.atmosphere), card.light, f(card.intent), card.text, cast, place ? [place.key, place.look] : null]);
}

/** What a take is made from: its still and what moves. `before` is the chosen take of the shot before, for a shot that continues it. */
export function takePrint(card: ShotCard, bible: Bible, aspect: Aspect, before: string | null): string {
  const voices = card.lines.map((l) => f(bible.characters.find((c) => c.key === l.who)?.voice));
  return print([stillPrint(card, bible, aspect), card.move, f(card.camera), card.action, f(card.performance), card.end, card.seconds, card.lines, voices, card.sound, card.link, card.motion, card.physics, card.crowd, card.pin, card.link === "continue" ? before : null]);
}

/** What a voice-over is recorded from. */
export function voicePrint(card: ShotCard, bible: Bible, voice: string): string | null {
  return card.vo ? print([card.vo, bible.language, voice]) : null;
}
