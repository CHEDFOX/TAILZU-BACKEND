/**
 * One note: who said what, the numbers of the talk, and the text.
 */

import type { Note } from "../../../../shared/types/api.js";
import type { Node, ScreenResponse, ActionRef } from "../../../../shared/types/sdui.js";
import { span } from "../phoneLook.js";
import { sw as say } from "../settingsWords.js";
import { foldParts, OTHER, statTile, donutWithLegend, swatch, columns } from "./charts.js";
import type { DeskContext } from "./context.js";
import { type Style, stack, text, row, link, n, section, twoUp, screen, page, blip } from "./kit.js";
import { noteTitle, peopleLine, peopleLabels, NOTE_STATUS } from "./notes.js";
import { speakerColor, speakerChip, speakerBox } from "./speakers.js";
import { local, dateLine, clock } from "./time.js";

/**
 * THE NOTE PAGE'S AIR. One rhythm for the whole page, so it reads as a few
 * calm sections and not one long list: the most room between sections, less
 * between the parts of one, and a heading always closer to what it heads than
 * to what came before it.
 */
const NOTE_AIR = { section: 72, part: 56, head: 20, box: 12 } as const;
/** A note section's heading: the desk's h2, a step up, set apart from its body. */
const NOTE_HEAD: Style = { fontSize: 24, lineHeight: "30px", marginBottom: NOTE_AIR.head };
/** The text column: summary and boxes keep a comfortable line length. */
const NOTE_MEASURE = 720;

/** The Mac did not let Tailzu hear the computer's sound: only the
 *  microphone is in this note. A window that can open the setting gets a
 *  button for it; an older one, where to find it. */
function onlyYourSide(canOpen: boolean): Node {
  return stack([
    text("Only your side", "d-eyebrow"),
    text("X0 Bot couldn't hear your computer's sound, so this note has only what your microphone heard.", "d-written", { marginTop: 6, maxWidth: 620 }),
    text("Allow it once, and your next note includes everyone on the call.", "d-lede", { marginTop: 4 }),
    canOpen
      ? row([link("Allow", { kind: "notes.allowSystemAudio" }, "d-btn")], { marginTop: 14 })
      : text("System Settings → Privacy & Security → Screen & System Audio Recording → turn on X0 Bot.", "d-margin", { marginTop: 10 }),
  ], { paddingTop: 18, paddingBottom: 20, paddingLeft: 22, paddingRight: 22, marginBottom: 44, radius: 12, background: "var(--d-press)", border: "1px solid var(--d-rule)", maxWidth: NOTE_MEASURE });
}

/** The note as plain text, for Copy: the meeting, the paragraph, the lines. */
function noteText(ctx: DeskContext, nt: Note): string {
  const named = new Map(nt.people.map((p) => [p.label, p.name]));
  const d = local(ctx, Date.parse(nt.startedAt));
  const out = [noteTitle(ctx, nt), `${dateLine(d)}, ${clock(d)}`];
  const who = peopleLine(nt.people, nt.transcript);
  if (who) out.push(`With: ${who}`);
  if (nt.summary) out.push("", nt.summary);
  if (nt.highlights.length) out.push("", ...nt.highlights.map((h) => `${named.get(h.speaker) || h.speaker}: ${h.text}`));
  return out.join("\n");
}

interface Voice { label: string; name: string; seconds: number; words: number; turns: number; longest: number; questions: number }

/**
 * The conversation as numbers, read off the kept transcript: for each voice,
 * how long it talked, how many words, how many turns, its longest unbroken
 * stretch, how many questions. A stretch runs to the next one's start, but no
 * longer than its words could take at a slow two a second, so a silence after
 * someone stops is not counted as their talking.
 */
