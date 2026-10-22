/**
 * WHICH APPS, AND WHICH OF THEIR TOOLS, THE PLANNER GETS TO SEE.
 *
 * First time right: the planner should be handed the one app that does what
 * was asked, with the tool that does it first, not three apps that share a
 * word with it. So (route()):
 *
 *   1. read the request (intent.ts): the app they named, the job (an event,
 *      a to-do, a message...), the verb, or a question that needs no app.
 *   2. an app they NAMED wins outright. Named but not connected (or not an
 *      app Tailzu has): no app, and the planner is told to say "connect X",
 *      never handed a stand-in. An automation hub named as the way ("via
 *      zapier", "use composio to") wins over the app it reaches.
 *   3. otherwise the JOB picks among the person's connected apps that do it
 *      (JOB_APPS): the one used in the last week, else the fixed order (a
 *      reminder goes to Todoist before Google Tasks, a note to Evernote
 *      before Notion). An automation hub only when no app that does the job
 *      directly is connected (JOB_HUBS).
 *   4. a question about the world or the screen: no app.
 *   5. nothing of the above: the old word overlap, only over apps the job
 *      tables do not know, and a catalog app only by being the app in front.
 *      Up to three, as before. An app the person added by link is picked
 *      only when named, and named only as any app is (intent.ts namedFor):
 *      not inside what a reminder or a message says, not in a question.
 *
 * When one app is picked (sure), the planner sees only that app's tools, and
 * only it is asked for its tool list. Two requests that land on the same app
 * ("cancel my 3pm and put a call at 5") are one pick with both verbs. Its
 * tools are ordered by the verb (create, read, move, delete, complete...):
 * the tool the words name first, then those whose verb is asked (by the order
 * asked, then by words in common, so "search confluence" is Confluence's
 * search and not Jira's), then the list tool a change needs for an id, then
 * three more (toolCards()). The first is offered as "pick:" only when it is
 * plainly ahead of the next, and never for an app added by link.
 *
 * Plain rules and lexical overlap, no model call and no embeddings: this runs
 * on every step of every run and must be free and the same every time.
 */
import type { ConnectorDef } from "./catalog.js";
import type { ToolInfo } from "./client.js";
import { JOB_APPS, JOB_HUBS, KNOWN_IDS, readIntent, toolVerb, type Intent, type Job, type Named, type Verb } from "./intent.js";

export const MAX_CONNECTORS = 3;
export const MAX_TOOLS = 12;
/** Tools shown beside the chosen one (and the list tool it needs) when the app is sure. */
export const MORE_TOOLS = 3;
const WEEK_MS = 7 * 24 * 60 * 60_000;

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "their", "them", "then", "than", "have", "has",
  "are", "was", "were", "will", "can", "all", "any", "not", "but", "you", "its", "per", "via", "etc", "use", "uses",
  "using", "new", "one", "out", "get", "set", "app", "apps", "please", "just", "want", "need", "like", "make", "tell",
  // Question and filler words: in every kind of request, so evidence of none.
  "what", "whats", "who", "how", "which", "when", "where", "why", "about", "more", "some",
]);

const stem = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
export const wordsOf = (s: string): string[] =>
  s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);
const keywords = (s: string) => wordsOf(s).filter((w) => w.length >= 3 && !STOP.has(w));
const phrase = (s: string) => ` ${wordsOf(s).join(" ")} `;
/** What people say for the words tools are named by: a PR is a pull request, a ticket or a bug an issue, a to-do a task. */
const SAID_AS: Readonly<Record<string, readonly string[]>> = {
  pr: ["pull", "request"], prs: ["pull", "request"], repo: ["repository"], ticket: ["issue"], bug: ["issue"], msg: ["message"],
  find: ["search"], todo: ["task"], todos: ["task"], reminder: ["task"],
};
const saidWords = (s: string) => new Set(wordsOf(s).flatMap((w) => [w, ...(SAID_AS[w] ?? [])]).filter((w) => w.length >= 3 && !STOP.has(w)));

export interface Candidate { def: ConnectorDef; lastUsedAt: number | null }

export interface ConnectorScore { id: string; score: number }

/** One app the planner will see, with what to put first among its tools. */
export interface Pick extends ConnectorScore {
  /** Chosen because they named it, because it does the job, or (the fallback) by words in common. */
  by: "name" | "job" | "words";
  verb?: Verb | null;
  /** Every verb asked of this app, in the order said: two requests that land on it ("cancel my 3pm and put a call at 5") keep both. */
  verbs?: Verb[];
  /** Our own tool the words name (phone.text, play.spotify). */
  tool?: string;
}

