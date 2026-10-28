/**
 * READING WHAT OTHER PARTS HAND THE SHELL AS WORDS: a UPI payment link, and the lines a connected Google app answers with.
 *
 *   upiOf(link)        the payee, UPI ID, amount and note of a upi://pay link (NPCI's linking specification), or null
 *   calendarOf(text)   google-calendar.list_events' lines ("- Today 10:00–10:30, Standup with Rohan (id: …)") as events
 *   googleTasksOf(text) google-tasks.list_tasks' lines ("- Renew car insurance, due Friday (id: …)") as to-dos
 *
 * A payment link is made by the UPI hand-off (connectors/handoffs/apps.ts upiLink): Tailzu fills a payment in for the person to
 * check in their own UPI app and press pay. Nothing here pays, and nothing here trusts a link it cannot read whole.
 */

export interface Upi {
  /** The payee's UPI ID, name@bank. */
  vpa: string;
  /** The payee's name, as the link says it (else the UPI ID). */
  name: string;
  amountPaise: number;
  note: string;
  /** The link itself, re-made from what was read: what "Open UPI to pay" opens. */
  link: string;
}

const VPA = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;
/** UPI's usual most for one payment between people (connectors/handoffs/apps.ts UPI_MAX_RUPEES). */
const UPI_MAX_PAISE = 100_000 * 100;

const enc = (s: string) => encodeURIComponent(s);

/** A upi://pay link read, or null when it is not one, has no payee or no amount, or the amount is not a sane one. */
export function upiOf(link: unknown): Upi | null {
  if (typeof link !== "string" || link.length > 1000 || !/^upi:\/\/pay\?/i.test(link.trim())) return null;
  let q: URLSearchParams;
  try { q = new URLSearchParams(link.trim().slice(link.indexOf("?") + 1)); } catch { return null; }
  const vpa = (q.get("pa") ?? "").trim();
  if (!VPA.test(vpa)) return null;
  const am = (q.get("am") ?? "").trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(am)) return null;
  const amountPaise = Math.round(Number(am) * 100);
  if (!(amountPaise > 0 && amountPaise <= UPI_MAX_PAISE)) return null;
  const cu = (q.get("cu") ?? "INR").trim().toUpperCase();
  if (cu !== "INR") return null;
  const name = (q.get("pn") ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || vpa;
  const note = (q.get("tn") ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const amount = (amountPaise / 100).toFixed(2);
  return {
    vpa, name, amountPaise, note,
    link: `upi://pay?pa=${enc(vpa).replace("%40", "@")}&pn=${enc(name)}&am=${amount}&cu=INR${note ? `&tn=${enc(note)}` : ""}`,
  };
}

export interface CalEvent {
  /** Minutes after the day's midnight; null for an all-day event. */
  start: number | null;
  end: number | null;
  title: string;
  /** "with Rohan and Meera". */
  with?: string;
  /** "10:00–10:30", "All day". */
  when: string;
}

const HM = /(\d{1,2}):(\d{2})/g;

/** The events of a list_events answer, in order. Lines that do not read as an event are left out. */
export function calendarOf(text: string): CalEvent[] {
  const out: CalEvent[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("- ")) continue;
    const body = line.slice(2).replace(/\s*\(id:[^)]*\)\s*$/, "");
    const comma = body.indexOf(", ");
    if (comma < 0) continue;
    const whenPart = body.slice(0, comma);
    let rest = body.slice(comma + 2).trim();
    if (rest.toLowerCase().startsWith("all day")) rest = rest.replace(/^all day,?\s*/i, "");
    const times = [...whenPart.matchAll(HM)].map((m) => Number(m[1]) * 60 + Number(m[2]));
    const w = / with (.+)$/.exec(rest);
    const title = (w ? rest.slice(0, w.index) : rest).trim();
    if (!title) continue;
    const pad = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    out.push({
      start: times[0] ?? null, end: times[1] ?? (times[0] !== undefined ? times[0] + 30 : null), title: title.slice(0, 120),
      ...(w ? { with: `with ${w[1]!.trim()}`.slice(0, 120) } : {}),
      when: times.length ? times.map(pad).join("–") : "All day",
    });
  }
  return out;
}

export interface GoogleTodo { title: string; due?: string; overdue?: boolean; notes?: string }

/** The to-dos of a list_tasks answer. */
export function googleTasksOf(text: string): GoogleTodo[] {
  const out: GoogleTodo[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("- ")) continue;
    let body = line.slice(2).replace(/\s*\(id:[^)]*\)\s*$/, "");
    let notes: string | undefined;
    const dash = body.indexOf(" — ");
    if (dash >= 0) { notes = body.slice(dash + 3).trim(); body = body.slice(0, dash); }
    const m = /, (due|overdue since) (.+)$/.exec(body);
    const title = (m ? body.slice(0, m.index) : body).trim();
    if (!title) continue;
    out.push({ title: title.slice(0, 120), ...(m ? { due: m[2]!.trim(), ...(m[1] === "overdue since" ? { overdue: true } : {}) } : {}), ...(notes ? { notes } : {}) });
  }
  return out;
}
