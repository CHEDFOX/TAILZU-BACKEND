/**
 * FIND A BOT: THE BOT STORE. Tailzu's ready-made bots, and bots people chose to list, to browse, read and add a copy of.
 *
 *   browse(user, q?)          the ready-made ones and the listed ones, each with how many people added it and whether it is yours or added
 *   entry(user, id)           one, with what it does, what it will and won't do, the apps it asks for
 *   list(user, slug)          the owner lists their bot: its public card is turned on (GET /v1/bots/:slug shows it) and it shows here
 *   unlist(user, slug)        off the store, and the card off
 *   add(user, id)             a copy for the person: the name, colour, purpose, rules, tone and the apps it asks for (each still asks before
 *                             it is used). Never the owner's files, memory, keys or commands. The copy is the person's own bot from then on.
 *
 * A listed bot is read live from the bots store each time, so what is shown is what the owner has now; a bot whose card was turned off
 * elsewhere, or that was deleted, is not shown.
 */
import { randomUUID } from "node:crypto";
import { BotError, type BotSkills, type Bots, type Colour, type StoredBot } from "../bots/index.js";
import { table, type Table } from "./rows.js";

export interface ListingRow {
  [k: string]: unknown;
  id: string;
  bot_id: string;
  owner_id: string;
  /** How the owner is shown: "Meera R.". */
  by_name: string;
  listed_ms: number;
}

export interface AddRow {
  [k: string]: unknown;
  listing_id: string;
  user_id: string;
  bot_id: string;
  added_ms: number;
}

export interface ShopEntry {
  id: string;
  kind: "ready" | "people";
  slug?: string;
  name: string;
  colour: Colour;
  purpose: string;
  by: string;
  adds: number;
  /** yours: you listed it; added: you have a copy. */
  status: "yours" | "added" | null;
  does: string[];
  will: string;
  wont: string;
  apps: string[];
}

interface Template {
  id: string; name: string; colour: Colour; purpose: string; about: string; principles: string[]; skills: BotSkills; tone: string; will: string; wont: string;
}

const skills = (on: Partial<BotSkills>): BotSkills => ({ web: false, files: false, artifacts: false, code: false, research: false, connectors: [], ...on });

/** Tailzu's ready-made bots: real definitions, added as the person's own copy. */
export const READY_MADE: readonly Template[] = [
  {
    id: "tailzu-study", name: "Study bot", colour: "plum", purpose: "Turns Classroom work into a daily plan",
    about: "Turns Classroom work into a daily plan. Good for school, college and exam prep.",
    principles: ["Read new work from Google Classroom each evening.", "Split work into 25-minute blocks before the due date.", "Put the plan in my calendar only after I say yes.", "Never submit work or message my teachers."],
    skills: skills({ connectors: ["google-classroom", "google-calendar"] }), tone: "encouraging and brief",
    will: "Read Classroom and your calendar", wont: "Submit work or message your teachers",
  },
  {
    id: "tailzu-money", name: "Money bot", colour: "stone", purpose: "Tracks UPI spends, never pays alone",
    about: "Keeps your spends in one place and totals the month. Opens UPI with the amount filled in; you press pay.",
    principles: ["Note each spend I tell you with its amount and category.", "Total my month in rupees when I ask.", "Open UPI with the amount filled in; I press pay.", "Never pay or move money by itself."],
    skills: skills({ files: true, connectors: ["upi"] }), tone: "plain and careful",
    will: "Note your spends and open UPI for you", wont: "Pay or move money by itself",
  },
  {
    id: "tailzu-recipe", name: "Recipe bot", colour: "sand", purpose: "Cooks from what's in your fridge",
    about: "Tell it what's in the fridge and it gives you a dish, with steps and times. Indian home food first.",
    principles: ["Suggest dishes from what I say is in the fridge.", "Indian home food first, with a vegetarian option.", "Give steps with times, under 30 minutes when you can.", "List what to buy separately."],
    skills: skills({ web: true }), tone: "warm and practical",
    will: "Suggest dishes, steps and a shopping list", wont: "Order or buy anything",
  },
];

const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** What a bot will do, in a line, from its skills and apps. */
function willOf(s: BotSkills, appName: (id: string) => string): string {
  const parts = [
    ...(s.web ? ["search the web"] : []), ...(s.research ? ["research with sources"] : []), ...(s.files ? ["read files you give it"] : []),
    ...(s.artifacts ? ["make pages and charts"] : []), ...(s.connectors.length ? [`use ${s.connectors.slice(0, 3).map(appName).join(", ")}`] : []),
  ];
  if (!parts.length) return "Talk it through with you";
  const line = parts.join(", ");
  return line[0]!.toUpperCase() + line.slice(1);
}

export class BotShop {
  constructor(
    private readonly bots: Bots,
    private readonly appName: (id: string) => string = (id) => id,
    private readonly now: () => number = Date.now,
    private readonly listings: Table<ListingRow> = table<ListingRow>("bot_listings"),
    private readonly adds: Table<AddRow> = table<AddRow>("bot_listing_adds"),
  ) {}

  private async addsOf(id: string): Promise<AddRow[]> {
    return this.adds.select({ listing_id: id }, { limit: 100_000 });
  }

  private async statusOf(userId: string, owner: string | null, adds: AddRow[]): Promise<ShopEntry["status"]> {
    if (owner === userId) return "yours";
    for (const a of adds.filter((x) => x.user_id === userId)) {
      const copy = await this.bots.store.getById(a.bot_id).catch(() => null);
      if (copy && copy.ownerId === userId) return "added";
    }
    return null;
  }

