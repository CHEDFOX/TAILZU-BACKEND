/**
 * THE CINEMA BOT'S DAY for the render check (screens/bots/cinemaPage.ts, cinemaScreens.ts): Aanya's films and pictures, and one film,
 * "Chai in the Rain", at each step: the script, the storyboard and its price, filming (one shot waiting for her, the money running short),
 * and done. The film is tests/cinema-rig.ts's. The stills are drawn here as small pictures in the film's palette, each with its shot's
 * number, standing in for the real stills a model makes: the layout, the sizes and the words are what is being checked. The film goes to
 * the screens the way the routes send it: as the person sees it (src/cinema/public.ts), with no model, prompt or score in it.
 */
import { film as filmOf } from "../../../tests/cinema-rig.js";
import { publicFilm } from "../../../src/cinema/public.js";
import type { Film } from "../../../src/cinema/types.js";

const PALETTE = [["#2f5d62", "#d9a441"], ["#1f3b4d", "#e0b25b"], ["#3b4f52", "#c98b3a"], ["#24414a", "#f0c36a"]] as const;

/** A stand-in still: a dusk sky over a lit stall, rain, and the shot's number, in the film's colours. */
export function still(n: number, aspect: Film["aspect"]): string {
  const [w, h] = aspect === "9:16" ? [360, 640] : aspect === "1:1" ? [480, 480] : [640, 360];
  const [a, b] = PALETTE[(n - 1) % PALETTE.length]!;
  const rain = Array.from({ length: 28 }, (_, i) => {
    const x = (i * 97 + n * 31) % w;
    const y = (i * 53 + n * 17) % h;
    return `<line x1="${x}" y1="${y}" x2="${x - 6}" y2="${y + 22}" stroke="#ffffff" stroke-opacity="0.35" stroke-width="1.5"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="#111a1d"/></linearGradient>
<radialGradient id="l" cx="0.62" cy="0.48" r="0.35"><stop offset="0" stop-color="${b}" stop-opacity="0.95"/><stop offset="1" stop-color="${b}" stop-opacity="0"/></radialGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/><rect width="${w}" height="${h}" fill="url(#l)"/>
<rect x="${w * 0.45}" y="${h * 0.42}" width="${w * 0.36}" height="${h * 0.3}" fill="#0d1416" opacity="0.55"/>
<rect x="${w * 0.42}" y="${h * 0.38}" width="${w * 0.42}" height="${h * 0.05}" fill="#55606a"/>
<circle cx="${w * 0.62}" cy="${h * 0.47}" r="${Math.min(w, h) * 0.03}" fill="#ffe2a0"/>
${rain}
<text x="16" y="${h - 18}" font-family="sans-serif" font-size="${Math.round(Math.min(w, h) * 0.07)}" fill="#ffffff" fill-opacity="0.8">Shot ${n}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** The film at a status, with its stills in place and links to them. */
function view(status: Film["status"], over: Partial<Film> = {}) {
  const f = filmOf({ id: "f1", status, aspect: "9:16", ...over });
  const links: Record<string, string> = {};
  if (status !== "script" && status !== "writing") {
    for (const s of f.shots) {
      s.still = `u/u1/cinema/films/f1/still-${s.n}.png`;
      links[s.still] = still(s.n, f.aspect);
    }
  }
  return { f, links };
}


function writing() {
  const f = filmOf({ id: "f1", status: "writing", aspect: "9:16", script: null, shots: [] });
  f.idea = "a 24 second vertical ad for my chai stall in the Mumbai rain, warm and a bit funny";
  return { film: publicFilm(f), title: "New film", links: {} };
}

function script() {
  const { f, links } = view("script", { budgetPaise: 0, spentPaise: 0 });
  return { film: publicFilm(f), title: "Chai in the Rain", links };
}

function board() {
  const { f, links } = view("board", { budgetPaise: 3_300, spentPaise: 2_590 });
  f.shots.forEach((s) => { s.status = "boarded"; });
  return { film: publicFilm(f), title: "Chai in the Rain", links };
}

function filming() {
  const { f, links } = view("rendering", { budgetPaise: 16_600, spentPaise: 15_900, hold: "budget" });
  const states = ["ok", "ok", "failed", "rendering"] as const;
  f.shots.forEach((s, i) => { s.status = states[i]!; });
  f.shots[2]!.error = "Shot 3 did not come out right in 3 takes: her hand passes through the glass. Change its words and try again.";
  const v = (s: number, note: string | null) => ({ scores: { identity: s, action: s - 1, camera: s, quality: s, continuity: s }, issues: note ? [{ kind: "anatomy" as const, major: true, note }] : [], fix: null, pass: !note });
  const take = (id: string, n: number, model: string, verdict: ReturnType<typeof v> | null, status: "done" | "running" = "done") => ({
    id, n, model, of: "x", job: "j", prompt: "", seconds: 5, status, paise: 60, video: null, lastFrame: null, verdict, error: null, startedAt: 0, endedAt: 1, polledAt: null,
  });
  f.takes = [
    take("t1", 1, "bytedance/seedance-2.0", v(9, null)),
    take("t2", 2, "kwaivgi/kling-v3.0-std", v(6, "the steam thins at the end")),
    take("t3", 3, "kwaivgi/kling-v3.0-std", v(5, "her hand passes through the glass")),
    take("t4", 3, "kwaivgi/kling-v3.0-std", v(4, "the glass melts into her fingers")),
    take("t5", 3, "google/veo-3.1-fast", v(4, "her face changes mid-shot")),
    take("t6", 4, "google/veo-3.1-fast", null, "running"),
  ];
  f.shots[0]!.take = "t1";
  f.shots[1]!.take = "t2";
  f.notes = ["Shot 2: kept the best of 3 takes (the steam thins at the end).", "Shot 1: given 8 seconds so its voice-over fits."];
  return { film: publicFilm(f), title: "Chai in the Rain", links };
}

function done() {
  const { f, links } = view("done", { budgetPaise: 16_600, spentPaise: 14_100 });
  f.shots.forEach((s) => { s.status = "ok"; });
  f.cut = { video: "u/u1/cinema/films/f1/film-x.mp4", srt: "u/u1/cinema/films/f1/words-x.srt", seconds: 24, of: "x" };
  links[f.cut.video!] = "https://api.local/v1/cinema/media/u/u1/cinema/films/f1/film-x.mp4?exp=1&sig=x";
  links[f.cut.srt!] = "https://api.local/v1/cinema/media/u/u1/cinema/films/f1/words-x.srt?exp=1&sig=x";
  f.script!.bible.characters.forEach((c) => { c.ref = `u/u1/cinema/films/f1/character-${c.key}.png`; });
  return { film: publicFilm(f), title: "Chai in the Rain", links };
}

const row = (id: string, title: string, status: Film["status"], o: Record<string, unknown> = {}) => ({
  id, title, status, hold: null, aspect: "9:16", shots: 4, done: 0, seconds: 24, poster: still(Number(id.slice(1)) || 1, "1:1"), updatedAt: 1, ...o,
});

export const CINEMA_OVERVIEW = {
  films: [
    row("f1", "Chai in the Rain", "board"),
    row("f2", "Diwali at Sharma Sweets", "rendering", { hold: "budget", done: 3, shots: 6, seconds: 30 }),
    row("f3", "Monsoon Sale, 15s", "done", { done: 3, shots: 3, seconds: 15 }),
  ],
  pictures: [1, 2, 3, 4].map((n) => ({ id: `p${n}`, ownerId: "u1", words: ["A Diwali sale poster", "Ravi's portrait", "A chai glass on a wet counter", "A logo for Ravi's Chai"][n - 1], kind: "poster", type: "image/png", note: null, createdAt: n, url: still(n + 1, "1:1") })),
  cast: [{ key: "ravi", name: "Ravi", look: "a man of 55, warm brown skin, deep-set kind eyes, grey stubble", wardrobe: "", voice: "", ref: "k", url: still(2, "1:1") }],
};

export const CINEMA_BOT = {
  slug: "cinema", name: "Cinema", colour: "stone", builtin: true, publicCard: false, tone: "warm and concrete", principles: [],
  purpose: "Makes films and videos shot by shot from your idea, and pictures: posters, product shots, portraits and logos.",
  skills: { web: false, files: false, artifacts: false, code: false, research: false, connectors: [] },
};

/** The routes the cinema bot's page reads, beside the bots' own. */
export const CINEMA_PAGE_API = (overview: unknown): Record<string, unknown> => ({
  "GET /v1/bots/cinema": { bot: CINEMA_BOT },
  "GET /v1/bots/cinema/memory": { facts: [], summary: "", turns: 0 },
  "GET /v1/bots/cinema/connectors": { connectors: [] },
  "GET /v1/botsapp/bots/chat/cinema?limit=1": { turns: [] },
  "GET /v1/botsapp/bots/chat/cinema?limit=30": { turns: [] },
  "GET /v1/cinema/overview": overview,
});

export const CINEMA_FILMS = { writing, script, board, filming, done };
