/**
 * THE CINEMA BOT'S FILM AND SHOT PAGES (src/cinema, routes/bots/cinema.ts), and what its bot page reads.
 *
 *   bots.cinema.film   params f: one film, as far as it has come. Top to bottom, the thing to decide first:
 *     the head         the title, the logline, where it stands in words, the frame and what it has cost
 *     the decision     what the film waits for, as one card at the top: the storyboard's price and Make the storyboard (script); the film's
 *                      price, what is kept back for retakes, and Film it (board); Add ₹… (more money); the film itself, its first still with
 *                      a play mark, Watch, Download, Share and the subtitles (done); otherwise what is happening now, in a line
 *     the script       (script) the look in a line, who is in it, and the shots as a numbered list, each opening its shot page
 *     the storyboard   (after) the stills as a grid, the way a storyboard is pinned up: each tile its still, its number, size and seconds, a
 *                      mark for where it stands (waiting, working, done, needs you) and what happens; each opens its shot page
 *     change           a change to the whole film in plain words (a change to one shot is on its page)
 *     your cast, notes, Stop, Delete (a second yes)
 *
 *   bots.cinema.shot   params f, n: one shot. Its still, large; where it stands, the model and the seconds; its card in full (what happens,
 *                      the acting, the camera, the composition, the light, the air, how it ends, the lines, the voice-over, the sound, what it
 *                      is for); the takes tried, each with the model, the checker's mark and what it said; Try again when it gave up; and a
 *                      change to this shot only.
 *
 * The bot's page itself is cinemaPage.ts. Every still and film is opened by a signed link of ours (src/cinema/media.ts), made fresh each
 * time a page is drawn.
 */
