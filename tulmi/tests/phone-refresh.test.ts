import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import { FONTS, buildBootstrap, buildScreen } from "../src/experience/catalog.js";
// eslint-disable-next-line import/first
import { PHONE_LOOK, sentence } from "../src/experience/phoneLook.js";
// eslint-disable-next-line import/first
import { LANGS } from "../src/experience/languages.js";

const walk = (n: unknown, hit: (x: Record<string, any>) => void): void => {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) { n.forEach((c) => walk(c, hit)); return; }
  const o = n as Record<string, any>;
  if (typeof o.type === "string") hit(o);
  for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, hit);
};

const month = {
  window: "month", requests: 41, wordsOut: 612, audioSeconds: 300, minutesSaved: 15, speakingMinutes: 5,
  sparklinePerDay: [], wordsPerDay: Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? 20 : 0)).concat([]),
  daysActive: 10, currentStreak: 1, bestStreak: 3, avgWordsPerSession: 15,
  topApps: [{ app: "WhatsApp", words: 300 }, { app: "Gmail", words: 200 }],
  writtenIn: [{ key: "hinglish", words: 300 }, { key: "en", words: 250 }, { key: "hi", words: 62 }],
};
const screens: Array<[string, Record<string, unknown>]> = [
  ["stats", { personality: {}, language: "en", stats: month,
    usage: { month: { words: 612, audioSeconds: 300, requests: 41 }, total: { words: 900, audioSeconds: 500, requests: 60 }, today: { words: 42, audioSeconds: 38, requests: 3 } },
    allowance: { base: 800, earned: 60, total: 860, used: 612, remaining: 248, streakDays: 1, grants: [], maxed: false, perVisit: [] } }],
  ["personality", { personality: { activePresetId: "signature", languages: ["hi", "en"], dictionary: [{ word: "tail zoo", replacement: "Tailzu" }] }, language: "en" }],
  ["voices", { personality: { pinnedPresetIds: ["witty"] }, language: "en" }],
  ["dictionary", { personality: {}, language: "en" }],
  ["settings", { personality: {}, language: "en" }],
];

