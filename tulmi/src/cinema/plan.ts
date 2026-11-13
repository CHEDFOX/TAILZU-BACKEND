/**
 * THE DIRECTOR: from what the person asked for to a bible and a shot list a crew could shoot. One model call (the strong tier) writes it;
 * the code then makes it safe to spend money on (`normalize`), because a model's script is a draft, not a contract:
 *
 *   - every field in range and of a kind the rest of the engine knows (sizes, angles, moves, links), names and keys made unique
 *   - every shot's people and place are ones the bible has; lines only from people in the shot
 *   - the first shot is a cut; a shot can only carry on from the one before in the same place
 *   - the shots' seconds brought to the length asked for, each between 2 and 15
 *   - a shot whose lines and voice-over cannot be said in its seconds is given the seconds (up to 15), and the person is told
 *
 * `lint` adds what a director would say about the cut (no establishing shot, the same size three times running) as notes, without
 * changing anything. `revise` takes a note in plain words, for the whole film or for one shot; for one shot only that shot may change,
 * whatever the model sends back, so a note about shot 4 never costs a new take of shot 2.
 *
 * The model is reached through a port (`Think`) the service fills with the gateway (code/brain/gateway.ts callModel), so all of this is
 * tested without a model.
 */
import { ANGLES, LINKS, MOVES, SHOT_SIZES, type Angle, type Aspect, type Bible, type Character, type Line, type Link, type Move, type Place, type Script, type ShotCard, type ShotSize } from "./types.js";

/** One model call. The service turns it into callModel with json: true. */
export type Think = (o: {
  purpose: string;
  tier: "strong" | "cheap" | "vision";
  system: string;
  user: string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];
  maxTokens: number;
  capPaise: number;
}) => Promise<{ json: unknown; text: string; usd?: number }>;

export const MAX_SHOTS = 30;
export const MAX_PEOPLE = 6;
export const MAX_PLACES = 6;
/** How many words a second can carry, said aloud at an easy pace. */
export const WORDS_PER_SECOND = 2.6;

export const DIRECTOR_SYSTEM = `You are a film director and cinematographer. You turn a request into a production bible and a shot list that an AI video crew will shoot shot by shot: each shot is first made as a still, then animated from that still for its few seconds.

Rules of the craft you follow:
- Open on an establishing shot of a new place (wide or extreme-wide), then cover the action in closer sizes. Vary shot sizes; never three of the same size in a row.
- One clear action per shot. A shot is 2 to 15 seconds; most are 3 to 8. About one shot for every 4 to 6 seconds of the film.
- Keep the 180-degree rule and screen direction: if someone exits right, they enter the next shot from the left.
- Match eyelines; cut on action; use "continue" only when the next shot is the very same moment carrying on in the same place.
- "frame" describes the OPENING composition as a still (who is where, what is in focus, foreground and background). "action" describes only what moves during the shot, in order, as visible physical actions (show a feeling through two or three things the body does, never "she is sad"). "end" describes the shot's last moment.
- One camera move per shot, with its lens.
- Describe people by what stays the same in every shot (face, age, hair, build) in the bible, and their clothes in "wardrobe". Never change wardrobe between shots unless the story says so.
- Ads: hook in the first two seconds, the product or name clearly seen near the end. Vertical 9:16: centre-weighted compositions and closer sizes.
- Spoken lines go in "lines" only for someone in the shot, short enough to say in the shot's seconds. Narration goes in "vo". Write lines and narration in the film's language exactly as people speak it (Hinglish stays Hinglish, in Latin letters).
- Words that must be readable in frame go in "text" (a sign, a label), at most a few words.
- Mark "physics" for water, rain, fire, smoke, cloth or hair in wind, and things falling; "crowd" for many people; "motion" 0 (still) to 3 (fast action).
- Never use real people's names or likenesses, brands the person did not ask for, or anything sexual involving minors, gore, or hate.

Answer with JSON only, in this shape:
{"bible":{"title":"","logline":"","genre":"","tone":"","style":"live|animated","language":"BCP-47 tag","look":{"palette":"","light":"","lens":"","stock":""},"characters":[{"key":"a-z0-9-","name":"","look":"","wardrobe":""}],"places":[{"key":"","name":"","look":""}],"music":"a few words, or null"},
"shots":[{"beat":"","size":"extreme-wide|wide|full|medium|medium-close|close|extreme-close|insert","angle":"eye|low|high|overhead|dutch|pov","move":"static|pan|tilt|dolly-in|dolly-out|truck|tracking|crane|orbit|handheld|zoom|drone","lens":35,"cast":["key"],"place":"key","action":"","frame":"","end":"","light":"","seconds":5,"lines":[{"who":"key","text":""}],"vo":"or null","sound":"","link":"cut|continue|dissolve","motion":0,"physics":false,"crowd":false,"text":"or null"}]}`;

