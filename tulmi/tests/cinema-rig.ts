/**
 * A small film for the cinema tests: two people, two places, four shots, and OpenRouter's model lists as they were read (fixtures/).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { blankShot } from "../src/cinema/flow.js";
import { imageCatalog, parseImageLive } from "../src/cinema/imageModels.js";
import { catalog, parseLive } from "../src/cinema/models.js";
import type { Bible, Film, ShotCard, Take, Verdict } from "../src/cinema/types.js";

const fixture = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"));

export const liveVideo = () => parseLive(fixture("openrouter-video-models.json"));
export const videoModels = () => catalog(liveVideo());
export const imageModels = () => imageCatalog(parseImageLive(fixture("openrouter-image-models.json")));

export const bible = (over: Partial<Bible> = {}): Bible => ({
  title: "Chai in the Rain",
  logline: "A chai seller's stall becomes the street's shelter in the first monsoon rain.",
  genre: "ad",
  tone: "warm",
  style: "live",
  language: "hi",
  look: { palette: "amber and teal", light: "overcast monsoon light, warm practicals", lens: "anamorphic, shallow depth of field", stock: "35mm film grain" },
  characters: [
    { key: "ravi", name: "Ravi", look: "a man in his fifties, grey stubble, kind eyes", wardrobe: "a faded blue kurta", ref: null },
    { key: "meera", name: "Meera", look: "a college student, short curly hair", wardrobe: "a yellow raincoat", ref: null },
  ],
  places: [
    { key: "stall", name: "the chai stall", look: "a tin-roofed stall on a Mumbai street, steam rising", ref: null },
    { key: "street", name: "the street", look: "a narrow lane with puddles and parked scooters", ref: null },
  ],
  music: "slow tabla and strings",
  lookRef: null,
  ...over,
});

export const card = (n: number, over: Partial<ShotCard> = {}): ShotCard => ({
  n,
  beat: "the rain arrives",
  size: "wide",
  angle: "eye",
  move: "static",
  lens: 35,
  cast: ["ravi"],
  place: "stall",
  action: "Ravi pours chai as the first drops hit the tin roof",
  frame: "Ravi behind the counter, steam rising, the street behind him",
  end: "Ravi looks up at the rain, smiling",
  light: "grey daylight, a warm bulb over the counter",
  seconds: 5,
  lines: [],
  vo: null,
  sound: "rain on tin, kettle",
  link: "cut",
  motion: 1,
  physics: false,
  crowd: false,
  text: null,
  pin: null,
  ...over,
});

export const shots = (): ShotCard[] => [
  card(1, { size: "extreme-wide", cast: [], place: "street", action: "Rain sweeps down the lane", frame: "The empty lane under dark clouds", physics: true, move: "drone", vo: "Har baarish ki ek kahani hoti hai." }),
  card(2),
  card(3, { size: "close", cast: ["meera"], place: "street", action: "Meera runs through the rain towards the stall", motion: 3, move: "tracking", physics: true }),
  card(4, { size: "medium", cast: ["ravi", "meera"], lines: [{ who: "ravi", text: "Andar aa jao, beta." }], action: "Ravi hands Meera a glass of chai", link: "cut" }),
];

export const film = (over: Partial<Film> = {}): Film => {
  const s = shots();
  return {
    id: "f1",
    ownerId: "u1",
    status: "boarding",
    hold: null,
    idea: "a 20 second ad for my chai stall in the Mumbai rain",
    aspect: "16:9",
    tier: "standard",
    length: 20,
    voice: "nova",
    budgetPaise: 0,
    spentPaise: 0,
    script: { bible: bible(), shots: s },
    shots: s.map((c) => blankShot(c.n)),
    takes: [],
    cut: { video: null, srt: null, seconds: 0, of: null },
    notes: [],
    error: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
};

export const verdict = (score: number, over: Partial<Verdict> = {}): Verdict => ({
  scores: { identity: score, action: score, camera: score, quality: score, continuity: score },
  issues: [],
  fix: null,
  pass: score >= 7,
  ...over,
});

let takeNo = 0;
export const take = (n: number, of: string, over: Partial<Take> = {}): Take => ({
  id: `t${++takeNo}`,
  n,
  model: "kwaivgi/kling-v3.0-std",
  of,
  job: "job",
  prompt: "p",
  seconds: 5,
  status: "running",
  paise: 50,
  video: null,
  lastFrame: null,
  verdict: null,
  error: null,
  startedAt: 0,
  endedAt: null,
  polledAt: null,
  ...over,
});