import type { ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import { mean } from "../../../../cinema/qc.js";
import type { CinemaOverview, FilmView } from "../../../../cinema/service.js";
import { CINEMA_SLUG, type Film, type FilmRow, type ShotCard, type ShotStatus, type Take } from "../../../../cinema/types.js";
import { botTopic } from "../../../../live/topics.js";
import {
  type BotsCtx, type Mark, page, row, col, box, text, card, meta, notice, primaryButton, secondaryButton, quietButton, sectionLabel, listCard, listRow,
  call, seq, when, picture, shapes, statusMark, SCREENS, C,
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

/** A link of ours as a full address (the apps open full addresses); a full address or a data URL as it is. */
export const abs = (path: string): string => (/^(https?:\/\/|data:)/.test(path) ? path : `${process.env.PUBLIC_ORIGIN || "https://api.x0bot.com"}${path}`);
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
const openShot = (f: string, n: number): ActionSpec => ({ kind: "navigate", screenId: SCREENS.cinemaShot, params: { f, n: String(n) } });
const toCinema: ActionSpec = { kind: "navigate", screenId: SCREENS.bot, params: { slug: CINEMA_SLUG }, replace: true };

/** Whether a film waits for the person: a script or a storyboard to approve, more money, a shot to look at. */
export const waitsForYou = (f: Pick<FilmRow, "status" | "hold">): boolean => !!f.hold || f.status === "script" || f.status === "board";

/** Where a film stands, in words. */
export function statusLine(f: Pick<FilmRow, "status" | "hold" | "shots" | "done">): string {
  if (f.hold === "budget") return "Waiting for you: it needs a little more money";
  if (f.hold === "shot") return "Waiting for you: a shot needs a look";
  switch (f.status) {
    case "writing": return "Writing the script…";
    case "script": return "Script ready: read it and say go";
    case "boarding": return "Drawing the storyboard…";
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
const SHOT_MARK: Record<ShotStatus, Mark> = {
  planned: "waiting", boarding: "working", boarded: "done", queued: "waiting", rendering: "working", checking: "working", ok: "done", failed: "needs",
};

const SIZE_WORDS: Record<ShotCard["size"], string> = {
  "extreme-wide": "Extreme wide", wide: "Wide", full: "Full", medium: "Medium", "medium-close": "Medium close", close: "Close-up", "extreme-close": "Extreme close-up", insert: "Insert",
};

/** A model's id in words: "kwaivgi/kling-v3.0-std" is "Kling v3.0 Std". */
export const modelName = (id: string): string =>
  (id.split("/").pop() ?? id).split("-").map((w) => (/^v?\d/.test(w) ? w : `${w[0]?.toUpperCase() ?? ""}${w.slice(1)}`)).join(" ");

/** A still's height for a width, by the film's frame. */
const heightFor = (w: number, aspect: Film["aspect"]): number => Math.round(aspect === "9:16" ? (w * 16) / 9 : aspect === "1:1" ? w : (w * 9) / 16);

/** How wide a storyboard tile is, so the grid fills the page: four or three across in the window, two on the phone. */
function tileWidth(ctx: BotsCtx, aspect: Film["aspect"]): number {
  if (isDesk(ctx)) return aspect === "9:16" ? 168 : 228;
  return 163;
}

/** A still, or a quiet box where it will be. */
function stillOrSpace(v: FilmView, key: string | null | undefined, w: number, label: string): Node {
  const url = key ? v.links[key] : undefined;
  const h = heightFor(w, v.film.aspect);
  return url
    ? picture(abs(url), w, h, { radius: 10, fit: "cover", background: C.surface, label })
    : box([meta("Drawing…", { size: 12 })], { width: w, height: h, borderRadius: 10, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" });
}

/** One tile of the storyboard: the still, the number, size and seconds with where it stands, and what happens. Opens the shot. */
function tile(ctx: BotsCtx, v: FilmView, c: ShotCard): Node {
  const st = v.film.shots.find((s) => s.n === c.n);
  const w = tileWidth(ctx, v.film.aspect);
  const status = st?.status ?? "planned";
  return box([
    stillOrSpace(v, st?.still, w, `Shot ${c.n}`),
    row([
      statusMark(SHOT_MARK[status], { size: 8, still: true }),
      text(String(c.n), { size: 13, weight: 600, lineHeight: 17 }),
      meta(`${SIZE_WORDS[c.size]} · ${c.seconds}s`, { size: 12, lines: 1 }),
    ], { gap: 6, alignItems: "center" }),
    text(plain(c.action), { size: 13, lineHeight: 17, lines: 2 }),
    status === "failed" ? meta(SHOT_WORDS.failed, { size: 12, color: C.ink }) : null,
  ].filter((x): x is Node => !!x), { width: w, gap: 6, flexDirection: "column" }, openShot(v.film.id, c.n));
}

/** The finished film: its first still with a play mark, opening the film. */
function hero(ctx: BotsCtx, v: FilmView, url: string): Node {
  const f = v.film;
  const desk = isDesk(ctx);
  const w = f.aspect === "9:16" ? (desk ? 260 : 200) : desk ? 560 : 330;
  const h = heightFor(w, f.aspect);
  const poster = f.shots.find((s) => s.still)?.still;
  const play = shapes([{ circle: [24, 24, 24], fill: "#000000", opacity: 0.55 }, { d: "M19 15.5v17l14-8.5z", fill: "#ffffff" }], { size: 56, viewBox: "0 0 48 48", label: "Play" });
  return box([
    poster && v.links[poster] ? picture(abs(v.links[poster]!), w, h, { radius: 14, fit: "cover", background: C.surface }) : box([], { width: w, height: h, borderRadius: 14, backgroundColor: C.ink }),
    box([play], { position: "absolute", top: 0, left: 0, width: w, height: h, alignItems: "center", justifyContent: "center" }),
  ], { width: w, height: h, alignSelf: "flex-start" }, { kind: "openUrl", url, external: true } as ActionSpec);
}

/** What the film waits for, or what is happening now: one card at the top. */
function decision(ctx: BotsCtx, v: FilmView): Node | null {
  const f = v.film;
  const F = `${CINEMA}/films/${f.id}`;
  const cards = f.script?.shots ?? [];
  if (f.status === "done" && f.cut.video && v.links[f.cut.video]) {
    const url = abs(v.links[f.cut.video]!);
    return col([
      hero(ctx, v, url),
      row([
        primaryButton("Watch", { kind: "openUrl", url, external: true } as ActionSpec, { size: "md" }),
        secondaryButton("Download", { kind: "download", url, filename: `${v.title.replace(/[^\w -]+/g, "").trim() || "film"}.mp4` } as ActionSpec, { size: "md" }),
        // The phone shares through its share sheet; the window has none, so it copies the link.
        isDesk(ctx)
          ? secondaryButton("Copy link", { kind: "copyText", text: url, message: "Link copied" }, { size: "md" })
          : secondaryButton("Share", { kind: "share", url, title: v.title } as ActionSpec, { size: "md" }),
      ], { gap: 8, flexWrap: "wrap" }),
      ...(f.cut.srt && v.links[f.cut.srt] ? [quietButton("Subtitles (.srt)", { kind: "openUrl", url: abs(v.links[f.cut.srt]!), external: true } as ActionSpec, { size: "md" })] : []),
    ], { gap: 12 });
  }
  if (f.hold === "budget") {
    const add = Math.max(5_000, Math.ceil((v.price?.reserve ?? f.budgetPaise * 0.25) / 100) * 100);
    return card([
      text("It needs a little more money to carry on", { size: 15, weight: 600, lineHeight: 20 }),
      meta(`${rupees(f.spentPaise)} of ${rupees(f.budgetPaise)} spent. What you don't use is never taken.`, { size: 13, lineHeight: 18 }),
      primaryButton(`Add ${rupees(add)}`, call("POST", `${F}/raise`, { paise: add }, { ok: seq(said("Carrying on."), refresh), fail: toast("Couldn't add that. Check today's limit.") }), { size: "md" }),
    ], { gap: 10 });
  }
  if (f.status === "script" && v.board) {
    return card([
      text(`The storyboard costs ${rupees(v.board.paise)}`, { size: 16, weight: 600, lineHeight: 21 }),
      meta(`${v.board.stills} stills and ${v.board.sheets} reference pictures, so every face and place stays the same.${v.price ? ` The whole film will be about ${rupees(v.price.paise)}; you'll see the exact price with the storyboard.` : ""}`, { size: 13, lineHeight: 18 }),
      primaryButton(`Make the storyboard · ${rupees(v.board.paise)}`, call("POST", `${F}/approve-script`, {}, { ok: seq(said("Drawing your storyboard."), refresh), fail: toast("Couldn't start. Check today's limit.") }), { size: "md" }),
      meta("Read the shots below first. Change anything in your words before you say go.", { size: 12 }),
    ], { gap: 10 });
  }
  if (f.status === "board" && v.price) {
    return card([
      text(`Filming costs up to ${rupees(v.price.paise)}`, { size: 16, weight: 600, lineHeight: 21 }),
      meta(`${rupees(v.price.video)} for ${cards.length} shots (${Math.round(v.price.seconds)}s), up to ${rupees(v.price.reserve)} for retakes the checker asks for, ${rupees(v.price.extras)} for music. What isn't used is never taken.`, { size: 13, lineHeight: 18 }),
      primaryButton(`Film it · ${rupees(v.price.paise)}`, call("POST", `${F}/approve-board`, {}, { ok: seq(said("Filming has started."), refresh), fail: toast("Couldn't start. Check today's limit.") }), { size: "md" }),
    ], { gap: 10 });
  }
  const now: Partial<Record<Film["status"], string>> = {
    writing: "The director is writing your script. It takes about a minute.",
    boarding: `Drawing the storyboard: ${f.shots.filter((s) => s.still).length} of ${cards.length} stills.`,
    rendering: `Filming: ${f.shots.filter((s) => s.status === "ok").length} of ${cards.length} shots done. Every take is checked before you see it.`,
    cutting: "Cutting the film: the voice-over, the music and the subtitles.",
  };
  return now[f.status] ? card([row([statusMark("working", { size: 10 }), text(now[f.status]!, { size: 14, lineHeight: 19 })], { gap: 10, alignItems: "center" })], { gap: 8 }) : null;
}

function filmPage(ctx: BotsCtx, d: { view?: FilmView }) {
  const desk = isDesk(ctx);
  const v = d.view;
  if (!v) {
    return page(ctx, {
      back: true, backTitle: "Cinema", title: "Film", nav: CINEMA_SLUG,
      body: [notice("This film couldn't be read. It may have been deleted.", { mark: "close" }), secondaryButton("Back to Cinema", toCinema, { size: "md" })],
      gap: 18,
    });
  }
  const f: Film = v.film;
  const F = `${CINEMA}/films/${f.id}`;
  const cards = f.script?.shots ?? [];
  const done = f.shots.filter((s) => s.status === "ok").length;
  const body: Node[] = [
    col([
      text(v.title, { size: desk ? 24 : 21, weight: 600, lineHeight: 28 }),
      f.script?.bible.logline ? meta(plain(f.script.bible.logline), { size: 13, lineHeight: 18 }) : meta(plain(f.idea).slice(0, 160), { size: 13, lineHeight: 18 }),
      meta([statusLine({ status: f.status, hold: f.hold, shots: cards.length, done }), f.aspect, f.spentPaise ? `${rupees(f.spentPaise)} spent` : ""].filter(Boolean).join(" · "), { size: 12 }),
    ], { gap: 4 }),
  ];
  if (f.status === "failed") body.push(notice(plain(f.error) || "This film couldn't be made.", { mark: "close" }));
  const top = decision(ctx, v);
  if (top) body.push(top);

  if (f.status === "script" && f.script) {
    const b = f.script.bible;
    body.push(col([
      sectionLabel("The look"),
      text([b.look.palette, b.look.light, b.look.stock].filter(Boolean).map(plain).join(" · "), { size: 14, lineHeight: 19 }),
      ...(b.characters.length ? [
        sectionLabel("Who's in it"),
        ...b.characters.map((c) => col([text(plain(c.name), { size: 14, weight: 600, lineHeight: 18 }), meta(plain(c.look), { size: 12, lineHeight: 16, lines: 2 })], { gap: 2 })),
      ] : []),
    ], { gap: 8 }));
    body.push(listCard(cards.map((c) => listRow({
      label: `${c.n}. ${plain(c.action)}`,
      sub: `${SIZE_WORDS[c.size]} · ${c.move.replace("-", " ")} · ${c.seconds}s${c.lines.length ? " · lines" : ""}${c.vo ? " · voice-over" : ""}`,
      onPress: openShot(f.id, c.n),
    })), { title: "The shots" }));
  } else if (cards.length) {
    body.push(col([sectionLabel("Storyboard"), row(cards.map((c) => tile(ctx, v, c)), { gap: 12, flexWrap: "wrap", alignItems: "flex-start" })], { gap: 10 }));
  }

  if (f.script && f.status !== "writing" && f.status !== "stopped") {
    const revise = {
      kind: "condition", if: { truthy: "cf_note" },
      then: call("POST", `${F}/revise`, { note: "$state.cf_note" }, { ok: seq(setState("cf_note", ""), said("Changed."), refresh), fail: toast("Couldn't make that change. Try saying it another way.") }),
      else: toast("Say what to change first."),
    } as ActionSpec;
    body.push(col([
      sectionLabel("Change the film"),
      mailField("cf_note", "Say what to change, in your words. To change one shot, open it.", desk, { label: "the change", multiline: true, minHeight: 64, onSubmit: revise }),
      row([secondaryButton("Make the change", revise, { size: "md" })]),
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
        primaryButton("Delete", call("DELETE", F, undefined, { ok: toCinema, fail: toast("Couldn't delete it. Try again.") }), { size: "md" }),
        quietButton("Keep it", setState("cf_sure", false), { size: "md" }),
      ], { gap: 8 }),
    ], { gap: 10 })),
  ], { gap: 8 }));

  return page(ctx, {
    back: true, backTitle: "Cinema", title: v.title, nav: CINEMA_SLUG, ...(desk ? { maxWidth: 760 } : {}),
    body, gap: 20,
    live: [botTopic(CINEMA_SLUG)],
    state: { cf_note: "", cf_sure: false },
  });
}

/** One labelled part of a shot's card, or nothing when it is empty. */
const part = (label: string, value: string | null | undefined): Node | null =>
  plain(value) ? col([sectionLabel(label), text(plain(value), { size: 14, lineHeight: 20 })], { gap: 4 }) : null;

/** A take, as the checker saw it. */
function takeRow(t: Take, i: number, people: boolean, chosen: boolean): Node {
  const score = t.verdict ? `${mean(t.verdict, people).toFixed(1)}/10` : "";
  const sub = t.status === "running" ? "Filming…"
    : t.status === "failed" ? `The video service failed${t.error ? `: ${plain(t.error)}` : ""}`
    : !t.verdict ? "Being checked…"
    : chosen ? (t.verdict.pass ? "Kept: it passed the check" : `Kept as the best${t.verdict.issues[0] ? `; ${plain(t.verdict.issues[0].note)}` : ""}`)
    : t.verdict.pass ? "Passed" : `Sent back${t.verdict.issues[0] ? `: ${plain(t.verdict.issues[0].note)}` : ""}`;
  return listRow({ label: [`Take ${i}`, modelName(t.model), score].filter(Boolean).join(" · "), sub, strong: chosen, chevron: false });
}

function shotPage(ctx: BotsCtx, d: { view?: FilmView; n?: number }) {
  const desk = isDesk(ctx);
  const v = d.view;
  const c = v?.film.script?.shots.find((s) => s.n === d.n);
  if (!v || !c) {
    return page(ctx, {
      back: true, backTitle: "Film", title: "Shot", nav: CINEMA_SLUG,
      body: [notice("This shot couldn't be read. The film may have changed.", { mark: "close" }), secondaryButton("Back to Cinema", toCinema, { size: "md" })],
      gap: 18,
    });
  }
  const f = v.film;
  const F = `${CINEMA}/films/${f.id}`;
  const st = f.shots.find((s) => s.n === c.n);
  const bible = f.script!.bible;
  const who = (k: string) => bible.characters.find((x) => x.key === k)?.name ?? k;
  const status = st?.status ?? "planned";
  const w = f.aspect === "9:16" ? (desk ? 300 : 230) : desk ? 560 : 350;
  const mine = f.takes.filter((t) => t.n === c.n).slice(-5);
  const body: Node[] = [
    col([
      text(`Shot ${c.n}`, { size: desk ? 24 : 21, weight: 600, lineHeight: 28 }),
      meta(`${SIZE_WORDS[c.size]} · ${c.move.replace("-", " ")} · ${c.seconds}s · ${v.title}`, { size: 12 }),
    ], { gap: 4 }),
    stillOrSpace(v, st?.still, w, `Shot ${c.n}`),
    row([
      statusMark(SHOT_MARK[status], { size: 8, still: true }),
      meta([SHOT_WORDS[status], v.models[c.n]].filter(Boolean).join(" · "), { size: 13 }),
    ], { gap: 8, alignItems: "center" }),
  ];
  if (status === "failed") {
    body.push(notice(plain(st?.error) || "This shot didn't come out right.", { mark: "close" }));
    body.push(row([primaryButton("Try again", call("POST", `${F}/shots/${c.n}/retry`, {}, { ok: seq(said("Trying that shot again."), refresh), fail: toast("Couldn't do that. Try again.") }), { size: "md" })]));
  }
  body.push(...[
    part("For", c.intent),
    part("What happens", c.action),
    part("The acting", c.performance),
    part("The camera", [`${SIZE_WORDS[c.size]}, ${c.angle} angle, ${c.lens}mm`, plain(c.camera) || c.move.replace("-", " ")].join(". ")),
    part("The frame", [c.frame, c.composition].filter(Boolean).join(" ")),
    part("The light", c.light),
    part("In the air", c.atmosphere),
    part("It ends on", c.end),
    c.lines.length ? col([sectionLabel("Lines"), ...c.lines.map((l) => text(`${who(l.who)}: “${plain(l.text)}”`, { size: 14, lineHeight: 20 }))], { gap: 4 }) : null,
    part("Voice-over", c.vo ? `“${c.vo}”` : null),
    part("Sound", c.sound),
  ].filter((x): x is Node => !!x));
  if (mine.length) {
    const all = f.takes.filter((t) => t.n === c.n);
    body.push(listCard(mine.map((t) => takeRow(t, all.indexOf(t) + 1, c.cast.length > 0, st?.take === t.id)), { title: "Takes" }));
  }
  if (f.status !== "writing" && f.status !== "stopped") {
    const revise = {
      kind: "condition", if: { truthy: "cs_note" },
      then: call("POST", `${F}/revise`, { note: "$state.cs_note", n: c.n }, { ok: seq(setState("cs_note", ""), said("Changed. Only this shot is made again."), refresh), fail: toast("Couldn't make that change. Try saying it another way.") }),
      else: toast("Say what to change first."),
    } as ActionSpec;
    body.push(col([
      sectionLabel("Change this shot"),
      mailField("cs_note", "“Slower, and she smiles at the end.”", desk, { label: "the change", multiline: true, minHeight: 64, onSubmit: revise }),
      row([secondaryButton("Make the change", revise, { size: "md" })]),
    ], { gap: 8 }));
  }
  return page(ctx, {
    back: true, backTitle: v.title, title: `Shot ${c.n}`, nav: CINEMA_SLUG, ...(desk ? { maxWidth: 680 } : {}),
    body, gap: 18,
    live: [botTopic(CINEMA_SLUG)],
    state: { cs_note: "" },
  });
}

const loadFilm = async (ctx: BotsCtx, deps: Deps): Promise<FilmView | undefined> => {
  const f = idParam(ctx.params.f);
  return f ? deps.api<FilmView>("GET", `${CINEMA}/films/${f}`).catch(() => undefined) : undefined;
};

export const cinemaScreens: BotsScreen[] = [
  screen<{ view?: FilmView }>({
    id: SCREENS.cinemaFilm,
    load: async (ctx, deps: Deps) => ({ view: await loadFilm(ctx, deps) }),
    build: (ctx, d) => filmPage(ctx, d ?? {}),
  }),
  screen<{ view?: FilmView; n?: number }>({
    id: SCREENS.cinemaShot,
    load: async (ctx, deps: Deps) => ({ view: await loadFilm(ctx, deps), n: Number(ctx.params.n) }),
    build: (ctx, d) => shotPage(ctx, d ?? {}),
  }),
];
