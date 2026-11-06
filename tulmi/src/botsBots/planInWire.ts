/**
 * STEPS 2 AND 3, PUT TOGETHER AT START (routes/bots/planIn.ts calls it): the work calendar's link service and the capture service, their
 * places on the person's days (planSources.ts), the box's bill slot, and their jobs.
 *
 *   wirePlanIn(o)    the services, plugged in; returns them and the stop for their jobs
 *   clashPush(...)   after the work calendar's read changed someone's days: one push for a new clash, 7 am to 9 pm (else the next note
 *                    carries the card): "Move the grocery run to Sat 11 am?" [Move it] [Keep] for their own movable thing, or
 *                    "Appointment clashes with your 6 pm meeting" / "Rebook it if you need to." for a booked one. Once per clash, and
 *                    within the day's six
 *
 * Jobs: the links due a read every 5 minutes; captures every minute (a photo that waited for the day's reading, a read a restart cut
 * off, a card read after they left); the sweeps every 6 hours (a link stopped for a week, cards and files past their week, old codes).
 */
import type { Calendar } from "../calendar/index.js";
import { dayOf, shiftDay, startOfDay } from "../calendar/words.js";
import { clockOf } from "./planDay.js";
import { PlanCapture, setPlanCapture, type CaptureDeps } from "./planCapture.js";
import { setAddDue } from "./planDue.js";
import type { PlanEase } from "./planEase.js";
import { PlanLinks, plugLinks, setPlanLinks } from "./planLinks.js";
import { clashesOf, movable } from "./planNeeds.js";
import { dayItems, isBooked, type DayItem } from "./planRows.js";
import { lockSafe, looksHealth, safeTitle } from "./planSafe.js";
import { addPlanSource, removePlanSource, sourceItems } from "./planSources.js";
import { planOn } from "./planSwitch.js";
import { planWaits } from "./planWaits.js";
import { onNoteReady } from "../notes/ready.js";

const MIN = 60_000;

type Send = NonNullable<CaptureDeps["send"]>;

/** One push for a clash the work calendar's new read made, once, by day and within the day's six. */
export async function clashPush(ease: PlanEase, userId: string, tz: number, send: Send, now = Date.now()): Promise<boolean> {
  if (!planOn("links")) return false;
  const hour = Math.floor(((now + tz * MIN) % (24 * 60 * MIN)) / (60 * MIN));
  if (hour < 7 || hour >= 21) return false;
  const day = dayOf(now, tz);
  const has = async (key: string) => (await ease.answers.select({ user_id: userId, key }, { limit: 1 }).catch(() => [])).length > 0;
  const mark = (key: string) => ease.answers.upsert({ user_id: userId, key, at_ms: now }, ["user_id", "key"]).catch(() => undefined);

  // Their own movable thing: the Move card, as the page would ask it.
  const line = await ease.line(userId, tz).catch(() => null);
  const card = line?.needs;
  if (card?.type === "move" && card.item) {
    const key = `decide:${card.key}`;
    if (await has(key)) return false;
    if (!(await ease.policy.spend(userId, day).catch(() => true))) return false;
    await mark(key);
    await send(userId, {
      kind: "plan_decide", key,
      vars: { title: lockSafe(card.question, 100), body: looksHealth(card.reason) ? "It overlaps something on your calendar." : lockSafe(card.reason, 120) },
      data: { item: card.item, day }, category: "x0_move",
    }).catch(() => undefined);
    return true;
  }

  // A booked thing of theirs that a meeting now clashes with: told, never offered a move (moving our row wouldn't rebook it).
  const tomorrow = shiftDay(day, 1);
  const listed = await ease.calendar.list(userId, { from: day, to: tomorrow, tz }).catch(() => null);
  if (!listed) return false;
  const w = { from: day, to: tomorrow, fromMs: startOfDay(day, tz), toMs: startOfDay(shiftDay(tomorrow, 1), tz), tz, now };
  const items: DayItem[] = [...dayItems(listed), ...(await sourceItems(userId, w))];
  for (const c of clashesOf({ items, now, tz, today: day, tomorrow })) {
    const meeting = c.a.source === "link" ? c.a : c.b.source === "link" ? c.b : null;
    const own = meeting === c.a ? c.b : c.a;
    if (!meeting || own.source === "link" || movable(own) || !isBooked(own) || meeting.start === null) continue;
    const key = `decide:clash:${own.id}:${meeting.id}:${own.start}`;
    if (await has(key)) continue;
    if (!(await ease.policy.spend(userId, day).catch(() => true))) return false;
    await mark(key);
    await send(userId, {
      kind: "plan_decide", key,
      vars: { title: lockSafe(`${safeTitle(own.title).split(" · ")[0]} clashes with your ${clockOf(meeting.start, tz)} meeting`, 100), body: "Rebook it if you need to." },
      data: { day: own.day },
    }).catch(() => undefined);
    return true;
  }
  return false;
}