const REVISE_SYSTEM = `${DIRECTOR_SYSTEM}

You are given the film's current bible and shot list as JSON and a note from the person. Change only what the note asks for, and keep every other field exactly as it is, word for word. Answer with the complete bible and shot list in the same JSON shape.`;

export interface DirectAsk {
  idea: string;
  length: number;
  aspect: Aspect;
  /** The language to write in when the idea does not say (the person's own). */
  language: string;
  /** The person's cast: characters they made before and want to use again. */
  cast?: Character[];
}

export class DirectorError extends Error {
  readonly status = 502;
  readonly code = "director_failed";
  constructor(message: string) {
    super(message);
    this.name = "DirectorError";
  }
}

/** Writes the film. One more try when the first answer is not a usable script. */
export async function direct(think: Think, a: DirectAsk): Promise<{ script: Script; notes: string[] }> {
  const user = [
    `Request: <<<${a.idea.slice(0, 4000)}>>>`,
    `Length: about ${a.length} seconds. Frame: ${a.aspect}. Language unless the request says otherwise: ${a.language}.`,
    a.cast?.length ? `People the person already has and wants kept exactly as they are (use their keys): ${JSON.stringify(a.cast.map((c) => ({ key: c.key, name: c.name, look: c.look, wardrobe: c.wardrobe })))}` : "",
  ].filter(Boolean).join("\n");
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await think({ purpose: "cinema.direct", tier: "strong", system: DIRECTOR_SYSTEM, user: attempt ? `${user}\n\nYour last answer was not usable JSON in the required shape. Answer again with JSON only.` : user, maxTokens: 8000, capPaise: 3000 });
    try {
      const out = normalize(r.json ?? r.text, { length: a.length, language: a.language });
      keepCast(out.script.bible, a.cast ?? []);
      return { script: out.script, notes: [...out.notes, ...lint(out.script)] };
    } catch {
      /* one more try */
    }
  }
  throw new DirectorError("The director could not write this film. Try saying it another way.");
}

/** Revises the film from a note. `n`: only that shot may change. */
export async function revise(think: Think, script: Script, note: string, o: { length: number; n?: number }): Promise<{ script: Script; notes: string[] }> {
  const user = `Current film: ${JSON.stringify(script)}\n\nNote${o.n ? ` about shot ${o.n}` : ""}: <<<${note.slice(0, 2000)}>>>`;
  const r = await think({ purpose: "cinema.revise", tier: "strong", system: REVISE_SYSTEM, user, maxTokens: 8000, capPaise: 3000 });
  let out: { script: Script; notes: string[] };
  try {
    out = normalize(r.json ?? r.text, { length: o.length, language: script.bible.language, keepLength: true });
  } catch {
    throw new DirectorError("The director could not make that change. Try saying it another way.");
  }
  keepRefs(out.script.bible, script.bible);
  if (!o.n) return { script: out.script, notes: [...out.notes, ...lint(out.script)] };
  const changed = out.script.shots.find((s) => s.n === o.n);
  if (!changed) return { script, notes: [] };
  const ok = (k: string, list: { key: string }[]) => list.some((x) => x.key === k);
  const shot: ShotCard = {
    ...changed,
    n: o.n,
    pin: script.shots.find((s) => s.n === o.n)?.pin ?? null,
    cast: changed.cast.filter((k) => ok(k, script.bible.characters)),
    place: ok(changed.place, script.bible.places) ? changed.place : script.shots.find((s) => s.n === o.n)?.place ?? changed.place,
  };
  shot.lines = shot.lines.filter((l) => shot.cast.includes(l.who));
  return { script: { bible: script.bible, shots: script.shots.map((s) => (s.n === o.n ? shot : s)) }, notes: out.notes.filter((x) => x.startsWith(`Shot ${o.n}`)) };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Making a model's answer safe to spend money on.

const str = (v: unknown, max: number, fallback = ""): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : fallback);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (typeof v === "string" && (list as readonly string[]).includes(v.trim().toLowerCase()) ? (v.trim().toLowerCase() as T) : fallback);
const num = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const slug = (v: unknown, fallback: string): string => {
  const s = (typeof v === "string" ? v : "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
  return s || fallback;
};

function asObject(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    const m = /\{[\s\S]*\}/.exec(raw);
    if (!m) return null;
    try {
      return asObject(JSON.parse(m[0]));
    } catch {
      return null;
    }
  }
  return null;
}

