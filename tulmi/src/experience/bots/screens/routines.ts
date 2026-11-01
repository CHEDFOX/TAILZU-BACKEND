/**
 * ROUTINES ON THE SCREEN (src/routines, docs/routines.md): what each bot does on a schedule, without being asked each time.
 *
 *   The card    Ask's answer, when the words asked for something done on a schedule ("every Friday at 5, sum up my week"): when it
 *               runs, what it does, who does it (chips, the bot "Ask any bot" picked chosen), and Save. Nothing is kept until Save.
 *               "Change" goes back to Ask with the words, to say it differently.
 *   bots.routines  the list: each routine's bot, task, when, next run, and its last answer; Run now, Pause / Turn on, Delete (asked
 *               twice). New routines are set up in Ask, by saying them.
 *   Home's row  under the bots, once there is a routine: how many are on and when the next one runs.
 *
 * The phone and the window alike; the window's page is narrower than its frame.
 */
import type { ActionRef, Node } from "../../../../../shared/types/sdui.js";
import {
  botAvatar, botLook, box, C, call, chips, col, emptyState, grow, icon, labelled, meta, notice, open, page, primaryButton, quietButton, RADIUS,
  row, SCREENS, secondaryButton, sectionLabel, seq, statusMark, text, title, when, type BotsCtx,
} from "../kit.js";
import { screen, type BotsScreen } from "../registry.js";
import { CODE_SLUG } from "../../../bots/builtin.js";
import { nextRun, nextWords, openDraft, scheduleWords, type BotChoice, type RoutineView } from "../../../routines/index.js";

export const ROUTINES_PATH = "/v1/routines";

export interface RoutinesData { routines: RoutineView[]; max: number; choices: BotChoice[] }

const toast = (message: string, tone?: "error"): ActionRef => ({ kind: "toast", message, ...(tone ? { tone } : {}) });

/** A bot's face, from the live list, else its built-in look. */
function face(ctx: BotsCtx, slug: string, size: number): Node {
  return botAvatar(ctx.live.bots.find((b) => b.slug === slug) ?? botLook(slug), size);
}

/** The bots that can take a routine: the person's, never Xode. */
const choicesOf = (ctx: BotsCtx): BotChoice[] => ctx.live.bots.filter((b) => b.slug !== CODE_SLUG).map((b) => ({ slug: b.slug, name: b.name }));

// ===================================================================== Ask's card

/** A token Ask's answer can show a card for: a sealed draft, not a state path that never filled in. */
export const isRoutineToken = (v: unknown): v is string => typeof v === "string" && v.length > 8 && !v.startsWith("$") && !!openDraft(v);

/**
 * Ask's answer for words about a schedule: the routine to save. `asked` is what they said, for Change. The bot picked is chosen; with
 * none, Save asks them to pick one.
 */
export function routineCard(ctx: BotsCtx, token: string, asked: string): Node[] {
  const d = openDraft(token);
  if (!d) return [];
  const tz = ctx.tzOffsetMinutes, now = ctx.live.now;
  const choices = choicesOf(ctx);
  const next = nextWords(nextRun(d.schedule, tz, now), tz, now);
  const save = call("POST", ROUTINES_PATH, { token, bot: "$state.rbot", tz }, {
    ok: seq(toast("Routine saved"), { kind: "navigate", screenId: SCREENS.routines, replace: true }),
    fail: toast("Couldn't save it. You may have it already, or have the most routines there can be.", "error"),
  });
  return [
    col([
      row([icon("today", { size: 16, color: C.meta }), meta("A routine, done on its own", { size: 12 })], { gap: 6 }),
      text(scheduleWords(d.schedule), { size: 22, weight: 700, lineHeight: 28, tracking: -0.4 }),
      text(d.task, { size: 16, lineHeight: 23 }),
      meta(`First run: ${next}`, { size: 13 }),
    ], { gap: 8, padding: 18, borderRadius: RADIUS.card, borderWidth: 1, borderColor: C.line }),
    col([
      sectionLabel("Who does it"),
      chips(choices.map((c) => ({ label: c.name, value: c.slug })), "rbot"),
    ], { gap: 10 }),
    notice("It asks you before it sends, deletes or pays for anything. The answer comes as a notification."),
    row([
      secondaryButton("Change", open(SCREENS.ask, { message: asked })),
      primaryButton("Save routine", { kind: "condition", if: { falsy: "rbot" }, then: toast("Pick the bot that does it"), else: save }),
    ], { gap: 10, justifyContent: "flex-end" }),
  ];
}

/** The state the card starts with: the bot already chosen. */
export function routineCardState(ctx: BotsCtx, token: string, picked: string): Record<string, unknown> {
  const d = openDraft(token);
  const choices = choicesOf(ctx);
  const chosen = choices.some((c) => c.slug === picked) ? picked : d?.bot && choices.some((c) => c.slug === d.bot) ? d.bot : "";
  return { rbot: chosen };
}

// ===================================================================== the list

function lastLine(r: RoutineView): string {
  if (!r.last) return "";
  const how = r.last.status === "failed" ? " · didn't work" : r.last.status === "needs" ? " · needs your OK" : "";
  return `Last run ${r.last.words}${how}`;
}

