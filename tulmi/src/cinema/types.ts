/**
 * THE CINEMA BOT'S SHAPES (docs/cinema.md): a film from the idea to the finished cut. Every part of src/cinema, routes/bots/cinema.ts and the
 * screens agree through these.
 *
 * A film goes through these steps, and the person is asked twice before money that matters is spent:
 *
 *   writing    the director writes the bible (who, where, the look) and the shot list from the idea
 *   script     the person reads it, changes anything in plain words, and approves it        <- asked: the script
 *   boarding   reference sheets for each person and place, then one still per shot (cheap)
 *   board      the storyboard and the price of the film                                      <- asked: the price
 *   rendering  each shot animated from its approved still by the model that suits it, checked by eye (a vision model), retaken when it fails
 *   cutting    the takes cut together with the voice-over, the music and the subtitles
 *   done       one film, ready to share; any shot can still be changed on its own
 *
 * A film can also be `failed` (something we could not get past) or `stopped` (the person stopped it). Money is in paise, as everywhere.
 */

export const CINEMA_SLUG = "cinema";
/** The film page's screen id (experience/bots/ids.ts SCREENS.cinemaFilm), params { f }. */
export const CINEMA_FILM_SCREEN = "bots.cinema.film";

export type Aspect = "16:9" | "9:16" | "1:1";
export const ASPECTS: readonly Aspect[] = ["16:9", "9:16", "1:1"];

/** How good, and how dear: the models a film may use (models.ts). */
export type Tier = "draft" | "standard" | "premium";
export const TIERS: readonly Tier[] = ["draft", "standard", "premium"];

export type FilmStatus = "writing" | "script" | "boarding" | "board" | "rendering" | "cutting" | "done" | "failed" | "stopped";

/** Why a film that should be moving is waiting: for more money, or for the person to look at a shot we could not get right. */
export type Hold = "budget" | "shot" | null;

export type Style = "live" | "animated";

export interface Look {
  /** Colours, a few words: "teal and amber, deep shadows". */
  palette: string;
  /** The light of the film: "soft window light, warm practicals". */
  light: string;
  /** The camera's feel: "anamorphic, shallow depth of field". */
  lens: string;
  /** The film stock or the animation's look: "35mm film grain", "hand-painted 2D". */
  stock: string;
  /** The colour grade: "warm highlights, teal shadows, gentle contrast, lifted blacks". */
  grade: string;
  /** The texture of the image: "fine grain, soft halation on highlights, slight lens bloom". */
  texture: string;
}

export interface Character {
  /** Its handle in the shot list: lower case, a-z 0-9 and hyphens. */
  key: string;
  name: string;
  /** Face, age, skin, eyes, hair, marks, build, posture: what makes them the same person in every shot. */
  look: string;
  wardrobe: string;
  /** How they sound when they speak: pitch, pace, accent, manner ("low, warm, unhurried Mumbai Hindi"). */
  voice: string;
  /** Media key of the reference sheet (a front view and a three-quarter view), once made. */
  ref: string | null;
}

export interface Place {
  key: string;
  name: string;
  look: string;
  ref: string | null;
}

export interface Bible {
  title: string;
  logline: string;
  genre: string;
  tone: string;
  style: Style;
  /** The language the voice-over, the lines and the subtitles are in: a BCP-47 tag ("hi", "en", "hi-Latn" for Hinglish). */
  language: string;
  look: Look;
  characters: Character[];
  places: Place[];
  /** The music, in words, or null for none: "slow tabla and strings, hopeful". */
  music: string | null;
  /** Media key of the look frame: one key-art picture of the film's colour and light, given to every still as its style reference. */
  lookRef: string | null;
}

export type ShotSize = "extreme-wide" | "wide" | "full" | "medium" | "medium-close" | "close" | "extreme-close" | "insert";
export const SHOT_SIZES: readonly ShotSize[] = ["extreme-wide", "wide", "full", "medium", "medium-close", "close", "extreme-close", "insert"];

export type Angle = "eye" | "low" | "high" | "overhead" | "dutch" | "pov";
export const ANGLES: readonly Angle[] = ["eye", "low", "high", "overhead", "dutch", "pov"];

export type Move = "static" | "pan" | "tilt" | "dolly-in" | "dolly-out" | "truck" | "tracking" | "crane" | "orbit" | "handheld" | "zoom" | "drone";
export const MOVES: readonly Move[] = ["static", "pan", "tilt", "dolly-in", "dolly-out", "truck", "tracking", "crane", "orbit", "handheld", "zoom", "drone"];

/**
 * How a shot joins the one before it.
 *   cut       a plain cut
 *   continue  the same moment carries on: this shot starts on the last frame of the one before and lands on its own still
 *   dissolve  a soft dissolve (time passes)
 */
export type Link = "cut" | "continue" | "dissolve";
export const LINKS: readonly Link[] = ["cut", "continue", "dissolve"];

/** A line spoken on screen, by a character in the shot. */
export interface Line { who: string; text: string }

