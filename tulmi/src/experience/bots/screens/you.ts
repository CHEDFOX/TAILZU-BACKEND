/**
 * THE YOU TAB AND WHAT HANGS OFF IT: You, Budget, Billing, This computer helps, What pings you, Privacy, Delete account, Connected apps, Connect an
 * app, and the window's Settings (You.dc.html, Budget, Billing, Devices, Notify, Privacy, DeleteAcct, Apps, AppConnect and their D* / Desk*
 * desktop boards). Plans and Language are built in screens/firstRun.ts (once first-run steps, now pages); they are linked, not built, here.
 *
 * Every number is the person's own, from the routes in routes/botsYou.ts (src/you): the month's spend over every bot's records, the stored
 * limit, the plan and invoices from billing, the computers from runner presence, the connected apps from connectors. A read that fails draws
 * the honest empty state (or ctx.live's month), never a sample. Every control writes: PUT /v1/you/settings, the existing connector, job,
 * billing and account routes, then a refresh and a short ink toast.
 *
 * Built with the kit (../kit.ts) the way screens/shell.ts builds bots.home; one id serves the phone and the window (ctx.client).
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../shared/types/sdui.js";
import {
  C, FACE, SCREENS, back, body, botAvatar, botLook, box, button, call, card, col, divider, emptyState, grow, icon, infoChip, listCard,
  listRow, meta, meter, mono, open, page, primaryButton, quietButton, row, rupees, secondaryButton, sectionLabel, seq, shapes,
  switchMark, switchRow, table, text, title, when, whenEq, type BotsCtx, type IconName,
} from "../kit.js";
import { DELETION_PATH, GRACE_DAYS, daysStrip, dayMonthOf, goneAt, keepAccount, scheduleDeletion, type DeletionState } from "./accountGrace.js";
import { PUSH_STATE, pushOffRow, withPushCheck } from "./pushAsk.js";
import { screen, type BotsScreen } from "../registry.js";

// ===================================================================== what the routes answer (routes/botsYou.ts)

interface Settings {
  monthLimitPaise: number;
  stopAtLimit: boolean;
  notify: { done: "quiet" | "ping"; summary: boolean; summaryAt: number; quiet: boolean; quietFrom: number; quietTo: number; botsOff: string[] };
  privacy: { screenPictures: "ask" | "allow" };
}
interface ByBot { bot: string; paise: number }
interface YouData {
  plan: { name: string; active: boolean };
  spend: { monthPaise: number; limitPaise: number; leftPaise: number; perDayPaise: number; resetsAt: number; byBot: ByBot[]; stopAtLimit: boolean };
  apps: { enabled: boolean; connected: Array<{ id: string; name: string; usedBy: string[]; lastUsedAt: number | null }>; github: { repos: number } | null; alone: number } | null;
  computers: { online: Array<{ name: string; busy: boolean; allowRun: boolean }>; offline: number; helped: { jobs: number; minutes: number } } | null;
  settings: Settings;
  exportUrl: string | null;
  language: string | null;
}
interface Report {
  month: string; monthStart: number; resetsAt: number; daysInMonth: number; today: number;
  monthPaise: number; limitPaise: number; leftPaise: number; stopAtLimit: boolean; perDayPaise: number; projectionPaise: number;
  byBot: ByBot[]; byDay: number[]; busiest: { day: number; paise: number } | null;
  biggest: Array<{ id: string; task: string; paise: number; at: number; minutes: number }>;
}
interface SpendData { report: Report; settings: Settings }
interface Invoice { id: string; number: string; date: number; amountPaise: number; amount: string; status: string; url: string | null; what: string }
interface BillingData {
  plan: { name: string; active: boolean; store: string | null; renews: boolean; until: number | null; since: number | null; price: string | null; period: string | null; paidBy: string | null; cancel: "razorpay" | "store" | null; manageUrl: string | null };
  invoices: Invoice[];
  month: { monthPaise: number; limitPaise: number } | null;
  email: string | null;
}
interface ComputersData {
  online: Array<{ deviceId: string; name: string; os: string; allowRun: boolean; busy: boolean; projects: "all" | "most" | number; liveOnly: boolean; container: boolean }>;
  offline: Array<{ deviceId: string; name: string; os: string; lastSeen: number }>;
  helped: { jobs: number; minutes: number };
}
interface AppsData {
  enabled: boolean;
  connected: Array<{ id: string; name: string; category: string; level: string; lastUsedAt: number | null; usedBy: string[]; needsSignIn?: boolean }>;
  more: Array<{ id: string; name: string; category: string; oneLine: string; usedBy: string[] }>;
  github: { repos: number } | null;
}
interface AppData {
  app: { id: string; name: string; category: string; oneLine: string; auth: "oauth" | "url"; provider: string | null; connected: boolean; level: string; lastUsedAt: number | null };
  bots: Array<{ slug: string; name: string; colour: string; purpose: string; builtin: boolean; linked: boolean }>;
  can: string[];
  cant: string[];
}
interface NotifyData { settings: Settings; today: { done: number; needs: number; spentPaise: number } | null; line: string | null }
interface AccountData {
  bots: Array<{ slug: string; name: string; colour: string; builtin: boolean }>;
  projects: string[];
  notes: number;
  keys: number;
  plan: { active: boolean; store: string | null; renews: boolean; until: number | null };
  exportUrl: string | null;
}

// ===================================================================== small things

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 86_400_000;

const local = (ctx: BotsCtx, t: number) => new Date(t + ctx.tzOffsetMinutes * 60_000);
/** "14 Oct" */
const dayMonth = (ctx: BotsCtx, t: number) => { const d = local(ctx, t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
/** "12 Oct 2026" */
const fullDate = (ctx: BotsCtx, t: number) => { const d = local(ctx, t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const hhmm = (ctx: BotsCtx, t: number) => { const d = local(ctx, t); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
/** "In use now", "2 min ago", "Today 10:40", "Yesterday", "Mon", "14 Oct". */
function ago(ctx: BotsCtx, t: number | null): string {
  if (!t) return "Not used yet";
  const now = ctx.live.now, mins = Math.floor((now - t) / 60_000);
  if (mins < 2) return "In use now";
  if (mins < 60) return `${mins} min ago`;
  const dayOf = (x: number) => Math.floor((x + ctx.tzOffsetMinutes * 60_000) / DAY_MS);
  const days = dayOf(now) - dayOf(t);
  if (days === 0) return `Today ${hhmm(ctx, t)}`;
  if (days === 1) return "Yesterday";
  if (days < 7) return DAYS[local(ctx, t).getUTCDay()]!;
  return dayMonth(ctx, t);
}
/** "9:00 pm", "11 pm" */
function clock(minute: number, short = false): string {
  const h = Math.floor(minute / 60) % 24, m = minute % 60, h12 = h % 12 === 0 ? 12 : h % 12, ap = h < 12 ? "am" : "pm";
  return short && m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}
const hours = (min: number) => (min < 60 ? `${min} min` : min % 60 >= 10 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${Math.floor(min / 60)} h`);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/** A bot by slug: the live one (name, colour, head), or Tailzu itself. */
function botOf(ctx: BotsCtx, slug: string) {
  const b = ctx.live.bots.find((x) => x.slug === slug);
  if (b) return { slug, name: b.name, short: b.name.replace(/ bot$/i, ""), look: b };
  const look = botLook(slug);
  const name = slug === "tailzu" ? "Tailzu" : slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
  return { slug, name, short: name.replace(/ bot$/i, ""), look };
}
const botByName = (ctx: BotsCtx, name: string) => ctx.live.bots.find((b) => b.name === name);

/** A line icon from a path of our own (24 grid), for the few the kit's set has not got. */
const glyph = (d: string, size = 20, color: string = C.ink): Node =>
  shapes([{ d, stroke: color, strokeWidth: 1.9, linecap: "round", linejoin: "round" }], { size });
const G = {
  download: "M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14",
  trash: "M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13",
  bell: "M6.5 16v-5a5.5 5.5 0 0 1 11 0v5l1.5 2h-14zM10 20.5a2 2 0 0 0 4 0",
  moon: "M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z",
  globe: "M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17zM3.5 12h17M12 3.5c2.4 2.4 3.5 5.4 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.4-3.5-8.5s1.1-6.1 3.5-8.5z",
  mail: "M3.5 6.5h17v11h-17zM3.5 7.5l8.5 6 8.5-6",
  never: "M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17zM6 6l12 12",
  card: "M3 6.5h18v11H3zM3 10h18M7 14.5h3",
  receipt: "M6 3.5h12v17l-3-2-3 2-3-2-3 2zM9 8h6M9 11.5h6",
  sliders: "M5 7h14M5 17h14M9 4.5v5M15 14.5v5",
  rules: "M5 6.5h14M5 12h14M5 17.5h9",
  box: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8",
  battery: "M3.5 8h15v8h-15zM18.5 10.5h2v3h-2M6 10.5v3",
};

const APP_ICON: Record<string, IconName> = { Calendar: "calendar", Tasks: "check", Docs: "notes", Code: "code", School: "book", Projects: "today", Notes: "notes", "Meeting notes": "notes" };
function appIcon(category: string, size = 20): Node {
  return box([category === "Email" ? glyph(G.mail, size) : icon(APP_ICON[category] ?? "link", { size })], {
    width: size + 16, height: size + 16, borderRadius: 10, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center", flexShrink: 0,
  });
}

const toast = (message: string): ActionSpec => ({ kind: "toast", message });
const refresh: ActionSpec = { kind: "refresh" };
const oops = (what = "save that"): ActionSpec => ({ kind: "toast", message: `Couldn't ${what}. Try again.`, tone: "error" });
/** A setting saved: PUT /v1/you/settings, a short toast, a refresh. */
const save = (b: Record<string, unknown>, ok: string): ActionRef => call("PUT", "/v1/you/settings", b, { ok: seq(toast(ok), refresh), fail: oops() });
const when2 = (path: string, then: ActionRef, otherwise: ActionRef): ActionSpec => ({ kind: "condition", if: { truthy: path }, then, else: otherwise });
const openUrl = (url: string): ActionSpec => ({ kind: "openUrl", url });
/** Help: the whole app's, kept here (Keybot links nothing account-wide). */
const HELP = [
  { label: "Write to us", value: "support@tailzu.space", url: "mailto:support@tailzu.space" },
  { label: "Privacy policy", value: "", url: "https://tailzu.space/privacy" },
  { label: "Terms of use", value: "", url: "https://tailzu.space/terms" },
] as const;
const helpAction = (url: string): ActionSpec => ({ kind: "openUrl", url, external: true });

/** A text input in an outlined box, into a state path. */
function field(path: string, placeholder: string, o: { keyboard?: "numeric" | "url" } = {}): Node {
  return row([{
    type: "TextField", id: path, bind: { value: path },
    props: {
      placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0, minHeight: 40, color: C.ink,
      ...(o.keyboard === "numeric" ? { keyboardType: "number-pad" } : o.keyboard === "url" ? { keyboardType: "url", autoCapitalize: "none" } : {}),
    },
    style: { flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 40, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.regular, fontSize: 15, color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none" },
  }], { borderWidth: 1, borderColor: C.outline, borderRadius: 12, paddingHorizontal: 14, minHeight: 44 });
}

/** The window's two columns: the main one, and a narrower one beside it. */
const columns = (left: Node[], right: Node[], o: { gap?: number; rightWidth?: number } = {}): Node =>
  row([
    col(left, { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, gap: 18 }),
    col(right, { width: o.rightWidth ?? 340, flexShrink: 0, gap: 18 }),
  ], { alignItems: "flex-start", gap: o.gap ?? 20 });

/** A page's heading: the title, and a line under it. */
const heading = (ctx: BotsCtx, t: string, sub?: string): Node =>
  col([title(t, ctx.client === "desktop" ? { size: 28, lineHeight: 34 } : {}), ...(sub ? [meta(sub, { size: 14, lineHeight: 19, color: C.grey70 })] : [])], { gap: 4 });

/** Something the screen could not read: says so, plainly. */
const couldNot = (what: string): Node => card([body(`Couldn't load ${what}.`, { size: 14 }), meta("Pull down to try again, or come back in a moment.", { size: 13 })], { gap: 4 });

/** A lock and "Always on": a ping that can't be turned off. */
const alwaysOn = (label = "Always on"): Node => row([icon("lock", { size: 13, color: C.meta }), meta(label, { size: 12 })], { gap: 4 });

/** A selected-or-not pill that saves on press (the state follows on both clients). */
function pills(options: Array<{ label: string; value: string }>, path: string, onPick: (value: string) => ActionRef): Node {
  return row(options.map((opt) => row([text(opt.label, { size: 13, lineHeight: 17, style: { color: whenEq(path, opt.value, C.paper, C.ink) } })], {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1,
    borderColor: whenEq(path, opt.value, C.ink, C.outline), backgroundColor: whenEq(path, opt.value, C.ink, C.paper),
  }, seq({ kind: "setState", path, value: opt.value }, onPick(opt.value)))), { gap: 8, flexWrap: "wrap" });
}

/** A segmented control that saves on press. */
function segments(options: Array<{ label: string; value: string }>, path: string, onPick: (value: string) => ActionRef, width?: number): Node {
  return row(options.map((opt) => box([text(opt.label, { size: 13, weight: 500, lineHeight: 17, align: "center" })], {
    flexGrow: 1, flexBasis: 0, alignItems: "center", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 9,
    backgroundColor: whenEq(path, opt.value, C.paper, "transparent"),
  }, seq({ kind: "setState", path, value: opt.value }, onPick(opt.value)))), { padding: 3, borderRadius: 12, backgroundColor: C.surface, gap: 2, ...(width ? { width } : {}) });
}

/** The month's ring: spend against the limit, with the number in the middle. */
function ring(spent: number, limit: number, size: number): Node {
  const r = 15.5, circ = 2 * Math.PI * r, part = Math.max(0, Math.min(1, limit > 0 ? spent / limit : 0));
  return box([
    box([shapes([
      { circle: [18, 18, r], stroke: C.divider, strokeWidth: 3 },
      ...(part > 0 ? [{ circle: [18, 18, r] as [number, number, number], stroke: C.ink, strokeWidth: 3, linecap: "round" as const, dash: `${(part * circ).toFixed(2)} ${circ.toFixed(2)}`, rotate: -90 }] : []),
    ], { size, viewBox: "0 0 36 36", label: `${rupees(spent)} of ${rupees(limit)}` })], { position: "absolute", top: 0, left: 0 }),
    text(rupees(spent), { size: Math.round(size / 4.6), weight: 700, tracking: -0.6, align: "center" }),
    meta(`of ${rupees(limit)}`, { size: 12, align: "center" }),
  ], { width: size, height: size, alignItems: "center", justifyContent: "center", flexShrink: 0 });
}

/** A day-by-day bar chart: ink for days with spend, a hairline for the quiet ones and the days to come. */
function bars(byDay: number[], today: number, height: number, gapPx = 2): Node {
  const max = Math.max(1, ...byDay);
  return row(byDay.map((v, i) => col([
    box([], {
      height: v > 0 ? Math.max(3, Math.round((v / max) * height)) : 2, borderRadius: 2,
      backgroundColor: i + 1 > today ? C.divider : v > 0 ? C.ink : C.track,
      ...(i + 1 === today && v > 0 ? { backgroundColor: C.paper, borderWidth: 1.5, borderColor: C.ink } : {}),
    }),
  ], { flexGrow: 1, flexBasis: 0, height, justifyContent: "flex-end" })), { gap: gapPx, alignItems: "flex-end", height });
}

const avatar = (ctx: BotsCtx, slug: string, size = 24): Node => botAvatar(botOf(ctx, slug).look, size);
/** A row of overlapping-free little avatars for bots named in a list ("Plan bot", "Gym bot"). */
const avatarsOf = (ctx: BotsCtx, names: string[], size = 16): Node[] =>
  names.slice(0, 4).map((n) => { const b = botByName(ctx, n); return b ? botAvatar(b, size) : box([], { width: size, height: size, borderRadius: size / 2, backgroundColor: C.surface }); });

const youInitial = (ctx: BotsCtx) => (ctx.user?.name ?? ctx.user?.email ?? "Y").trim().charAt(0).toUpperCase() || "Y";
const youName = (ctx: BotsCtx) => ctx.user?.name ?? ctx.user?.email?.split("@")[0] ?? "You";
const face = (ctx: BotsCtx, size: number): Node =>
  box([text(youInitial(ctx), { size: Math.round(size * 0.4), weight: 600, align: "center" })], {
    width: size, height: size, borderRadius: size / 2, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", flexShrink: 0,
  });

const LANGS: Record<string, string> = { auto: "Same as you", en: "English", hi: "Hindi", hinglish: "Hinglish", bn: "Bengali", ta: "Tamil", te: "Telugu", mr: "Marathi", gu: "Gujarati", kn: "Kannada", ml: "Malayalam", pa: "Punjabi", ur: "Urdu" };
const languageName = (code: string | null) => (!code ? "Same as you" : LANGS[code.toLowerCase()] ?? LANGS[code.toLowerCase().split("-")[0]!] ?? code);

const signOut: ActionSpec = { kind: "signOut" };
const exportAction = (url: string | null): ActionRef => (url ? seq(openUrl(url), toast("Your data is downloading")) : toast("Download isn't available right now. Try again later."));

// ===================================================================== bots.you

/** The month by bot: the spend meter in each bot's colour, and its legend. */
function monthLegend(ctx: BotsCtx, byBot: ByBot[]): Node {
  return row(byBot.slice(0, 5).map((b) => {
    const bot = botOf(ctx, b.bot);
    return row([box([], { width: 7, height: 7, borderRadius: 4, backgroundColor: bot.look.color }), meta(`${bot.short} ${rupees(b.paise)}`, { size: 12 })], { gap: 5 });
  }), { gap: 12, flexWrap: "wrap", rowGap: 6 });
}

function monthOf(ctx: BotsCtx, d: YouData | undefined) {
  return d ? { spent: d.spend.monthPaise, limit: d.spend.limitPaise, byBot: d.spend.byBot } : { spent: ctx.live.spend.monthPaise, limit: ctx.live.spend.budgetPaise, byBot: [] as ByBot[] };
}

const leftLine = (ctx: BotsCtx, d: YouData | undefined, m: { spent: number; limit: number }) => {
  const left = Math.max(0, m.limit - m.spent);
  const parts = [left > 0 ? `${rupees(left)} left` : "Limit reached", ...(d ? [`resets ${dayMonth(ctx, d.spend.resetsAt)}`] : [])];
  if (d && d.spend.perDayPaise > 0) parts.push(`about ${rupees(d.spend.perDayPaise)} a day`);
  return parts.join(" · ");
};

function appsLine(d: YouData | undefined): string {
  const names = [...(d?.apps?.github ? ["GitHub"] : []), ...(d?.apps?.connected ?? []).map((a) => a.name.replace(/^Google /, ""))];
  return names.length ? (names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ")) : "None yet";
}
const computerLine = (d: YouData | undefined) => {
  const c = d?.computers;
  if (!c) return "";
  const on = c.online.filter((x) => x.allowRun);
  return on.length ? "On · free" : c.online.length ? "Online · not helping" : c.offline ? "Offline" : "Off";
};
const pingsLine = (s: Settings | undefined) => {
  if (!s) return "";
  const parts = ["Needs you always", ...(s.notify.summary ? [`summary at ${clock(s.notify.summaryAt, true)}`] : [])];
  return parts.join(" · ");
};

function youPhone(ctx: BotsCtx, d: YouData | undefined) {
  const m = monthOf(ctx, d);
  const planLine = `${d?.plan.name ?? "Your plan"} · ${plural(ctx.live.bots.length, "bot")}`;
  return page(ctx, {
    tab: "you", title: "You", gap: 18,
    body: [
      row([
        face(ctx, 48),
        col([text(youName(ctx), { size: 20, weight: 600, tracking: -0.3, lineHeight: 25, lines: 1 }), meta(planLine, { size: 13 })], { gap: 2, flexShrink: 1, minWidth: 0 }),
      ], { gap: 12 }, open(SCREENS.billing)),
      card([
        row([text("This month", { size: 14, weight: 600 }), grow(), text(`${rupees(m.spent)} of ${rupees(m.limit)}`, { size: 14, color: C.grey70 })]),
        meter(m.spent, m.limit, m.byBot.length ? { segments: m.byBot.map((b) => ({ value: b.paise, color: botOf(ctx, b.bot).look.color })) } : {}),
        m.byBot.length ? monthLegend(ctx, m.byBot) : meta(m.spent > 0 ? leftLine(ctx, d, m) : "Nothing spent yet this month", { size: 12 }),
      ], { gap: 12, padding: 16, onPress: open(SCREENS.budget) }),
      listCard([
        // Family and friends: spaces, what's shared, tasks, payment requests and chats (screens/spaces.ts).
        listRow({ label: "Spaces and chats", value: "Family and friends", onPress: open(SCREENS.spaces) }),
        listRow({ label: "Connected apps", value: appsLine(d), onPress: open(SCREENS.apps) }),
        listRow({ label: "This computer helps", value: computerLine(d), onPress: open(SCREENS.computer) }),
        // Sign in on a computer by scanning its code (screens/link.ts).
        listRow({ label: "Link a computer", value: "Scan to sign in", onPress: open(SCREENS.link) }),
        listRow({ label: "What pings you", value: d ? (d.settings.notify.quiet ? "Quiet hours on" : "Needs you always") : "", onPress: open(SCREENS.notify) }),
        listRow({ label: "Language", value: languageName(d?.language ?? null), onPress: open(SCREENS.language) }),
        listRow({ label: "What bots may do alone", value: d?.apps ? (d.apps.alone ? plural(d.apps.alone, "rule") : "Ask me first") : "", onPress: open(SCREENS.apps) }),
      ]),
      listCard([
        listRow({ label: "Plan and billing", value: d?.plan.name ?? "", onPress: open(SCREENS.billing) }),
        listRow({ label: "Your data", value: "Download · Delete", onPress: open(SCREENS.privacy) }),
        listRow({ label: "Privacy", onPress: open(SCREENS.privacy) }),
      ]),
      listCard(HELP.map((h) => listRow({ label: h.label, value: h.value || undefined, onPress: helpAction(h.url) })), { title: "Help" }),
    ],
  });
}

/** One row of the window's settings card: an icon, a label with a line under it, and what is on the right. */
function deskRow(o: { glyphNode: Node; label: string; sub?: string; right?: Node; value?: string; onPress?: ActionRef; chevron?: boolean }): Node {
  return row([
    box([o.glyphNode], { width: 22, alignItems: "center" }),
    col([text(o.label, { size: 14, weight: 500, lineHeight: 19 }), ...(o.sub ? [meta(o.sub, { size: 12 })] : [])], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 }),
    ...(o.value ? [text(o.value, { size: 13, color: C.meta, align: "right", style: { flexShrink: 0 } })] : []),
    ...(o.right ? [o.right] : []),
    ...((o.chevron ?? !!o.onPress) ? [icon("chevron", { size: 16, color: C.meta })] : []),
  ], { gap: 12, paddingVertical: 13, paddingHorizontal: 16, minHeight: 52 }, o.onPress);
}
const deskList = (rows: Node[]): Node => listCard(rows);

function youDesk(ctx: BotsCtx, d: YouData | undefined) {
  const m = monthOf(ctx, d);
  const top = m.byBot.length ? Math.max(...m.byBot.map((b) => b.paise)) : 1;
  const helped = d?.computers?.helped;
  const online = d?.computers?.online ?? [];
  const apps = d?.apps;
  const appRows: Node[] = [
    ...(apps?.github ? [deskRow({
      glyphNode: icon("code", { size: 18 }), label: "GitHub", sub: `Used by Code · ${plural(apps.github.repos, "repo")}`, onPress: open(SCREENS.code),
    })] : []),
    ...(apps?.connected ?? []).slice(0, 3).map((a) => deskRow({
      glyphNode: icon("link", { size: 18 }), label: a.name, sub: a.usedBy.length ? `Used by ${a.usedBy.map((n) => n.replace(/ bot$/i, "")).join(", ")}` : "Not used by a bot yet",
      value: ago(ctx, a.lastUsedAt), onPress: open(SCREENS.appConnect, { id: a.id }),
    })),
  ];
  const moreApps = (apps?.connected.length ?? 0) - 3;
  return page(ctx, {
    tab: "you", title: "You", maxWidth: 1040, gap: 22,
    body: [
      row([
        face(ctx, 52),
        col([
          text(youName(ctx), { size: 24, weight: 700, tracking: -0.5, lineHeight: 30 }),
          meta([`${d?.plan.name ?? "Your plan"} · ${plural(ctx.live.bots.length, "bot")}`, ...(ctx.user?.email ? [ctx.user.email] : [])].join(" · "), { size: 13 }),
        ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
        secondaryButton("Plan and billing", open(SCREENS.billing), { size: "md" }),
        secondaryButton("Sign out", signOut, { size: "md" }),
      ], { gap: 14 }),
      columns([
        card([
          row([
            ring(m.spent, m.limit, 132),
            col([
              row([text("This month", { size: 14, weight: 600 }), grow(), text("Budget", { size: 13, weight: 500, style: { textDecorationLine: "underline" } })], {}, open(SCREENS.budget)),
              ...(m.byBot.length ? m.byBot.slice(0, 4).map((b) => {
                const bot = botOf(ctx, b.bot);
                return row([
                  botAvatar(bot.look, 20), text(bot.short, { size: 13, style: { width: 64 } }),
                  box([meter(b.paise, top, { color: bot.look.color, height: 4 })], { flexGrow: 1, flexShrink: 1 }),
                  text(rupees(b.paise), { size: 13, weight: 600, align: "right", style: { width: 56 } }),
                ], { gap: 10 });
              }) : [meta("Nothing spent yet this month.", { size: 13 })]),
              meta(leftLine(ctx, d, m), { size: 12 }),
            ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 10 }),
          ], { gap: 22, alignItems: "center" }),
        ], { padding: 20 }),
        col([
          row([sectionLabel(`Connected apps · ${(apps?.connected.length ?? 0) + (apps?.github ? 1 : 0)}`), grow(), text("Manage", { size: 13, weight: 500, style: { textDecorationLine: "underline" } })], {}, open(SCREENS.apps)),
          appRows.length ? deskList([...appRows, ...(moreApps > 0 ? [deskRow({ glyphNode: box([]), label: `${plural(moreApps, "more app")}`, onPress: open(SCREENS.apps) })] : [])])
            : card([meta(apps && !apps.enabled ? "Connected apps aren't on yet." : "No apps connected yet. Your bots can use GitHub, Docs and more.", { size: 13 }), button("Connect an app", open(SCREENS.apps), { kind: "secondary", size: "md" })], { gap: 10 }),
        ], { gap: 8 }),
      ], [
        deskList([
          deskRow({
            glyphNode: icon("computer", { size: 18 }), label: "This computer helps",
            sub: online.length ? `${computerLine(d)} · ${online[0]!.name}` : "Off · your computers can run jobs for free",
            ...(helped && helped.jobs ? { value: `${plural(helped.jobs, "job")} this month` } : {}),
            onPress: open(SCREENS.computer),
          }),
        ]),
        deskList([
          deskRow({ glyphNode: glyph(G.globe, 18), label: "Language", sub: "Bots reply the way you talk", value: languageName(d?.language ?? null), onPress: open(SCREENS.language) }),
          deskRow({ glyphNode: glyph(G.rules, 18), label: "What bots may do alone", sub: "Everything else asks you first", value: apps ? (apps.alone ? plural(apps.alone, "rule") : "Nothing yet") : "", onPress: open(SCREENS.apps) }),
          deskRow({ glyphNode: glyph(G.bell, 18), label: "What pings you", sub: pingsLine(d?.settings) || "Needs you always", value: d?.settings.notify.quiet ? "Quiet hours on" : "", onPress: open(SCREENS.notify) }),
        ]),
        deskList([
          deskRow({ glyphNode: icon("shield", { size: 18 }), label: "Privacy", sub: "What we keep, and for how long", onPress: open(SCREENS.privacy) }),
          deskRow({
            glyphNode: glyph(G.download, 18), label: "Your data", sub: "Chats, notes and files", chevron: false,
            right: row([button("Download", exportAction(d?.exportUrl ?? null), { kind: "secondary", size: "md" }), button("Delete", open(SCREENS.privacy), { kind: "secondary", size: "md" })], { gap: 8 }),
          }),
          deskRow({ glyphNode: glyph(G.trash, 18), label: "Delete account", sub: "7 days to change your mind", onPress: open(SCREENS.deleteAccount) }),
        ]),
        deskList(HELP.map((h) => deskRow({ glyphNode: icon(h.url.startsWith("mailto:") ? "send" : "book", { size: 18 }), label: h.label, value: h.value || undefined, onPress: helpAction(h.url) }))),
      ], { rightWidth: 380 }),
    ],
  });
}

// ===================================================================== bots.budget

const LIMITS = [{ label: "₹300", value: "300" }, { label: "₹500", value: "500" }, { label: "₹1,000", value: "1000" }, { label: "Other", value: "other" }];

/** "Stop bots at the limit": the switch, saved both ways. */
function stopRow(limit: number): Node {
  return switchRow("Stop bots at the limit", "stop", {
    sub: `They pause and ask before going past ${rupees(limit)}`,
    onChange: when2("stop", save({ stopAtLimit: true }, `Bots stop at ${rupees(limit)}`), save({ stopAtLimit: false }, "Bots can go past the limit")),
  });
}

/** The limit chooser: ₹300, ₹500, ₹1,000 or another amount; "Set monthly limit" saves it. */
function limitPicker(): Node {
  return col([
    pills(LIMITS, "limit", () => ({ kind: "log", message: "limit picked" })),
    when({ eq: ["limit", "other"] }, field("otherLimit", "Amount in ₹, like 750", { keyboard: "numeric" })),
  ], { gap: 10 });
}
const setLimit: ActionRef = when2("limit",
  { kind: "condition", if: { eq: ["limit", "other"] },
    then: call("PUT", "/v1/you/settings", { monthLimitRupees: "$state.otherLimit" }, { ok: seq(toast("Monthly limit set"), refresh), fail: oops("set that amount") }),
    else: call("PUT", "/v1/you/settings", { monthLimitRupees: "$state.limit" }, { ok: seq(toast("Monthly limit set"), refresh), fail: oops() }) },
  toast("Pick a limit first"));

const limitState = (limit: number) => {
  const r = String(Math.round(limit / 100));
  return LIMITS.some((l) => l.value === r) ? { limit: r, otherLimit: "" } : { limit: "other", otherLimit: r };
};

function byBotRows(ctx: BotsCtx, rep: Report, desk: boolean): Node[] {
  const top = rep.byBot.length ? rep.byBot[0]!.paise : 1;
  return rep.byBot.map((b) => {
    const bot = botOf(ctx, b.bot);
    const pct = rep.monthPaise > 0 ? Math.round((b.paise / rep.monthPaise) * 100) : 0;
    return desk
      ? col([
        row([botAvatar(bot.look, 24), text(bot.name, { size: 14, style: { flexShrink: 1 } }), grow(), meta(`${pct}%`, { size: 12 }), text(rupees(b.paise), { size: 14, weight: 600, align: "right", style: { width: 64 } })], { gap: 10 }),
        meter(b.paise, top, { color: bot.look.color, height: 4 }),
      ], { gap: 8 })
      : row([
        botAvatar(bot.look, 24), text(bot.short, { size: 14, style: { width: 64 } }),
        box([meter(b.paise, top, { color: bot.look.color, height: 5 })], { flexGrow: 1, flexShrink: 1 }),
        text(rupees(b.paise), { size: 14, weight: 600, align: "right", style: { width: 60 } }),
      ], { gap: 10 });
  });
}

const busiestLine = (ctx: BotsCtx, rep: Report) =>
  rep.busiest ? `Busiest: ${rupees(rep.busiest.paise)} on ${rep.busiest.day} ${MONTHS[local(ctx, rep.monthStart).getUTCMonth()]}` : "No spend yet";

function biggestRows(ctx: BotsCtx, rep: Report): Node[] {
  return rep.biggest.slice(0, 3).map((j) => row([
    avatar(ctx, "code", 24),
    col([text(j.task, { size: 14, lineHeight: 19, lines: 1 }), meta(`${dayMonth(ctx, j.at)} · ${hours(j.minutes)}`, { size: 12 })], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 }),
    text(rupees(j.paise), { size: 14, weight: 600 }),
  ], { gap: 10 }, open(SCREENS.codeJob, { id: j.id })));
}

function budgetPhone(ctx: BotsCtx, d: SpendData | undefined) {
  if (!d) {
    const s = ctx.live.spend;
    return page(ctx, {
      back: true, nav: "you", title: "Budget",
      body: [title("Budget"), col([row([text(rupees(s.monthPaise), { size: 34, weight: 700, tracking: -0.8 }), meta(` of ${rupees(s.budgetPaise)} this month`, { size: 14 })], { alignItems: "flex-end", gap: 4 }), meter(s.monthPaise, s.budgetPaise)], { gap: 10 }), couldNot("the month's details")],
    });
  }
  const rep = d.report;
  return page(ctx, {
    back: true, nav: "you", title: "Budget", gap: 20,
    state: { stop: d.settings.stopAtLimit, ...limitState(d.settings.monthLimitPaise) },
    body: [
      title("Budget"),
      col([
        row([text(rupees(rep.monthPaise), { size: 34, weight: 700, tracking: -0.8, lineHeight: 40 }), meta(`of ${rupees(rep.limitPaise)} this month`, { size: 14, style: { paddingBottom: 6 } })], { alignItems: "flex-end", gap: 8 }),
        meter(rep.monthPaise, rep.limitPaise),
        row([meta(`${rep.leftPaise > 0 ? `${rupees(rep.leftPaise)} left` : "Limit reached"} · resets ${dayMonth(ctx, rep.resetsAt)}`, { size: 12 }), grow(), meta(`About ${rupees(rep.perDayPaise)} a day`, { size: 12 })]),
      ], { gap: 10 }),
      ...(rep.byBot.length ? [col([sectionLabel("By bot"), ...byBotRows(ctx, rep, false)], { gap: 12 })] : [meta("Nothing spent yet this month. Your bots' costs show up here as they work.", { size: 14 })]),
      ...(rep.monthPaise > 0 ? [col([
        row([sectionLabel("By day"), grow(), meta(busiestLine(ctx, rep), { size: 12 })]),
        bars(rep.byDay, rep.today, 64),
        row([meta(`1 ${MONTHS[local(ctx, rep.monthStart).getUTCMonth()]}`, { size: 11 }), grow(), meta("Today", { size: 11 })]),
      ], { gap: 10 })] : []),
      ...(rep.biggest.length ? [col([sectionLabel("Biggest jobs"), ...biggestRows(ctx, rep)], { gap: 12 })] : []),
      col([sectionLabel("Monthly limit"), limitPicker()], { gap: 10 }),
    ],
    footer: [box([stopRow(rep.limitPaise)], { marginHorizontal: -16 }), primaryButton("Set monthly limit", setLimit, { wide: true })],
  });
}

function budgetDesk(ctx: BotsCtx, d: SpendData | undefined) {
  if (!d) {
    return page(ctx, { back: true, backTitle: "You", nav: "you", title: "Budget", maxWidth: 1040, body: [heading(ctx, "Budget"), couldNot("the month's details")] });
  }
  const rep = d.report;
  const monthName = MONTHS_LONG[local(ctx, rep.monthStart).getUTCMonth()]!;
  const lastDay = `${rep.daysInMonth} ${MONTHS[local(ctx, rep.monthStart).getUTCMonth()]}`;
  const stat = (big: string, line: string) => col([text(big, { size: 16, weight: 600 }), meta(line, { size: 12 })], { gap: 2 });
  const pace = rep.projectionPaise <= rep.limitPaise ? (rep.projectionPaise < rep.limitPaise * 0.8 ? "well under your limit" : "close to your limit") : "past your limit";
  const ticks = [1, 7, 14, 21].filter((x) => x < rep.today - 2);
  return page(ctx, {
    back: true, backTitle: "You", nav: "you", title: "Budget", maxWidth: 1040, gap: 20,
    state: { stop: d.settings.stopAtLimit, ...limitState(d.settings.monthLimitPaise) },
    body: [
      heading(ctx, "Budget", `${monthName} ${rep.month.slice(0, 4)} · what your bots cost`),
      card([
        row([
          row([text(rupees(rep.monthPaise), { size: 34, weight: 700, tracking: -0.8, lineHeight: 40 }), meta(`of ${rupees(rep.limitPaise)} this month`, { size: 13, style: { paddingBottom: 6 } })], { alignItems: "flex-end", gap: 8 }),
          grow(),
          stat(rep.leftPaise > 0 ? `${rupees(rep.leftPaise)} left` : "Limit reached", `resets ${dayMonth(ctx, rep.resetsAt)}`),
          stat(`About ${rupees(rep.perDayPaise)} a day`, `${plural(rep.today, "day")} so far`),
          stat(`About ${rupees(Math.round(rep.projectionPaise / 100) * 100)} by ${lastDay}`, pace),
        ], { gap: 36, flexWrap: "wrap", rowGap: 12 }),
        meter(rep.monthPaise, rep.limitPaise),
      ], { padding: 20, gap: 16 }),
      columns([
        card([
          row([sectionLabel("By day"), grow(), meta(busiestLine(ctx, rep), { size: 12 })]),
          rep.monthPaise > 0 ? bars(rep.byDay, rep.today, 150, 5) : box([meta("Nothing spent yet this month.", { size: 13 })], { height: 150, justifyContent: "center", alignItems: "center" }),
          row([
            ...ticks.flatMap((t, i) => [meta(t === 1 ? `1 ${MONTHS[local(ctx, rep.monthStart).getUTCMonth()]}` : String(t), { size: 11 }), ...(i < ticks.length - 1 ? [grow()] : [])]),
            grow(), meta("Today", { size: 11, weight: 600 }), grow(), meta(String(rep.daysInMonth), { size: 11 }),
          ]),
        ], { padding: 20, gap: 14 }),
        card([
          row([sectionLabel("Biggest jobs")]),
          rep.biggest.length
            ? table([{ label: "Job", flex: 3 }, { label: "Date" }, { label: "Time" }, { label: "Cost", align: "right" }],
              rep.biggest.slice(0, 4).map((j) => [
                row([avatar(ctx, "code", 24), col([text(j.task, { size: 14, lines: 1 }), meta("Code bot", { size: 12 })], { flexShrink: 1, minWidth: 0, gap: 1 })], { gap: 10 }),
                dayMonth(ctx, j.at), hours(j.minutes), text(rupees(j.paise), { size: 14, weight: 600 }),
              ]), { onRow: (i) => open(SCREENS.codeJob, { id: rep.biggest[i]!.id }) })
            : meta("No Code bot jobs this month.", { size: 13 }),
        ], { padding: 20, gap: 12 }),
      ], [
        card([sectionLabel("By bot"), ...(rep.byBot.length ? byBotRows(ctx, rep, true) : [meta("Nothing spent yet.", { size: 13 })])], { padding: 20, gap: 14 }),
        card([
          row([sectionLabel("Monthly limit"), grow(), text(rupees(rep.limitPaise), { size: 20, weight: 700 })]),
          limitPicker(),
          box([stopRow(rep.limitPaise)], { marginHorizontal: -16 }),
          primaryButton("Set monthly limit", setLimit, { wide: true, size: "md" }),
        ], { padding: 20, gap: 14 }),
      ]),
    ],
  });
}

// ===================================================================== bots.billing

const billingBody = (b: BillingData["plan"]) =>
  b.active ? "Unlimited Keybot words, first in line on busy days" : "Keybot with a monthly word allowance, and every bot";

function cancelAction(p: BillingData["plan"]): ActionRef | undefined {
  if (p.cancel === "store" && p.manageUrl) return openUrl(p.manageUrl);
  if (p.cancel !== "razorpay") return undefined;
  return when2("cancelSure",
    call("POST", "/v1/billing/razorpay/cancel", {}, { ok: seq(toast("Cancelled. Pro stays till the end of what you paid for."), refresh), fail: oops("cancel the plan") }),
    seq({ kind: "setState", path: "cancelSure", value: true }, toast("Tap Cancel plan again to cancel")));
}
const cancelLine = (ctx: BotsCtx, p: BillingData["plan"]) =>
  p.cancel === "store" ? `Cancel in ${p.paidBy ?? "your app store"}. Your bots and projects stay.`
    : `Two taps. ${p.until ? `Pro stays till ${dayMonth(ctx, p.until)}, ` : ""}your bots and projects stay too.`;

function invoiceRows(ctx: BotsCtx, list: Invoice[]): Node[] {
  return list.slice(0, 3).map((i) => listRow({
    label: fullDate(ctx, i.date), sub: i.what, value: i.amount,
    ...(i.url ? { right: glyph(G.download, 18, C.meta), chevron: false, onPress: openUrl(i.url) } : {}),
  }));
}

function billingPhone(ctx: BotsCtx, d: BillingData | undefined) {
  if (!d) return page(ctx, { back: true, nav: "you", title: "Plan and billing", body: [title("Plan and billing"), couldNot("your plan")] });
  const p = d.plan;
  const cancel = cancelAction(p);
  return page(ctx, {
    back: true, nav: "you", title: "Plan and billing", gap: 18, state: { cancelSure: false },
    body: [
      title("Plan and billing"),
      listCard([
        col([
          row([text(p.name, { size: 20, weight: 700 }), grow(), ...(p.price ? [text(p.price, { size: 17, weight: 700 }), meta(` / ${(p.period ?? "a month").replace(/^a /, "")}`, { size: 13 })] : p.active ? [] : [text("₹0", { size: 17, weight: 700 })])], { gap: 2 }),
          meta(billingBody(p), { size: 13 }),
        ], { gap: 4, paddingVertical: 16, paddingHorizontal: 16 }),
        ...(p.active && p.until ? [listRow({ label: p.renews ? "Renews" : "Ends", value: dayMonth(ctx, p.until) })] : []),
        ...(p.paidBy ? [listRow({ label: "Paid by", value: p.paidBy })] : []),
        ...(d.month ? [listRow({ label: "Bot use this month", value: `${rupees(d.month.monthPaise)} of ${rupees(d.month.limitPaise)}`, onPress: open(SCREENS.budget) })] : []),
      ]),
      ...(p.paidBy === "UPI autopay" ? [meta("Your UPI app tells you before each renewal.", { size: 12 })] : []),
      ...(d.invoices.length ? [col([
        row([sectionLabel("Invoices"), grow(), meta(plural(d.invoices.length, "invoice"), { size: 12 })]),
        listCard(invoiceRows(ctx, d.invoices)),
        meta("From Razorpay. Tap one to open it.", { size: 12 }),
      ], { gap: 8 })] : p.active && p.store && p.store !== "razorpay" ? [meta(`Your receipts are in ${p.paidBy ?? "your app store"}.`, { size: 13 })] : []),
    ],
    footer: [
      primaryButton(p.active ? "Change plan" : "See plans", open(SCREENS.plans), { wide: true }),
      ...(cancel ? [col([quietButton("Cancel plan", cancel, { wide: true }), meta(cancelLine(ctx, p), { size: 12, align: "center" })], { gap: 2 })] : []),
    ],
  });
}

function billingDesk(ctx: BotsCtx, d: BillingData | undefined) {
  if (!d) return page(ctx, { back: true, backTitle: "You", nav: "you", title: "Plan and billing", maxWidth: 1040, body: [heading(ctx, "Plan and billing"), couldNot("your plan")] });
  const p = d.plan;
  const cancel = cancelAction(p);
  const planCard = (name: string, price: string, lines: string[], mine: boolean) => card([
    row([text(name, { size: 15, weight: 600 }), grow(), ...(mine ? [box([text("Your plan", { size: 11, weight: 600, color: C.paper })], { backgroundColor: C.ink, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 })] : [])]),
    row([text(price, { size: 26, weight: 700, tracking: -0.5 }), ...(name === "Pro" && p.period ? [meta(` / ${p.period.replace(/^a /, "")}`, { size: 13 })] : [])], { alignItems: "flex-end" }),
    ...lines.map((l) => row([icon("check", { size: 14 }), meta(l, { size: 12, color: C.grey70 })], { gap: 6 })),
  ], { padding: 16, gap: 8, ...(mine ? { selected: C.ink } : {}), style: { flexGrow: 1, flexBasis: 0 } });
  const sub = [p.active && p.since ? `${p.name} since ${fullDate(ctx, p.since)}` : p.name, ...(p.active && p.until ? [`${p.renews ? "renews" : "ends"} ${dayMonth(ctx, p.until)}`] : [])].join(" · ");
  return page(ctx, {
    back: true, backTitle: "You", nav: "you", title: "Plan and billing", maxWidth: 1040, gap: 20, state: { cancelSure: false },
    body: [
      heading(ctx, "Plan and billing", sub),
      columns([
        card([
          sectionLabel("Plan"),
          row([planCard("Free", "₹0", ["Keybot, a monthly word allowance", "Every bot, within its daily budget"], !p.active), planCard("Pro", p.price ?? "Pro", ["Unlimited Keybot words", "First in line on busy days"], p.active)], { gap: 12, alignItems: "stretch" }),
          row([
            secondaryButton(p.active ? "Change plan" : "See plans", open(SCREENS.plans), { size: "md" }),
            ...(cancel ? [quietButton("Cancel plan", cancel, { size: "md" })] : []),
            ...(cancel ? [meta(cancelLine(ctx, p), { size: 12, style: { flexShrink: 1 } })] : []),
          ], { gap: 10 }),
        ], { padding: 20, gap: 14 }),
      ], [
        card([
          sectionLabel("Paid by"),
          p.paidBy ? row([glyph(G.card, 20), text(p.paidBy, { size: 15, weight: 500 }), grow(), ...(p.manageUrl ? [button("Change", openUrl(p.manageUrl), { kind: "secondary", size: "md" })] : [])], { gap: 10 })
            : meta("Nothing to pay on the free plan.", { size: 13 }),
          ...(p.active && p.until ? [row([statusMark2(), col([text(`${dayMonth(ctx, p.until)} · ${p.renews ? `${p.name} renews` : `${p.name} ends`}`, { size: 13, weight: 500 }), meta(p.renews ? [p.price ? `${p.price} for another ${(p.period ?? "a month").replace(/^a /, "")}` : "", p.paidBy === "UPI autopay" ? "your UPI app tells you first" : "cancel any time before"].filter(Boolean).join(" · ") : "Nothing more is taken", { size: 12 })], { gap: 2, flexShrink: 1 })], { gap: 10, alignItems: "flex-start" })] : []),
          ...(d.month ? [box([listRow({ label: "Bot use so far this month", value: `${rupees(d.month.monthPaise)} of ${rupees(d.month.limitPaise)}`, onPress: open(SCREENS.budget) })], { backgroundColor: C.surface, borderRadius: 12, overflow: "hidden" })] : []),
        ], { padding: 20, gap: 14 }),
      ]),
      ...(d.invoices.length ? [card([
        row([sectionLabel(`Invoices · ${d.invoices.length}`), grow(), meta("From Razorpay", { size: 12 })]),
        table([{ label: "Date" }, { label: "Invoice" }, { label: "What", flex: 2 }, { label: "Total", align: "right" }, { label: "", align: "right" }],
          d.invoices.slice(0, 8).map((i) => [fullDate(ctx, i.date), mono(i.number), i.what, text(i.amount, { size: 14, weight: 600 }),
            i.url ? row([glyph(G.download, 14), text("PDF", { size: 12, weight: 500 })], { gap: 4, borderWidth: 1, borderColor: C.outline, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }) : ""]),
          { onRow: (k) => (d.invoices[k]?.url ? openUrl(d.invoices[k]!.url!) : undefined) }),
      ], { padding: 20, gap: 12 })] : []),
    ],
  });
}
/** A hollow ring: a date to come. */
const statusMark2 = (): Node => box([], { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: C.ink, marginTop: 4 });

// ===================================================================== bots.computer

const DOWNLOAD_URL = `${(process.env.PUBLIC_ORIGIN || "https://api.tailzu.space").replace(/\/+$/, "")}/download`;

function onlineLine(c: ComputersData["online"][number], working: string | undefined): string {
  if (!c.allowRun) return "Online · not running jobs";
  if (c.busy) return working ? `Online · working on ${working}` : "Online · working for Code bot";
  return "Online · ready for Code bot";
}
const projectsLine = (p: ComputersData["online"][number]["projects"]) => (p === "all" ? "Every project" : p === "most" ? "All but a few" : plural(p, "project"));
const daysAgo = (ctx: BotsCtx, t: number) => {
  const days = Math.floor((ctx.live.now - t) / DAY_MS);
  return days < 1 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};
const codeWorking = (ctx: BotsCtx) => ctx.live.working.find((w) => w.bot === "code" && w.id.startsWith("job:"));

function computerPhone(ctx: BotsCtx, d: ComputersData | undefined) {
  const head = [title("This computer helps"), meta("Your own computers run part of the work, so jobs cost less. It's free, and bots say when they use one.", { size: 14, lineHeight: 20, color: C.grey70 })];
  const add = card([
    text("Add a computer", { size: 15, weight: 600 }),
    meta("On that computer, get Tailzu, sign in as you, and turn on This computer helps. It shows up here.", { size: 13, lineHeight: 18 }),
    button("Get Tailzu for computer", openUrl(DOWNLOAD_URL), { kind: "secondary", size: "md" }),
  ], { gap: 10 });
  if (!d) return page(ctx, { back: true, nav: "computer", title: "This computer helps", body: [...head, couldNot("your computers")] });
  if (!d.online.length && !d.offline.length) {
    return page(ctx, { back: true, nav: "computer", title: "This computer helps", body: [...head, emptyState({ pose: "think", title: "No computer yet", body: "Your laptop can run tests and builds for Code bot, for free.", action: { label: "Get Tailzu for computer", onPress: openUrl(DOWNLOAD_URL) } })] });
  }
  const w = codeWorking(ctx);
  const first = d.online[0];
  return page(ctx, {
    back: true, nav: "computer", title: "This computer helps", gap: 18,
    body: [
      ...head,
      listCard([
        ...d.online.map((c, i) => col([
          row([icon("computer", { size: 22 }), col([text(c.name, { size: 15, weight: 600 }), meta(onlineLine(c, c.busy ? w?.title.split(/[.\n]/)[0] : undefined), { size: 12 })], { gap: 2, flexShrink: 1, minWidth: 0 })], { gap: 12 }),
          ...(i === 0 ? [row([
            box([text(plural(d.helped.jobs, "job"), { size: 18, weight: 700 }), meta("helped this month", { size: 12 })], { flexGrow: 1, flexBasis: 0, backgroundColor: C.surface, borderRadius: 12, padding: 12, gap: 2 }),
            box([text(hours(d.helped.minutes), { size: 18, weight: 700 }), meta("of work, free", { size: 12 })], { flexGrow: 1, flexBasis: 0, backgroundColor: C.surface, borderRadius: 12, padding: 12, gap: 2 }),
          ], { gap: 10 })] : []),
        ], { gap: 12, paddingVertical: 14, paddingHorizontal: 16 })),
        ...d.offline.map((c) => listRow({
          left: icon("computer", { size: 22, color: C.idle }), label: c.name, sub: `Offline · last seen ${daysAgo(ctx, c.lastSeen)}`, chevron: false,
          right: quietButton("Remove", call("DELETE", `/v1/you/computers/${encodeURIComponent(c.deviceId)}`, undefined, { ok: seq(toast(`${c.name} removed`), refresh), fail: oops("remove it") }), { size: "md" }),
        })),
      ]),
      ...(first ? [col([
        sectionLabel("What it may do"),
        listCard([
          listRow({ label: "Run jobs for Code bot", value: first.allowRun ? "On" : "Off" }),
          listRow({ label: "Projects", value: projectsLine(first.projects) }),
          listRow({ label: "Can push code", value: "Never", sub: "It gets a read-only copy" }),
        ]),
        meta("Change these in Tailzu on that computer. Never other folders, passwords, photos or your browser.", { size: 12, lineHeight: 17 }),
      ], { gap: 8 })] : []),
      add,
    ],
  });
}

function computerDesk(ctx: BotsCtx, d: ComputersData | undefined) {
  const head = heading(ctx, "This computer helps", "Your bots can run heavy work on your own computers instead of the cloud. It's free, and your files stay with you.");
  if (!d) return page(ctx, { back: true, nav: "computer", title: "This computer helps", maxWidth: 1040, body: [head, couldNot("your computers")] });
  const w = codeWorking(ctx);
  const busy = d.online.find((c) => c.busy);
  const first = d.online[0];
  const status = first ? onlineLine(first, busy ? w?.title.split(/[.\n]/)[0] : undefined) : d.offline.length ? "Offline" : "No computer yet";
  return page(ctx, {
    back: true, nav: "computer", title: "This computer helps", maxWidth: 1040, gap: 20,
    body: [
      row([col([head], { flexGrow: 1, flexShrink: 1 }), ...(first ? [infoChip(first.allowRun ? "Helping" : "Not helping")] : [])], { gap: 16, alignItems: "flex-start" }),
      columns([
        col([
          sectionLabel("Runner"),
          listCard([
            listRow({ label: "Status", value: status }),
            ...(first ? [
              listRow({ label: "This computer", value: [first.name, first.os === "darwin" ? "Mac" : first.os === "win32" ? "Windows" : first.os === "linux" ? "Linux" : ""].filter(Boolean).join(" · ") }),
              listRow({ label: "Projects it may run", value: projectsLine(first.projects) }),
              listRow({ label: "Where jobs run", value: first.container ? "In a sealed box" : "On this computer, in its own folder" }),
            ] : []),
          ]),
        ], { gap: 8 }),
        ...(busy && w ? [card([
          row([avatar(ctx, "code", 30), col([text(`Working on ${w.title.split(/[.\n]/)[0]}`, { size: 14, weight: 600, lines: 1 }), meta(`Code bot · on ${busy.name}`, { size: 12 })], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 }),
            button("Stop job", call("POST", `/v1/code/jobs/${w.id.slice(4)}/stop`, {}, { ok: seq(toast("Stopped"), refresh), fail: oops("stop it") }), { kind: "secondary", size: "md" })], { gap: 12 }),
        ], { padding: 16 })] : []),
        ...(d.offline.length ? [col([sectionLabel("Other computers"), listCard(d.offline.map((c) => listRow({
          left: icon("computer", { size: 20, color: C.idle }), label: c.name, sub: `Offline · last seen ${daysAgo(ctx, c.lastSeen)}`, chevron: false,
          right: button("Remove", call("DELETE", `/v1/you/computers/${encodeURIComponent(c.deviceId)}`, undefined, { ok: seq(toast(`${c.name} removed`), refresh), fail: oops("remove it") }), { kind: "secondary", size: "md" }),
        })))], { gap: 8 })] : []),
        ...(!d.online.length ? [card([
          text("Add a computer", { size: 15, weight: 600 }),
          meta("On that computer, get Tailzu, sign in as you, and turn on This computer helps. It shows up here.", { size: 13 }),
          button("Get Tailzu for computer", openUrl(DOWNLOAD_URL), { kind: "secondary", size: "md" }),
        ], { gap: 10, padding: 20 })] : []),
      ], [
        card([
          sectionLabel("Guard rails"),
          ...[
            [icon("folder", { size: 18 }), "Runs only projects you allowed", "Nothing else on the computer is shown to bots."],
            [icon("lock", { size: 18 }), "Never pushes code", "It gets a copy to read. Tailzu commits, through your rules."],
            [icon("shield", { size: 18 }), "Asks before anything risky", "Bots say when they use a computer."],
          ].map(([g, l, s]) => row([g as Node, col([text(l as string, { size: 14, weight: 500 }), meta(s as string, { size: 12 })], { gap: 2, flexShrink: 1 })], { gap: 12, alignItems: "flex-start" })),
        ], { padding: 20, gap: 14 }),
        card([
          sectionLabel("Helped this month"),
          row([text(plural(d.helped.jobs, "job"), { size: 30, weight: 700, tracking: -0.6 }), meta(`${hours(d.helped.minutes)} of work, free`, { size: 12, style: { paddingBottom: 6 } })], { gap: 10, alignItems: "flex-end" }),
        ], { padding: 20, gap: 10 }),
      ]),
    ],
  });
}
// ===================================================================== bots.notify

const SUMMARY_TIMES = [{ label: "7 pm", value: "1140" }, { label: "8 pm", value: "1200" }, { label: "9 pm", value: "1260" }, { label: "10 pm", value: "1320" }];
const notifyState = (s: Settings, ctx: BotsCtx) => ({
  done: s.notify.done, summary: s.notify.summary, quiet: s.notify.quiet, at: String(s.notify.summaryAt), pickTime: false,
  ...Object.fromEntries(ctx.live.bots.map((b) => [`bot_${b.slug.replace(/-/g, "_")}`, !s.notify.botsOff.includes(b.slug)])),
});
const doneSeg = (width?: number) => segments([{ label: "Quiet", value: "quiet" }, { label: "Ping", value: "ping" }], "done",
  (v) => save({ notify: { done: v } }, v === "ping" ? "Done pings you" : "Done comes without a sound"), width);
const summarySwitch = () => seq({ kind: "toggleState", path: "summary" }, when2("summary", save({ notify: { summary: true } }, "Daily summary on"), save({ notify: { summary: false } }, "Daily summary off")));
const quietSwitch = () => seq({ kind: "toggleState", path: "quiet" }, when2("quiet", save({ notify: { quiet: true } }, "Quiet hours on"), save({ notify: { quiet: false } }, "Quiet hours off")));
const botSwitch = (slug: string) => {
  const path = `bot_${slug.replace(/-/g, "_")}`;
  const saveIt = when2(path, save({ notify: { bot: slug, on: true } }, "Pings on"), save({ notify: { bot: slug, on: false } }, "Pings off"));
  return { path, saveIt, press: seq({ kind: "toggleState", path }, saveIt) };
};
const timePicker = (): Node => when({ truthy: "pickTime" }, pills(SUMMARY_TIMES, "at", (v) => seq(save({ notify: { summaryAt: Number(v) } }, "Summary time changed"), { kind: "setState", path: "pickTime", value: false })));
const botSub = (slug: string) => (slug === "keybot" ? "Only reminders, like your streak" : slug === "code" ? "Done, stopped or moved jobs" : undefined);

function summaryPreview(ctx: BotsCtx, d: NotifyData): Node {
  return box([
    row([botAvatar(botOf(ctx, "tailzu").look, 26), col([
      meta(`Tonight, ${clock(d.settings.notify.summaryAt)}`, { size: 12 }),
      text(d.line ?? "Nothing happened yet today. On a quiet day, no note comes.", { size: 13, weight: d.line ? 500 : 400, lineHeight: 18 }),
    ], { gap: 2, flexShrink: 1 })], { gap: 10, alignItems: "flex-start" }),
  ], { backgroundColor: C.surface, borderRadius: 14, padding: 14 });
}

function notifyPhone(ctx: BotsCtx, d: NotifyData | undefined) {
  if (!d) return page(ctx, { back: true, nav: "you", title: "What pings you", body: [title("What pings you"), couldNot("your settings")] });
  const s = d.settings;
  return page(ctx, {
    back: true, nav: "you", title: "What pings you", gap: 18, state: { ...notifyState(s, ctx), ...PUSH_STATE },
    body: [
      // While this phone does not allow notifications, it says so first (screens/pushAsk.ts); the title reads the phone's answer.
      withPushCheck(ctx, title("What pings you")),
      ...pushOffRow(ctx),
      listCard([
        listRow({ left: box([], { width: 8, height: 8, borderRadius: 4, backgroundColor: C.ink }), label: "Needs you", sub: "A bot is waiting on your answer", right: alwaysOn(), chevron: false }),
        listRow({ left: box([], { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: C.ink }), label: "Done", sub: "Quiet: no sound. Ping: with sound", right: doneSeg(116), chevron: false }),
        row([
          glyph(G.rules, 18),
          col([text("Daily summary", { size: 15 }), row([meta("One note at ", { size: 12 }), text(clock(s.notify.summaryAt), { size: 12, weight: 600 }), meta(" · ", { size: 12 }),
            box([text("Change", { size: 12, style: { textDecorationLine: "underline" } })], { minHeight: 24, justifyContent: "center" }, { kind: "toggleState", path: "pickTime" })], {})], { flexGrow: 1, flexShrink: 1, gap: 2 }),
          box([switchMark("summary")], { minHeight: 44, justifyContent: "center" }, summarySwitch()),
        ], { gap: 12, paddingVertical: 10, paddingHorizontal: 16 }),
      ]),
      timePicker(),
      when({ truthy: "summary" }, summaryPreview(ctx, d)),
      col([
        sectionLabel("By bot"),
        listCard(ctx.live.bots.map((b) => { const sw = botSwitch(b.slug); return switchRow(b.name, sw.path, { left: botAvatar(b, 28), ...(botSub(b.slug) ? { sub: botSub(b.slug)! } : {}), onChange: sw.saveIt }); })),
        meta("A bot turned off still reaches you when it needs you.", { size: 12 }),
      ], { gap: 8 }),
      card([
        row([glyph(G.moon, 18), col([text("Quiet hours", { size: 15, weight: 500 }), meta(`${clock(s.notify.quietFrom, true)} – ${clock(s.notify.quietTo, true)}, every night`, { size: 12 })], { flexGrow: 1, gap: 2 }), switchMark("quiet")], { gap: 12 }, quietSwitch()),
        meta("Bots keep working. Done waits in Activity. Needs you still reaches you, without sound.", { size: 12, lineHeight: 17 }),
      ], { gap: 10, padding: 16 }),
    ],
  });
}

function notifyDesk(ctx: BotsCtx, d: NotifyData | undefined) {
  if (!d) return page(ctx, { back: true, backTitle: "You", nav: "you", title: "What pings you", maxWidth: 1040, body: [heading(ctx, "What pings you"), couldNot("your settings")] });
  const s = d.settings;
  const H = 24 * 60, pct = (m: number) => `${((m / H) * 100).toFixed(1)}%`;
  const quietBar = s.notify.quietFrom > s.notify.quietTo
    ? row([box([], { width: pct(s.notify.quietTo), height: 6, backgroundColor: C.ink }), box([], { flexGrow: 1, height: 6 }), box([], { width: pct(H - s.notify.quietFrom), height: 6, backgroundColor: C.ink })], { borderRadius: 3, backgroundColor: C.track, overflow: "hidden" })
    : row([box([], { width: pct(s.notify.quietFrom), height: 6 }), box([], { width: pct(s.notify.quietTo - s.notify.quietFrom), height: 6, backgroundColor: C.ink })], { borderRadius: 3, backgroundColor: C.track, overflow: "hidden" });
  return page(ctx, {
    back: true, backTitle: "You", nav: "you", title: "What pings you", maxWidth: 1040, gap: 20, state: notifyState(s, ctx),
    body: [
      heading(ctx, "What pings you", "Needs you always reaches you. The rest waits quietly in Activity."),
      columns([
        card([
          table([{ label: "By bot", flex: 2 }, { label: "Needs you" }, { label: "Done pings", align: "right" }],
            ctx.live.bots.map((b) => {
              const sw = botSwitch(b.slug);
              return [
                row([botAvatar(b, 26), col([text(b.name, { size: 14 }), ...(botSub(b.slug) ? [meta(botSub(b.slug)!, { size: 11 })] : [])], { gap: 1, flexShrink: 1 })], { gap: 10 }),
                alwaysOn("Always"),
                box([switchMark(sw.path)], {}, sw.press),
              ];
            })),
        ], { padding: 0, gap: 0, style: { borderWidth: 0 } }),
        meta("A bot turned off still reaches you when it needs you.", { size: 12 }),
      ], [
        card([
          row([col([text("Done", { size: 15, weight: 600 }), meta("Quiet: no sound. Ping: with sound", { size: 12 })], { flexGrow: 1, gap: 2 }), doneSeg(130)], { gap: 12 }),
          divider(),
          row([col([text("Daily summary", { size: 15, weight: 600 }), meta(`One note at ${clock(s.notify.summaryAt)}`, { size: 12 })], { flexGrow: 1, gap: 2 }), box([switchMark("summary")], {}, summarySwitch())], { gap: 12 }),
          pills(SUMMARY_TIMES, "at", (v) => save({ notify: { summaryAt: Number(v) } }, "Summary time changed")),
          sectionLabel("Tonight's summary, as it will look"),
          summaryPreview(ctx, d),
        ], { padding: 20, gap: 14 }),
        card([
          row([glyph(G.moon, 18), col([text("Quiet hours", { size: 15, weight: 600 }), meta(`${clock(s.notify.quietFrom, true)} – ${clock(s.notify.quietTo, true)}, every night`, { size: 12 })], { flexGrow: 1, gap: 2 }), switchMark("quiet")], { gap: 12 }, quietSwitch()),
          quietBar,
          row([meta("12 am", { size: 11 }), grow(), meta("12 pm", { size: 11 }), grow(), meta("11 pm", { size: 11 })]),
          meta("Bots keep working. Done waits in Activity. Needs you still reaches you, without sound.", { size: 12, lineHeight: 17 }),
        ], { padding: 20, gap: 12 }),
      ], { rightWidth: 400 }),
    ],
  });
}

// ===================================================================== bots.privacy

const KEPT: Array<[string, string, string]> = [
  ["Chats with your bots", "What they remember. Forget any of it", "Till you delete"],
  ["What you ask on your phone", "The first 80 characters, for Activity", "30 days"],
  ["Keybot voice", "Only the text stays, if you keep history", "Not kept"],
  ["Screen pictures", "Only ones you allowed, while answering", "Not kept"],
  ["Your account and bots", "Projects, settings, connected apps", "Till you delete"],
];
const NEVER = ["Sell your data, to anyone", "Train AI models on your data", "Open folders you didn't share"];

const deleteData: ActionRef = when2("sureData",
  call("POST", "/v1/you/data/delete", {}, { ok: seq(toast("Chats, notes and files deleted"), { kind: "setState", path: "sureData", value: false }, refresh), fail: oops("delete that") }),
  seq({ kind: "setState", path: "sureData", value: true }, toast("Tap Delete my data again to delete")));

function neverList(): Node {
  return col(NEVER.map((n) => row([glyph(G.never, 16), body(n, { size: 14 })], { gap: 10 })), { gap: 10 });
}

function picturesCard(ctx: BotsCtx): Node {
  return card([
    text("Screen pictures", { size: 15, weight: 600 }),
    meta("Ask on your computer takes one to see what's wrong on screen. You see it before it's sent, and it isn't kept.", { size: 12, lineHeight: 17 }),
    ...(ctx.client === "desktop" ? [segments([{ label: "Ask first", value: "ask" }, { label: "Allow", value: "allow" }], "pictures", (v) => seq(
      { kind: "ask.picturesAll", on: v === "allow" } as unknown as ActionSpec,
      save({ privacy: { screenPictures: v } }, v === "allow" ? "Pictures go without asking" : "Ask asks first"),
    ))] : [meta("Change this in Tailzu on your computer.", { size: 12 })]),
  ], { gap: 10, padding: 16 });
}

function privacyPhone(ctx: BotsCtx, d: YouData | undefined) {
  return page(ctx, {
    back: true, nav: "you", title: "Privacy", gap: 18, state: { sureData: false, pictures: d?.settings.privacy.screenPictures ?? "ask" },
    body: [
      title("Privacy"),
      col([sectionLabel("What we keep, and for how long"), listCard(KEPT.map(([l, , v]) => listRow({ label: l, value: v })))], { gap: 8 }),
      col([sectionLabel("What we never do"), neverList()], { gap: 10 }),
      picturesCard(ctx),
    ],
    footer: [
      secondaryButton("Download my data", exportAction(d?.exportUrl ?? null), { wide: true, icon: undefined }),
      col([quietButton("Delete my data", deleteData, { wide: true }), meta("Chats, notes and files go. Your account and plan stay.", { size: 12, align: "center" })], { gap: 0 }),
    ],
  });
}

function privacyDesk(ctx: BotsCtx, d: YouData | undefined) {
  return page(ctx, {
    back: true, backTitle: "You", nav: "you", title: "Privacy", maxWidth: 1040, gap: 20, state: { sureData: false, pictures: d?.settings.privacy.screenPictures ?? "ask" },
    body: [
      heading(ctx, "Privacy", "What we keep, and for how long"),
      columns([
        table([{ label: "What", flex: 2 }, { label: "Kept for", flex: 1 }], KEPT.map(([l, s, v]) => [col([text(l, { size: 14 }), meta(s, { size: 12 })], { gap: 2 }), text(v, { size: 14, weight: 500 })])),
        card([
          sectionLabel("Your data"),
          row([
            button("Download my data", exportAction(d?.exportUrl ?? null), { kind: "secondary", size: "md" }),
            button("Delete my data", deleteData, { kind: "secondary", size: "md" }),
          ], { gap: 10 }),
          meta("Delete: chats, notes and files go. Your account and plan stay.", { size: 12 }),
          divider(),
          row([text("Delete the whole account instead", { size: 14 }), grow(), icon("chevron", { size: 16, color: C.meta })], {}, open(SCREENS.deleteAccount)),
        ], { padding: 20, gap: 12 }),
      ], [
        card([sectionLabel("What we never do"), neverList()], { padding: 20, gap: 12 }),
        picturesCard(ctx),
      ]),
    ],
  });
}

// ===================================================================== bots.delete-account

// Asking sets a date seven days out and signs the person out; signing in before it shows the date and Keep my account (accountGrace.ts).

/** What the page reads: what the account holds (GET /v1/you/account), and whether a date is set (GET /v1/account/deletion). */
interface DeleteData { account: AccountData | undefined; deletion: DeletionState | undefined }

function goesAway(ctx: BotsCtx, d: AccountData, gone?: string): Node[] {
  const own = d.bots.filter((b) => !b.builtin);
  return [
    listRow({
      label: plural(d.bots.length, "bot"), chevron: false,
      right: row(d.bots.slice(0, 5).map((b) => botAvatar(botLook(b.slug, b.colour), 20)), { gap: 3 }),
      ...(ctx.client === "desktop" ? { sub: d.bots.map((b) => b.name).join(", ") } : own.length ? { sub: `${plural(own.length, "of your own")}` } : {}),
    }),
    listRow({ label: plural(d.projects.length, "project"), value: d.projects.length ? (d.projects.length > 1 ? `${d.projects[0]} and ${d.projects.length - 1} more` : d.projects[0]!) : "None" }),
    listRow({ label: plural(d.notes, "note"), value: "and every chat" }),
    listRow({ label: plural(d.keys, "key"), value: d.keys ? (gone ? `stop working on ${gone}` : "stop working right away") : "None" }),
  ];
}
const planWarning = (ctx: BotsCtx, d: AccountData): Node[] =>
  d.plan.active && d.plan.renews ? [card([
    row([glyph(G.never, 16), text(`Cancel Pro first. You're on Pro, and it would still renew${d.plan.until ? ` on ${dayMonth(ctx, d.plan.until)}` : ""}.`, { size: 13, weight: 500, lineHeight: 18, style: { flexShrink: 1 } })], { gap: 10, alignItems: "flex-start" }),
    text("Plan and billing", { size: 13, weight: 500, style: { textDecorationLine: "underline" } }),
  ], { gap: 8, padding: 14, style: { backgroundColor: C.surface, borderWidth: 0 }, onPress: open(SCREENS.billing) })] : [];

/** The seven days under their strip: from today (or the day they asked) to the day it goes, and what that means. */
function graceBlock(ctx: BotsCtx, del: DeletionState | undefined): Node {
  const s = del?.scheduled;
  const from = s?.requestedAt ?? ctx.live.now, gone = dayMonthOf(ctx, goneAt(ctx, del));
  return col([
    daysStrip(ctx, from),
    row([meta(`${s ? "Asked on" : "Today,"} ${dayMonthOf(ctx, from)}`, { size: 12 }), grow(), meta(`Gone for good, ${gone}`, { size: 12 })]),
    text(s ? "Until then everything is here, as it was. Keep your account and nothing is lost."
      : `You have ${GRACE_DAYS} days to change your mind. Sign in before ${gone} and everything comes back as it was.`, { size: 14, lineHeight: 20 }),
  ], { gap: 8 });
}

function deletePhone(ctx: BotsCtx, data: DeleteData | undefined) {
  const d = data?.account, del = data?.deletion;
  const gone = dayMonthOf(ctx, goneAt(ctx, del));
  if (del?.scheduled) {
    return page(ctx, {
      back: true, nav: "you", title: "Delete account", gap: 18,
      body: [
        heading(ctx, "Delete account", `Your account will be deleted on ${gone}.`),
        graceBlock(ctx, del),
        ...(d ? [col([sectionLabel("What goes then"), listCard(goesAway(ctx, d, gone))], { gap: 8 })] : []),
      ],
      footer: [primaryButton("Keep my account", keepAccount, { wide: true })],
    });
  }
  const holdButton: Node = {
    ...button("Hold to delete", undefined, { wide: true }),
    on: { onPress: { kind: "toast", message: "Press and hold to delete" }, onLongPress: scheduleDeletion(gone) },
  };
  return page(ctx, {
    back: true, nav: "you", title: "Delete account", gap: 18,
    body: [
      heading(ctx, "Delete account", "Here is exactly what happens, so there are no surprises."),
      ...(d ? [
        col([sectionLabel("What goes away"), listCard(goesAway(ctx, d, gone))], { gap: 8 }),
        graceBlock(ctx, del),
        ...planWarning(ctx, d),
        row([meta("Want a copy first? ", { size: 13 }), text("Download my data", { size: 13, weight: 500, style: { textDecorationLine: "underline" } })], {}, exportAction(d.exportUrl)),
      ] : [couldNot("what your account holds"), graceBlock(ctx, del)]),
    ],
    footer: [holdButton, meta("Press and hold. Let go any time to stop.", { size: 12, align: "center" }), secondaryButton("Keep my account", back(), { wide: true })],
  });
}

function deleteDesk(ctx: BotsCtx, data: DeleteData | undefined) {
  const d = data?.account, del = data?.deletion, s = del?.scheduled;
  const gone = dayMonthOf(ctx, goneAt(ctx, del));
  const days = card([
    row([sectionLabel(s ? "Until then, nothing is lost" : `${GRACE_DAYS} days to change your mind`), grow(), text(`Gone for good, ${gone}`, { size: 13, weight: 600, lineHeight: 18 })], { gap: 10 }),
    daysStrip(ctx, s?.requestedAt ?? ctx.live.now, { labels: true }),
    text(s ? "Everything is here, as it was. Keep your account and nothing changes."
      : `You have ${GRACE_DAYS} days to change your mind. Sign in before ${gone} and everything comes back as it was.`, { size: 14, lineHeight: 20 }),
  ], { padding: 20, gap: 12 });
  const left = [
    ...(d ? [col([sectionLabel(s ? "What goes then" : "What goes away"), listCard(goesAway(ctx, d, gone))], { gap: 8 })] : [couldNot("what your account holds")]),
    days,
  ];
  if (s) {
    return page(ctx, {
      back: true, backTitle: "You", nav: "you", title: "Delete account", maxWidth: 1040, gap: 20,
      body: [
        heading(ctx, "Delete account", `Your account will be deleted on ${gone}.`),
        columns(left, [card([
          sectionLabel("Changed your mind?"),
          meta("Keep your account and everything stays as it is: your bots, projects, notes and keys.", { size: 13, lineHeight: 18 }),
          primaryButton("Keep my account", keepAccount, { wide: true, size: "md" }),
        ], { padding: 20, gap: 12 })]),
      ],
    });
  }
  return page(ctx, {
    back: true, backTitle: "You", nav: "you", title: "Delete account", maxWidth: 1040, gap: 20, state: { sure: false },
    body: [
      heading(ctx, "Delete account", "Here is exactly what happens, so there are no surprises."),
      columns(left, [
        card([
          sectionLabel("Before you go"),
          ...(d ? planWarning(ctx, d) : []),
          row([icon("check", { size: 14 }), meta("Want a copy first? Chats, notes, files and job steps, in one file.", { size: 13, style: { flexShrink: 1 } })], { gap: 8, alignItems: "flex-start" }),
          button("Download my data", exportAction(d?.exportUrl ?? null), { kind: "secondary", size: "md" }),
          divider(),
          when({ falsy: "sure" }, primaryButton("Delete account", { kind: "setState", path: "sure", value: true }, { wide: true, size: "md" })),
          when({ truthy: "sure" }, col([
            text(`Delete your account on ${gone}?`, { size: 14, weight: 600, align: "center" }),
            primaryButton("Yes, delete my account", scheduleDeletion(gone), { wide: true, size: "md" }),
          ], { gap: 8 })),
          secondaryButton("Keep my account", back(), { wide: true, size: "md" }),
        ], { padding: 20, gap: 12 }),
      ]),
    ],
  });
}

// ===================================================================== bots.apps

const LEVEL_WORDS: Record<string, string> = { look: "Reads only", draft: "Reads, drafts for your yes", send: "Reads and acts, asking first" };

function usedByNode(ctx: BotsCtx, names: string[], extra?: string): Node {
  return row([
    ...(names.length ? [row(avatarsOf(ctx, names, 14), { gap: 2 })] : []),
    meta(names.length ? `${names.map((n) => n.replace(/ bot$/i, "")).join(", ")}${extra ? ` · ${extra}` : ""}` : extra ?? "No bot uses it yet", { size: 12, lines: 1, style: { flexShrink: 1 } }),
  ], { gap: 6 });
}

function appsPhone(ctx: BotsCtx, d: AppsData | undefined) {
  const head = [title("Connected apps"), meta("Bots only use what you allowed. Tap one to change it.", { size: 14, color: C.grey70 })];
  if (!d) return page(ctx, { back: true, nav: "you", title: "Connected apps", body: [...head, couldNot("your apps")] });
  if (!d.enabled) return page(ctx, { back: true, nav: "you", title: "Connected apps", body: [...head, emptyState({ pose: "think", title: "Connected apps aren't on yet", body: "When they are, your bots can use GitHub, Docs and more." })] });
  const rows: Node[] = [
    ...(d.github ? [listRow({ left: appIcon("Code"), label: "GitHub", sub: `Used by Code · ${plural(d.github.repos, "repo")}`, onPress: open(SCREENS.code) })] : []),
    ...d.connected.map((a) => row([
      appIcon(a.category),
      col([text(a.name, { size: 15, lineHeight: 20 }), usedByNode(ctx, a.usedBy)], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 3 }),
      meta(a.needsSignIn ? "Sign in again" : ago(ctx, a.lastUsedAt), { size: 12 }),
    ], { gap: 12, paddingVertical: 12, paddingHorizontal: 16 }, open(SCREENS.appConnect, { id: a.id }))),
  ];
  return page(ctx, {
    back: true, nav: "you", title: "Connected apps", gap: 18,
    body: [
      ...head,
      rows.length ? col([sectionLabel(`Connected · ${rows.length}`), listCard(rows)], { gap: 8 })
        : emptyState({ pose: "hello", title: "No apps yet", body: "Connect one and your bots can work in it for you." }),
      ...(d.more.length ? [col([sectionLabel("Connect more"), listCard(d.more.slice(0, 4).map((a) => row([
        appIcon(a.category),
        col([text(a.name, { size: 15 }), meta(a.oneLine, { size: 12, lines: 1 })], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 }),
        text("Connect", { size: 14, weight: 600 }),
      ], { gap: 12, paddingVertical: 12, paddingHorizontal: 16 }, open(SCREENS.appConnect, { id: a.id }))))], { gap: 8 })] : []),
      meta("Disconnecting an app stops every bot that uses it.", { size: 12, align: "center" }),
    ],
  });
}

function appsDesk(ctx: BotsCtx, d: AppsData | undefined) {
  const head = heading(ctx, "Connected apps", "Bots only use what you allowed. Click one to change it.");
  if (!d) return page(ctx, { back: true, backTitle: "You", nav: "you", title: "Connected apps", maxWidth: 1040, body: [head, couldNot("your apps")] });
  if (!d.enabled) return page(ctx, { back: true, backTitle: "You", nav: "you", title: "Connected apps", maxWidth: 1040, body: [head, emptyState({ pose: "think", title: "Connected apps aren't on yet", body: "When they are, your bots can use GitHub, Docs and more." })] });
  const list = [
    ...(d.github ? [{ id: "", name: "GitHub", category: "Code", usedBy: ["Code bot"], extra: plural(d.github.repos, "repo"), can: "Read code, open pull requests. Never merges.", last: "", go: open(SCREENS.code) }] : []),
    ...d.connected.map((a) => ({ id: a.id, name: a.name, category: a.category, usedBy: a.usedBy, extra: undefined as string | undefined, can: LEVEL_WORDS[a.level] ?? "Reads only", last: a.needsSignIn ? "Sign in again" : ago(ctx, a.lastUsedAt), go: open(SCREENS.appConnect, { id: a.id }) })),
  ];
  return page(ctx, {
    back: true, backTitle: "You", nav: "you", title: "Connected apps", maxWidth: 1040, gap: 20,
    body: [
      head,
      list.length ? table([{ label: `Connected · ${list.length}`, flex: 2 }, { label: "Used by", flex: 2 }, { label: "Bots can", flex: 3 }, { label: "Last used", flex: 1 }],
        list.map((a) => [
          row([appIcon(a.category, 18), text(a.name, { size: 14, weight: 500, style: { flexShrink: 1 } })], { gap: 10 }),
          usedByNode(ctx, a.usedBy, a.extra), a.can, a.last,
        ]), { onRow: (i) => list[i]!.go })
        : emptyState({ pose: "hello", title: "No apps yet", body: "Connect one and your bots can work in it for you." }),
      ...(d.more.length ? [col([sectionLabel("Connect more"), row(d.more.slice(0, 3).map((a) => card([
        row([appIcon(a.category, 18), col([text(a.name, { size: 14, weight: 500 }), meta(a.oneLine, { size: 12, lines: 2 })], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 })], { gap: 10, alignItems: "flex-start" }),
        button("Connect", open(SCREENS.appConnect, { id: a.id }), { kind: "secondary", size: "md" }),
      ], { padding: 16, gap: 12, style: { flexGrow: 1, flexBasis: 0 } })), { gap: 14, alignItems: "stretch" })], { gap: 8 })] : []),
      meta("Disconnecting an app stops every bot that uses it.", { size: 12 }),
    ],
  });
}

// ===================================================================== bots.app-connect

/** Connect: the phone opens the sign-in page the route names; the window does it all with its own action. A pasted link goes in the body. */
function connectAction(ctx: BotsCtx, a: AppData["app"]): ActionRef {
  const done = seq(toast(`${a.name} connected`), refresh);
  if (ctx.client === "desktop") {
    return { kind: "connector.connect", id: a.id, ...(a.auth === "url" ? { urlPath: "url" } : {}), onSuccess: done, onError: oops("connect it") };
  }
  return call("POST", `/v1/connectors/${encodeURIComponent(a.id)}/connect`, a.auth === "url" ? { url: "$state.url" } : {}, {
    assignTo: "link",
    ok: when2("link.authorizeUrl", { kind: "openUrl", url: "$state.link.authorizeUrl" }, done),
    fail: oops("connect it"),
  });
}
const disconnect = (a: AppData["app"]): ActionRef =>
  call("DELETE", `/v1/connectors/${encodeURIComponent(a.id)}`, undefined, { ok: seq(toast(`${a.name} disconnected`), back()), fail: oops("disconnect it") });

function appHeader(a: AppData["app"]): Node {
  return row([
    box([shapes([{ circle: [12, 12, 2.2], fill: C.ink }, ...[[12, 4.5], [17.3, 6.7], [19.5, 12], [17.3, 17.3], [12, 19.5], [6.7, 17.3], [4.5, 12], [6.7, 6.7]].map(([x, y]) => ({ circle: [x!, y!, 1.2] as [number, number, number], fill: C.ink }))], { size: 22 })],
      { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center" }),
    icon("more", { size: 18, color: C.meta }),
    appIcon(a.category, 22),
  ], { gap: 10 });
}

function canCards(d: AppData): Node {
  const list = (head: string, items: string[], mark: "check" | "close") => card([
    sectionLabel(head),
    ...items.map((x) => row([icon(mark, { size: 14 }), text(x, { size: 13, lineHeight: 18, style: { flexShrink: 1 } })], { gap: 8, alignItems: "flex-start" })),
  ], { padding: 14, gap: 10, style: { flexGrow: 1, flexBasis: 0 } });
  return row([list("It can", d.can, "check"), list("It can't", d.cant, "close")], { gap: 10, alignItems: "stretch" });
}

function botsUsing(d: AppData): Node {
  const rows = d.bots.map((b) => {
    const look = botLook(b.slug, b.colour);
    const path = `link_${b.slug.replace(/-/g, "_")}`;
    const toggle = seq({ kind: "toggleState", path }, when2(path,
      call("PUT", `/v1/bots/${b.slug}/connectors/${encodeURIComponent(d.app.id)}`, {}, { ok: seq(toast(`${b.name} can use it`), refresh), fail: oops() }),
      call("DELETE", `/v1/bots/${b.slug}/connectors/${encodeURIComponent(d.app.id)}`, undefined, { ok: seq(toast(`${b.name} won't use it`), refresh), fail: oops() })));
    return b.builtin
      ? listRow({ left: botAvatar(look, 28), label: b.name, sub: b.purpose.length > 44 ? `${b.purpose.slice(0, 43).trimEnd()}…` : b.purpose, right: alwaysOn("Always"), chevron: false })
      : listRow({ left: botAvatar(look, 28), label: b.name, sub: b.purpose.length > 44 ? `${b.purpose.slice(0, 43).trimEnd()}…` : b.purpose, right: switchMark(path), chevron: false, onPress: toggle });
  });
  return col([sectionLabel("Bots that will use it"), rows.length ? listCard(rows) : meta("No bot uses it yet. Make one that does, or ask any bot.", { size: 13 })], { gap: 8 });
}

function appConnectBody(ctx: BotsCtx, d: AppData): Node[] {
  const a = d.app;
  return [
    appHeader(a),
    heading(ctx, a.connected ? a.name : `Connect ${a.name}`, a.connected ? `Connected · last used ${ago(ctx, a.lastUsedAt).toLowerCase()}` : `${a.oneLine} Here is exactly what your bots get.`),
    canCards(d),
    botsUsing(d),
    ...(a.connected ? [col([
      sectionLabel("What bots may do"),
      pills([{ label: "Read only", value: "look" }, { label: "Draft for me", value: "draft" }, { label: "Act, asking first", value: "send" }], "level",
        (v) => call("POST", `/v1/connectors/${encodeURIComponent(a.id)}/level`, { level: v }, { ok: seq(toast("Changed"), refresh), fail: oops() })),
    ], { gap: 8 })] : []),
    ...(!a.connected && a.auth === "url" ? [col([sectionLabel("Its link"), field("url", "Paste the link from the app", { keyboard: "url" })], { gap: 8 })] : []),
  ];
}

function appConnect(ctx: BotsCtx, d: AppData | undefined) {
  const desk = ctx.client === "desktop";
  if (!d) {
    return page(ctx, { back: true, backTitle: desk ? "Connected apps" : undefined, nav: "you", title: "Connect an app", ...(desk ? { maxWidth: 1040 } : {}), body: [title("Connect an app"), couldNot("this app")] });
  }
  const a = d.app;
  const primary = a.connected ? secondaryButton("Disconnect", disconnect(a), { wide: !desk, size: desk ? "md" : "lg" })
    : primaryButton(a.provider === "google" ? "Connect with Google" : "Connect", connectAction(ctx, a), { wide: !desk, size: desk ? "md" : "lg" });
  const foot = meta(a.connected ? "Disconnecting stops every bot that uses it." : "Disconnect any time in You", { size: 12, align: desk ? "left" : "center" });
  const state = { url: "", level: a.level, ...Object.fromEntries(d.bots.map((b) => [`link_${b.slug.replace(/-/g, "_")}`, b.linked])) };
  if (!desk) return page(ctx, { back: true, nav: "you", title: `Connect ${a.name}`, gap: 18, state, body: appConnectBody(ctx, d), footer: [primary, foot] });
  return page(ctx, {
    back: true, backTitle: "Connected apps", nav: "you", title: `Connect ${a.name}`, maxWidth: 1040, gap: 20, state,
    body: [columns([...appConnectBody(ctx, d), row([primary, foot], { gap: 14 })], [
      card([
        sectionLabel("How it works"),
        ...[
          ["You connect it yourself", `${a.provider === "google" ? "Google" : a.name} asks you what to allow.`],
          ["Reading just happens", "A change asks you the first time, every time until you say it may."],
          ["Off any time", "Disconnect here or in You. Every bot stops using it at once."],
        ].map(([h, s]) => row([icon("check", { size: 14 }), col([text(h!, { size: 14, weight: 500 }), meta(s!, { size: 12, lineHeight: 17 })], { gap: 2, flexShrink: 1 })], { gap: 10, alignItems: "flex-start" })),
      ], { padding: 20, gap: 14 }),
    ], { rightWidth: 340 })],
  });
}

// ===================================================================== bots.settings (the window's)

function settingsPage(ctx: BotsCtx, d: YouData | undefined) {
  const desk = ctx.client === "desktop";
  const deskSettingsId = ctx.desk.pages ? "desk_settings" : "settings";
  const account = card([
    sectionLabel("Account"),
    row([face(ctx, 40), col([text(youName(ctx), { size: 15, weight: 600 }), meta(ctx.user?.email ?? "", { size: 12 })], { flexGrow: 1, flexShrink: 1, gap: 2 }), button("Sign out", signOut, { kind: "secondary", size: "md" })], { gap: 12 }),
    divider(),
    row([text("Paying", { size: 14 }), grow(), meta(d ? `${d.plan.name} · ${rupees(d.spend.monthPaise)} this month` : "", { size: 13 }), icon("chevron", { size: 16, color: C.meta })], { gap: 8, minHeight: 32 }, open(SCREENS.billing)),
  ], { padding: 18, gap: 12 });
  const yours = listCard([
    listRow({ label: "Spaces and chats", value: "Family and friends", onPress: open(SCREENS.spaces) }),
    listRow({ label: "Budget", value: d ? `${rupees(d.spend.monthPaise)} of ${rupees(d.spend.limitPaise)}` : "", onPress: open(SCREENS.budget) }),
    listRow({ label: "What pings you", value: d?.settings.notify.quiet ? "Quiet hours on" : "", onPress: open(SCREENS.notify) }),
    listRow({ label: "Connected apps", value: appsLine(d), onPress: open(SCREENS.apps) }),
    listRow({ label: "This computer helps", value: computerLine(d), onPress: open(SCREENS.computer) }),
    listRow({ label: "Language", value: languageName(d?.language ?? null), onPress: open(SCREENS.language) }),
  ]);
  const privacy = listCard([
    listRow({ label: "Privacy", onPress: open(SCREENS.privacy) }),
    listRow({ label: "Download my data", chevron: false, right: glyph(G.download, 18, C.meta), onPress: exportAction(d?.exportUrl ?? null) }),
    listRow({ label: "Delete account", onPress: open(SCREENS.deleteAccount) }),
  ]);
  const local = card([
    sectionLabel(desk ? "On this computer" : "On this phone"),
    meta(desk ? "Shortcuts, where the pill sits, screen pictures, apps Ask never looks at, and updates." : "Your keyboard, sounds and the rest of this phone's settings.", { size: 13, lineHeight: 18 }),
    button(desk ? "Open computer settings" : "Open phone settings", open(deskSettingsId), { kind: "secondary", size: "md" }),
  ], { padding: 18, gap: 10 });
  return page(ctx, {
    back: !desk, nav: "settings", title: "Settings", ...(desk ? { maxWidth: 1040 } : {}), gap: 20,
    body: desk
      ? [heading(ctx, "Settings", "Tailzu for Mac and Windows"), columns([account, col([sectionLabel("Your bots"), yours], { gap: 8 }), col([sectionLabel("Your data"), privacy], { gap: 8 })], [local])]
      : [title("Settings"), account, col([sectionLabel("Your bots"), yours], { gap: 8 }), col([sectionLabel("Your data"), privacy], { gap: 8 }), local],
  });
}

// ===================================================================== the list

const tz = (ctx: BotsCtx) => `tz=${Math.round(ctx.tzOffsetMinutes)}`;

export const youScreens: BotsScreen[] = [
  screen<YouData>({ id: SCREENS.you, load: (ctx, deps) => deps.api<YouData>("GET", `/v1/you?${tz(ctx)}`), build: (ctx, d) => (ctx.client === "desktop" ? youDesk(ctx, d) : youPhone(ctx, d)) }),
  screen<SpendData>({ id: SCREENS.budget, load: (ctx, deps) => deps.api<SpendData>("GET", `/v1/you/spend?${tz(ctx)}`), build: (ctx, d) => (ctx.client === "desktop" ? budgetDesk(ctx, d) : budgetPhone(ctx, d)) }),
  screen<BillingData>({ id: SCREENS.billing, load: (ctx, deps) => deps.api<BillingData>("GET", `/v1/you/billing?${tz(ctx)}`), build: (ctx, d) => (ctx.client === "desktop" ? billingDesk(ctx, d) : billingPhone(ctx, d)) }),
  screen<ComputersData>({ id: SCREENS.computer, load: (_ctx, deps) => deps.api<ComputersData>("GET", "/v1/you/computers"), build: (ctx, d) => (ctx.client === "desktop" ? computerDesk(ctx, d) : computerPhone(ctx, d)) }),
  screen<NotifyData>({ id: SCREENS.notify, load: (ctx, deps) => deps.api<NotifyData>("GET", `/v1/you/notify?${tz(ctx)}`), build: (ctx, d) => (ctx.client === "desktop" ? notifyDesk(ctx, d) : notifyPhone(ctx, d)) }),
  screen<YouData>({ id: SCREENS.privacy, load: (ctx, deps) => deps.api<YouData>("GET", `/v1/you?${tz(ctx)}`), build: (ctx, d) => (ctx.client === "desktop" ? privacyDesk(ctx, d) : privacyPhone(ctx, d)) }),
  screen<DeleteData>({
    id: SCREENS.deleteAccount,
    load: async (_ctx, deps) => {
      const [account, deletion] = await Promise.all([
        deps.api<AccountData>("GET", "/v1/you/account").catch(() => undefined),
        deps.api<DeletionState>("GET", DELETION_PATH).catch(() => undefined),
      ]);
      return { account, deletion };
    },
    build: (ctx, d) => (ctx.client === "desktop" ? deleteDesk(ctx, d) : deletePhone(ctx, d)),
  }),
  screen<AppsData>({ id: SCREENS.apps, load: (_ctx, deps) => deps.api<AppsData>("GET", "/v1/you/apps"), build: (ctx, d) => (ctx.client === "desktop" ? appsDesk(ctx, d) : appsPhone(ctx, d)) }),
  screen<AppData>({
    id: SCREENS.appConnect,
    load: async (ctx, deps) => {
      const id = String(ctx.params.id ?? "");
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id)) throw new Error("no app");
      return deps.api<AppData>("GET", `/v1/you/apps/${encodeURIComponent(id)}`);
    },
    build: (ctx, d) => appConnect(ctx, d),
  }),
  screen<YouData>({ id: SCREENS.settings, load: (ctx, deps) => deps.api<YouData>("GET", `/v1/you?${tz(ctx)}`), build: (ctx, d) => settingsPage(ctx, d) }),
];