function routineBlock(ctx: BotsCtx, r: RoutineView, i: number): Node {
  const paused = r.status === "paused";
  const del = `del${i}`;
  const toggle = call("POST", `${ROUTINES_PATH}/${r.id}/status`, { status: paused ? "on" : "paused" }, {
    ok: toast(paused ? "Turned on" : "Paused"), fail: toast("Couldn't change it. Try again.", "error"),
  });
  const run = call("POST", `${ROUTINES_PATH}/${r.id}/run`, {}, {
    ok: toast(`${r.bot.name} did it`), fail: toast("It didn't run. It may have just run; try again in a minute.", "error"),
  });
  const remove = call("DELETE", `${ROUTINES_PATH}/${r.id}`, undefined, { ok: toast("Routine deleted"), fail: toast("Couldn't delete it. Try again.", "error") });
  return col([
    row([
      face(ctx, r.bot.slug, 36),
      col([
        text(r.task, { size: 15, weight: 600, lineHeight: 20, lines: 2 }),
        meta(`${r.when} · ${r.bot.name}`, { size: 13, lines: 1 }),
      ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      ...(paused ? [] : [statusMark("working", { color: C.meta, size: 8, still: true })]),
    ], { gap: 12, alignItems: "flex-start" }),
    meta(paused ? r.pausedWhy || "Paused. It won't run until you turn it on." : r.next ? `Next: ${r.next.words}` : "", { size: 13, ...(paused && r.pausedWhy ? { color: C.ink } : {}) }),
    ...(r.last ? [col([
      meta(lastLine(r), { size: 12 }),
      ...(r.last.text ? [text(r.last.text, { size: 14, lineHeight: 20, lines: 4, color: C.grey70 })] : []),
    ], { gap: 4, padding: 12, borderRadius: 14, backgroundColor: C.surface })] : []),
    when({ falsy: del }, row([
      quietButton("Run now", run),
      quietButton(paused ? "Turn on" : "Pause", toggle),
      grow(),
      quietButton("Delete", { kind: "setState", path: del, value: true }),
    ], { gap: 4, flexWrap: "wrap" })),
    when({ truthy: del }, row([
      meta("Delete this routine?", { size: 13 }), grow(),
      quietButton("Keep", { kind: "setState", path: del, value: false }),
      secondaryButton("Delete", remove),
    ], { gap: 6, alignItems: "center" })),
  ], { gap: 10, padding: 16, borderRadius: RADIUS.card, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper });
}

function routinesPage(ctx: BotsCtx, d: RoutinesData | undefined) {
  const desk = ctx.client === "desktop";
  const list = d?.routines ?? [];
  const on = list.filter((r) => r.status === "on").length;
  const head = col([
    title("Routines"),
    meta(list.length ? `Your bots do these on their own. ${on} on, ${list.length} of ${d?.max ?? list.length}.` : "Your bots can do things on a schedule, without being asked each time.", { size: 14 }),
  ], { gap: 6 });
  const example = "Every Friday at 5, sum up my week";
  const bodyNodes: Node[] = !d
    ? [emptyState({ pose: "think", title: "Couldn't load your routines", body: "Pull to try again." })]
    : !list.length
      ? [emptyState({
        pose: "listen", title: "Nothing on a schedule yet",
        body: `Say it once in Ask, like “${example}” or “Every morning at 8, check the weather in Lisbon”.`,
        action: { label: "Set one up in Ask", onPress: open(SCREENS.ask, { message: example }) },
      })]
      : list.map((r, i) => routineBlock(ctx, r, i));
  return page(ctx, {
    ...(desk ? { nav: "bots" } : { back: true, backTitle: "Bots" }), title: "Routines", gap: 16, maxWidth: 760, live: ["routines"],
    state: Object.fromEntries(list.map((_, i) => [`del${i}`, false])),
    body: [head, ...bodyNodes],
    ...(list.length ? { footer: [secondaryButton("New routine", open(SCREENS.ask), { wide: true })] } : {}),
  });
}

// ===================================================================== Home

/** Home's row, once there is a routine: how many are on, and the next run. */
export function routinesRow(ctx: BotsCtx, d: RoutinesData | undefined): Node[] {
  const list = d?.routines ?? [];
  if (!list.length) return [];
  const on = list.filter((r) => r.status === "on");
  const next = on.filter((r) => r.next).sort((a, b) => a.next!.at - b.next!.at)[0];
  const line = !on.length ? "All paused" : next ? `${on.length} on · next ${next.next!.words.replace(/^Today at /, "today at ").replace(/^Tomorrow at /, "tomorrow at ")}` : `${on.length} on`;
  const desk = ctx.client === "desktop";
  return [labelled(row([
    box([icon("today", { size: desk ? 22 : 20, color: C.ink })], {
      width: desk ? 44 : 40, height: desk ? 44 : 40, borderRadius: (desk ? 44 : 40) / 2, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", flexShrink: 0,
    }),
    col([
      text("Routines", { size: 16, weight: 600, lineHeight: 21 }),
      text(line, { size: 13, lineHeight: 17, lines: 1, color: C.meta }),
    ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    icon("chevron", { size: 16, color: C.meta }),
  ], {
    gap: 14, minHeight: desk ? 84 : 76, paddingHorizontal: desk ? 18 : 16, paddingVertical: 12,
    borderRadius: RADIUS.card, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper,
  }, open(SCREENS.routines)), `Routines. ${line}`)];
}

export const routinesScreens: BotsScreen[] = [
  screen<RoutinesData>({ id: SCREENS.routines, load: (_ctx, deps) => deps.api<RoutinesData>("GET", ROUTINES_PATH), build: routinesPage }),
];
