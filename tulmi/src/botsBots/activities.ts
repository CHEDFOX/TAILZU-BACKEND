/**
 * ACTIVITIES: WHAT THE WORK TURNED INTO, not what was said getting there (docs/talk-door.md, the Activities screen).
 *
 * Talk is one conversation. What it PRODUCES is not one thing: a trip looked up, a job running, a payment filed, a
 * routine saved. Each of those is an activity, and an activity is the only thing the second tab shows — so the tab
 * answers "what is my work doing?" rather than "which bots do I own?" or "what did I type on Tuesday?".
 *
 *   activitiesFrom(input)  ->  { schedules, now, done }      pure: no store, no clock of its own, no model
 *
 * AN ACTIVITY IS A SESSION THAT PRODUCED WORK. Every turn of Talk's thread carries `by` (which bot answered) and, when
 * something was actually set going, `did` (a job, a payment, a routine, what the everyday tools found). So:
 *
 *   the bots on it   the distinct `by` of its turns, in the order they first spoke — that is the row of heads the card
 *                    draws on one thread, and why an activity can have MORE THAN ONE bot without anything new stored
 *   its state        needs you > working > failed > done: the most pressing thing any part of it is doing
 *   its line         composed from the `did`s BY RULE — never by a model. A job knows its task, a routine knows
 *                    "Every Friday at 5 pm", a payment knows its payee. Composing those is free, instant, and cannot
 *                    describe work that did not happen. A summary written by a model would cost money per card and
 *                    could lie about the one thing this screen exists to be trusted about.
 *   where it opens   THE WORK ITSELF — the job, the trip, the payment. Never the conversation: the card is the
 *                    outcome, and sending someone back into the transcript to find it is the opposite of showing it.
 *
 * A SESSION OF ONLY QUESTIONS AND ANSWERS IS NOT AN ACTIVITY. "What's on tomorrow?" is conversation; it belongs in the
 * thread and in the ledger, not on a card that says work is being done. Only a turn carrying `did` makes an activity.
 *
 * WORK THAT DID NOT COME FROM TALK still shows: a job started on Xode's own page, a payment from a notification, a
 * missed call. Those arrive as ordinary feed rows (shell/feed.ts) and become activities of one bot each. Rows already
 * covered by a session are dropped, so nothing is counted twice; `ask` and `words` rows are never activities at all
 * (an answer given and words spoken are not work set going).
 */
import type { FeedOpen, FeedRow } from "../shell/feed.js";
import type { ChatTurn } from "./chat.js";
import type { Session } from "./sessions.js";

/** A bot as a card draws it: its head, its name, its colour. */
export interface ActivityBot { slug: string; name: string; color: string }

/** How pressing an activity is. The same words the feed and the tiles use, so one vocabulary across the app. */
export type ActivityState = "needs" | "working" | "failed" | "done";

export interface Activity {
  /** The session it came from ("s:<id>"), or the feed row it is ("r:<id>"). Stable, so a list can be compared. */
  id: string;
  /** What it is, in the person's own first words (sessions name themselves: sessions.ts nameFrom). */
  title: string;
  /** What it came to, in plain words, composed by rule. */
  line: string;
  /** One or more, in the order they first answered: the heads the card draws joined on one thread. */
  bots: ActivityBot[];
  state: ActivityState;
  /** When it last moved. */
  at: number;
  /** The work itself. Absent when there is nothing to open. */
  open?: FeedOpen;
  /** A picture it made, for the card's corner (sessions.ts `frame`). */
  frame?: string;
}

/** A thing that will happen again, with the bot that does it (src/routines). */
export interface ActivitySchedule {
  id: string;
  bot: ActivityBot;
  /** What it does each time: "Sum up my week". */
  task: string;
  /** When, in words: "Every Friday at 5 pm". */
  when: string;
  /** The next run, in words ("Fri 30 Oct at 5 pm"), or empty while it is paused. */
  next: string;
  paused: boolean;
}

export interface ActivitiesRead {
  schedules: ActivitySchedule[];
  /** Needs you first, then working: what is live, newest first inside each. */
  now: Activity[];
  /** Finished and failed, newest first. */
  done: Activity[];
}

/** What a routine looks like to this module (routines/service.ts RoutineView, the parts a card draws). */
export interface RoutineLite {
  id: string;
  bot: { slug: string } | string | null;
  task: string;
  when: string;
  status: string;
  next: { words: string } | null;
}

export interface ActivityInput {
  /** Talk's sessions, newest first (sessions.list(user, "talk")). */
  sessions: readonly Session[];
  /** Each session's turns, oldest first, by session id. */
  turns: ReadonlyMap<string, readonly ChatTurn[]>;
  /** The activity feed (shell/feed.ts feedOf), newest first. */
  rows: readonly FeedRow[];
  routines: readonly RoutineLite[];
  /** A bot's name and colour, for the heads. */
  look: (slug: string) => { name: string; color: string };
}

/** The feed's kinds that are WORK. An answer given (`ask`) and words spoken (`words`) are not. */
const WORK_ROWS = new Set<FeedRow["type"]>(["job", "task", "payment", "call", "follow"]);

/** needs > working > failed > done, so one number orders a card against another. */
const RANK: Record<ActivityState, number> = { needs: 0, working: 1, failed: 2, done: 3 };

/** A feed row's mark as an activity's state ("waiting" is something to come back to, which reads as working). */
const stateOfRow = (m: FeedRow["mark"]): ActivityState =>
  m === "needs" ? "needs" : m === "working" || m === "waiting" ? "working" : m === "failed" ? "failed" : "done";

