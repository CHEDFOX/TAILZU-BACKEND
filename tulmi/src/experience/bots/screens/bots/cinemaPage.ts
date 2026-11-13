/**
 * THE CINEMA BOT'S PAGE (src/cinema, routes/bots/cinema.ts): bots.bot with slug "cinema". Its chat is the usual bots.chat; this is where films
 * and pictures are made.
 *
 *   the head       back, the bot's name, and a line: what is waiting for the person, else what it does
 *   waiting        first, the films that wait for the person (a script or a storyboard to say go to, a shot to look at, today's limit)
 *   a new film     what the film is (in their words); Length (15, 30, 60 seconds), Frame (wide, vertical, square) and Quality (draft, standard,
 *                  premium) as segmented controls; and Write the script. Nothing is made until they say go to the script, then the storyboard
 *   a picture      what the picture is, and Make it: a poster, a product shot, a portrait, a logo
 *   your films     the others, each with its first still, where it stands and what it cost; each opens its page (cinemaScreens.ts)
 *   your pictures  the latest, each opening full size
 *   your cast      the people kept from films, to use again
 *   the ask bar    the bots' own (parts.ts chatBar): "Ask about your films…" goes to the cinema bot's chat
 */
import type { ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import { botTopic } from "../../../../live/topics.js";
import type { BotTileSpec } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, page, row, col, text, box, icon, labelled, back, grow, card, meta, notice, primaryButton, C, botAvatar, botBuddy, botMoment,
  canBuddy, canMoments, listCard, listRow, sectionLabel, open, SCREENS, call, seq, segmented, picture,
} from "../../kit.js";
import { toast } from "../firstRun/parts.js";
import { mailField } from "./mailCards.js";
import { abs, CINEMA, openFilm, statusLine, waitsForYou, type CinemaData } from "./cinemaScreens.js";
import { type BotPageData, chatBar, isDesk, lookOf, setState } from "./parts.js";

export type CinemaPageData = BotPageData & { cinema?: CinemaData };

/** The avatar the cinema bot wears (shared/bots/looks.json). */
export const DIRECTOR = "director";

/**
 * Its Home tile: the director, clapping his board over and over (the catalog's c.clap), the way the postie files his letters. A build that
 * plays no moments gets the tile as it was.
 */
export function cinemaTileLook(ctx: BotsCtx): Pick<BotTileSpec, "avatar" | "moment" | "momentMode"> {
  if (!canMoments(ctx)) return {};
  const m = botMoment(ctx, "c.clap", "loop");
  return { avatar: DIRECTOR, ...(m.moment ? { moment: m.moment, ...(m.momentMode ? { momentMode: m.momentMode } : {}) } : {}) };
}

const said = (message: string): ActionSpec => ({ kind: "toast", message, tone: "success" } as ActionSpec);
const refresh: ActionSpec = { kind: "refresh" };
const plain = (s: string | null | undefined): string => String(s ?? "").trim().replace(/^[@\s]+/, "");