/** An app named but not there: its name, and the catalog ids that would be it (none when Tailzu has no such app). */
export interface Missing { label: string; ids: readonly string[] }

export interface Route {
  picks: Pick[];
  /** One app, chosen for a job or by name: the planner sees only its tools. */
  sure: boolean;
  /** Apps they named that are not connected, or that Tailzu has no way into: the planner says so, and uses nothing else. */
  missing: Missing[];
  intent: Intent;
}

/** An app the job tables and the names know: chosen only by them, never by a word it shares. */
const known = (def: ConnectorDef) => !def.custom && KNOWN_IDS.has(def.id);

/** The top apps for these words, best first. Empty when no app has any signal. */
export function pickConnectors(utterance: string, frontApp: string, have: Candidate[], now = Date.now()): ConnectorScore[] {
  return route(utterance, frontApp, have, now).picks.map(({ id, score }) => ({ id, score }));
}

/** Which apps the planner sees for these words, and why. */
export function route(utterance: string, frontApp: string, have: Candidate[], now = Date.now()): Route {
  // The apps the person added, by the names they gave them: named like any other app.
  const own = have.filter((h) => h.def.custom).map((h) => ({ id: h.def.id, names: [h.def.name, ...h.def.aliases].filter((n) => n.trim()) }));
  const intent = readIntent(utterance, own);
  const none = (missing: Missing[] = []): Route => ({ picks: [], sure: false, missing, intent });

  const clauses = [intent, ...(intent.more ?? [])];
  const picks: Pick[] = [];
  const missing: Missing[] = [];
  for (const c of clauses) {
    const r = pickFor(c, have, now, phrase(frontApp));
    if ("missing" in r) missing.push(...r.missing.filter((m) => !missing.some((x) => x.label === m.label)));
    else if (r.pick) {
      const same = picks.find((p) => p.id === r.pick!.id);
      // Two requests for one app: one pick, both verbs (and the tool the first named).
      if (same) { if (r.pick.verb && !same.verbs!.includes(r.pick.verb)) same.verbs!.push(r.pick.verb); }
      else picks.push({ ...r.pick, verbs: r.pick.verb ? [r.pick.verb] : [] });
    }
  }
  if (missing.length && !picks.length) return none(missing);
  if (picks.length) return { picks: picks.slice(0, MAX_CONNECTORS), sure: picks.length === 1, missing, intent };
  // A job no connected app of ours does: an app we do not know may still do it, by its words.
  if (intent.job) return { picks: scoreUnknown(utterance, frontApp, have, now, false), sure: false, missing: [], intent };
  if (intent.guarded) return none();
  return { picks: scoreUnknown(utterance, frontApp, have, now, true), sure: false, missing: [], intent };
}

/** The app for one request: by the name they said, else by the job. */
function pickFor(c: Intent, have: Candidate[], now: number, front = " "): { pick?: Pick } | { missing: Missing[] } {
  const base = { verb: c.verb, ...(c.tool ? { tool: c.tool } : {}) };
  if (c.named.length) {
    const resolved: Array<{ n: Named; apps: Candidate[] }> = [];
    const unresolved: Named[] = [];
    for (const n of c.named) {
      let apps = n.ids.map((id) => have.find((h) => h.def.id === id)).filter((h): h is Candidate => !!h);
      // An app of the person's own that answers to the name ("slack").
      if (!apps.length) apps = have.filter((h) => !known(h.def) && !h.def.custom && [h.def.name, ...h.def.aliases].map(phrase).includes(phrase(n.phrase)));
      if (apps.length) resolved.push({ n, apps });
      // Not connected, but in front of them: done on the screen, not through an app.
      else if (!front.includes(phrase(n.label))) unresolved.push(n);
    }
    const hub = resolved.find((r) => r.n.via);
    const take = hub ?? (unresolved.length ? undefined : resolved[0]);
    if (!take && unresolved.length) return { missing: unresolved.map((n) => ({ label: n.label, ids: n.ids })) };
    if (!take) return c.job ? jobPick(c, have, now, base) : {};
    // A name with two apps behind it (YouTube: play it, or search it): the job says which.
    const app = (c.job && take.apps.find((h) => JOB_APPS[c.job!].includes(h.def.id))) || take.apps[0]!;
    return { pick: { id: app.def.id, score: 10, by: "name", ...base, ...(take.n.tool ? { tool: take.n.tool } : {}) } };
  }
  return c.job ? jobPick(c, have, now, base) : {};
}

