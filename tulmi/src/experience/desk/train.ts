/**
 * Train: how well the app knows the person's voice, and the way to teach it more.
 */

import type { ScreenResponse, Node } from "../../../../shared/types/sdui.js";
import { LANGUAGE_NAMES } from "../../history/writtenIn.js";
import { sw as say } from "../settingsWords.js";
import { statTile, ACCENT, SERIES, columns, foldParts, donutWithLegend, type Part, splitBar } from "./charts.js";
import type { DeskContext } from "./context.js";
import { voiceNamer } from "./insights.js";
import { link, row, n, stack, text, ROOM, room, section, screen, page, twoUp } from "./kit.js";
import { local, MONTHS } from "./time.js";

// ---- TRAIN --------------------------------------------------------------------------------

/**
 * TRAIN — what Tailzu has learned about how this person writes, as figures and
 * charts, the way Insights shows what they wrote.
 *
 * The band carries the start button and four figures (rounds, sittings, words
 * it knows, how long it has been learning), over the network at this person's
 * growth where the window can draw it. Under it: how well it knows them (three
 * stages, by sittings), the portrait in its own words, their words with what
 * each means to them, the modes they write in, how they change through the day,
 * what it noted per voice, and what it learns from — the days it heard them,
 * the voices and languages they write in (the stats read, when it arrived).
 */