export function cinemaPage(ctx: BotsCtx, d: CinemaPageData) {
  const bot = d.bot!;
  const look = lookOf(bot.slug, bot.colour);
  const o = d.cinema?.overview;
  const desk = isDesk(ctx);

  const waiting = o?.films.find((f) => f.hold || f.status === "script" || f.status === "board");
  const line = waiting ? `${plain(waiting.title)}: ${statusLine(waiting)}` : "Films and pictures from your words";
  const name = col([
    text(bot.name, { size: desk ? 17 : 19, weight: 600, lineHeight: desk ? 22 : 24 }),
    meta(line, { size: 12, lines: 1 }),
  ], { gap: 1, flexShrink: 1 });
  const head = desk
    ? row([botAvatar(look, 30), name, grow()], { gap: 10 })
    : row([labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back"), name, grow()], { gap: 6 });

  const body: Node[] = [head];
  if (!o) {
    body.push(notice("Your films couldn't be read just now. Pull to try again.", { mark: "close" }));
  } else {
    const filmRow = (f: (typeof o.films)[number]) => listRow({
      label: plain(f.title) || "New film",
      sub: [statusLine(f), f.seconds ? `${Math.round(f.seconds)}s` : ""].filter(Boolean).join(" · "),
      strong: waitsForYou(f),
      ...(f.poster ? { left: picture(abs(f.poster), 44, 44, { radius: 8, fit: "cover", background: C.surface }) } : {}),
      onPress: openFilm(f.id),
    });
    const waiting = o.films.filter(waitsForYou);
    if (waiting.length) body.push(listCard(waiting.map(filmRow), { title: "Waiting for you" }));

    const write = {
      kind: "condition", if: { truthy: "cn_idea" },
      then: call("POST", `${CINEMA}/films`, { idea: "$state.cn_idea", length: "$state.cn_len", aspect: "$state.cn_aspect", tier: "$state.cn_tier" }, {
        ok: seq(setState("cn_idea", ""), said("Writing your script. It takes about a minute."), refresh),
        fail: toast("Couldn't start the film. Try again."),
      }),
      else: toast("Say what the film is about first."),
    } as ActionSpec;
    const option = (label: string, control: Node) => row([meta(label, { size: 12, style: { width: 62 } }), box([control], { flexGrow: 1, flexShrink: 1 })], { gap: 10, alignItems: "center" });
    body.push(col([
      sectionLabel("A new film"),
      mailField("cn_idea", "What happens, who is in it, and where it is for. “A 30 second ad for my chai stall in the Mumbai rain.”", desk, { label: "the film", multiline: true, minHeight: 84, onSubmit: write }),
      option("Length", segmented([{ label: "15 s", value: "15" }, { label: "30 s", value: "30" }, { label: "60 s", value: "60" }], "cn_len")),
      option("Frame", segmented([{ label: "Wide", value: "16:9" }, { label: "Vertical", value: "9:16" }, { label: "Square", value: "1:1" }], "cn_aspect")),
      option("Quality", segmented([{ label: "Draft", value: "draft" }, { label: "Standard", value: "standard" }, { label: "Premium", value: "premium" }], "cn_tier")),
      row([primaryButton("Write the script", write, { size: "md" })]),
      meta("You read the script and see the storyboard before anything is filmed.", { size: 12 }),
    ], { gap: 10 }));

    const make = {
      kind: "condition", if: { truthy: "cn_pic" },
      then: call("POST", `${CINEMA}/pictures`, { words: "$state.cn_pic" }, {
        ok: seq(setState("cn_pic", ""), said("Your picture is ready."), refresh),
        fail: toast("Couldn't make that picture. Try again."),
      }),
      else: toast("Say what the picture should show first."),
    } as ActionSpec;
    body.push(col([
      sectionLabel("A picture"),
      mailField("cn_pic", "A poster, a product shot, a portrait, a logo…", desk, { label: "the picture", onSubmit: make }),
      row([primaryButton("Make it", make, { size: "md" })]),
    ], { gap: 10 }));

    if (!o.films.length && !o.pictures.length) {
      const him = canBuddy(ctx)
        ? botBuddy({ kind: "custom", color: look.color, life: "page.cinema", width: desk ? 170 : 120, height: desk ? 78 : 66, size: desk ? 42 : 36, state: "idle", avatar: DIRECTOR, ...botMoment(ctx, "c.frame", "loop") })
        : row([icon("spark", { size: 28, color: look.color })], { justifyContent: "center" });
      body.push(card([
        row([him], { justifyContent: "center" }),
        text("Say what you want to see. A director writes the shots, you look over the storyboard, and each shot is filmed by the camera that suits it, checked, and cut together with voice-over and music.", { size: 14, color: C.ink, align: "center", lineHeight: 20 }),
      ], { dashed: true, gap: 10, padding: 22, style: { alignItems: "center" } }));
    }

    const rest = o.films.filter((f) => !waitsForYou(f));
    if (rest.length) body.push(listCard(rest.map(filmRow), { title: "Your films" }));

    if (o.pictures.length) {
      body.push(col([
        sectionLabel("Your pictures"),
        row(o.pictures.slice(0, 12).map((p) => box([picture(abs(p.url), desk ? 120 : 96, desk ? 120 : 96, { radius: 10, fit: "cover", background: C.surface, label: plain(p.words).slice(0, 60) })], {},
          { kind: "openUrl", url: abs(p.url), external: true } as ActionSpec)), { gap: 8, flexWrap: "wrap" }),
      ], { gap: 8 }));
    }

    if (o.cast.length) {
      body.push(listCard(o.cast.map((c) => listRow({
        label: plain(c.name), sub: plain(c.look).slice(0, 80),
        ...(c.url ? { left: picture(abs(c.url), 40, 40, { radius: 20, fit: "cover", background: C.surface }) } : {}),
        chevron: false,
      })), { title: "Your cast" }));
    }

  }

  return page(ctx, {
    back: desk, title: bot.name, nav: bot.slug, ...(desk ? { maxWidth: 720 } : {}),
    body,
    footer: o ? [chatBar(ctx, bot.slug, bot.name, "Ask about your films…", open(SCREENS.chat, { slug: bot.slug }))] : [],
    gap: 18,
    live: [botTopic(bot.slug)],
    state: { cn_idea: "", cn_pic: "", cn_len: "30", cn_aspect: "16:9", cn_tier: "standard" },
  });
}
