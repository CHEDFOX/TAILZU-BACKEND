/**
 * WHEN THIS PERSON TALKS TO THEIR PHONE.
 *
 * Every dictation is a moment the person had the phone in hand and a reason
 * to write. Their rhythm is those moments folded onto the week — 168 hours,
 * weekday by hour — with recent weeks counting more than old ones, and each
 * moment spilling a little into the hours beside it so 18:58 and 19:03 are
 * the same habit. Next to it, the same moments folded onto a single day, for
 * a person whose weekdays are too thin to trust on their own.
 *
 * All in UTC. A moment's UTC hour already encodes where the person lives, so
 * the best hour to reach them needs no timezone; the timezone is only asked
 * for the person's night, which a push must never land in.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type Moment = { at: number; words: number };

export interface Rhythm {
  /** weekday * 24 + hour, UTC. */
  week: Float64Array;
  /** hour of day, UTC. */
  day: Float64Array;
  /** Moments counted, and the distinct UTC days they fell on. */
  events: number;
  days: number;
}

export interface TimingKnobs {
  halfLifeDays: number;
  dayBlend: number;
  minEvents: number;
  minDays: number;
  leadMin: number;
  jitterMin: number;
  quietStartHour: number;
  quietEndHour: number;
  fallbackLocalHour: number;
}

export function rhythm(moments: readonly Moment[], now: number, halfLifeDays: number): Rhythm {
  const week = new Float64Array(168);
  const day = new Float64Array(24);
  const days = new Set<number>();
  const half = halfLifeDays > 0 ? halfLifeDays : 14;
  let events = 0;
  for (const m of moments) {
    if (!Number.isFinite(m.at) || m.at > now) continue;
    const age = (now - m.at) / DAY;
    const w = Math.pow(0.5, age / half);
    const d = new Date(m.at);
    const h = d.getUTCHours();
    const bin = d.getUTCDay() * 24 + h;
    week[bin] += w;
    week[(bin + 1) % 168] += w * 0.5;
    week[(bin + 167) % 168] += w * 0.5;
    day[h] += w;
    day[(h + 1) % 24] += w * 0.5;
    day[(h + 23) % 24] += w * 0.5;
    days.add(Math.floor(m.at / DAY));
    events++;
  }
  return { week, day, events, days: days.size };
}

/** Whether there is enough of a habit to plan by. */
export function confident(r: Rhythm, k: Pick<TimingKnobs, "minEvents" | "minDays">): boolean {
  return r.events >= k.minEvents && r.days >= k.minDays;
}

/** How strongly the hour starting at `hourStart` is this person's. */
export function score(r: Rhythm, hourStart: number, dayBlend: number): number {
  const d = new Date(hourStart);
  const h = d.getUTCHours();
  return r.week[d.getUTCDay() * 24 + h] + dayBlend * r.day[h];
}

/** The weekday (0 = Sunday, UTC) this person writes most on. */
export function busiestWeekday(r: Rhythm): number {
  let best = 0, bestSum = -1;
  for (let wd = 0; wd < 7; wd++) {
    let s = 0;
    for (let h = 0; h < 24; h++) s += r.week[wd * 24 + h];
    if (s > bestSum) { bestSum = s; best = wd; }
  }
  return best;
}

/** In the person's night, by their own clock. Unknown clock: never. */
export function isQuiet(hourStart: number, tzOffsetMin: number | null, k: Pick<TimingKnobs, "quietStartHour" | "quietEndHour">): boolean {
  if (tzOffsetMin === null) return false;
  const local = new Date(hourStart + tzOffsetMin * 60_000).getUTCHours();
  const s = k.quietStartHour, e = k.quietEndHour;
  if (s === e) return false;
  return s < e ? local >= s && local < e : local >= s || local < e;
}

/** A stable few minutes for this person on this day, so sends spread out. */
export function jitterMs(seed: string, jitterMin: number): number {
  if (!(jitterMin > 0)) return 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % (Math.floor(jitterMin) + 1)) * 60_000;
}

export interface TimeChoice {
  sendAt: number;
  /** "rhythm": their own habit. "fallback": the default hour on their clock. "seen": the hour they last opened the app. */
  basis: "rhythm" | "fallback" | "seen";
}

/**
 * The moment to send inside [from, to]: a little before the hour this person
 * is most likely to be writing, or, with too little history, the fallback hour
 * on their own clock, or the hour they last opened the app. Null when nothing
 * in the window is allowed.
 */
export function pickTime(opts: {
  rhythm: Rhythm;
  from: number;
  to: number;
  tzOffsetMin: number | null;
  lastSeenAt: number | null;
  seed: string;
  knobs: TimingKnobs;
}): TimeChoice | null {
  const { rhythm: r, from, to, tzOffsetMin, lastSeenAt, seed, knobs: k } = opts;
  if (!(to > from)) return null;
  const lead = Math.max(0, k.leadMin) * 60_000;
  const place = (hourStart: number): number | null => {
    // The offset moves the planned moment, never "now": a plan asked again
    // after its moment has come must still say "now", not a few minutes on.
    const at = Math.max(from, hourStart - lead + jitterMs(`${seed}:${Math.floor(hourStart / DAY)}`, k.jitterMin));
    return at <= to ? at : null;
  };
  // Hours whose start (less the lead) is still ahead, or which began under
  // half an hour ago: a habit hour that has just started is still the habit.
  const first = Math.floor((from - 30 * 60_000) / HOUR) * HOUR + HOUR;
  const hours: number[] = [];
  for (let t = first; t <= to + lead; t += HOUR) {
    if (t + 30 * 60_000 <= from) continue;
    if (isQuiet(t, tzOffsetMin, k)) continue;
    hours.push(t);
  }
  if (!hours.length) return null;

  if (confident(r, k)) {
    let best: number | null = null, bestScore = 0;
    for (const t of hours) {
      const s = score(r, t, k.dayBlend);
      if (s > bestScore + 1e-9) { bestScore = s; best = t; }
    }
    if (best !== null && bestScore > 0) {
      const at = place(best);
      if (at !== null) return { sendAt: at, basis: "rhythm" };
    }
  }

  // Too little history. Their clock's fallback hour, if we know their clock.
  if (tzOffsetMin !== null) {
    const want = ((Math.round(k.fallbackLocalHour) % 24) + 24) % 24;
    for (const t of hours) {
      if (new Date(t + tzOffsetMin * 60_000).getUTCHours() === want) {
        const at = place(t);
        if (at !== null) return { sendAt: at, basis: "fallback" };
      }
    }
  }
  // Otherwise the hour they last came to the app.
  if (lastSeenAt !== null && Number.isFinite(lastSeenAt)) {
    const want = new Date(lastSeenAt).getUTCHours();
    for (const t of hours) {
      if (new Date(t).getUTCHours() === want) {
        const at = place(t);
        if (at !== null) return { sendAt: at, basis: "seen" };
      }
    }
  }
  return null;
}
