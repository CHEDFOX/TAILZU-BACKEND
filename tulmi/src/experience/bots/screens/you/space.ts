/**
 * YOUR SPACE (You › Your space; routes/bots/botsYouSpace.ts): what your bots know about you, in sections, beside your own things.
 *
 *   bots.you.space            the sections as tiles: how much is in each, a peek, Off when bots may not use it
 *   bots.you.space.section    one section (params: id): may bots use it, the things of yours that belong there (opened in their own pages),
 *                             and every line bots keep, each with the bots that keep it. Tap a line: pin it, move it, reword it, forget it
 *                             (everywhere). Write a line of your own (never into Money). About you also has your name and gender.
 */
import type { ActionRef, ActionSpec, Node, ScreenResponse } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, C, box, button, call, chips, col, grid, grow, icon, listCard, listRow, meta, open, page, primaryButton, row, sectionLabel, seq, switchRow, text, when } from "../../kit.js";
import { screen, type BotsScreen } from "../../registry.js";
import { botRoute, SCREENS } from "../../ids.js";
import type { IconName } from "../../glyphs.js";
import { GENDERS } from "../firstRun/parts.js";
import { DAY_MS, dayMonth, local, oops, plural, refresh, toast } from "./parts.js";

export const SPACE_API = "/v1/bots/you/space";

type SectionId = "about" | "day" | "people" | "places" | "likes" | "money" | "work" | "bots" | "files" | "timeline";
type FactSection = Exclude<SectionId, "bots" | "files" | "timeline">;
export interface SectionCard { id: SectionId; name: string; count: number; peek: string; off: boolean }
export interface SpaceOverview { on: boolean; total: number; sections: SectionCard[] }
export interface SpaceLine { key: string; text: string; section: FactSection; from: string[]; forAll: boolean; at: number; pinned: boolean }
export interface SpaceThing { kind: "event" | "todo" | "home" | "trip" | "group" | "project" | "note" | "bot"; ref: string; title: string; line: string; at: number | null }
export interface SectionView {
  id: SectionId; name: string; line: string; use: boolean | null; canAdd: boolean; on: boolean;
  lines: SpaceLine[]; things: SpaceThing[]; me?: { name: string; gender: string | null };
  groups?: Array<{ id: string; name: string }>;
}
type Groups = NonNullable<SectionView["groups"]>;

const ICON: Record<SectionId, IconName> = {
  about: "person", day: "sun", people: "link", places: "pin", likes: "spark", money: "rupee", work: "folder", bots: "computer", files: "notes", timeline: "today",
};
const FACT_NAMES: Record<FactSection, string> = { about: "About you", day: "Your day", people: "People", places: "Places", likes: "Likes", money: "Money", work: "Work" };
/** What a tile says when it holds nothing yet. */
const EMPTY_PEEK: Record<SectionId, string> = {
  about: "Your name, your languages", day: "Your routine", people: "Family, friends, your groups", places: "Home, trips", likes: "Food, music, how you like things",
  money: "Kept by the one bot you tell", work: "Your job, studies, projects", bots: "What each one knows", files: "Your notes", timeline: "Newest first",
};
const THINGS_TITLE: Partial<Record<SectionId, string>> = { day: "Next up", places: "Your places", people: "Your groups", work: "Your projects", files: "Your notes", bots: "Your bots" };
const ADD_HINT: Partial<Record<SectionId, string>> = {
  about: "e.g. I speak Tamil and English", day: "e.g. I'm free after 7 pm on weekdays", people: "e.g. My sister Meera lives in Pune",
  places: "e.g. I'm from Kochi", likes: "e.g. Keep replies short", work: "e.g. I teach maths at a school",
};

/** Where a thing of theirs opens: its own page. */
function openThing(t: SpaceThing): ActionRef | undefined {
  switch (t.kind) {
    case "event": case "todo": case "home": return open(SCREENS.plan);
    case "trip": return open(SCREENS.travel);
    case "group": return open(SCREENS.spaces, { id: t.ref });
    case "project": return open(SCREENS.code, { project: t.ref });
    case "note": return open(SCREENS.note, { id: t.ref });
    case "bot": return t.ref ? botRoute(t.ref) : undefined;
  }
}

const dayNo = (ctx: BotsCtx, t: number) => Math.floor(local(ctx, t).getTime() / DAY_MS);

