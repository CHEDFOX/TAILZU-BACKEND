/**
 * LIVE UPDATES: WHICH TOPICS A WRITE CHANGES, AND WHICH TOPICS A SCREEN LISTENS TO (the convention is bus.ts's).
 *
 *   topicsForWrite("PUT", "/v1/keybot/prefs", {})        -> ["keybot"]
 *   topicsForScreen("bots.code.job", { id: "j1" })       -> ["job:j1"]
 *
 * Both tables are here, side by side, so a topic one side names is one the other side hears. The topics:
 *
 *   home       Home and the tiles: a bot's state, what needs them, what is working, the week
 *   bots       the person's bots: made, changed, removed, added from the store
 *   bot:<slug> one bot's own pages: its chat, rules, keys, commands, memory, listing (bot:plan, bot:travel too)
 *   activity   the Activity feed: an answer, a payment, a job, a connected-app task, the day's words
 *   tasks      connected-app tasks (bots.tasks), and the person's own to-dos (src/calendar)
 *   calendar   the person's own calendar (src/calendar): Plan, Today, Tasks' upcoming
 *   code       the Code bot's lists: jobs, projects, rules, PR care
 *   job:<id>   one Code bot job: its progress, its question, its end
 *   notes      the meeting notes list;  note:<id>  one meeting's notes (its transcript grows while it records)
 *   keybot     Keybot: its settings, words, voices, history, stats
 *   you        You and account settings: profile, plan, notifications, connected apps
 *
 * Spaces and messaging ("space:<id>", "thread:<id>", "threads") and the calendar (calendar, tasks, bot:plan, from wherever it changes:
 * the app, a bot, a space, a reminder) publish their own and are left out of the write table.
 *
 * A write over HTTP is published by live/writes.ts (an onResponse hook: a 2xx write whose route is in the table below); the
 * writes that happen away from a request publish where they are made (notes/store.ts, the Code bot's job store, the history).
 * A screen's topics are added to its ScreenResponse by experience/bots/index.ts; a screen can name more with page({ live }).
 */

export const TOPIC = {
  home: "home",
  bots: "bots",
  activity: "activity",
  tasks: "tasks",
  calendar: "calendar",
  code: "code",
  notes: "notes",
  keybot: "keybot",
  you: "you",
} as const;

/** An id fit for a topic: short, no spaces, no separators of ours. Empty when there is none. */
const idOf = (v: unknown): string => {
  const s = typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
  return /^[A-Za-z0-9_.-]{1,80}$/.test(s) ? s : "";
};

export const botTopic = (slug: unknown): string => (idOf(slug) ? `bot:${idOf(slug).toLowerCase()}` : "");
export const jobTopic = (id: unknown): string => (idOf(id) ? `job:${idOf(id)}` : "");
export const noteTopic = (id: unknown): string => (idOf(id) ? `note:${idOf(id)}` : "");

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** The Bots app's own area (routes/botsBots.ts AREA). */
const AREA = "/v1/botsapp/bots";

/**
 * The topics a successful write changes, by its route PATTERN as Fastify registered it ("/v1/bots/:slug", not the URL),
 * and its params. Empty for a read, and for a write nobody else is looking at (a draft, a sign-in, a bootstrap).
 */
