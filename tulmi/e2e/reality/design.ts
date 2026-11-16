/**
 * MEASURING THE DESIGN LAYER ITSELF, SO THE TASTE WORK SHIPS AGAINST EVIDENCE.
 *
 * Every published design brief, rule list and slop detector in this field was shipped on taste. The best empirical work anyone has done is one
 * afternoon's blog post. That is not a criticism of the people who wrote them — there was no instrument. It is, though, the thing worth having:
 * checks get copied in a week, and knowing WHICH checks work does not.
 *
 * So this is the instrument. A corpus of pages with faults planted in them on purpose, opened in a real browser, measured by the real probe and
 * read by the real `coherence.ts`. Two numbers come out, and they are the only two that matter for a reporting tool:
 *
 *   caught   of the faults that were deliberately planted, how many were found
 *   crying   how much was said about the page that has NOTHING wrong with it
 *
 * The second is the one that decides whether any of this survives contact with a person. A check that cries wolf gets switched off, and then
 * every other check in the file goes with it. So a clean page scoring zero is a harder requirement than a broken page scoring high, and the
 * corpus has clean pages in it for exactly that reason.
 *
 * WHAT THIS IS NOT. It does not score beauty, and it never will: there is no ground truth for beauty and anyone who claims one is selling a
 * number. It scores whether the measurements are true, which is a question with a right answer.
 *
 * FREE AND OFFLINE. No model is called, nothing is paid for, and it needs only a Chromium — so it belongs in the nightly stage-0 slice beside the
 * offline suite, and the number it produces goes on the trend line, where a change to a rule shows up as movement instead of an argument.
 */
import { checkFloor } from "../../src/code/agent/floor.js";
import { allStrays, defects, type Defect } from "../../src/code/agent/coherence.js";
import { runProbe, type ProbeRender, type ProbeResult } from "../../src/code/agent/probe.js";
import { fingerprint, spread, type Fingerprint } from "../../src/code/agent/sameness.js";

/** One page in the corpus: what it is, and what is deliberately wrong with it. */
export interface Case {
  name: string;
  html: string;
  /** The rules that SHOULD fire. Empty means the page is sound and anything said about it is a false alarm. */
  plant: string[];
}

const SOUND_HEAD = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page</title>';
const SOUND_CSS = `
 body{margin:0;font:16px/1.6 system-ui;color:#111827;background:#fff}
 .wrap{padding:16px;max-width:100%;box-sizing:border-box}
 h1{font-size:28px;margin:0 0 16px}
 h2{font-size:20px;margin:0 0 8px}
 .card{padding:16px;margin:0 0 16px;border-radius:12px;background:#f3f4f6}
 button{font-size:16px;padding:12px 16px;border:0;border-radius:8px;background:#1d4ed8;color:#fff}
 button:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}
 a{color:#1d4ed8}
`;
const build = (body: string, css = "", head = SOUND_HEAD): string =>
  `<!doctype html><html lang="en"><head>${head}<style>${SOUND_CSS}${css}</style></head><body><div class="wrap">${body}</div></body></html>`;

/** Enough real words that a share-of-text rule has something to weigh against. */
const PROSE = "Every plan includes unlimited projects, priority support and a monthly review with the team who built it.";

/**
 * The corpus. Each page is ONE fault on an otherwise sound page, which is what makes a miss or a false alarm unambiguous: there is nothing else
 * in the page for the result to be about. The sound pages are not filler — they are the half of the measurement that keeps the rest honest.
 */
export const CASES: readonly Case[] = [
  { name: "sound: prose and a control", plant: [], html: build(`<h1>Pricing</h1><h2>Pro</h2><p>${PROSE}</p><button>Buy Pro</button>`) },
  { name: "sound: cards in a row", plant: [], html: build(`<h1>Plans</h1><div class="card"><h2>Free</h2><p>${PROSE}</p></div><div class="card"><h2>Pro</h2><p>${PROSE}</p></div><button>Choose</button>`) },
  {
    name: "text nobody can read", plant: ["text.contrast"],
    html: build(`<h1>Pricing</h1><p class="f">${PROSE}</p><button>Buy</button>`, ".f{color:#b9bcc2}"),
  },
  {
    name: "text the colour of its background", plant: ["text.invisible"],
    html: build(`<h1>Pricing</h1><p>${PROSE}</p><p class="g">Total due today</p><button>Buy</button>`, ".g{color:#fff;background:#fff}"),
  },
  {
    name: "most of the page set too small", plant: ["text.small"],
    html: build(`<h1>Pricing</h1><p class="t">${PROSE} ${PROSE}</p><button>Buy</button>`, ".t{font-size:10px}"),
  },
  {
    name: "a block that will not fit a phone", plant: ["layout.overflow"],
    html: build(`<h1>Pricing</h1><div class="w"></div><p>${PROSE}</p><button>Buy</button>`, ".w{width:900px;height:40px;background:#e5e7eb}"),
  },
  {
    name: "a button with no focus ring", plant: ["focus.none"],
    html: build(`<h1>Pricing</h1><p>${PROSE}</p><button class="b">Buy</button>`, ".b:focus-visible{outline:none}"),
  },
  {
    name: "motion that ignores the request to stop", plant: ["motion.reduce"],
    html: build(`<h1>Pricing</h1><p>${PROSE}</p><div class="s"></div><button>Buy</button>`,
      "@keyframes sp{to{transform:rotate(360deg)}} .s{width:16px;height:16px;background:#1d4ed8;animation:sp 1.1s linear infinite}"),
  },
  {
    name: "no viewport tag at all", plant: ["viewport"],
    html: build(`<h1>Pricing</h1><p>${PROSE}</p><button>Buy</button>`, "", '<meta charset="utf-8"><title>Page</title>'),
  },
  {
    name: "an image with nothing to say for itself", plant: ["img.alt"],
    html: build(`<h1>Pricing</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="40" height="40"><p>${PROSE}</p><button>Buy</button>`),
  },
  {
    name: "a field nobody labelled", plant: ["field.label"],
    html: build(`<h1>Sign up</h1><p>${PROSE}</p><input type="email" name="email"><button>Join</button>`),
  },
];