export function deskTrain(ctx: DeskContext): ScreenResponse {
  const portrait = ctx.personality.stylePortrait;
  const st = ctx.stats;
  const now = local(ctx, Date.now());
  const rounds = portrait?.examples ?? 0;
  const sittings = portrait?.sessions ?? 0;
  const styles = (portrait?.styles ?? []).filter((x) => x?.name);
  const rhythms = (portrait?.rhythms ?? []).filter((x) => x?.when && x?.vibe);
  const voiceName = voiceNamer(ctx);
  const tones = Object.entries(portrait?.tones ?? {}).filter(([, v]) => String(v ?? "").trim());
  const first = portrait?.firstSeenAt ? Date.parse(portrait.firstSeenAt) : NaN;
  const ageDays = Number.isFinite(first) ? Math.max(0, Math.floor((Date.now() - first) / 86_400_000)) : 0;
  const ageText = !Number.isFinite(first) ? "—" : ageDays < 1 ? "today" : ageDays < 14 ? `${ageDays} ${ageDays === 1 ? "day" : "days"}`
    : ageDays < 60 ? `${Math.floor(ageDays / 7)} weeks` : `${Math.floor(ageDays / 30)} months`;
  const since = Number.isFinite(first) ? (() => { const d = local(ctx, first); return `since ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`; })() : "from your first dictation";

  // ---- the band ----------------------------------------------------------------------
  const start = link(rounds ? "Continue training" : "Start training", { kind: "navigate", screenId: "training_live" }, "d-btn",
    { backgroundColor: "#F3E2C6", color: "#17120E" });
  const figures = row([
    statTile("Training rounds", n(rounds), rounds ? "spoken sessions and picks" : "none yet", true, true),
    statTile("Sittings learned from", n(sittings), since, true),
    statTile("Learning for", ageText, (portrait?.observed ?? 0) > 0 ? `${n(portrait!.observed!)} dictations read since the last rewrite` : "every dictation teaches it", true),
  ], { gap: 36, flexWrap: "wrap", marginTop: 30, paddingTop: 22, borderTop: "1px solid rgba(243,226,198,.12)", width: "100%" });
  const head: Node[] = [
    stack([
      text(say("tab.train"), "d-eyebrow"),
      text("A few minutes of talking, and it writes like you.", "d-h1", { marginTop: 6, maxWidth: "22ch" }),
      text("X0 Bot asks a few questions and listens to how you answer. What it learns stays with your account, on every device.",
        "d-lede", { marginTop: 10, maxWidth: "46ch", color: "rgba(243,226,198,.72)" }),
      row([start], { marginTop: 22 }),
    ], { minWidth: 0 }),
    figures,
  ];
  // THE NETWORK, where the window can show it, behind the band's words: the
  // same field the phone's training card carries, at this person's growth. A
  // plain ground under it — a gradient would sit over the field.
  const band: Node = ctx.field
    ? stack([
        ctx.field,
        stack([row(head, { justify: "between", align: "end", gap: 24, flexWrap: "wrap" })], { position: "relative" }, "d-room-inner"),
      ], { position: "relative", overflow: "hidden", ...ROOM, backgroundImage: "none", minHeight: 300, justify: "end" }, "d-room")
    : room(head);

  // ---- how well it knows them ----------------------------------------------------------
  const STAGES = [
    { name: "First impression", when: "a sitting or two" },
    { name: "Getting to know you", when: "three to nine sittings" },
    { name: "Knows how you write", when: "ten sittings and on" },
  ];
  const stage = sittings >= 10 ? 2 : sittings >= 3 ? 1 : 0;
  const stageBlock = section("How well it knows you", sittings
      ? `${STAGES[stage]!.name}: ${n(sittings)} ${sittings === 1 ? "sitting" : "sittings"} so far.${stage < 2 ? ` ${stage === 0 ? 3 - sittings : 10 - sittings} more and it moves on.` : " One odd day no longer changes what it knows."}`
      : "Nothing yet. Talk to it once, or dictate anywhere, and it starts.", [
    row(STAGES.map((x, i) => stack([
      stack([], { height: 8, radius: 4, background: i <= stage && sittings > 0 ? (i === stage ? ACCENT : "var(--d-ink)") : "var(--d-rule)" }),
      text(x.name, "d-k", { fontWeight: 600, fontSize: 13, marginTop: 10, ...(i === stage && sittings > 0 ? {} : { color: "var(--d-ink3)" }) }),
      text(x.when, "d-margin", { marginTop: 2 }),
    ], { flex: 1, minWidth: 0 })), { gap: 6, marginTop: 20 }),
  ], { flex: "none", width: "100%" });

  // ---- the portrait, in its own words -------------------------------------------------
  const core = String(portrait?.core ?? "").trim();
  const coreBlock = core
    ? section("What it knows about how you write", "In its own words. Every dictation is written with this in mind.", [
        text(core, "d-written", { fontSize: 18, lineHeight: "29px", marginTop: 16, maxWidth: 720 }),
      ], { flex: "none", width: "100%", marginTop: 52 })
    : null;

  // ---- how they write --------------------------------------------------------------------
  const stylesBlock = section("How you write", styles.length
      ? "The modes you actually write in, and when each one shows up."
      : "Short or long, formal or not, and when. It fills in as it reads more of you.",
    styles.length ? [stack(styles.slice(0, 8).map((x, i) => row([
      stack([], { width: 10, height: 10, radius: 3, marginTop: 6, background: SERIES[i % SERIES.length]!, flex: "none" }),
      stack([text(x.name, "d-k", { fontWeight: 600, fontSize: 14 }), ...(x.when ? [text(x.when, "d-lede", { fontSize: 13.5, lineHeight: "20px", marginTop: 2 })] : [])], { flex: 1, minWidth: 0 }),
    ], { gap: 12, paddingTop: 10, paddingBottom: 10, align: "start" }, "d-rule-bottom")), { marginTop: 14 })] : []);

  // ---- through the day, and per voice --------------------------------------------------
  const rhythmBlock = rhythms.length
    ? section("Through the day", "How you change from morning to night.", [stack(rhythms.slice(0, 6).map((x) => row([
        text(x.when, "d-margin-strong", { width: 110, flex: "none", paddingTop: 3 }),
        text(x.vibe, "d-written", { flex: 1, minWidth: 0, fontSize: 15.5, lineHeight: "23px" }),
      ], { gap: 14, paddingTop: 10, paddingBottom: 10, align: "start" }, "d-rule-bottom")), { marginTop: 14 })])
    : section("Through the day", "How you change from morning to night, once it has seen a few of your days.", []);
  const toneBlock = tones.length
    ? section("Per voice", "What it noticed about you in each voice.", [stack(tones.slice(0, 6).map(([id, note]) => row([
        text(voiceName(id), "d-margin-strong", { width: 110, flex: "none", paddingTop: 3 }),
        text(String(note), "d-lede", { flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: "20px" }),
      ], { gap: 14, paddingTop: 10, paddingBottom: 10, align: "start" }, "d-rule-bottom")), { marginTop: 14 })])
    : null;

  // ---- what it learns from -------------------------------------------------------------
  const wpd = st?.wordsPerDay ?? st?.days?.map((d) => d.words) ?? [];
  const heardDays = wpd.filter((v) => v > 0).length;
  const dayLabel = (k: number) => { const d = new Date(now.getTime() - k * 86_400_000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`; };
  const fromBlock = heardDays
    ? section("What it learns from", `Every dictation teaches it a little. It heard you on ${heardDays} of the last ${wpd.length} days; the amber column is today.`,
        [columns(wpd, { highlight: [wpd.length - 1], ticks: [dayLabel(wpd.length - 1), dayLabel(Math.floor((wpd.length - 1) / 2)), "Today"] })],
        { flex: "none", width: "100%", marginTop: 52 })
    : null;
  const vp = foldParts((st?.voiceWords ?? []).map((v) => ({ label: voiceName(v.id), value: v.words })));
  const voicesBlock = vp.length > 1
    ? section("The voices you write in", "Your words this month, by the voice that wrote them.", [donutWithLegend(vp, { value: `${vp.length}`, label: "voices" })])
    : null;
  const lp = foldParts((st?.writtenIn ?? []).map((l) => ({ label: LANGUAGE_NAMES[l.key] ?? l.key, value: l.words })));
  const kinds = st?.kindWords;
  const kp: Part[] = kinds ? [
    { label: "Spoken", value: kinds.voice, color: SERIES[0] },
    { label: "Typed", value: kinds.typing, color: SERIES[3] },
    { label: "Draft", value: kinds.draft, color: SERIES[2] },
  ].filter((p) => p.value > 0) : [];
  const langBlock = lp.length > 1 || kp.length > 1
    ? section("What it hears", undefined, [
        ...(lp.length > 1 ? [text("Languages", "d-eyebrow", { marginTop: 18 }), splitBar(lp)] : []),
        ...(kp.length > 1 ? [text("Spoken, typed, drafted", "d-eyebrow", { marginTop: 30 }), splitBar(kp)] : []),
      ])
    : null;

  return screen("desk_train", say("tab.train"), [band, page([
    stageBlock,
    ...(coreBlock ? [coreBlock] : []),
    ...twoUp(stylesBlock, null),
    ...twoUp(rhythmBlock, toneBlock),
    ...(fromBlock ? [fromBlock] : []),
    ...twoUp(voicesBlock, langBlock),
  ])]);
}