const trim = (s: unknown, n: number): string => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * WHAT A SESSION'S WORK CAME TO, in one line, by rule.
 *
 * Each `did` says what was set going, and each has its own words. Several in one session are joined with " · ", newest
 * first, at most three — a card is a glance, and a session with eight things in it is better read on its own page.
 */
function lineOf(dids: ReadonlyArray<NonNullable<ChatTurn["did"]>>, rows: ReadonlyMap<string, FeedRow>): string {
  const parts: string[] = [];
  for (const d of dids) {
    if (d.job) {
      // The job's own row knows where it got to ("Opened a pull request", "3 of 7 done"); without it, that it is on.
      const r = rows.get(`job:${d.job}`);
      parts.push(r ? trim(r.sub || r.title, 60) : "Xode is on it");
    }
    if (d.upi) parts.push("A payment to press");
    if (d.needs) parts.push(d.needs === 1 ? "1 thing needs your yes" : `${d.needs} things need your yes`);
    if (d.finds) parts.push("Found what you asked for");
    if (d.routine) parts.push("Saved as a routine");
    if (parts.length >= 3) break;
  }
  return parts.slice(0, 3).join(" · ");
}

/** Where a session's card goes when it is tapped: the first piece of work it holds, and nothing else. */
function openOf(dids: ReadonlyArray<NonNullable<ChatTurn["did"]>>): FeedOpen | undefined {
  for (const d of dids) {
    if (d.job) return { screenId: "bots.code.job", params: { id: d.job } };
    if (d.upi) return { screenId: "bots.approve", params: { upi: d.upi } };
  }
  return undefined;
}

/**
 * THE ACTIVITIES, from what is already kept. Nothing here reads a store, asks a model or looks at a clock: everything
 * it needs is handed in, so the rules are the same on every road and testable on their own.
 */
export function activitiesFrom(input: ActivityInput): ActivitiesRead {
  const byId = new Map<string, FeedRow>();
  for (const r of input.rows) byId.set(r.id, r);
  const bot = (slug: string): ActivityBot => ({ slug, ...input.look(slug) });

  const made: Activity[] = [];
  /** Feed rows a session already speaks for, so they are not also counted on their own. */
  const taken = new Set<string>();

  for (const s of input.sessions) {
    const turns = input.turns.get(s.id) ?? [];
    const dids: Array<NonNullable<ChatTurn["did"]>> = [];
    const slugs: string[] = [];
    for (const t of turns) {
      if (t.by?.slug && !slugs.includes(t.by.slug)) slugs.push(t.by.slug);
      if (t.did) dids.unshift(t.did);     // newest first: the latest thing it did leads the line
    }
    // Only work makes an activity. A session of questions and answers stays a conversation.
    if (!dids.length) continue;
    for (const d of dids) if (d.job) taken.add(`job:${d.job}`);

    // The state is the most pressing thing any part of it is doing: a job's own row knows best, else what the turns said.
    let state: ActivityState = "done";
    for (const d of dids) {
      const row = d.job ? byId.get(`job:${d.job}`) : undefined;
      const s2: ActivityState = row ? stateOfRow(row.mark) : d.needs ? "needs" : d.upi ? "needs" : "done";
      if (RANK[s2] < RANK[state]) state = s2;
    }
    const open = openOf(dids);
    made.push({
      id: `s:${s.id}`,
      title: trim(s.title, 80) || "Something you asked for",
      line: lineOf(dids, byId),
      // A session with no bot named on any turn (every answer came from the front door's own roads) is X0's own.
      bots: (slugs.length ? slugs : ["tailzu"]).slice(0, 4).map(bot),
      state,
      at: s.touchedAt,
      ...(open ? { open } : {}),
      ...(s.frame ? { frame: s.frame } : {}),
    });
  }

  // Work that did not come from Talk: a job started on Xode's own page, a payment from a notification, a missed call.
  for (const r of input.rows) {
    if (!WORK_ROWS.has(r.type) || taken.has(r.id)) continue;
    made.push({
      id: `r:${r.id}`,
      title: trim(r.title, 80),
      line: trim(r.sub, 60),
      bots: [bot(r.bot)],
      state: stateOfRow(r.mark),
      at: r.at,
      ...(r.open ? { open: r.open } : {}),
    });
  }

  // What is live is ordered by how pressing it is, then by how recent. What is OVER is ordered by time alone: a failed
  // thing from last week outranking a finished one from this morning would be a list that argues with the word "done".
  const live = made.filter((a) => a.state === "needs" || a.state === "working")
    .sort((a, b) => RANK[a.state] - RANK[b.state] || b.at - a.at);
  const over = made.filter((a) => a.state === "done" || a.state === "failed").sort((a, b) => b.at - a.at);

  return { schedules: input.routines.map((r) => scheduleOf(r, bot)), now: live, done: over };
}

/** A routine as its card: the bot that does it, what it does, when, and when next. */
function scheduleOf(r: RoutineLite, bot: (slug: string) => ActivityBot): ActivitySchedule {
  const slug = typeof r.bot === "string" ? r.bot : r.bot?.slug ?? "tailzu";
  const paused = r.status !== "on";
  return {
    id: r.id,
    bot: bot(slug || "tailzu"),
    task: trim(r.task, 80),
    when: trim(r.when, 60),
    next: paused ? "" : trim(r.next?.words, 40),
    paused,
  };
}