function jobPick(c: Intent, have: Candidate[], now: number, base: Omit<Pick, "id" | "score" | "by">): { pick?: Pick } {
  const app = bestFor(c.job!, have, now);
  return app ? { pick: { id: app.def.id, score: 10, by: "job", ...base } } : {};
}

/** The connected app for a job: used in the last week, else the first in the job's order; a hub only when nothing else does it. */
function bestFor(job: Job, have: Candidate[], now: number): Candidate | undefined {
  for (const ids of [JOB_APPS[job], JOB_HUBS[job] ?? []]) {
    const apps = ids.map((id) => have.find((h) => h.def.id === id && !h.def.custom)).filter((h): h is Candidate => !!h);
    if (!apps.length) continue;
    const recent = apps.filter((h) => h.lastUsedAt && now - h.lastUsedAt < WEEK_MS).sort((a, b) => b.lastUsedAt! - a.lastUsedAt!);
    return recent[0] ?? apps[0];
  }
  return undefined;
}

/**
 * The old overlap, for apps the job tables do not know: an alias or the name
 * in their words is the strongest signal; the app in front, a word shared with
 * the one-line description (and not already an alias said), and use in the
 * last week add to it. A known catalog app takes part only as the app in
 * front, and only when the words are not a question (`front`); a hand-off and
 * an app the person added never do.
 */
function scoreUnknown(utterance: string, frontApp: string, have: Candidate[], now: number, front: boolean): Pick[] {
  const said = phrase(utterance);
  const inFront = phrase(frontApp);
  const saidWords = new Set(keywords(utterance));
  const scored: Pick[] = [];
  for (const { def, lastUsedAt } of have) {
    if (def.custom || def.auth === "none") continue;
    const names = [def.name, ...def.aliases].map(phrase).filter((a) => a.trim());
    let signal = 0;
    if (known(def)) {
      if (front && names.some((n) => inFront.includes(n))) signal += 4;
    } else {
      // Each alias once as it reads after stemming: "video" and "videos" are one word said.
      const aliases = new Set(def.aliases.map(phrase));
      const hit = new Set<string>();
      for (const a of aliases) if (a.trim() && said.includes(a)) { signal += 10; for (const w of a.trim().split(" ")) hit.add(w); }
      if (names.some((n) => said.includes(n)) && signal === 0) signal += 10;
      if (names.some((n) => inFront.includes(n))) signal += 4;
      const desc = new Set(keywords(def.oneLine));
      for (const w of saidWords) if (desc.has(w) && !hit.has(w)) signal += 2;
    }
    if (signal <= 0) continue;
    const recent = lastUsedAt && now - lastUsedAt < WEEK_MS ? 3 * (1 - (now - lastUsedAt) / WEEK_MS) : 0;
    scored.push({ id: def.id, score: signal + recent, by: "words" });
  }
  // Stable: equal scores keep the order the person's connections came in.
  return scored.map((s, i) => ({ s, i })).sort((a, b) => b.s.score - a.s.score || a.i - b.i).map((x) => x.s).slice(0, MAX_CONNECTORS);
}

export interface Card {
  connector: string;
  name: string;
  /** The description's first sentence. */
  description: string;
  /** Arguments as a short schema: {"query":"string","limit?":"number"}. */
  args: string;
}

const firstSentence = (s: string | undefined, max = 160) => {
  const one = (s ?? "").replace(/\s+/g, " ").trim();
  const cut = /^(.+?[.!?])(\s|$)/.exec(one)?.[1] ?? one;
  return cut.length > max ? cut.slice(0, max - 1).trimEnd() + "…" : cut;
};

function argsOf(schema: ToolInfo["inputSchema"]): string {
  const props = (schema?.properties ?? {}) as Record<string, { type?: unknown; enum?: unknown[] }>;
  const required = new Set(schema?.required ?? []);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props).slice(0, 8)) {
    const type = Array.isArray(v?.enum) && v.enum.length <= 8 ? v.enum.map(String).join("|") : Array.isArray(v?.type) ? v.type.join("|") : String(v?.type ?? "any");
    out[required.has(k) ? k : `${k}?`] = type;
  }
  const s = JSON.stringify(out);
  return s.length > 400 ? s.slice(0, 399) + "…" : s;
}

/** The cards for the planner: these apps' tools, best twelve for these words (by the route's request, when given). */
export function pickTools(utterance: string, byConnector: Array<{ def: ConnectorDef; tools: ToolInfo[] }>, r?: Route): Card[] {
  return r ? toolCards(utterance, byConnector, r).cards : lexical(utterance, byConnector);
}

