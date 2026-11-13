/**
 * THE CINEMA BOT'S FILM PAGE (src/cinema, routes/bots/cinema.ts), and what its bot page reads.
 *
 *   bots.cinema.film   params f: one film, as far as it has come.
 *     the head         the title, the logline, and where it stands in words ("Storyboard ready: approve the price"), with a notice when it
 *                      waits for the person (more money, a shot to look at) or could not be made
 *     script           (status script) the look and the people, then each shot as a card: its number, size and move, seconds, the beat,
 *                      what happens, the lines and the voice-over. The storyboard's price, and the whole film's roughly, and Make the
 *                      storyboard. Change something (to the whole film, or one shot picked by its number)
 *     storyboard       (board and after) each shot's still with its card, the model that will film it and its seconds; on board, the
 *                      film's price (with what is kept back for retakes) and Film it
 *     filming          each shot's state (waiting, filming, checking, done, needs you); a shot that gave up says why, with Try again
 *     the film         (done) Watch, Download, Share, and the subtitles; Keep in my cast for the people who have a sheet
 *     notes            what the director and the eye said (a shot kept as the best of three, a shot given more seconds for its words)
 *     Stop, Delete     Delete asks a second time
 *
 * The page itself is cinemaPage.ts. Every still and film is opened by a signed link of ours (src/cinema/media.ts), made fresh each time the
 * page is drawn.
 */