export function topicsForWrite(method: string, route: string, params: Record<string, unknown> = {}): string[] {
  if (!WRITES.has(String(method).toUpperCase()) || typeof route !== "string") return [];
  const p = route;
  const out = new Set<string>();
  const add = (...ts: string[]) => { for (const t of ts) if (t) out.add(t); };
  const { home, bots, activity, tasks, code, keybot, you } = TOPIC;

  if (p.startsWith(`${AREA}/spaces`)) return [];                     // Spaces and messaging publish their own
  if (p.startsWith("/v1/botsapp/calendar")) return [];                 // and so does the calendar (src/calendar/service.ts)
  if (p === "/v1/shell/ask" || p === "/v1/shell/receipts" || p === "/v1/ask") add(activity, home);
  else if (p.startsWith(`${AREA}/chat/`)) add(activity, home, botTopic(params.slug));
  else if (p.startsWith(`${AREA}/rules/`)) add(botTopic(params.slug));
  else if (p.startsWith(`${AREA}/store/`) || p === `${AREA}/draft/approve`) add(bots, home);
  else if (p.startsWith(`${AREA}/listing/`)) add(bots, botTopic(params.slug));
  else if (p.startsWith(`${AREA}/plan`)) add(botTopic("plan"), home);
  else if (p.startsWith(`${AREA}/trip`)) add(botTopic("travel"), home);
  else if (p === "/v1/bots/first-run/arrival") add(home);
  else if (p === "/v1/bots" || p === "/v1/bots/approve") add(bots, home);
  else if (p.startsWith("/v1/bots/code/")) add(code, home, p.includes("/jobs/:id") ? jobTopic(params.id) : "");
  else if (p.startsWith("/v1/bots/:slug")) {
    add(botTopic(params.slug));
    if (p === "/v1/bots/:slug") add(bots, home);
    if (p === "/v1/bots/:slug/ask") add(activity);
  } else if (p.startsWith("/v1/code/jobs/:id")) add(jobTopic(params.id), code, home, activity);
  else if (p === "/v1/code/jobs") add(code, home, activity);
  // A runner's heartbeats and results: the job store says which job changed, and only when one did (writes.ts liveJobStore).
  else if (p.startsWith("/v1/code/runner/") || p === "/v1/code/github/webhook") return [];
  else if (p.startsWith("/v1/code/")) add(code);
  else if (p.startsWith("/v1/tasks/")) add(tasks, activity, home);
  else if (p.startsWith("/v1/connectors")) add(you);
  else if (p.startsWith("/v1/keybot/") || p === "/v1/words" || p === "/v1/snippets" || p.startsWith("/v1/train/")) add(keybot);
  else if (p === "/v1/you/data/delete") add(you, keybot, activity, home);
  else if (p.startsWith("/v1/you/") || p === "/v1/profile" || p.startsWith("/v1/pay/") || p.startsWith("/v1/billing/")) add(you);
  else if (p.startsWith("/v1/personality")) add(you, keybot);
  else if (p.startsWith("/v1/history")) add(keybot, activity);
  return [...out];
}

/** Screens a live event must never reload: a live session, a training run, a flow the person is in the middle of. */
const NEVER = new Set([
  "bots.keybot.live", "bots.keybot.train", "bots.keybot.on", "bots.keybot.reply", "bots.keybot.rewrite",
]);

const KEYBOT_PAGES = new Set([
  "bots.keybot", "bots.keybot.tone", "bots.keybot.words", "bots.keybot.voices", "bots.keybot.history", "bots.keybot.settings",
  "bots.keybot.pill", "bots.keybot.month", "bots.keybot.day", "bots.keybot.apps", "bots.keybot.speak", "bots.keybot.days",
  "bots.keybot.style", "bots.keybot.haptics", "bots.keybot.name",
]);

/** The topics a Bots app screen listens to by default (its own `page({ live })` adds to these). */
export function topicsForScreen(screenId: string, params: Record<string, unknown> = {}): string[] {
  if (NEVER.has(screenId)) return [];
  if (KEYBOT_PAGES.has(screenId)) return [TOPIC.keybot];
  const { home, bots, activity, tasks, code, notes, you, keybot } = TOPIC;
  const list = (...ts: string[]) => ts.filter(Boolean);
  switch (screenId) {
    case "bots.home": case "bots.empty-home": return [home, bots];
    case "bots.activity": return [activity];
    case "bots.tasks": return [tasks, activity, TOPIC.calendar];
    case "bots.today": return [home, activity, notes, TOPIC.calendar, tasks];
    case "bots.notes": return [notes];
    case "bots.note": return noteTopic(params.id) ? [noteTopic(params.id)] : [notes];
    case "bots.you": case "bots.billing": case "bots.computer": case "bots.notify": case "bots.privacy":
    case "bots.apps": case "bots.app-connect": case "bots.language": return [you];
    case "bots.settings": return [you, keybot];
    case "bots.budget": return [you, code];
    case "bots.bot": return list(bots, botTopic(params.slug));
    case "bots.chat": case "bots.edit": case "bots.keys": return list(botTopic(params.slug));
    case "bots.store": return [bots];
    case "bots.plan": return [botTopic("plan"), TOPIC.calendar, tasks];
    case "bots.travel": return [botTopic("travel")];
    case "bots.code": case "bots.code.plan": case "bots.code.review": case "bots.code.pr-care": case "bots.code.rules": return [code];
    case "bots.code.job": case "bots.code.team": return jobTopic(params.id) ? [jobTopic(params.id)] : [code];
    case "bots.failed": return list(jobTopic(params.id));
    default: return [];
  }
}

/** A screen's own topics joined with its defaults, each once, in order. */
export function joinTopics(...lists: Array<readonly string[] | undefined>): string[] {
  return [...new Set(lists.flatMap((l) => l ?? []).filter((t) => typeof t === "string" && t.length > 0))];
}