/** "today", "yesterday", "3 days ago", "2 Nov"; ahead: "today", "tomorrow", "5 Nov". */
function ago(ctx: BotsCtx, at: number): string {
  const days = dayNo(ctx, ctx.live.now) - dayNo(ctx, at);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days === -1) return "tomorrow";
  if (days > 1 && days < 7) return `${days} days ago`;
  return dayMonth(ctx, at);
}

/** Who keeps a line, and since when: "Pinned · Plan Ease, Travel · 3 days ago", "All your bots · today". */
const fromLine = (ctx: BotsCtx, l: SpaceLine, withSection = false) =>
  [...(l.pinned ? ["Pinned"] : []), ...(withSection ? [FACT_NAMES[l.section]] : []), l.from.length ? l.from.join(", ") : "All your bots", ago(ctx, l.at)].join(" · ");

// ===================================================================== the hub

function tile(c: SectionCard): Node {
  return col([
    row([icon(ICON[c.id], { size: 18 }), grow(), c.off ? text("Off", { size: 12, weight: 600, color: C.meta, lineHeight: 16 }) : c.count ? meta(String(c.count), { size: 12 }) : box([])], { alignItems: "center" }),
    col([
      text(c.name, { size: 15, weight: 600, lineHeight: 20, lines: 1 }),
      meta(c.peek || EMPTY_PEEK[c.id], { size: 12, lineHeight: 16, lines: 2 }),
    ], { gap: 2 }),
  ], { gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, minHeight: 112 }, open(SCREENS.youSpaceSection, { id: c.id }));
}

function hub(ctx: BotsCtx, d: SpaceOverview | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  return page(ctx, {
    back: true, nav: "you", title: "Your space", gap: 18, ...(desk ? { maxWidth: 1040 } : {}),
    body: [
      col([
        text("Your space", { size: desk ? 28 : 24, weight: 700, tracking: -0.4, lineHeight: desk ? 34 : 30 }),
        meta(d && d.total ? `What your bots know about you: ${plural(d.total, "thing")}, in one place. Only you see it.` : "What your bots know about you, in one place. Only you see it.", { size: 13 }),
      ], { gap: 4 }),
      ...(d && !d.on ? [col([
        text("Your bots aren't using any of this", { size: 14, weight: 600, lineHeight: 19 }),
        meta("“Use what you've told your bots” is off in Privacy. It's all kept here for you.", { size: 12 }),
      ], { gap: 2, padding: 14, borderRadius: 16, backgroundColor: C.surface }, open(SCREENS.privacy))] : []),
      grid((d?.sections ?? []).map(tile), desk ? 4 : 2, 10),
    ],
  });
}

// ===================================================================== one section