describe("the phone refresh", () => {
  it("names only faces the server serves, and sets each one's weight", () => {
    // A custom face's weight is its FILE. A text that names one and leaves
    // fontWeight to its role asks for a weight the family does not have, and
    // the phone falls back to the system font for it.
    for (const [id, ctx] of screens) {
      walk(buildScreen(id, ctx as never)!.root, (n) => {
        const fam = n.style?.fontFamily;
        if (!fam || fam === "display" || fam === "body") return;
        expect(Object.keys(FONTS), `${id}: ${fam}`).toContain(fam);
        expect(n.style.fontWeight, `${id}: ${fam} without its weight`).toBe("normal");
      });
    }
  });

  it("never sets a face tighter than its letters need, so no line is clipped", () => {
    // The training card's "IT LEARNS YOU" lost the tops of its capitals:
    // the mono was set at 1.26 of its size and its line box is 1.30.
    const MIN: Record<string, number> = {
      "Tailzu Label": 1.45, "Tailzu Said": 1.34, "Tailzu UI": 1.4, "Tailzu UI Medium": 1.4,
      // Newsreader draws to 0.9em (0.925 italic) above a 0.735em ascender:
      // at 1.3 the training card's title lost the tops of its letters.
      "Tailzu Written": 1.45, "Tailzu Written Italic": 1.45, "Tailzu Written Light": 1.45, "Tailzu Written Light Italic": 1.45,
    };
    for (const [id, ctx] of screens) {
      walk(buildScreen(id, ctx as never)!.root, (n) => {
        const fam = n.style?.fontFamily;
        if (!fam || !(fam in MIN)) return;
        const need = Math.ceil(Number(n.style.fontSize) * MIN[fam]!);
        expect(Number(n.style.lineHeight), `${id}: "${n.props?.content}" in ${fam} ${n.style.fontSize}`).toBeGreaterThanOrEqual(need);
      });
    }
  });

  it("keeps the Stats type small: nothing on the page above 26", () => {
    walk(buildScreen("stats", screens[0]![1] as never)!.root, (n) => {
      if (n.type === "Text" && n.style?.fontFamily && String(n.style.fontFamily).startsWith("Tailzu")) {
        expect(Number(n.style.fontSize), String(n.props?.content)).toBeLessThanOrEqual(26);
      }
    });
  });

  it("says the month as a sentence, with typing in its colour", () => {
    const s = JSON.stringify(buildScreen("stats", screens[0]![1] as never));
    for (const w of ["You ", "said ", "612 ", "words ", "15 ", "min"]) expect(s).toContain(`"${w}`);
    expect(s).toContain(PHONE_LOOK.typedInk);
    expect(s).toContain('"42 "');
    expect(s).toContain('"seconds."');
    expect(s).toContain("248 of 860, back on the 1st.");
    expect(s).toContain("Hinglish");
  });

  it("wraps a sentence at words, keeping a full stop with the word before it", () => {
    const row = sentence(["Typed, it took ", { text: "15 min", style: { color: "#f00" } }, ". Said, 5."], "writtenLight", 20) as any;
    const words = row.children.map((c: any) => c.type === "Stack" ? c.children.map((x: any) => x.props.content).join("") : c.props.content);
    expect(words).toEqual(["Typed, ", "it ", "took ", "15 ", "min. ", "Said, ", "5."]);
  });

  it("shows every voice's sentence for each kind of writing", () => {
    const v = buildScreen("voices", screens[2]![1] as never)! as any;
    expect(v.state.vctx).toBe("chats");
    const contexts = new Set<string>();
    walk(v.root, (n) => { if (n.visibleIf?.eq?.[0] === "vctx") contexts.add(n.visibleIf.eq[1]); });
    expect([...contexts].sort()).toEqual(["chats", "email", "other", "work"]);
  });

  it("draws the Stats gear so it can be seen on the dark ground", () => {
    const s = JSON.stringify(buildScreen("stats", screens[0]![1] as never));
    expect(s).toContain('"stroke":"rgba(255,255,255,0.66)"');
  });

  it("uses no amber inside Full history", () => {
    const h = JSON.stringify(buildScreen("history", {
      personality: {}, language: "en",
      history: [{ id: "a", kind: "voice", input: "haan bhai", output: "Haan bhai.", wordsIn: 2, wordsOut: 2, createdAt: new Date().toISOString() }],
    } as never)).toUpperCase();
    expect(h).not.toContain("#E8A23C");
    expect(h).not.toContain("232,162,60");
  });

  it("lights the selected tab in amber again", () => {
    const b = buildBootstrap({} as never) as any;
    for (const tab of b.navigation.tabs) {
      const lit = tab.glyph.layers.filter((l: any) => l.activeColor === "#E8A23C");
      expect(lit.length, tab.id).toBeGreaterThan(0);
    }
  });

  it("offers every language the models handle, the same list the site shows", () => {
    const json = JSON.stringify(buildScreen("languages", { personality: {}, language: "en" } as never));
    for (const l of LANGS) {
      const value = l.slug === "hinglish" ? "hinglish" : l.code;
      expect(json, l.name).toContain(`"value":"${value}"`);
    }
    // Grouped: India, then the world.
    expect(json.indexOf('"India"')).toBeLessThan(json.indexOf('"The world"'));
    // A newly offered code reads as its name on the You card, never as a code.
    const you = JSON.stringify(buildScreen("personality", { personality: { languages: ["doi", "sat"] }, language: "en" } as never));
    expect(you).toContain("Dogri, Santali");
  });

  it("shows each haptics key once across the keyboards, placed by a stable shuffle", () => {
    const keysOn = (email: string) => {
      const out: Array<{ id: string; layer: number }> = [];
      // The reels, not the fallback (the same boards again for old bundles).
      let reels: any = null;
      walk(buildScreen("haptics", { personality: {}, language: "en", email } as never)!.root, (n) => {
        if (!reels && n.type === "Reels") reels = n;
      });
      reels.children.forEach((board: any, layer: number) => {
        walk({ ...board, fallback: undefined }, (n) => {
          if (n.type !== "KeyboardPreview") return;
          for (const row of n.props.rows) for (const k of row) if (!k.spacer && k.id) out.push({ id: k.id, layer });
        });
      });
      return out;
    };
    const a = keysOn("asha@example.com");
    const ids = a.map((k) => k.id);
    expect(new Set(ids).size, "a key shown twice").toBe(ids.length);
    for (const id of ["space", "backspace", "return", ".", "@", "123", "abc", "shift", "q", "1", "mic"]) expect(ids).toContain(id);
    // Stable for the same account — every tap refreshes the screen.
    expect(keysOn("asha@example.com")).toEqual(a);
    // And not simply "first keyboard wins": across accounts, a shared key
    // lands on more than one keyboard.
    const homes = new Set(["a@x.io", "b@x.io", "c@x.io", "d@x.io", "e@x.io", "f@x.io"]
      .map((e) => keysOn(e).find((k) => k.id === "backspace")!.layer));
    expect(homes.size).toBeGreaterThan(1);
  });

  it("keeps amber for what is live — and nothing on You, Voices or Languages is", () => {
    // Amber marks what is live right now: recording, listening, a live voice
    // session. The voice that is writing is a setting, so the dot beside it is
    // in its card's own ink; a chosen language's tick is pale; the network on
    // the training card pulses pale. None of these screens carries amber at
    // all — not as a colour, a border, a fill or the field's signal.
    const cases: Array<[string, Record<string, unknown>]> = [
      screens[1]!, screens[2]!,
      ["languages", { personality: { languages: ["hi", "en"] }, language: "en" }],
    ];
    for (const [id, ctx] of cases) {
      const s = buildScreen(id, ctx as never)!;
      let amber = 0;
      walk(s.root, (n) => {
        const st = n.style ?? {};
        if ([st.backgroundColor, st.color, st.borderColor].includes(PHONE_LOOK.accent)) amber++;
      });
      expect(amber, id).toBe(0);
      const json = JSON.stringify(s).toUpperCase().replace(/\s/g, "");
      expect(json, id).not.toContain(PHONE_LOOK.accent.toUpperCase());
      expect(json, id).not.toContain("232,162,60");
    }
    // The dot beside the writing voice is still drawn — in the card's ink.
    const dots: Array<Record<string, any>> = [];
    walk(buildScreen("personality", screens[1]![1] as never)!.root, (n) => {
      if (n.style?.width === 5 && n.style?.height === 5 && n.style?.borderRadius === 2.5) dots.push(n);
    });
    expect(dots).toHaveLength(1);
    expect(dots[0]!.style.backgroundColor).toBeTruthy();
  });
});