  private async readyEntry(userId: string, t: Template): Promise<ShopEntry> {
    const adds = await this.addsOf(t.id);
    return {
      id: t.id, kind: "ready", name: t.name, colour: t.colour, purpose: t.purpose, by: "Tailzu", adds: new Set(adds.map((a) => a.user_id)).size,
      status: await this.statusOf(userId, null, adds), does: t.principles.filter((p) => !/^never\b/i.test(p)).slice(0, 3),
      will: t.will, wont: t.wont, apps: t.skills.connectors.map(this.appName),
    };
  }

  private async peopleEntry(userId: string, l: ListingRow, b: StoredBot): Promise<ShopEntry> {
    const adds = await this.addsOf(l.id);
    const never = b.principles.find((p) => /^(never|don't|do not)\b/i.test(p));
    return {
      id: l.id, kind: "people", slug: b.slug, name: b.name, colour: b.colour, purpose: b.purpose, by: l.owner_id === userId ? "you" : l.by_name || "someone",
      adds: new Set(adds.map((a) => a.user_id)).size, status: await this.statusOf(userId, l.owner_id, adds),
      does: b.principles.filter((p) => p !== never).slice(0, 3), will: willOf(b.skills, this.appName),
      wont: never ? never.replace(/\.$/, "") : "Pay, book or send anything without your yes", apps: b.skills.connectors.map(this.appName),
    };
  }

  /** The listed bots that are still there and still public. */
  private async live(): Promise<Array<{ l: ListingRow; b: StoredBot }>> {
    const rows = await this.listings.select({}, { order: "listed_ms", desc: true, limit: 200 });
    const out: Array<{ l: ListingRow; b: StoredBot }> = [];
    for (const l of rows) {
      const b = await this.bots.store.getById(l.bot_id).catch(() => null);
      if (b && b.publicCard && b.ownerId === l.owner_id) out.push({ l, b });
    }
    return out;
  }

  async browse(userId: string, q?: string): Promise<{ readyMade: ShopEntry[]; people: ShopEntry[] }> {
    const want = words(q ?? "");
    const fits = (e: { name: string; purpose: string; principles?: string[] }) =>
      !want.length || want.some((w) => words(`${e.name} ${e.purpose} ${(e.principles ?? []).join(" ")}`).some((x) => x.startsWith(w)));
    const readyMade = await Promise.all(READY_MADE.filter(fits).map((t) => this.readyEntry(userId, t)));
    const people: ShopEntry[] = [];
    for (const { l, b } of await this.live()) if (fits(b)) people.push(await this.peopleEntry(userId, l, b));
    people.sort((a, b) => b.adds - a.adds);
    return { readyMade, people };
  }

  async entry(userId: string, id: string): Promise<ShopEntry | null> {
    const t = READY_MADE.find((x) => x.id === id);
    if (t) return this.readyEntry(userId, t);
    const [l] = await this.listings.select({ id }, { limit: 1 });
    if (!l) return null;
    const b = await this.bots.store.getById(l.bot_id).catch(() => null);
    return b && b.publicCard && b.ownerId === l.owner_id ? this.peopleEntry(userId, l, b) : null;
  }

  /** Whether the person's bot is listed. */
  async listed(userId: string, slug: string): Promise<boolean> {
    const found = await this.bots.resolve(userId, slug);
    if (!found?.stored) return false;
    return (await this.listings.select({ bot_id: found.stored.id, owner_id: userId }, { limit: 1 })).length > 0;
  }

  async list(userId: string, slug: string, byName: string): Promise<{ listed: true }> {
    const found = await this.bots.resolve(userId, slug);
    if (!found) throw new BotError("not_found", "There is no such bot.", 404);
    if (!found.stored) throw new BotError("builtin", "Tailzu's own bots are already everyone's.", 403);
    await this.bots.update(userId, found.stored.id, { publicCard: true });
    const [have] = await this.listings.select({ bot_id: found.stored.id, owner_id: userId }, { limit: 1 });
    if (!have) await this.listings.insert({ id: randomUUID(), bot_id: found.stored.id, owner_id: userId, by_name: byName.slice(0, 40), listed_ms: this.now() });
    return { listed: true };
  }

  async unlist(userId: string, slug: string): Promise<{ listed: false }> {
    const found = await this.bots.resolve(userId, slug);
    if (!found?.stored) throw new BotError("not_found", "There is no such bot.", 404);
    await this.listings.remove({ bot_id: found.stored.id, owner_id: userId });
    await this.bots.update(userId, found.stored.id, { publicCard: false });
    return { listed: false };
  }

  async add(userId: string, id: string): Promise<{ bot: { slug: string; name: string }; warnings: string[] }> {
    const t = READY_MADE.find((x) => x.id === id);
    let def: { name: string; colour: Colour; purpose: string; principles: string[]; skills: BotSkills; tone: string };
    if (t) def = { name: t.name, colour: t.colour, purpose: t.purpose, principles: t.principles, skills: t.skills, tone: t.tone };
    else {
      const [l] = await this.listings.select({ id }, { limit: 1 });
      const b = l ? await this.bots.store.getById(l.bot_id).catch(() => null) : null;
      if (!l || !b || !b.publicCard || b.ownerId !== l.owner_id) throw new BotError("not_found", "That bot isn't in the store any more.", 404);
      if (l.owner_id === userId) throw new BotError("yours", "This one is already yours.", 409);
      def = { name: b.name, colour: b.colour, purpose: b.purpose, principles: b.principles, skills: { ...b.skills, connectors: [...b.skills.connectors] }, tone: b.tone };
    }
    const made = await this.bots.create(userId, def);
    await this.adds.insert({ listing_id: id, user_id: userId, bot_id: made.bot.id, added_ms: this.now() });
    return { bot: { slug: made.bot.slug, name: made.bot.name }, warnings: made.warnings };
  }
}