/** The four things a tapped line offers. Moving and rewording open under it. */
function lineActions(l: SpaceLine, id: SectionId, groups: Groups): Node {
  const path = `${SPACE_API}/lines/${l.key}`;
  const put = (body: Record<string, unknown>, ok: string): ActionRef => call("PUT", path, body, { ok: seq(toast(ok), { kind: "setState", path: "pick", value: "" } as ActionSpec, refresh), fail: oops("change that") });
  const forget: ActionRef = {
    kind: "condition", if: { eq: ["sure", l.key] },
    then: call("DELETE", path, {}, { ok: seq(toast("Forgotten by every bot"), { kind: "setState", path: "pick", value: "" } as ActionSpec, refresh), fail: oops("forget that") }),
    else: seq({ kind: "setState", path: "sure", value: l.key } as ActionSpec, toast("Tap Forget again: every bot forgets it")),
  } as ActionSpec;
  const small = (label: string, a: ActionRef) => button(label, a, { kind: "secondary", size: "md" });
  const moveTo = (Object.keys(FACT_NAMES) as FactSection[]).filter((s) => s !== l.section).map((s) => ({ label: FACT_NAMES[s], value: s }));
  return col([
    row([
      small(l.pinned ? "Unpin" : "Pin", put({ pinned: !l.pinned }, l.pinned ? "Unpinned" : "Pinned: every bot sees it first")),
      small("Move", { kind: "setState", path: "mode", value: "move" } as ActionSpec),
      small("Edit", seq({ kind: "setState", path: "edit", value: l.text } as ActionSpec, { kind: "setState", path: "mode", value: "edit" } as ActionSpec)),
      small("Forget", forget),
      // One line, to one group's bots, by this tap only. Money never leaves the bot that was told.
      ...(groups.length && l.section !== "money" ? [small("Share", { kind: "setState", path: "mode", value: "share" } as ActionSpec)] : []),
    ], { gap: 8, flexWrap: "wrap" }),
    when({ eq: ["mode", "share"] }, col([
      meta("Share this one line with a group's bots. Nothing else of your space goes with it.", { size: 12 }),
      chips(groups.map((g) => ({ label: g.name, value: g.id })), "shareTo", {
        onChange: call("POST", `${path}/share`, { space: "$state.shareTo" }, {
          ok: seq(toast("Shared with the group's bots"), { kind: "setState", path: "pick", value: "" } as ActionSpec),
          fail: toast("Couldn't share that. It may be there already.") as ActionSpec,
        }),
      }),
    ], { gap: 6 })),
    when({ eq: ["mode", "move"] }, col([meta("Move it to", { size: 12 }), chips(moveTo, "moveTo", { onChange: put({ section: "$state.moveTo" }, "Moved") })], { gap: 6 })),
    when({ eq: ["mode", "edit"] }, col([
      field("edit", "", 2),
      row([grow(), button("Save", put({ text: "$state.edit" }, id === "timeline" ? "Saved" : "Saved for every bot that keeps it"), { size: "md" })]),
    ], { gap: 8 })),
  ], { gap: 10, paddingHorizontal: 16, paddingBottom: 14 });
}