/** What one page scored. */
export interface CaseResult {
  name: string;
  planted: string[];
  fired: string[];
  /** Planted and found. */
  caught: string[];
  /** Planted and missed. */
  missed: string[];
  /** Fired on a page where it was not planted. On a sound page every one of these is a false alarm. */
  extra: string[];
  sound: boolean;
  trouble: string[];
}

/** The whole corpus, as one number each for the two things that matter. */
export interface DesignScore {
  cases: CaseResult[];
  /** Of everything planted, the share that was found. */
  caught: number;
  planted: number;
  found: number;
  /** How many things were said about the pages that have nothing wrong with them. Zero is the requirement, not the hope. */
  crying: number;
  soundPages: number;
  /** How alike the corpus's own pages came out, as a sanity check on the fingerprint itself. */
  sameness: ReturnType<typeof spread>;
  /** Pages that could not be measured at all. */
  unmeasured: number;
}

/** Every rule that fired on a page, from all three readers, as one flat list. */
export function fired(html: string, p: ProbeResult): string[] {
  const out = [...checkFloor(html).map((f) => f.rule), ...defects(p).map((d: Defect) => d.rule)];
  // A stray is reported but is never a fault, so it is named apart and never counts as a planted catch.
  for (const { kind } of allStrays(p)) out.push(`stray:${kind}`);
  return [...new Set(out)];
}

/**
 * Runs the corpus. `render` is a real browser; `read` returns the page's HTML as it was drawn, which the floor needs. Both come from the caller
 * so this file knows nothing about how a browser is started.
 */
export async function scoreDesign(
  render: ProbeRender,
  read: (html: string) => Promise<string>,
  cases: readonly Case[] = CASES,
): Promise<DesignScore> {
  const results: CaseResult[] = [];
  const prints: Fingerprint[] = [];
  let unmeasured = 0;
  for (const c of cases) {
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(c.html)}`;
    const probe = await runProbe(render, url);
    if (!probe.walked) { unmeasured += 1; continue; }
    prints.push(fingerprint(probe));
    const html = await read(c.html).catch(() => c.html);
    const all = fired(html, probe);
    // A stray is never something a case plants, so it is left out of the tally entirely rather than counted as noise.
    const real = all.filter((r) => !r.startsWith("stray:"));
    results.push({
      name: c.name, planted: [...c.plant], fired: all,
      caught: c.plant.filter((r) => real.includes(r)),
      missed: c.plant.filter((r) => !real.includes(r)),
      extra: real.filter((r) => !c.plant.includes(r)),
      sound: c.plant.length === 0,
      trouble: probe.trouble,
    });
  }
  const planted = results.reduce((n, r) => n + r.planted.length, 0);
  const found = results.reduce((n, r) => n + r.caught.length, 0);
  const soundPages = results.filter((r) => r.sound);
  return {
    cases: results, planted, found, caught: planted ? found / planted : 1,
    crying: soundPages.reduce((n, r) => n + r.extra.length, 0), soundPages: soundPages.length,
    sameness: spread(prints), unmeasured,
  };
}

/** A verdict in the same words the rest of the harness uses, so it reads beside the others. */
export function designVerdict(s: DesignScore): "working" | "weak" | "broken" | "unknown" {
  if (!s.cases.length) return "unknown";
  // Crying wolf is disqualifying on its own: a check nobody trusts is worse than no check.
  if (s.crying > 0) return s.crying > 2 ? "broken" : "weak";
  if (s.caught >= 0.9) return "working";
  return s.caught >= 0.6 ? "weak" : "broken";
}

/** What REALITY.md carries. */
export function designMarkdown(s: DesignScore): string[] {
  if (!s.cases.length) return ["## The design layer", "", "Not measured: no browser was available to draw the pages.", ""];
  const out = [
    "## The design layer", "",
    `Faults planted in a corpus of ${s.cases.length} pages, opened in a real browser and read by the real checks.`, "",
    `- **Caught**: ${s.found} of ${s.planted} (${Math.round(s.caught * 100)}%)`,
    `- **Cried wolf**: ${s.crying} thing(s) said about the ${s.soundPages} page(s) with nothing wrong. This is the number that decides whether any of it gets switched off.`,
    `- Verdict: **${designVerdict(s)}**`,
  ];
  const missed = s.cases.filter((c) => c.missed.length);
  if (missed.length) out.push("", "Missed:", ...missed.map((c) => `- ${c.name}: ${c.missed.join(", ")}`));
  const noisy = s.cases.filter((c) => c.sound && c.extra.length);
  if (noisy.length) out.push("", "Said about a sound page:", ...noisy.map((c) => `- ${c.name}: ${c.extra.join(", ")}`));
  if (s.unmeasured) out.push("", `${s.unmeasured} page(s) could not be measured at all.`);
  const tight = s.sameness.filter((x) => x.share > 0.5 && x.axis !== "light or dark");
  if (tight.length) out.push("", `The corpus's own pages came out alike on: ${tight.map((x) => `${x.axis} (${Math.round(x.share * 100)}%)`).join(", ")} — expected here, since they are the same page with one fault changed, and a sanity check that the fingerprint notices.`);
  out.push("");
  return out;
}