/** One shot as the director wrote it. What the person changes, and what every prompt is written from. */
export interface ShotCard {
  /** 1, 2, 3 ... in film order. */
  n: number;
  /** What this shot does for the story, in a line. */
  beat: string;
  /** The result the shot is for: what the viewer should feel or understand by its end. */
  intent: string;
  size: ShotSize;
  angle: Angle;
  move: Move;
  /** Focal length in millimetres (full frame). */
  lens: number;
  /** The characters in frame, by key. */
  cast: string[];
  /** The place, by key. */
  place: string;
  /** What happens in the shot, in order. */
  action: string;
  /** The acting, as two to four visible cues: what faces, hands and bodies do ("his jaw tightens; he looks down; his thumb rubs the rim"). */
  performance: string;
  /** The camera in detail: the move's speed and direction, where it starts and ends, what the focus does. */
  camera: string;
  /** The opening frame, as a still: who and what is where. */
  frame: string;
  /** The frame's layers and balance: foreground, subject, background, where the eye goes, the space left. */
  composition: string;
  /** What moves in the air and the place: rain, steam, dust, wind, haze, light flicker. */
  atmosphere: string;
  /** How the shot ends: its last moment, the place the model animates towards. */
  end: string;
  /** The light: the key's direction and quality, its colour temperature, the practicals, the fill and the rim. */
  light: string;
  seconds: number;
  lines: Line[];
  /** Voice-over heard over this shot, or null. */
  vo: string | null;
  /** Sound in the shot: the ambience, then the effects tied to what happens. */
  sound: string;
  link: Link;
  /** How much moves: 0 almost nothing, 3 fast action. */
  motion: 0 | 1 | 2 | 3;
  /** Water, fire, cloth, hair in wind, things falling: physics a model can get wrong. */
  physics: boolean;
  /** Many people in frame. */
  crowd: boolean;
  /** Words that must be readable in frame (a sign, a label), or null. */
  text: string | null;
  /** A model the person chose for this shot, or null for ours. */
  pin: string | null;
}

export interface Script { bible: Bible; shots: ShotCard[] }

export type ShotStatus = "planned" | "boarding" | "boarded" | "queued" | "rendering" | "checking" | "ok" | "failed";

export type IssueKind =
  | "identity" | "wardrobe" | "action" | "camera" | "anatomy" | "artifact" | "morph" | "text" | "continuity" | "physics" | "framing" | "lipsync" | "safety";
export const ISSUE_KINDS: readonly IssueKind[] = [
  "identity", "wardrobe", "action", "camera", "anatomy", "artifact", "morph", "text", "continuity", "physics", "framing", "lipsync", "safety",
];

export interface Issue { kind: IssueKind; major: boolean; note: string }

/** What the eye (qc.ts) made of a still or a take. Scores are 0 to 10. */
export interface Verdict {
  scores: { identity: number; action: number; camera: number; quality: number; continuity: number };
  issues: Issue[];
  /** One line to add to the prompt that would fix it, or null. */
  fix: string | null;
  pass: boolean;
}

export type TakeStatus = "running" | "done" | "failed";

/** One attempt at animating a shot. */
export interface Take {
  id: string;
  n: number;
  model: string;
  /** The card's take print it was made for (compile.ts takePrint): a take of an older card is history, never used. */
  of: string;
  /** The provider's job id while it runs. */
  job: string | null;
  prompt: string;
  seconds: number;
  status: TakeStatus;
  paise: number;
  /** Media key of the clip, once fetched. */
  video: string | null;
  /** Media key of its last frame (the next shot's first, when it continues). */
  lastFrame: string | null;
  verdict: Verdict | null;
  error: string | null;
  startedAt: number;
  endedAt: number | null;
  /** When it was last asked about (the poll), so the tick does not ask every second. */
  polledAt: number | null;
}

/** One shot's progress. */
export interface ShotState {
  n: number;
  status: ShotStatus;
  /** Media key of the approved still (the better of two, by the eye, when the shot has people in it). */
  still: string | null;
  stillVerdict: Verdict | null;
  /** The card's fingerprint when its still was made (compile.ts stillPrint): a change to what is seen makes a new still. */
  stillOf: string | null;
  /** The take that made the cut. */
  take: string | null;
  /** The take print the chosen take was made for (compile.ts takePrint): a change to what moves makes a new take. */
  takeOf: string | null;
  /** The take print the shot gave up on (qc.ts "wait"): it waits for the person until the card changes or they try again. */
  failedOf: string | null;
  /** Models blamed for the card as it is now, so a retake goes elsewhere. Cleared when the card changes. */
  blamed: string[];
  /** A fix carried into the next take's prompt (qc.ts). Cleared when the card changes. */
  fix: string | null;
  /** Why it failed, for the person. */
  error: string | null;
  /** Media key of the voice-over, recorded before the price so the shot's seconds fit it. */
  voice: string | null;
  /** What the voice-over was recorded from (its words, language and voice): a change records it again. */
  voiceOf: string | null;
  /** How long the voice-over runs, in seconds. */
  voiceSeconds: number;
  /** When the recogniser reported them, each word of the voice-over and when it was said: the subtitles are timed from these (cut.ts). */
  voiceWords?: { word: string; start: number; end: number }[];
}

export interface Cut {
  /** Media key of the finished film (mp4). */
  video: string | null;
  /** Media key of the subtitles (srt). */
  srt: string | null;
  seconds: number;
  /** The fingerprint of what was cut, so a changed shot makes a new cut. */
  of: string | null;
}

export interface Film {
  id: string;
  ownerId: string;
  status: FilmStatus;
  hold: Hold;
  /** What the person asked for, in their words. */
  idea: string;
  aspect: Aspect;
  tier: Tier;
  /** How long they want it, in seconds. */
  length: number;
  /** The voice the voice-over is read in (experience/ttsVoices.ts). */
  voice: string;
  /** What they agreed to spend, in paise (0 until the price is approved). */
  budgetPaise: number;
  spentPaise: number;
  script: Script | null;
  shots: ShotState[];
  takes: Take[];
  cut: Cut;
  /** Warnings for the person: a shot kept as the best of its tries, a line too long for its shot. */
  notes: string[];
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

/** A film as a list row (never a cost: the person's plan covers their films). */
export interface FilmRow {
  id: string;
  title: string;
  status: FilmStatus;
  hold: Hold;
  aspect: Aspect;
  shots: number;
  done: number;
  seconds: number;
  /** A signed link to a still to show for it. */
  poster: string | null;
  updatedAt: number;
}