function talkStats(nt: Note): { voices: Voice[]; spans: Array<{ label: string; at: number; end: number }>; words: number; turns: number; questions: number } {
  const named = new Map(nt.people.map((p) => [p.label, p.name]));
  const segs = [...nt.transcript].filter((x) => x.text?.trim()).sort((x, y) => x.at - y.at);
  const by = new Map<string, Voice>();
  const spans: Array<{ label: string; at: number; end: number }> = [];
  let prev = "", run = 0, words = 0, turns = 0, questions = 0;
  segs.forEach((g, i) => {
    const label = g.speaker || "Others";
    const w = g.text.trim().split(/\s+/).length;
    const next = segs[i + 1]?.at ?? Math.max(nt.durationSeconds || 0, g.at + w / 2.5);
    const secs = Math.max(0.5, Math.min(next - g.at, w / 2));
    const q = (g.text.match(/\?/g) ?? []).length;
    const v = by.get(label) ?? { label, name: named.get(label) || label, seconds: 0, words: 0, turns: 0, longest: 0, questions: 0 };
    v.seconds += secs; v.words += w; v.questions += q;
    if (label !== prev) { v.turns += 1; turns += 1; run = 0; prev = label; }
    run += secs; v.longest = Math.max(v.longest, run);
    by.set(label, v);
    spans.push({ label, at: g.at, end: g.at + secs });
    words += w; questions += q;
  });
  return { voices: [...by.values()].sort((x, y) => y.seconds - x.seconds), spans, words, turns, questions };
}