/** Tools by words in common, across the apps (a name hit counts more than a description hit). */
function lexical(utterance: string, byConnector: Array<{ def: ConnectorDef; tools: ToolInfo[] }>): Card[] {
  const said = saidWords(utterance);
  const all: Array<{ card: Card; score: number; order: number }> = [];
  let order = 0;
  for (const { def, tools } of byConnector) {
    for (const t of tools) {
      all.push({ score: overlap(said, t), order: order++, card: cardOf(def, t) });
    }
  }
  return all.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, MAX_TOOLS).map((x) => x.card);
}

/**
 * Words in common with a tool: 3 for each in its name, 1 for each in its
 * description. Within one app (`names`: how many of its tools have each word
 * in their name), a name word counts less the more of its tools have it
 * (every Notion tool says "notion", only one says "comment"), and a word for
 * what a tool does ("add", "search") counts less than one for what it does it
 * to: the verb has chosen the tools already, so "add a confluence page" is
 * createConfluencePage, not addCommentToJiraIssue.
 */
function overlap(said: Set<string>, t: ToolInfo, names?: Map<string, number>, own?: Set<string>): number {
  let score = 0;
  // And, within one app, a little less for each thing its name says that was not asked (the app's own name
  // aside): "open a jira ticket" is createJiraIssue, not addCommentToJiraIssue.
  for (const w of new Set(keywords(t.name))) score += said.has(w) ? (names ? (ACTION_WORDS.has(w) ? 1 : 3 / (names.get(w) ?? 1)) : 3) : names && !ACTION_WORDS.has(w) && !own?.has(w) ? -0.25 : 0;
  for (const w of new Set(keywords(t.description ?? ""))) if (said.has(w)) score += names && ACTION_WORDS.has(w) ? 0.5 : 1;
  return score;
}

const cardOf = (def: ConnectorDef, t: ToolInfo): Card =>
  ({ connector: def.id, name: t.name, description: firstSentence(t.description), args: argsOf(t.inputSchema) });

/** A change that names its thing by an id it has to look up first. */
const NEEDS_ID: ReadonlySet<Verb> = new Set(["move", "delete", "complete"]);

/** The words in a tool's name that say what it does, not what it does it to. */
const ACTION_WORDS = new Set(["list", "get", "search", "find", "fetch", "read", "query", "show", "create", "add", "new", "make", "insert", "update", "edit", "change", "delete", "cancel", "remove", "archive", "move", "mark", "complete", "completed", "uncompleted", "transition", "reschedule", "using", "by", "all", "my", "one"]);
/** What a list tool lists when it lists the boxes, not the things in them: event types, projects, teams. */
const CONTAINER_WORDS = new Set(["type", "project", "team", "workspace", "user", "status", "statuse", "label", "cycle", "notebook", "base", "table", "board", "space", "folder"]);
const thingsOf = (name: string) => new Set(wordsOf(name).filter((w) => !ACTION_WORDS.has(w)));

interface Ranked { card: Card; rank: number; score: number; verbAt: number; verb: Verb | null; custom: boolean }

/**
 * Each app's tools in the order the request wants them, the apps in the order
 * picked: the tool its words name, then those whose verb is asked (in the
 * order asked, then by words in common: "search confluence" is Confluence's
 * search, "any PRs?" is the pull requests list), then, for a change, the list
 * tool that finds the thing it changes (Calendly's booked meetings, not its
 * event types), then the rest by words in common. `rank` 0 and 1 are chosen
 * by the request; each app keeps those and MORE_TOOLS more, or all of them
 * when the request chose none. Apps picked only by words in common have no
 * request to go by: their tools are ranked together by those words, as they
 * always were.
 */