import type { ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import type { CinemaOverview, FilmView } from "../../../../cinema/service.js";
import { CINEMA_SLUG, type Film, type FilmRow, type ShotCard, type ShotStatus } from "../../../../cinema/types.js";
import { botTopic } from "../../../../live/topics.js";
import {
  type BotsCtx, page, row, col, text, card, chip, chips, meta, notice, primaryButton, secondaryButton, quietButton, sectionLabel, listCard, listRow,
  call, seq, when, picture, SCREENS, C,
} from "../../kit.js";
import { type BotsScreen, screen } from "../../registry.js";
import { toast } from "../firstRun/parts.js";
import { mailField } from "./mailCards.js";
import { isDesk, setState } from "./parts.js";

type Deps = Parameters<NonNullable<BotsScreen["load"]>>[1];

export const CINEMA = "/v1/cinema";
const said = (message: string): ActionSpec => ({ kind: "toast", message, tone: "success" } as ActionSpec);
const refresh: ActionSpec = { kind: "refresh" };
const idParam = (v: unknown): string => (/^[A-Za-z0-9_-]{1,64}$/.test(String(v ?? "")) ? String(v) : "");

/** A link of ours as a full address (the apps open full addresses). */
export const abs = (path: string): string => (/^https?:\/\//.test(path) ? path : `${process.env.PUBLIC_ORIGIN || "https://api.x0bot.com"}${path}`);
/** Money in rupees, as people say it. */
export const rupees = (paise: number): string => `₹${Math.max(0, Math.ceil(paise / 100)).toLocaleString("en-IN")}`;
const plain = (s: string | null | undefined): string => String(s ?? "").trim().replace(/^[@\s]+/, "");

/** What the bot's page reads: the overview, or that it could not be read. */
export type CinemaData = { overview?: CinemaOverview; down?: boolean };

export async function loadCinema(_ctx: BotsCtx, deps: Deps): Promise<CinemaData> {
  const overview = await deps.api<CinemaOverview>("GET", `${CINEMA}/overview`).catch(() => undefined);
  return overview ? { overview } : { down: true };
}

export const openFilm = (id: string): ActionSpec => ({ kind: "navigate", screenId: SCREENS.cinemaFilm, params: { f: id } });

/** Where a film stands, in words. */
export function statusLine(f: Pick<FilmRow, "status" | "hold" | "shots" | "done">): string {
  if (f.hold === "budget") return "Waiting for you: it needs a little more money";
  if (f.hold === "shot") return "Waiting for you: a shot needs a look";
  switch (f.status) {
    case "writing": return "Writing the script…";
    case "script": return "Script ready: read it and say go";
    case "boarding": return "Making the storyboard…";
    case "board": return "Storyboard ready: approve the price";
    case "rendering": return f.shots ? `Filming: ${f.done} of ${f.shots} shots done` : "Filming…";
    case "cutting": return "Cutting the film…";
    case "done": return "Ready to watch";
    case "failed": return "Couldn't be made";
    case "stopped": return "Stopped";
  }
}

const SHOT_WORDS: Record<ShotStatus, string> = {
  planned: "Waiting", boarding: "Drawing", boarded: "Drawn", queued: "Waiting to film", rendering: "Filming", checking: "Checking", ok: "Done", failed: "Needs you",
};

const SIZE_WORDS: Record<ShotCard["size"], string> = {
  "extreme-wide": "Extreme wide", wide: "Wide", full: "Full", medium: "Medium", "medium-close": "Medium close", close: "Close-up", "extreme-close": "Extreme close-up", insert: "Insert",
};

/** One shot as a card: its still when there is one, its number, size, move and seconds, and what happens in it. */
function shotCard(ctx: BotsCtx, v: FilmView, card_: ShotCard): Node {
  const f = v.film;
  const st = f.shots.find((s) => s.n === card_.n);
  const who = (k: string) => f.script?.bible.characters.find((c) => c.key === k)?.name ?? k;
  const desk = isDesk(ctx);
  const w = desk ? 220 : 120;
  const h = Math.round(f.aspect === "9:16" ? (w * 16) / 9 : f.aspect === "1:1" ? w : (w * 9) / 16);
  const still = st?.still && v.links[st.still] ? picture(abs(v.links[st.still]!), w, h, { radius: 10, fit: "cover", background: C.surface, label: `Shot ${card_.n}` }) : null;
  const words = col([
    row([
      text(`Shot ${card_.n}`, { size: 14, weight: 600, lineHeight: 18 }),
      meta(`${SIZE_WORDS[card_.size]} · ${card_.move.replace("-", " ")} · ${card_.seconds}s`, { size: 12 }),
    ], { gap: 8, flexWrap: "wrap" }),
    card_.beat ? meta(plain(card_.beat), { size: 12, lineHeight: 16 }) : null,
    text(plain(card_.action), { size: 14, lineHeight: 19 }),
    ...card_.lines.map((l) => text(`${who(l.who)}: “${plain(l.text)}”`, { size: 13, lineHeight: 18, color: C.ink })),
    card_.vo ? meta(`Voice-over: “${plain(card_.vo)}”`, { size: 12, lineHeight: 16 }) : null,
    row([
      ...(st && f.status !== "script" && f.status !== "writing" ? [chip(SHOT_WORDS[st.status])] : []),
      ...(v.models[card_.n] && f.status !== "script" ? [meta(v.models[card_.n]!, { size: 11 })] : []),
    ], { gap: 6, flexWrap: "wrap", alignItems: "center" }),
    st?.status === "failed" && st.error ? notice(plain(st.error), { mark: "close" }) : null,
    st?.status === "failed" ? quietButton("Try again", call("POST", `${CINEMA}/films/${f.id}/shots/${card_.n}/retry`, {}, { ok: seq(said("Trying that shot again."), refresh), fail: toast("Couldn't do that. Try again.") }), { size: "md" }) : null,
  ].filter((x): x is Node => !!x), { gap: 4, flexShrink: 1, flexGrow: 1 });
  return card([still ? row([still, words], { gap: 12, alignItems: "flex-start" }) : words], { gap: 8 });
}

function filmPage(ctx: BotsCtx, d: { view?: FilmView }) {
  const desk = isDesk(ctx);
  const v = d.view;
  if (!v) {
    return page(ctx, {
      back: true, backTitle: "Cinema", title: "Film", nav: CINEMA_SLUG,
      body: [notice("This film couldn't be read. It may have been deleted.", { mark: "close" }), secondaryButton("Back to Cinema", { kind: "navigate", screenId: SCREENS.bot, params: { slug: CINEMA_SLUG }, replace: true } as ActionSpec, { size: "md" })],
      gap: 18,
    });
  }
  const f: Film = v.film;
  const F = `${CINEMA}/films/${f.id}`;
  const cards = f.script?.shots ?? [];
  const done = f.shots.filter((s) => s.status === "ok").length;
  const body: Node[] = [
    col([
      text(v.title, { size: desk ? 22 : 20, weight: 600, lineHeight: 26 }),
      f.script?.bible.logline ? meta(plain(f.script.bible.logline), { size: 13, lineHeight: 18 }) : meta(plain(f.idea).slice(0, 160), { size: 13, lineHeight: 18 }),
      meta([statusLine({ status: f.status, hold: f.hold, shots: cards.length, done }), `${f.aspect}`, f.spentPaise ? `${rupees(f.spentPaise)} spent` : ""].filter(Boolean).join(" · "), { size: 12 }),
    ], { gap: 4 }),
  ];
  if (f.status === "failed") body.push(notice(plain(f.error) || "This film couldn't be made.", { mark: "close" }));

  if (f.status === "done" && f.cut.video && v.links[f.cut.video]) {
    const url = abs(v.links[f.cut.video]!);
    body.push(card([
      text(`Your film is ready${f.cut.seconds ? ` · ${Math.round(f.cut.seconds)}s` : ""}`, { size: 16, weight: 600, lineHeight: 21 }),
      row([
        primaryButton("Watch", { kind: "openUrl", url, external: true } as ActionSpec, { size: "md" }),
        secondaryButton("Download", { kind: "download", url, filename: `${v.title.replace(/[^\w -]+/g, "").trim() || "film"}.mp4` } as ActionSpec, { size: "md" }),
        secondaryButton("Share", { kind: "share", url, title: v.title } as ActionSpec, { size: "md" }),
      ], { gap: 8, flexWrap: "wrap" }),
      ...(f.cut.srt && v.links[f.cut.srt] ? [quietButton("Subtitles (.srt)", { kind: "openUrl", url: abs(v.links[f.cut.srt]!), external: true } as ActionSpec, { size: "md" })] : []),
    ], { gap: 10 }));
  }

  if (f.hold === "budget") {
    const add = Math.max(5_000, Math.ceil((v.price?.reserve ?? f.budgetPaise * 0.25) / 100) * 100);
    body.push(card([
      text("It needs a little more money to carry on", { size: 15, weight: 600, lineHeight: 20 }),
      meta(`${rupees(f.spentPaise)} of ${rupees(f.budgetPaise)} spent. What you don't use is never taken.`, { size: 13, lineHeight: 18 }),
      primaryButton(`Add ${rupees(add)}`, call("POST", `${F}/raise`, { paise: add }, { ok: seq(said("Carrying on."), refresh), fail: toast("Couldn't add that. Check today's limit.") }), { size: "md" }),
    ], { gap: 10 }));
  }

  if (f.status === "script" && f.script) {
    const b = f.script.bible;
    body.push(col([
      sectionLabel("The look"),
      text([b.look.palette, b.look.light, b.look.lens, b.look.stock].filter(Boolean).map(plain).join(" · "), { size: 14, lineHeight: 19 }),
      ...(b.characters.length ? [sectionLabel("Who's in it"), ...b.characters.map((c) => text(`${plain(c.name)}: ${plain(c.look)}; ${plain(c.wardrobe)}`, { size: 13, lineHeight: 18 }))] : []),
      ...(b.music ? [meta(`Music: ${plain(b.music)}`, { size: 12 })] : []),
    ], { gap: 6 }));
  }

  if (cards.length) body.push(col([sectionLabel(f.status === "script" ? "The shots" : "Storyboard"), ...cards.map((c) => shotCard(ctx, v, c))], { gap: 10 }));

  if (f.status === "script" && v.board) {
    body.push(card([
      text(`The storyboard costs ${rupees(v.board.paise)}`, { size: 15, weight: 600, lineHeight: 20 }),
      meta(`${v.board.stills} stills and ${v.board.sheets} reference pictures, so every face and place stays the same.${v.price ? ` The whole film will be about ${rupees(v.price.paise)}; you'll see the exact price with the storyboard.` : ""}`, { size: 13, lineHeight: 18 }),
      primaryButton(`Make the storyboard (${rupees(v.board.paise)})`, call("POST", `${F}/approve-script`, {}, { ok: seq(said("Drawing your storyboard."), refresh), fail: toast("Couldn't start. Check today's limit.") }), { size: "md" }),
    ], { gap: 10 }));
  }

  if (f.status === "board" && v.price) {
    body.push(card([
      text(`Filming costs up to ${rupees(v.price.paise)}`, { size: 15, weight: 600, lineHeight: 20 }),
      meta(`${rupees(v.price.video)} for ${cards.length} shots (${Math.round(v.price.seconds)}s), up to ${rupees(v.price.reserve)} for retakes the checker asks for, and ${rupees(v.price.extras)} for music. What isn't used is never taken.`, { size: 13, lineHeight: 18 }),
      primaryButton(`Film it (${rupees(v.price.paise)})`, call("POST", `${F}/approve-board`, {}, { ok: seq(said("Filming has started."), refresh), fail: toast("Couldn't start. Check today's limit.") }), { size: "md" }),
    ], { gap: 10 }));
  }

  if (f.script && f.status !== "writing" && f.status !== "stopped") {
    const revise = {
      kind: "condition", if: { truthy: "cf_note" },
      then: call("POST", `${F}/revise`, { note: "$state.cf_note", n: "$state.cf_n" }, { ok: seq(setState("cf_note", ""), said("Changed."), refresh), fail: toast("Couldn't make that change. Try saying it another way.") }),
      else: toast("Say what to change first."),
    } as ActionSpec;
    body.push(col([
      sectionLabel("Change something"),
      chips([{ label: "The whole film", value: "" }, ...cards.map((c) => ({ label: `Shot ${c.n}`, value: String(c.n) }))], "cf_n"),
      mailField("cf_note", "Say what to change, in your words", desk, { label: "the change", multiline: true, minHeight: 70, onSubmit: revise }),
      secondaryButton("Make the change", revise, { size: "md" }),
      meta("Only what the change touches is made again.", { size: 12 }),
    ], { gap: 8 }));
  }

  const keepers = f.script?.bible.characters.filter((c) => c.ref) ?? [];
  if (keepers.length && (f.status === "board" || f.status === "done")) {
    body.push(listCard(keepers.map((c) => listRow({
      label: `Keep ${plain(c.name)} in my cast`, sub: "Use them again in another film or picture",
      onPress: call("POST", `${F}/cast/${c.key}`, {}, { ok: said(`${plain(c.name)} is in your cast.`), fail: toast("Couldn't keep that. Try again.") }),
    })), { title: "Your cast" }));
  }

  if (f.notes.length) body.push(col([sectionLabel("Notes"), ...f.notes.slice(0, 5).map((n) => meta(plain(n), { size: 12, lineHeight: 16 }))], { gap: 4 }));

  const working = ["boarding", "rendering", "cutting"].includes(f.status);
  body.push(col([
    ...(working ? [quietButton("Stop", call("POST", `${F}/stop`, {}, { ok: seq(said("Stopped."), refresh), fail: toast("Couldn't stop it. Try again.") }), { size: "md" })] : []),
    when({ falsy: "cf_sure" }, quietButton("Delete this film", setState("cf_sure", true), { size: "md" })),
    when({ truthy: "cf_sure" }, card([
      text(`Delete ${v.title}?`, { size: 15, weight: 600, lineHeight: 20 }),
      meta("The film, its storyboard and its takes go for good.", { size: 13, lineHeight: 18 }),
      row([
        primaryButton("Delete", call("DELETE", F, undefined, { ok: { kind: "navigate", screenId: SCREENS.bot, params: { slug: CINEMA_SLUG }, replace: true } as ActionSpec, fail: toast("Couldn't delete it. Try again.") }), { size: "md" }),
        quietButton("Keep it", setState("cf_sure", false), { size: "md" }),
      ], { gap: 8 }),
    ], { gap: 10 })),
  ], { gap: 8 }));

  return page(ctx, {
    back: true, backTitle: "Cinema", title: v.title, nav: CINEMA_SLUG, ...(desk ? { maxWidth: 760 } : {}),
    body, gap: 18,
    live: [botTopic(CINEMA_SLUG)],
    state: { cf_note: "", cf_n: "", cf_sure: false },
  });
}

export const cinemaScreens: BotsScreen[] = [
  screen<{ view?: FilmView }>({
    id: SCREENS.cinemaFilm,
    load: async (ctx, deps: Deps) => {
      const f = idParam(ctx.params.f);
      return f ? { view: await deps.api<FilmView>("GET", `${CINEMA}/films/${f}`).catch(() => undefined) } : {};
    },
    build: (ctx, d) => filmPage(ctx, d ?? {}),
  }),
];