export interface PlanInWiring { links: PlanLinks; capture: PlanCapture; stop: () => void }

/** The two services, plugged into the person's days, with their jobs running. */
export function wirePlanIn(o: {
  ease: PlanEase;
  capture: Omit<CaptureDeps, "calendar" | "prefs">;
  send?: Send;
  log?: { warn: (o: object, m: string) => void };
  calendar?: Calendar;
  jobs?: boolean;
}): PlanInWiring {
  const ease = o.ease;
  const links = new PlanLinks({
    changed: (userId, tz) => { if (o.send) void clashPush(ease, userId, tz, o.send).catch(() => undefined); },
  });
  setPlanLinks(links);
  plugLinks(() => ease.answers, (u) => ease.calendar.tzOf(u));
  const capture = new PlanCapture({
    calendar: o.calendar ?? ease.calendar, prefs: ease.prefs, tzOf: (u) => ease.calendar.tzOf(u),
    fits: (u, d) => ease.policy.spend(u, d),
    // A meeting's someone-else's to-do becomes a wait (step 4) when its card is added.
    addWait: async (u, w, x) => ({ id: (await planWaits().add(u, w, x)).id }),
    ...o.capture, ...(o.send ? { send: o.send } : {}),
  });
  setPlanCapture(capture);
  // A meeting's notes ready: its named to-dos with a day as one card (no AI: the notes were already read).
  onNoteReady((userId, note) => capture.fromNote(userId, { id: note.id, title: note.title ?? "", todos: note.todos ?? [], people: note.people ?? [] }));
  setAddDue((userId, d) => capture.addDue(userId, d));
  addPlanSource({
    name: "captures",
    more: (userId) => capture.briefs(userId),
    evening: (userId, w) => (planOn("capture") ? capture.eveningLine(userId, w.asked) : Promise.resolve([])),
    morning: (userId) => (planOn("capture") ? capture.morningLine(userId) : Promise.resolve([])),
  });
  const timers: NodeJS.Timeout[] = [];
  if (o.jobs !== false) {
    let busyLinks = false, busyCap = false;
    const every = (ms: number, fn: () => Promise<unknown>) => { const t = setInterval(() => { void fn(); }, ms); t.unref?.(); timers.push(t); };
    every(5 * MIN, async () => {
      if (busyLinks) return;
      busyLinks = true;
      try { await links.tick(50, (u) => ease.calendar.tzOf(u)); } catch (err) { o.log?.warn({ err: (err as Error)?.name }, "plan ease: links"); } finally { busyLinks = false; }
    });
    every(MIN, async () => {
      if (busyCap) return;
      busyCap = true;
      try { await capture.tick(); } catch (err) { o.log?.warn({ err: (err as Error)?.name }, "plan ease: captures"); } finally { busyCap = false; }
    });
    every(6 * 60 * MIN, async () => {
      await links.sweep().catch((err) => o.log?.warn({ err: (err as Error)?.name }, "plan ease: links sweep"));
      await capture.sweep().catch((err) => o.log?.warn({ err: (err as Error)?.name }, "plan ease: captures sweep"));
    });
  }
  return {
    links, capture,
    stop: () => {
      for (const t of timers) clearInterval(t);
      removePlanSource("links"); removePlanSource("captures"); onNoteReady(null);
      setPlanLinks(null); setPlanCapture(null); setAddDue(null);
    },
  };
}
