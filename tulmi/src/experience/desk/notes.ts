/**
 * Notes: the meetings and talks the desktop recorded, by day.
 */

import type { NoteSummary, Note } from "../../../../shared/types/api.js";
import type { ActionRef, ScreenResponse, Node } from "../../../../shared/types/sdui.js";
import { span } from "../phoneLook.js";
import { sw as say } from "../settingsWords.js";
import { statTile, columns, pct, splitBar, SERIES, barList } from "./charts.js";
import type { DeskContext } from "./context.js";
import { row, n, room, stack, text, keys, shownIf, section, twoUp, emptyState, link, screen, page } from "./kit.js";
import { local, MONTHS, clock, dayKey, DAYPARTS, dayHeading } from "./time.js";

// ---- NOTES ---------------------------------------------------------------------------
//
// The note-taker's pages: every note, by day, and one note in full. A note is
// what the window heard while the hotkey was on — a meeting, a lecture, a
// thought said aloud — organised by the writer (src/notes/organise.ts) into
// what came up, what was decided, who will do what, and what is still open.
// People stay apart: every point that belongs to someone says whose it is.
export const NOTE_STATUS: Record<string, string> = {
  recording: "Still recording, or stopped before it finished",
  organising: "Organising. This takes a minute",
  failed: "Couldn't organise this one. What was heard is kept",
};

/** "You, Priya, Speaker 3" — names where the writer found them. */
export function peopleLine(people: NoteSummary["people"], transcript?: Note["transcript"]): string {
  const named = new Map((people ?? []).map((p) => [p.label, p.name]));
  return peopleLabels(people, transcript).map((l) => named.get(l) || l).join(", ");
}
/** Who is in a note, by label, in the order they first spoke. */
export function peopleLabels(people: NoteSummary["people"], transcript?: Note["transcript"]): string[] {
  return transcript?.length
    ? [...new Set(transcript.map((s) => s.speaker ?? "").filter(Boolean))]
    : (people ?? []).map((p) => p.label);
}

export function noteTitle(ctx: DeskContext, nt: Pick<NoteSummary, "title" | "startedAt">): string {
  if (nt.title) return nt.title;
  const d = local(ctx, Date.parse(nt.startedAt));
  return `Notes, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)} at ${clock(d)}`;
}

const startNotes: ActionRef = { kind: "notes.toggle" };

/** Morning from five, afternoon from noon, evening from five, night from nine. */
const daypart = (h: number) => (h >= 5 && h < 12 ? 0 : h >= 12 && h < 17 ? 1 : h >= 17 && h < 21 ? 2 : 3);

/**
 * NOTES — the room carries the four figures (how many, how long, how many
 * words, who), then the notes as numbers: the last two weeks, how long they
 * run, when in the day, who is in them. Every note follows, newest first.
 * The charts only come once there are two notes to compare.
 */
