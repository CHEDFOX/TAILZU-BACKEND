/**
 * A PERSON'S SPACE: WHAT THEIR BOTS KNOW ABOUT THEM, IN SECTIONS, WITH THEIR OWN THINGS BESIDE IT. One place to read, change and switch off.
 *
 *   overview(userId)              every section: how much is in it, a peek, and whether bots may use it
 *   section(userId, id)           one section: its lines (what bots learned, each with the bots that keep it) and the things that belong
 *                                 there (today's plans, home and trips, groups, projects, notes, each bot)
 *   add(userId, section, text)    a line they write themselves, kept for all their bots (never health, religion, politics or money)
 *   change(userId, key, patch)    pin it (every bot sees it first), move it to another section, or reword it (every copy)
 *   forget(userId, key)           gone from every bot that kept it
 *   use(userId, section, on)      a section switched off: its lines stay here for them, and no bot is shown them
 *
 * Nothing is copied: the lines are the ones bots already keep (bot_facts: each bot's own and the shared "_you"), filed by rules as they are read
 * (spaceFile.ts), so deleting the person's data or account clears it as before. What they change here is kept beside their settings
 * (privacy.space: sections off, pins, moves). The same line kept by three bots is one line here, and forgetting it forgets all three.
 */
import { usableFact } from "../bots/memory.js";
import { dropSharedCache, sensitive, SHARED_ID, SHARED_KEEP } from "../bots/shared.js";
import { botStore, type BotStore } from "../bots/store.js";
import { LIMITS } from "../bots/types.js";
import type { OwnItem, ShareSources } from "../botsBots/spaceShares.js";
import { fileFact, keyOf, sectionOf } from "./spaceFile.js";
import { FACT_SECTIONS, isFactSection, NO_MARKS, PINS_MAX, SECTION_IDS, type FactSection, type SectionId, type SpaceMarks } from "./spaceMarks.js";
import { youStore, type YouStore } from "./store.js";

export const SECTION_NAMES: Record<SectionId, string> = {
  about: "About you", day: "Your day", people: "People", places: "Places", likes: "Likes",
  money: "Money", work: "Work", bots: "Bots", files: "Files & notes", timeline: "Timeline",
};
export const SECTION_LINES: Record<SectionId, string> = {
  about: "Who you are, and how you like to be talked to.",
  day: "Your routine, and what's on next.",
  people: "The people in your life, and your groups.",
  places: "Home, where you're from, and your trips.",
  likes: "What you like, and how you like things done.",
  money: "Only the bot you told keeps these. Your other bots never see them.",
  work: "Your work and studies, and your Xode projects.",
  bots: "What each of your bots knows about you.",
  files: "Your notes.",
  timeline: "Everything your bots learned, newest first.",
};

/** One thing bots know: the same words kept by any number of bots. */
export interface SpaceLine {
  key: string; text: string; section: FactSection;
  /** The bots that keep it, by name. Empty when it is kept only for all of them. */
  from: string[];
  /** Kept for all their bots (the shared copy), not only the ones that learned it. */
  forAll: boolean;
  at: number; pinned: boolean;
}
/** Something of theirs that belongs in a section: shown, opened, never changed here. */
export interface SpaceThing { kind: "event" | "todo" | "home" | "trip" | "group" | "project" | "note" | "bot"; ref: string; title: string; line: string; at: number | null }
export interface SectionCard { id: SectionId; name: string; count: number; peek: string; off: boolean }
export interface SpaceOverview { on: boolean; total: number; sections: SectionCard[] }
export interface SectionView {
  id: SectionId; name: string; line: string;
  /** Bots may use it: null for the sections that hold no lines of their own. */
  use: boolean | null;
  /** They may write a line into it. */
  canAdd: boolean;
  on: boolean;
  lines: SpaceLine[]; things: SpaceThing[];
  me?: { name: string; gender: string | null };
}

export class SpaceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export interface SpaceDeps {
  store?: BotStore;
  you?: YouStore;
  /** Their own things: plans, notes, trips, projects (botsBots/shareSources.ts). */
  sources?: ShareSources;
  /** Their groups, each with the other people in it. */
  groups?: (userId: string) => Promise<Array<{ id: string; name: string; people: string[] }>>;
  /** Where their day starts (Plan Ease's home), "" when not set. */
  home?: (userId: string) => Promise<string>;
  now?: () => number;
}