function unique(keys: string[], k: string): string {
  let out = k;
  for (let i = 2; keys.includes(out); i++) out = `${k}-${i}`;
  keys.push(out);
  return out;
}

export function normalize(raw: unknown, o: { length: number; language: string; keepLength?: boolean }): { script: Script; notes: string[] } {
  const r = asObject(raw);
  if (!r) throw new Error("not an object");
  const b = asObject(r.bible) ?? {};
  const look = asObject(b.look) ?? {};
  const notes: string[] = [];

  const ckeys: string[] = [];
  const characters: Character[] = (Array.isArray(b.characters) ? b.characters : []).slice(0, MAX_PEOPLE).flatMap((x, i) => {
    const c = asObject(x);
    if (!c) return [];
    const name = str(c.name, 40) || `Person ${i + 1}`;
    return [{ key: unique(ckeys, slug(c.key ?? name, `person-${i + 1}`)), name, look: str(c.look, 400), wardrobe: str(c.wardrobe, 240), ref: null }];
  });
  const pkeys: string[] = [];
  const places: Place[] = (Array.isArray(b.places) ? b.places : []).slice(0, MAX_PLACES).flatMap((x, i) => {
    const p = asObject(x);
    if (!p) return [];
    const name = str(p.name, 60) || `Place ${i + 1}`;
    return [{ key: unique(pkeys, slug(p.key ?? name, `place-${i + 1}`)), name, look: str(p.look, 400), ref: null }];
  });
  const rawShots = (Array.isArray(r.shots) ? r.shots : []).map(asObject).filter((x): x is Record<string, unknown> => !!x).slice(0, MAX_SHOTS);
  if (!rawShots.length) throw new Error("no shots");
  if (!places.length) places.push({ key: "place", name: "the place", look: str(rawShots[0]!.frame, 400), ref: null });

  const keyOf = (v: unknown, list: { key: string; name: string }[]): string | null => {
    if (typeof v !== "string") return null;
    const k = slug(v, "");
    return list.find((x) => x.key === k)?.key ?? list.find((x) => slug(x.name, "") === k)?.key ?? null;
  };

  const bible: Bible = {
    title: str(b.title, 80) || "Untitled",
    logline: str(b.logline, 240),
    genre: str(b.genre, 40),
    tone: str(b.tone, 80),
    style: oneOf(b.style, ["live", "animated"] as const, "live"),
    language: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(str(b.language, 20)) ? str(b.language, 20) : o.language,
    look: { palette: str(look.palette, 160), light: str(look.light, 160), lens: str(look.lens, 120), stock: str(look.stock, 120) || "digital cinema camera" },
    characters,
    places,
    music: str(b.music, 160) || null,
    lookRef: null,
  };

  let shots: ShotCard[] = rawShots.map((s, i): ShotCard => {
    const cast = [...new Set((Array.isArray(s.cast) ? s.cast : []).map((k) => keyOf(k, characters)).filter((k): k is string => !!k))].slice(0, 4);
    const lines: Line[] = (Array.isArray(s.lines) ? s.lines : []).flatMap((x) => {
      const l = asObject(x);
      const who = l ? keyOf(l.who, characters) : null;
      const text = l ? str(l.text, 240) : "";
      return who && text && cast.includes(who) ? [{ who, text }] : [];
    }).slice(0, 4);
    return {
      n: i + 1,
      beat: str(s.beat, 160),
      size: oneOf<ShotSize>(s.size, SHOT_SIZES, "medium"),
      angle: oneOf<Angle>(s.angle, ANGLES, "eye"),
      move: oneOf<Move>(s.move, MOVES, "static"),
      lens: Math.round(num(s.lens, 12, 200, 35)),
      cast,
      place: keyOf(s.place, places) ?? places[0]!.key,
      action: str(s.action, 600) || str(s.beat, 160),
      frame: str(s.frame, 600) || str(s.action, 600),
      end: str(s.end, 300),
      light: str(s.light, 200),
      seconds: Math.round(num(s.seconds, 2, 15, 5)),
      lines,
      vo: str(s.vo, 400) || null,
      sound: str(s.sound, 200),
      link: oneOf<Link>(s.link, LINKS, "cut"),
      motion: Math.round(num(s.motion, 0, 3, 1)) as 0 | 1 | 2 | 3,
      physics: s.physics === true,
      crowd: s.crowd === true,
      text: str(s.text, 40) || null,
      pin: null,
    };
  });

  shots = shots.map((s, i) => (s.link === "continue" && (i === 0 || shots[i - 1]!.place !== s.place) ? { ...s, link: "cut" } : i === 0 && s.link !== "cut" ? { ...s, link: "cut" } : s));
  if (!o.keepLength) shots = fitLength(shots, o.length);
  shots = shots.map((s) => {
    const words = [...s.lines.map((l) => l.text), s.vo ?? ""].join(" ").split(/\s+/).filter(Boolean).length;
    const need = Math.ceil(words / WORDS_PER_SECOND + 0.5);
    if (need <= s.seconds) return s;
    if (need > 15) notes.push(`Shot ${s.n}: its words are too long to say in 15 seconds; shorten them.`);
    else notes.push(`Shot ${s.n}: given ${need} seconds so its words can be said.`);
    return { ...s, seconds: Math.min(15, need) };
  });
  return { script: { bible, shots }, notes };
}