export function deskNotes(ctx: DeskContext): ScreenResponse {
  const all = ctx.notes ?? [];
  const now = local(ctx, Date.now());
  const secs = all.reduce((s, x) => s + (x.durationSeconds || 0), 0);
  const heard = all.reduce((s, x) => s + (x.words || 0), 0);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const thisWeek = all.filter((x) => Date.parse(x.startedAt) >= weekAgo).length;
  // The people the writer could name, each counted once per note they were in.
  const met = new Map<string, number>();
  for (const nt of all) {
    for (const name of new Set((nt.people ?? []).filter((p) => p.name && p.label !== "You").map((p) => p.name!))) {
      met.set(name, (met.get(name) ?? 0) + 1);
    }
  }

  const figures = all.length ? row([
    statTile("Notes", n(all.length), `${thisWeek} in the last 7 days`, true, true),
    statTile("Time heard", span(secs / 60), `about ${span(secs / all.length / 60)} each`, true),
    statTile("Words heard", n(heard), secs >= 60 ? `${n(heard / (secs / 60))} a minute` : "across every note", true),
    statTile("People met", n(met.size), met.size ? "named in your notes" : "no names heard yet", true),
  ], { gap: 36, flexWrap: "wrap", marginTop: 26, paddingTop: 22, borderTop: "1px solid rgba(243,226,198,.12)", width: "100%" }) : null;

  const band = room([
    stack([
      text("Notes", "d-eyebrow"),
      text("Meetings, lectures, thoughts", "d-h1", { marginTop: 6 }),
      ...(all.length ? [] : [text("Nothing yet", "d-count d-on-room", { marginTop: 12 })]),
    ], { minWidth: 0 }),
    // The notes chord; with the one key there is none, and the window draws "Say “take notes” / “stop notes” with <key>" instead.
    ...(ctx.notesHotkey ? [row([
      keys("notes", true),
      shownIf(text("to start or stop. Nothing is typed anywhere.", "d-count d-on-room", { maxWidth: 170, marginLeft: 6 }), { falsy: "desktop.oneKey" }),
      shownIf(text("Nothing is typed anywhere.", "d-count d-on-room", { maxWidth: 170, marginLeft: 6 }), { truthy: "desktop.oneKey" }),
    ], { align: "center", gap: 0 })] : []),
    ...(figures ? [figures] : []),
  ]);

  // ---- the notes as numbers -------------------------------------------------------------
  const charts: Node[] = [];
  if (all.length >= 2) {
    const today = dayKey(now);
    const perDay = new Array(14).fill(0) as number[];
    const lengths = [0, 0, 0, 0, 0];
    const parts = [0, 0, 0, 0];
    let together = 0, alone = 0;
    for (const nt of all) {
      const d = local(ctx, Date.parse(nt.startedAt));
      const ago = Math.round((Date.parse(today) - Date.parse(dayKey(d))) / 86_400_000);
      const min = (nt.durationSeconds || 0) / 60;
      if (ago >= 0 && ago < 14) perDay[13 - ago] += min;
      lengths[min < 5 ? 0 : min < 15 ? 1 : min < 30 ? 2 : min < 60 ? 3 : 4]! += 1;
      parts[daypart(d.getUTCHours())]! += 1;
      if ((nt.people ?? []).length > 1) together += 1; else alone += 1;
    }
    const dayLabel = (k: number) => { const d = new Date(now.getTime() - k * 86_400_000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`; };
    const activeDays = perDay.filter((v) => v > 0).length;
    const daysBlock = activeDays
      ? section("The last two weeks", `Minutes heard each day. ${activeDays} of the 14 days had a note.`,
          [columns(perDay, { highlight: [13], ticks: [dayLabel(13), dayLabel(7), "Today"] })])
      : null;
    const lPeak = lengths.indexOf(Math.max(...lengths));
    const lengthBlock = section("How long they run", `Most notes run ${["under 5 minutes", "5 to 15 minutes", "15 to 30 minutes", "half an hour to an hour", "over an hour"][lPeak]}.`,
      [columns(lengths, { highlight: [lPeak], labels: ["<5 min", "5–15", "15–30", "30–60", "60+"] })]);
    const pPeak = parts.indexOf(Math.max(...parts));
    const whenBlock = section("When you take them", `Mostly in the ${DAYPARTS[pPeak]!.toLowerCase()}${pPeak === 3 ? "" : "s"}.`,
      [columns(parts, { highlight: [pPeak], labels: [...DAYPARTS] })]);
    const people = [...met.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
    const whoBlock = section("Who's in them", together && alone
        ? `${pct(together, all.length)}% are conversations; the rest, you on your own.`
        : together ? "Every note is a conversation." : "Every note is you on your own.", [
      ...(together && alone ? [splitBar([
        { label: "With others", value: together, color: SERIES[1] },
        { label: "On your own", value: alone, color: SERIES[0] },
      ])] : []),
      ...(people.length ? [
        text("Who comes up most", "d-eyebrow", { marginTop: 28 }),
        barList(people.map(([name, k]) => ({ label: name, words: k, value: `${k} ${k === 1 ? "note" : "notes"}` }))),
      ] : []),
    ]);
    charts.push(...twoUp(daysBlock, lengthBlock, { marginTop: 0 }), ...twoUp(whenBlock, whoBlock));
  }

  const body: Node[] = [];
  if (!all.length) {
    body.push(stack([
      emptyState("tap-s", say("e.notes")),
      text("Start it in a meeting, a lecture, or on a walk around your own ideas. X0 Bot listens to your microphone and to your computer's sound, tells the voices apart, and keeps it short here: what the meeting was, a paragraph on the whole conversation, and the few things people said that mattered, with who said them.", "d-lede", { marginTop: 0, maxWidth: 560 }),
      ...(ctx.notesHotkey ? [row([link("Start taking notes", startNotes, "d-btn")], { marginTop: 16 })] : []),
    ], { paddingBottom: 26 }));
  } else if (charts.length) {
    body.push(text("Every note", "d-h2", { marginTop: 60, marginBottom: 18 }));
  }
  let lastDay = "";
  for (const nt of all) {
    const day = dayHeading(ctx, nt.startedAt);
    if (day !== lastDay) {
      body.push(text(day, "d-eyebrow", { marginTop: lastDay ? 34 : 0, marginBottom: 4 }));
      lastDay = day;
    }
    const d = local(ctx, Date.parse(nt.startedAt));
    const who = peopleLine(nt.people);
    const status = nt.status !== "ready" ? NOTE_STATUS[nt.status] : !nt.organised ? "Nothing was heard"
      : nt.systemAudio === "denied" ? "Your side only" : "";
    body.push(row([
      stack([
        text(clock(d), "d-margin-strong"),
        ...(nt.durationSeconds ? [text(span(nt.durationSeconds / 60), "d-margin")] : []),
      ], { width: 96, flex: "none", paddingTop: 3 }),
      stack([
        text(noteTitle(ctx, nt), "d-written"),
        ...(nt.summary ? [text(nt.summary, "d-lede")] : []),
        ...(who || status ? [text([who, status].filter(Boolean).join(" · "), "d-margin", { marginTop: 4 })] : []),
      ], { flex: 1, minWidth: 0, gap: 4 }),
    ], { gap: 24, paddingTop: 22, paddingBottom: 22 }, "d-entry", {
      on: { onPress: { kind: "navigate", screenId: "desk_note", params: { noteId: nt.id } } },
    }));
  }

  return screen("desk_notes", "Notes", [band, page([...charts, stack(body, { maxWidth: 760 })])]);
}