const DAY = 86_400_000;
const PEEK_CHARS = 60;
const cut = (s: string, n = PEEK_CHARS) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export class UserSpace {
  private readonly store: BotStore;
  private readonly you: YouStore;
  private readonly now: () => number;

  constructor(private readonly d: SpaceDeps = {}) {
    this.store = d.store ?? botStore();
    this.you = d.you ?? youStore();
    this.now = d.now ?? Date.now;
  }

  private async marks(userId: string): Promise<{ marks: SpaceMarks; on: boolean }> {
    const p = (await this.you.getSettings(userId)).privacy;
    return { marks: p.space ?? NO_MARKS, on: p.personalise !== false };
  }

  private async saveMarks(userId: string, marks: SpaceMarks, keys: ReadonlySet<string>): Promise<void> {
    const s = await this.you.getSettings(userId);
    // Only lines still kept somewhere keep a pin or a move.
    const clean: SpaceMarks = {
      off: marks.off,
      pins: marks.pins.filter((k) => keys.has(k)),
      moved: Object.fromEntries(Object.entries(marks.moved).filter(([k]) => keys.has(k))),
    };
    await this.you.putSettings(userId, { ...s, privacy: { ...s.privacy, space: clean } }, this.now());
    dropSharedCache(userId);
  }

  /** Every line, one per wording, with the names of the bots that keep it. */
  async lines(userId: string, marks: SpaceMarks): Promise<{ lines: SpaceLine[]; copies: Map<string, Array<{ botId: string; id: string }>>; bots: Map<string, { name: string; slug: string }> }> {
    const facts = await this.store.listAllFacts(userId);
    const ids = [...new Set(facts.map((f) => f.botId).filter((b) => b !== SHARED_ID))];
    const bots = new Map<string, { name: string; slug: string }>();
    await Promise.all(ids.map(async (id) => {
      const b = await this.store.getById(id).catch(() => null);
      bots.set(id, { name: b?.name ?? "A bot", slug: b?.slug ?? "" });
    }));
    const pins = new Set(marks.pins);
    const byKey = new Map<string, SpaceLine>();
    const copies = new Map<string, Array<{ botId: string; id: string }>>();
    for (const f of facts) {
      const key = keyOf(f.text);
      copies.set(key, [...(copies.get(key) ?? []), { botId: f.botId, id: f.id }]);
      const had = byKey.get(key);
      const name = f.botId === SHARED_ID ? null : bots.get(f.botId)!.name;
      if (had) {
        if (name && !had.from.includes(name)) had.from.push(name);
        if (f.botId === SHARED_ID) had.forAll = true;
        had.at = Math.max(had.at, f.createdAt);
        continue;
      }
      byKey.set(key, { key, text: f.text, section: sectionOf(f.text, marks), from: name ? [name] : [], forAll: f.botId === SHARED_ID, at: f.createdAt, pinned: pins.has(key) });
    }
    // Pinned first, then newest first.
    const lines = [...byKey.values()].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at - a.at);
    return { lines, copies, bots };
  }

  private async list(userId: string, bot: keyof ShareSources): Promise<OwnItem[]> {
    const s = this.d.sources?.[bot];
    return s ? s.list(userId).catch(() => []) : [];
  }

  /** The things that belong in a section (a section with none: nothing is read). */
  private async things(userId: string, id: SectionId, bots: Map<string, { name: string; slug: string }>, lines: SpaceLine[]): Promise<SpaceThing[]> {
    const now = this.now();
    switch (id) {
      case "day": {
        // What's on next: the coming two days, and open to-dos.
        const items = await this.list(userId, "plan");
        return items.filter((i) => i.line === "To-do" || (i.at !== null && i.at >= now - DAY / 4 && i.at <= now + 2 * DAY)).slice(0, 8)
          .map((i) => ({ kind: i.line === "To-do" ? "todo" : "event", ref: i.id, title: i.title, line: i.line, at: i.at }));
      }
      case "places": {
        const [home, trips] = await Promise.all([this.d.home ? this.d.home(userId).catch(() => "") : Promise.resolve(""), this.list(userId, "travel")]);
        return [
          ...(home ? [{ kind: "home" as const, ref: "home", title: home, line: "Where your day starts", at: null }] : []),
          ...trips.slice(0, 8).map((t) => ({ kind: "trip" as const, ref: t.id, title: t.title, line: t.line, at: t.at })),
        ];
      }
      case "people": {
        const groups = this.d.groups ? await this.d.groups(userId).catch(() => []) : [];
        return groups.slice(0, 12).map((g) => ({ kind: "group", ref: g.id, title: g.name, line: g.people.length ? g.people.slice(0, 4).join(", ") + (g.people.length > 4 ? ` and ${g.people.length - 4} more` : "") : "Only you so far", at: null }));
      }
      case "work":
        return (await this.list(userId, "code")).slice(0, 12).map((p) => ({ kind: "project", ref: p.id, title: p.title, line: p.line, at: p.at }));
      case "files":
        return (await this.list(userId, "notes")).slice(0, 30).map((n) => ({ kind: "note", ref: n.id, title: n.title, line: n.line, at: n.at }));
      case "bots": {
        const count = new Map<string, number>();
        for (const l of lines) for (const n of l.from) count.set(n, (count.get(n) ?? 0) + 1);
        return [...bots.values()].filter((b, i, all) => all.findIndex((x) => x.name === b.name) === i)
          .map((b) => ({ kind: "bot" as const, ref: b.slug, title: b.name, line: `Knows ${plural(count.get(b.name) ?? 0, "thing")}`, at: null }))
          .sort((a, b) => (count.get(b.title) ?? 0) - (count.get(a.title) ?? 0));
      }
      default:
        return [];
    }
  }

  async overview(userId: string): Promise<SpaceOverview> {
    const { marks, on } = await this.marks(userId);
    const { lines, bots } = await this.lines(userId, marks);
    const off = new Set(marks.off);
    const [day, places, people, work, files] = await Promise.all((["day", "places", "people", "work", "files"] as const).map((id) => this.things(userId, id, bots, lines).catch(() => [])));
    const thingsOf: Partial<Record<SectionId, SpaceThing[]>> = { day, places, people, work, files };
    const sections = SECTION_IDS.map((id): SectionCard => {
      if (id === "timeline") return { id, name: SECTION_NAMES[id], count: lines.length, peek: lines[0] ? cut(lines[0].text) : "", off: false };
      if (id === "bots") return { id, name: SECTION_NAMES[id], count: bots.size, peek: [...new Set([...bots.values()].map((b) => b.name))].slice(0, 3).join(", "), off: false };
      const mine = isFactSection(id) ? lines.filter((l) => l.section === id) : [];
      const things = thingsOf[id] ?? [];
      const peek = mine[0]?.text ?? things[0]?.title ?? "";
      return { id, name: SECTION_NAMES[id], count: mine.length + things.length, peek: cut(peek), off: isFactSection(id) && off.has(id) };
    });
    return { on, total: lines.length, sections };
  }

  /** One section. About you also shows their name and gender, read with their own session (`profile`). */
  async section(userId: string, id: SectionId, o: { profile?: () => Promise<{ name: string; gender: string | null }> } = {}): Promise<SectionView> {
    const { marks, on } = await this.marks(userId);
    const { lines, bots } = await this.lines(userId, marks);
    const fact = isFactSection(id);
    const [things, me] = await Promise.all([
      this.things(userId, id, bots, lines).catch(() => []),
      id === "about" && o.profile ? o.profile().catch(() => null) : Promise.resolve(null),
    ]);
    return {
      id, name: SECTION_NAMES[id], line: SECTION_LINES[id],
      use: fact ? !marks.off.includes(id) : null,
      canAdd: fact && id !== "money",
      on,
      lines: id === "timeline" ? [...lines].sort((a, b) => b.at - a.at) : fact ? lines.filter((l) => l.section === id) : [],
      things,
      ...(me ? { me } : {}),
    };
  }

  /** A line they write: one short line, kept for all their bots, in the section they wrote it in. */
  async add(userId: string, section: unknown, raw: unknown): Promise<SpaceLine> {
    if (!isFactSection(section)) throw new SpaceError(400, "bad_section", "That isn't a section you can write in.");
    if (section === "money") throw new SpaceError(400, "money_stays", "Money stays with the one bot you tell. Tell that bot instead.");
    const text = typeof raw === "string" ? usableFact(raw) : null;
    if (!text) throw new SpaceError(400, "bad_line", "Write one short line (up to 160 letters), with no passwords or codes.");
    if (sensitive(text)) throw new SpaceError(400, "sensitive", "Health, religion, politics and money stay with the one bot you tell. Tell that bot instead.");
    const { marks } = await this.marks(userId);
    const now = this.now();
    await this.store.addFacts(userId, SHARED_ID, [text], SHARED_KEEP, now);
    const key = keyOf(text);
    const moved = { ...marks.moved };
    if (fileFact(text) === section) delete moved[key]; else moved[key] = section;
    const { lines } = await this.lines(userId, { ...marks, moved });
    await this.saveMarks(userId, { ...marks, moved }, new Set(lines.map((l) => l.key)));
    return lines.find((l) => l.key === key) ?? { key, text, section, from: [], forAll: true, at: now, pinned: false };
  }

  /** Pin it, move it, or reword it: every bot's copy alike. */
  async change(userId: string, key: string, patch: { pinned?: unknown; section?: unknown; text?: unknown }): Promise<SpaceLine> {
    const { marks } = await this.marks(userId);
    const { lines, copies } = await this.lines(userId, marks);
    const line = lines.find((l) => l.key === key);
    if (!line) throw new SpaceError(404, "not_found", "That line isn't kept any more.");
    const next: SpaceMarks = { off: marks.off, pins: [...marks.pins], moved: { ...marks.moved } };
    let cur = line;

    if (patch.text !== undefined) {
      const text = typeof patch.text === "string" ? usableFact(patch.text) : null;
      if (!text) throw new SpaceError(400, "bad_line", "Write one short line (up to 160 letters), with no passwords or codes.");
      // A shared copy never holds a sensitive line; the bots that learned it keep their own.
      const all = copies.get(key) ?? [];
      if (sensitive(text) && all.some((c) => c.botId === SHARED_ID)) throw new SpaceError(400, "sensitive", "Health, religion, politics and money stay with the one bot you tell. Tell that bot instead.");
      const now = this.now();
      for (const c of all) {
        await this.store.dropFact(userId, c.botId, c.id);
        await this.store.addFacts(userId, c.botId, [text], c.botId === SHARED_ID ? SHARED_KEEP : LIMITS.facts.perBot, now);
      }
      const nk = keyOf(text);
      if (next.pins.includes(key)) next.pins = [...next.pins.filter((k) => k !== key), nk];
      // The section stays where it was.
      if (fileFact(text) !== line.section) next.moved[nk] = line.section;
      delete next.moved[key];
      cur = { ...line, key: nk, text, at: now };
    }
    if (patch.section !== undefined) {
      if (!isFactSection(patch.section)) throw new SpaceError(400, "bad_section", "That isn't a section.");
      if (fileFact(cur.text) === patch.section) delete next.moved[cur.key]; else next.moved[cur.key] = patch.section;
      cur = { ...cur, section: patch.section };
    }
    if (patch.pinned !== undefined) {
      if (typeof patch.pinned !== "boolean") throw new SpaceError(400, "bad_request", "pinned is true or false.");
      next.pins = next.pins.filter((k) => k !== cur.key);
      if (patch.pinned) {
        if (next.pins.length >= PINS_MAX) throw new SpaceError(409, "pins_full", `You can pin ${PINS_MAX} lines. Unpin one first.`);
        next.pins.push(cur.key);
      }
      cur = { ...cur, pinned: patch.pinned };
    }
    const keys = new Set(lines.map((l) => l.key));
    keys.add(cur.key);
    await this.saveMarks(userId, next, keys);
    return cur;
  }

  /** Forgotten by every bot that kept it. */
  async forget(userId: string, key: string): Promise<number> {
    const { marks } = await this.marks(userId);
    const { lines, copies } = await this.lines(userId, marks);
    const all = copies.get(key) ?? [];
    if (!all.length) throw new SpaceError(404, "not_found", "That line isn't kept any more.");
    let n = 0;
    for (const c of all) if (await this.store.dropFact(userId, c.botId, c.id)) n += 1;
    await this.saveMarks(userId, marks, new Set(lines.map((l) => l.key).filter((k) => k !== key)));
    return n;
  }

  /** Bots may use a section, or not. Its lines stay either way. */
  async use(userId: string, section: unknown, on: unknown): Promise<boolean> {
    if (!isFactSection(section)) throw new SpaceError(400, "bad_section", "That section holds nothing bots use.");
    if (typeof on !== "boolean") throw new SpaceError(400, "bad_request", "on is true or false.");
    const { marks } = await this.marks(userId);
    const off = new Set(marks.off);
    if (on) off.delete(section); else off.add(section);
    const { lines } = await this.lines(userId, marks);
    await this.saveMarks(userId, { ...marks, off: FACT_SECTIONS.filter((s) => off.has(s)) }, new Set(lines.map((l) => l.key)));
    return on;
  }
}