function lineRow(ctx: BotsCtx, l: SpaceLine, id: SectionId, groups: Groups = []): Node {
  const tap = { kind: "condition", if: { eq: ["pick", l.key] }, then: { kind: "setState", path: "pick", value: "" }, else: seq({ kind: "setState", path: "pick", value: l.key } as ActionSpec, { kind: "setState", path: "mode", value: "" } as ActionSpec, { kind: "setState", path: "sure", value: "" } as ActionSpec) } as ActionSpec;
  return col([
    row([
      col([text(l.text, { size: 15, lineHeight: 20 }), meta(fromLine(ctx, l, id === "timeline"), { size: 12, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      icon("more", { size: 18, color: C.meta }),
    ], { gap: 12, paddingVertical: 14, paddingHorizontal: 16, alignItems: "center" }, tap),
    when({ eq: ["pick", l.key] }, lineActions(l, id, groups)),
  ], {});
}

function field(path: string, placeholder: string, lines: number): Node {
  return {
    type: "TextField", id: path, bind: { value: path },
    props: { placeholder, placeholderColor: C.idle, multiline: lines > 1, numberOfLines: lines, background: "transparent", borderWidth: 0, color: C.ink },
    style: { minHeight: lines > 1 ? 72 : 44, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line, fontSize: 15, color: C.ink, textAlignVertical: "top" },
  } as Node;
}

/** Your name and gender, as the account has them, changed in place. */
function meCard(me: NonNullable<SectionView["me"]>): Node {
  const gender = GENDERS.find((g) => g.value === me.gender)?.label ?? "Not set";
  const save = call("PUT", "/v1/profile", { full_name: "$state.meName", gender: "$state.meGender" }, { ok: seq(toast("Saved"), { kind: "setState", path: "editMe", value: false } as ActionSpec, refresh), fail: oops() });
  return col([
    when({ falsy: "editMe" }, listCard([
      listRow({ label: "Name", value: me.name || "Not set", chevron: false }),
      listRow({ label: "Gender", value: gender, chevron: false }),
      listRow({ label: "Change", strong: true, onPress: { kind: "setState", path: "editMe", value: true } as ActionSpec }),
    ])),
    when({ truthy: "editMe" }, col([
      field("meName", "Your name", 1),
      chips(GENDERS, "meGender"),
      row([button("Cancel", { kind: "setState", path: "editMe", value: false } as ActionSpec, { kind: "quiet", size: "md" }), grow(), button("Save", save, { size: "md" })], { alignItems: "center" }),
    ], { gap: 10 })),
  ], { gap: 0 });
}

/** The timeline's lines under a heading a day: Today, Yesterday, 2 Nov. */
function byDay(ctx: BotsCtx, lines: SpaceLine[], id: SectionId): Node[] {
  const out: Node[] = [];
  let day = "", rows: Node[] = [];
  const flush = () => { if (rows.length) out.push(col([sectionLabel(day), listCard(rows)], { gap: 8 })); rows = []; };
  for (const l of lines) {
    const a = ago(ctx, l.at);
    const label = a === "today" ? "Today" : a === "yesterday" ? "Yesterday" : dayMonth(ctx, l.at);
    if (label !== day) { flush(); day = label; }
    rows.push(lineRow(ctx, l, id));
  }
  flush();
  return out;
}

function sectionPage(ctx: BotsCtx, v: SectionView | undefined): ScreenResponse {
  const id = (v?.id ?? String(ctx.params.id ?? "about")) as SectionId;
  const desk = ctx.client === "desktop";
  const lines = v?.lines ?? [], things = v?.things ?? [];
  const usePath = `${SPACE_API}/${id}/use`;
  const add = call("POST", `${SPACE_API}/${id}`, { text: "$state.add" }, {
    ok: seq({ kind: "setState", path: "add", value: "" } as ActionSpec, toast("Kept for all your bots"), refresh),
    fail: toast("Couldn't keep that. Try again.") as ActionSpec,
  });
  const guardedAdd = { kind: "condition", if: { falsy: "add" }, then: toast("Write it first"), else: add } as ActionSpec;
  const empty = !lines.length && !things.length && !v?.me;
  return page(ctx, {
    back: true, nav: "you", title: v?.name ?? "Your space", gap: 18, ...(desk ? { maxWidth: 760 } : {}),
    state: { pick: "", mode: "", sure: "", edit: "", moveTo: "", shareTo: "", add: "", use: v?.use !== false, editMe: false, meName: v?.me?.name ?? "", meGender: v?.me?.gender ?? "" },
    body: [
      row([
        box([icon(ICON[id], { size: 20 })], { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }),
        col([text(v?.name ?? "", { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), meta(v?.line ?? "", { size: 13 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      ], { gap: 12, alignItems: "center" }),
      ...(v && v.use !== null ? [listCard([switchRow("Bots can use this", "use", {
        sub: id === "money" ? "Only the bot you told, never your other bots." : "Off: it stays here for you, and no bot is shown it.",
        onChange: call("PUT", usePath, { on: "$state.use" }, { ok: refresh, fail: oops() }),
      })])] : []),
      ...(v?.me ? [col([sectionLabel("On your account"), meCard(v.me)], { gap: 8 })] : []),
      ...(things.length ? [listCard(things.map((t) => listRow({
        label: t.title, sub: [t.line, t.at !== null && t.kind !== "bot" ? ago(ctx, t.at) : ""].filter(Boolean).join(" · "), onPress: openThing(t),
      })), { title: THINGS_TITLE[id] ?? "Yours" })] : []),
      ...(id === "timeline" ? byDay(ctx, lines, id) : lines.length ? [listCard(lines.map((l) => lineRow(ctx, l, id, v?.groups ?? [])), { title: `What your bots know · ${lines.length}` })] : []),
      ...(empty ? [meta(id === "money" ? "Nothing yet. A bot you tell about money keeps it to itself, and it shows here." : "Nothing here yet. As you talk to your bots, what they learn about you shows here.", { size: 13 })] : []),
      ...(v?.canAdd ? [col([
        sectionLabel("Add something"),
        field("add", ADD_HINT[id] ?? "One short line", 2),
        row([meta("Kept for all your bots.", { size: 12, style: { flexShrink: 1 } }), grow(), primaryButton("Add", guardedAdd, { size: "md" })], { gap: 10, alignItems: "center" }),
      ], { gap: 8 })] : []),
    ],
  });
}

export const spaceScreens: BotsScreen[] = [
  screen<SpaceOverview>({ id: SCREENS.youSpace, load: (_ctx, deps) => deps.api<SpaceOverview>("GET", SPACE_API), build: hub }),
  screen<SectionView>({
    id: SCREENS.youSpaceSection,
    load: (ctx, deps) => deps.api<SectionView>("GET", `${SPACE_API}/${encodeURIComponent(String(ctx.params.id ?? "about"))}`),
    build: sectionPage,
  }),
];