function ranked(utterance: string, byConnector: Array<{ def: ConnectorDef; tools: ToolInfo[] }>, r: Route): Ranked[] {
  const said = saidWords(utterance);
  if (r.picks.every((p) => p.by === "words")) {
    return lexical(utterance, byConnector).map((card) => ({ card, rank: 3, score: 0, verbAt: 0, verb: null, custom: !!byConnector.find((b) => b.def.id === card.connector)?.def.custom }));
  }
  const out: Ranked[] = [];
  for (const { def, tools } of byConnector) {
    const p = r.picks.find((x) => x.id === def.id);
    // Our own tools say their verb (native.ts); an MCP app's is read from its tool's name, never from what it claims.
    const verbOf = (t: ToolInfo) => (def.kind === "native" ? (t as ToolInfo & { verb?: Verb }).verb : undefined) ?? toolVerb(t.name);
    const asked = p?.verbs?.length ? p.verbs : p?.verb ? [p.verb] : [];
    // Each verb asked, and where in the request: an app with no tool to complete a thing completes it by updating it.
    const at = new Map<Verb, number>();
    asked.forEach((v, i) => {
      if (!at.has(v)) at.set(v, i);
      if (v === "complete" && !tools.some((t) => verbOf(t) === "complete") && !at.has("move")) at.set("move", i);
    });
    const names = new Map<string, number>();
    for (const t of tools) for (const w of new Set(keywords(t.name))) names.set(w, (names.get(w) ?? 0) + 1);
    const own = new Set(wordsOf([def.name, ...def.aliases].join(" ")));
    // An app with one tool (the email, a payment, a ride): that tool is the job.
    const chosenAs = (t: ToolInfo) => (p?.tool && t.name === p.tool ? 0 : at.has(verbOf(t)!) || (p && tools.length === 1) ? 1 : 3);
    const order = (xs: Array<{ t: ToolInfo; order: number; rank: number; score: number; verbAt: number }>) =>
      xs.sort((a, b) => a.rank - b.rank || (a.rank === 1 ? a.verbAt - b.verbAt : 0) || b.score - a.score || a.order - b.order);
    const first = order(tools.map((t, i) => ({ t, order: i, rank: chosenAs(t), score: overlap(said, t, names, own), verbAt: at.get(verbOf(t)!) ?? 0 })))
      .find((x) => x.rank <= 1 && NEEDS_ID.has(verbOf(x.t)!));
    // The tool that finds the id the first change needs: a list or a search of the thing it changes (not a get by
    // that id, not a list of its containers), the app's name that every one of its tools carries not counting as a thing.
    const thing = (name: string) => new Set([...thingsOf(name)].filter((w) => tools.length < 2 || (names.get(w) ?? 0) < tools.length));
    const changed = first ? thing(first.t.name) : new Set<string>();
    const helper = first
      ? tools.filter((t) => verbOf(t) === "read" && /list|search|get|find|fetch/i.test(t.name))
        .map((t, i) => {
          const w = thing(t.name);
          return { t, i, names: [...w].filter((x) => changed.has(x)).length, lists: /list|search|find/i.test(t.name) ? 1 : 0, box: [...w].some((x) => CONTAINER_WORDS.has(x)) ? 1 : 0 };
        })
        .sort((a, b) => Number(b.names > 0) - Number(a.names > 0) || b.lists - a.lists || a.box - b.box || b.names - a.names || a.i - b.i)[0]?.t
      : undefined;
    const rankOf = (t: ToolInfo) => { const r = chosenAs(t); return r < 3 ? r : t === helper ? 2 : 3; };
    const mine = order(tools.map((t, i) => ({ t, order: i, rank: rankOf(t), score: overlap(said, t, names, own), verbAt: at.get(verbOf(t)!) ?? 0 })));
    const chosen = mine.filter((x) => x.rank < 3).length;
    const keep = p && p.by !== "words" && chosen > 0 ? mine.slice(0, chosen + MORE_TOOLS) : mine;
    out.push(...keep.map((x) => ({ card: cardOf(def, x.t), rank: x.rank, score: x.score, verbAt: x.verbAt, verb: verbOf(x.t), custom: !!def.custom })));
  }
  return out.slice(0, MAX_TOOLS);
}

/**
 * The cards for a route, and the tool to offer as "pick:": the first card,
 * when the app is sure, that tool was chosen by the request's own words or
 * verb (not by the order it happened to be listed in), and it is plainly
 * ahead of the next one (not tied with it, and not one of two changes
 * asked). Never for an app the person added by link: its tool list is its
 * own say-so. `lookup` is the tool that finds the id a change needs, when the
 * pick is such a change: the planner is told to use it first.
 */
export function toolCards(utterance: string, byConnector: Array<{ def: ConnectorDef; tools: ToolInfo[] }>, r: Route): { cards: Card[]; pick?: string; lookup?: string } {
  const list = ranked(utterance, byConnector, r);
  const [first, second] = list;
  const ahead = !!first && (!second || second.card.connector !== first.card.connector || first.rank < second.rank
    || (first.rank === second.rank && first.verbAt === second.verbAt && first.score > second.score));
  const pick = r.sure && first && first.rank <= 1 && ahead && !first.custom ? `${first.card.connector}.${first.card.name}` : undefined;
  const helper = pick && first.verb && NEEDS_ID.has(first.verb) ? list.find((x) => x.rank === 2 && x.card.connector === first.card.connector) : undefined;
  return { cards: list.map((x) => x.card), ...(pick ? { pick } : {}), ...(helper ? { lookup: `${helper.card.connector}.${helper.card.name}` } : {}) };
}