/** Brings the shots' seconds to about the length asked for, each kept between 2 and 15. */
export function fitLength(shots: ShotCard[], length: number): ShotCard[] {
  const total = shots.reduce((n, s) => n + s.seconds, 0);
  if (!total || Math.abs(total - length) / length <= 0.15) return shots;
  const k = length / total;
  return shots.map((s) => ({ ...s, seconds: Math.max(2, Math.min(15, Math.round(s.seconds * k))) }));
}

/** A director's notes on the cut. Nothing is changed. */
export function lint(script: Script): string[] {
  const out: string[] = [];
  const s = script.shots;
  if (s.length >= 3 && !s.slice(0, 2).some((x) => x.size === "wide" || x.size === "extreme-wide")) out.push("No establishing shot: the film opens close, before we know where we are.");
  for (let i = 2; i < s.length; i++) {
    if (s[i]!.size === s[i - 1]!.size && s[i]!.size === s[i - 2]!.size) out.push(`Shots ${s[i - 2]!.n} to ${s[i]!.n} are all ${s[i]!.size}: the cut may feel flat.`);
  }
  return out;
}

/** People from the person's cast keep their own looks and sheets, whatever the model wrote. */
function keepCast(bible: Bible, cast: readonly Character[]): void {
  for (const c of bible.characters) {
    const mine = cast.find((x) => x.key === c.key);
    if (mine) Object.assign(c, { name: mine.name, look: mine.look, wardrobe: mine.wardrobe, ref: mine.ref });
  }
}

/** A revised bible keeps the sheets of the people and places whose looks did not change, and the look frame while the look stays. */
function keepRefs(next: Bible, before: Bible): void {
  if (JSON.stringify(next.look) === JSON.stringify(before.look) && next.style === before.style) next.lookRef = before.lookRef;
  for (const c of next.characters) {
    const was = before.characters.find((x) => x.key === c.key);
    if (was && was.look === c.look && was.wardrobe === c.wardrobe) c.ref = was.ref;
  }
  for (const p of next.places) {
    const was = before.places.find((x) => x.key === p.key);
    if (was && was.look === p.look) p.ref = was.ref;
  }
}