/** m:ss, or h:mm:ss past the hour — a place in a recording. */
const stamp = (secs: number) => {
  const t = Math.max(0, Math.round(secs)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s2 = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s2).padStart(2, "0")}` : `${m}:${String(s2).padStart(2, "0")}`;
};

/** Seconds as the page says them: "45 sec", "3 min", "1 h 05". */
const secsLine = (secs: number) => (secs < 60 ? `${Math.max(1, Math.round(secs))} sec` : span(secs / 60));

/**
 * The conversation in numbers: who talked (a donut of the talking time), who
 * said what (a small table), and who spoke when — every stretch of talk on
 * one line per voice, under the words-a-minute of the meeting as it went.
 */
function noteNumbers(nt: Note): Node[] {
  const t = talkStats(nt);
  if (!t.spans.length) return [];
  const length = Math.max(nt.durationSeconds || 0, ...t.spans.map((x) => x.end), 1);
  // One colour per voice for the whole page (speakerColor): the same as its
  // box in "What mattered". The donut shows the four who talked most, anyone
  // past them as Others.
  const colorOf = new Map(t.voices.map((v) => [v.label, speakerColor(v.label)]));
  const parts = foldParts(t.voices.map((v) => ({ label: v.name, value: v.seconds, value2: secsLine(v.seconds), color: colorOf.get(v.label) })));
  if (t.voices.length > 4) {
    const rest = t.voices.slice(4).reduce((s, v) => s + v.seconds, 0);
    parts[parts.length - 1] = { label: "Others", value: rest, color: OTHER, value2: secsLine(rest) };
  }

  const tiles = row([
    statTile("Pace", n(t.words / (length / 60)), "words a minute"),
    statTile("Voices", n(t.voices.length), t.voices.length === 1 ? "just one" : "told apart"),
    statTile("Turns", n(t.turns), "changes of speaker"),
    statTile("Questions", n(t.questions), "asked out loud"),
  ].map((x) => ({ ...x, style: { ...(x.style ?? {}), minWidth: 150 } })), { gap: 32, flexWrap: "wrap", paddingTop: 28 }, "d-rule-top");

  const share = t.voices.length > 1
    ? section("Who talked", "Each voice's share of the talking time.",
        [donutWithLegend(parts, { value: secsLine(t.voices.reduce((s, v) => s + v.seconds, 0)), label: "talking" })])
    : section("Who talked", `Only ${t.voices[0]!.name === "You" ? "you" : t.voices[0]!.name}, for ${secsLine(t.voices[0]!.seconds)}.`, []);

  const cell = (v: string, w: number, strong = false): Node =>
    text(v, strong ? "d-margin-strong" : "d-num", { width: w, flex: "none", textAlign: "right" });
  const table = section("Who said what", undefined, [stack([
    row([text("", "d-margin", { flex: 1 }), cell("Words", 60, true), cell("Turns", 52, true), cell("Longest", 64, true), cell("Asked", 48, true)],
      { gap: 10, paddingBottom: 10 }, "d-rule-bottom"),
    ...t.voices.slice(0, 8).map((v) => row([
      row([swatch(colorOf.get(v.label) ?? OTHER), text(v.name, "d-k", { fontWeight: 500, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 })],
        { gap: 8, align: "center", flex: 1, minWidth: 0 }),
      cell(n(v.words), 60), cell(n(v.turns), 52), cell(secsLine(v.longest), 64), cell(n(v.questions), 48),
    ], { gap: 10, align: "center", paddingTop: 10, paddingBottom: 10 }, "d-rule-bottom")),
  ], { marginTop: 20 })]);

  // Words a minute through the meeting: about a column a minute, at most 40.
  const B = Math.max(6, Math.min(40, Math.round(length / 60)));
  const flow = new Array(B).fill(0) as number[];
  for (const g of nt.transcript) {
    if (!g.text?.trim()) continue;
    flow[Math.min(B - 1, Math.floor((g.at / length) * B))]! += g.text.trim().split(/\s+/).length * (B / (length / 60));
  }
  const fPeak = flow.indexOf(Math.max(...flow));
  // Each lane is read at 300 steps and drawn as its runs, so an hour of short
  // turns is a few dozen marks on the page, not a thousand.
  const STEPS = 300;
  const lanes = t.voices.slice(0, 6).map((v) => {
    const on = new Array(STEPS).fill(false) as boolean[];
    for (const x of t.spans) {
      if (x.label !== v.label) continue;
      const a = Math.floor((x.at / length) * STEPS), b = Math.max(a, Math.ceil((x.end / length) * STEPS) - 1);
      for (let k = a; k <= Math.min(STEPS - 1, b); k++) on[k] = true;
    }
    const marks: Node[] = [];
    for (let k = 0; k < STEPS; k++) {
      if (!on[k]) continue;
      let e = k;
      while (e + 1 < STEPS && on[e + 1]) e++;
      marks.push(stack([], {
        position: "absolute", top: 0, bottom: 0,
        left: `${((k / STEPS) * 100).toFixed(2)}%`, width: `${(((e - k + 1) / STEPS) * 100).toFixed(2)}%`,
        background: colorOf.get(v.label) ?? OTHER, radius: 2,
      }));
      k = e;
    }
    return row([
      text(v.name, "d-margin-strong", { width: 110, flex: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
      stack(marks, { position: "relative", flex: 1, minWidth: 0, height: 14, radius: 3, background: "color-mix(in srgb, var(--d-ink) 5%, var(--d-sheet))" }),
    ], { gap: 14, align: "center" });
  });
  const timeline = section("Who spoke when", `Every stretch of talk across the ${secsLine(length)}, under how fast the words came.`, [
    stack([
      row([stack([], { width: 110, flex: "none" }), stack([columns(flow, { highlight: [fPeak], height: 64 })], { flex: 1, minWidth: 0 })], { gap: 14 }),
      stack(lanes, { gap: 10, marginTop: 16 }),
      row([stack([], { width: 110, flex: "none" }),
        row([stamp(0), stamp(length / 2), stamp(length)].map((l) => text(l, "d-margin")), { justify: "between", flex: 1, minWidth: 0 })],
        { gap: 14, marginTop: 10 }),
    ], { marginTop: 20 }),
  ], { flex: "none", width: "100%", marginTop: NOTE_AIR.part });

  return [
    text("The conversation in numbers", "d-h2", { ...NOTE_HEAD, marginTop: NOTE_AIR.section }),
    tiles,
    ...twoUp(share, table, { marginTop: NOTE_AIR.part }),
    timeline,
  ];
}

/**
 * One note: the meeting, one paragraph on the whole conversation, and the
 * few things people said that matter — each with who said it, in their own
 * voice, worded the best way. Under them, the conversation in numbers (see
 * noteNumbers); the transcript itself is never shown.
 */
export function deskNote(ctx: DeskContext): ScreenResponse {
  const nt = ctx.note;
  if (!nt) {
    return screen("desk_note", "Note", [page([
      text("Notes", "d-eyebrow"),
      text("This note is gone.", "d-h1", { marginTop: 6 }),
      row([link("All notes", { kind: "switchTab", tabId: "desk_notes" })], { marginTop: 18 }),
    ])]);
  }
  const d = local(ctx, Date.parse(nt.startedAt));
  const named = new Map(nt.people.map((p) => [p.label, p.name]));
  const nameOf = (label: string) => named.get(label) || label;
  const who = peopleLabels(nt.people, nt.transcript);
  const meta = [dateLine(d), clock(d), nt.durationSeconds ? span(nt.durationSeconds / 60) : ""].filter(Boolean).join(" · ");
  const busy = nt.status === "organising";
  const canOrganise = nt.status === "failed" || nt.status === "recording" || (nt.status === "ready" && !nt.organised && nt.transcript.length > 0);

  const head = stack([
    row([link("All notes", { kind: "switchTab", tabId: "desk_notes" })], { marginBottom: 18 }),
    text("Meeting", "d-eyebrow"),
    text(noteTitle(ctx, nt), "d-h1", { marginTop: 6 }),
    text(meta, "d-count", { marginTop: 12 }),
    // Who was in it, each in their colour: the page's key to the boxes below.
    ...(who.length ? [row([
      text("With", "d-margin", { marginRight: 2 }),
      ...who.map((l) => speakerChip(nameOf(l), speakerColor(l))),
    ], { gap: 8, align: "center", flexWrap: "wrap", marginTop: 16 })] : []),
    // WHAT THE PAGE SAYS IS GOING ON, with Blip beside it when it is a working
    // or an error state: carrying the pieces while the note is written, and
    // thinking it over, with the fix in a line, when it could not be. The one
    // Blip here; a note that is ready has none.
    ...(nt.status === "organising" || nt.status === "failed"
      ? [row([
          blip(nt.status === "organising" ? "carry-s" : "think-s", 0.6),
          stack([
            text(NOTE_STATUS[nt.status] ?? "", "d-lede"),
            ...(nt.status === "failed" ? [text(say("x.note"), "d-margin", { marginTop: 6 })] : []),
          ], { flex: 1, minWidth: 0 }),
        ], { align: "center", gap: 16, marginTop: 14 })]
      : nt.status !== "ready" ? [text(NOTE_STATUS[nt.status] ?? "", "d-lede", { marginTop: 12 })] : []),
    ...(nt.status === "ready" && !nt.organised ? [text("Nobody spoke in this one.", "d-lede", { marginTop: 12 })] : []),
    row([
      ...(nt.organised ? [link("Copy", { kind: "copyText", text: noteText(ctx, nt), message: "Copied" })] : []),
      ...(busy ? [link("Refresh", { kind: "refresh" })] : []),
      ...(canOrganise ? [link(nt.status === "recording" ? "Organise now" : "Organise again", {
        kind: "callEndpoint", method: "POST", path: `/v1/notes/${nt.id}/organise`,
        onSuccess: { kind: "toast", message: "Organising. Give it a minute." },
      } as ActionRef)] : []),
      { ...link("Delete", { kind: "setState", path: "noteDel", value: true }), visibleIf: { falsy: "noteDel" } },
      { ...row([
        text("Delete this note?", "d-margin-strong"),
        link("Delete", {
          kind: "callEndpoint", method: "DELETE", path: `/v1/notes/${nt.id}`,
          onSuccess: { kind: "switchTab", tabId: "desk_notes" },
        } as ActionRef),
        link("Keep", { kind: "setState", path: "noteDel", value: false }),
      ], { gap: 14, align: "center" }), visibleIf: { truthy: "noteDel" } },
    ], { gap: 22, marginTop: 22, align: "center", flexWrap: "wrap" }),
  ], { paddingBottom: 30, marginBottom: 44 }, "d-rule-bottom");

  const body: Node[] = [];
  // THE COMPUTER'S SOUND WAS OFF. The note is still made, from the
  // microphone; this says so, and how to have everyone in the next one.
  if (nt.systemAudio === "denied") body.push(onlyYourSide(!!ctx.allowSystemAudio));
  if (nt.summary) body.push(text(nt.summary, "d-written", { fontSize: 19, lineHeight: "31px", maxWidth: 680 }));
  if (nt.highlights.length) {
    // A turn is what one speaker said in a row: one box, their colour.
    const turns: Array<{ speaker: string; points: string[] }> = [];
    for (const h of nt.highlights) {
      const last = turns[turns.length - 1];
      if (last && last.speaker === h.speaker) last.points.push(h.text);
      else turns.push({ speaker: h.speaker, points: [h.text] });
    }
    body.push(stack([
      text("What mattered", "d-h2", NOTE_HEAD),
      stack(turns.map((t) => speakerBox(nameOf(t.speaker), speakerColor(t.speaker), t.points)), { gap: NOTE_AIR.box }),
    ], { marginTop: nt.summary ? NOTE_AIR.section - 8 : 0 }));
  }

  return screen("desk_note", noteTitle(ctx, nt), [page([head, stack(body, { maxWidth: NOTE_MEASURE }), ...noteNumbers(nt)])], { noteDel: false });
}
