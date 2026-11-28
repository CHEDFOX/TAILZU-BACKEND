/**
 * THE CINEMA BOT WHILE FILMS ARE OFF: AN IDEA, SEEN AS A PICTURE, THEN BUILT IN 3D (CINEMA_FILMS, cinema/films.ts;
 * docs/cinema-3d.md §2a). bots.bot with slug "cinema" draws this page in place of the film page.
 *
 *   cinema3dPage   the head; what is building (or just finished) in a card over the page; "An idea" and Show me, which makes a
 *                  picture; their ideas, each a picture with Make it 3D (or See it in 3D once it is built); their 3D creations
 *   bots.cinema.scene (params: s)   one creation: the idea's picture, the 3D of it, the thing from every side, how it is coming on
 *                  while it builds, and another version in their words
 *
 * THE PICTURE COMES FIRST, ON PURPOSE. Words are a poor way to agree on a shape; a picture is a good one. The person sees the idea,
 * keeps the one they like, and only then is anything built: the 3D loop reads that picture into what to build and checks every
 * render against it (scene/brief.ts, scene/eye.ts). So what comes out looks like what they chose, not like a guess at their words.
 *
 * In the app's look: ink on paper; pictures and renders large, because they are the point; the director over the page.
 */
import type { ActionSpec, Node, ScreenResponse } from "../../../../../../shared/types/sdui.js";
import { botTopic } from "../../../../live/topics.js";
import {
  type BotsCtx, page, row, col, text, box, icon, labelled, back, grow, card, meta, notice, primaryButton, button, C, botAvatar, botBuddy,
  botMoment, canBuddy, listCard, listRow, sectionLabel, open, SCREENS, call, seq, picture, emptyState,
} from "../../kit.js";
import { screen, type BotsScreen } from "../../registry.js";
import { toast } from "../firstRun/parts.js";
import { mailField } from "./mailCards.js";
import { abs, CINEMA } from "./cinemaScreens.js";
import { loadScene, sceneLine, SCENES, type SceneView } from "./cinema3dData.js";
import { type BotPageData, chatBar, isDesk, lookOf, setState } from "./parts.js";
import type { CinemaPageData } from "./cinemaPage.js";
import { openMedia } from "../media.js";

const DIRECTOR = "director";
const said = (message: string): ActionSpec => ({ kind: "toast", message, tone: "success" } as ActionSpec);
const refresh: ActionSpec = { kind: "refresh" };
const plain = (s: string | null | undefined): string => String(s ?? "").trim().replace(/^[@\s]+/, "");
/** A picture of theirs, whole, in the viewer: Save to Photos, Share (screens/media.ts). */
const viewPicture = (url: string, words: string): ActionSpec => openMedia({ url: abs(url), name: `${(words || "Picture").slice(0, 60)}.png`, mime: "image/png" });
const openScene = (id: string): ActionSpec => ({ kind: "navigate", screenId: SCREENS.cinemaScene, params: { s: id } });

/**
 * A picture the width of its column, on grey while it loads. `whole` fits it inside the frame instead of filling it: a render
 * or an idea is shown whole (a tall bottle in a wide frame must not lose its top), a card's cover can be cropped.
 */
function wide(url: string, height: number, radius = 14, label = "", whole = false): Node {
  return box([{ type: "Image", props: { source: { url: abs(url) }, contentFit: whole ? "contain" : "cover", radius: 0, accessibilityLabel: label }, style: { width: "100%", height: "100%" } } as Node], {
    width: "100%", height, borderRadius: radius, overflow: "hidden", backgroundColor: C.surface,
  });
}

/** The best picture a creation has: its real render, else its latest preview, else the idea it came from. */
const shotOf = (s: SceneView): string | undefined => s.picture ?? s.preview ?? s.reference;

/** Build this picture in 3D. The server reads the picture into what to build; a busy or missing renderer is said in words. */
const make3d = (pictureId: string): ActionSpec => call("POST", SCENES, { picture: pictureId }, {
  ok: seq(said("Building it in 3D. It shows here as it goes, a few minutes in all."), refresh),
  fail: toast("Couldn't start that. If something is already building, wait for it to finish."),
}) as ActionSpec;

/**
 * WHAT IS BUILDING, OVER THE PAGE: the creation in the works with its latest preview and the round it is on, the director framing
 * it with his hands; or the one that just finished, with him throwing it in the air. Nothing to say, no card.
 */
function heroCard(ctx: BotsCtx, look: { color: string }, scenes: readonly SceneView[], desk: boolean): Node | null {
  const working = scenes.find((s) => s.status === "working");
  const fresh = !working ? scenes.find((s) => s.status === "done" && ctx.live.now - s.at < 6 * 3_600_000) : undefined;
  const s = working ?? fresh;
  if (!s) return null;
  const him = canBuddy(ctx)
    ? [botBuddy({
      kind: "custom", color: look.color, life: "page.cinema", width: desk ? 110 : 72, height: desk ? 56 : 50, size: desk ? 34 : 28,
      state: "idle", avatar: DIRECTOR, lookTo: "down", ...botMoment(ctx, working ? "c.frame" : "c.premiere", working ? "loop" : "once"),
    })]
    : [];
  const shot = shotOf(s);
  return card([
    ...(shot ? [wide(shot, desk ? 300 : 240, 14, "", true)] : []),
    row([col([
      text(plain(s.ask).slice(0, 70) || "Your idea", { size: 16, weight: 600, lineHeight: 21, lines: 2 }),
      meta(working ? `${sceneLine(s)}. It checks each render against your picture.` : "Ready in 3D. See it from every side.", { size: 13, lineHeight: 18, lines: 2 }),
    ], { gap: 2, flexShrink: 1 }), grow(), ...him], { gap: 10, alignItems: "center" }),
    row([primaryButton(working ? "Watch it build" : "See it in 3D", openScene(s.id), { size: "md" })]),
  ], { gap: 12 });
}

export function cinema3dPage(ctx: BotsCtx, d: CinemaPageData): ScreenResponse {
  const bot = d.bot!;
  const look = lookOf(bot.slug, bot.colour);
  const o = d.cinema?.overview;
  const sc = d.cinema?.scenes;
  const scenes = sc?.scenes ?? [];
  const canRender = sc?.render.ok === true;
  const desk = isDesk(ctx);

  const name = col([
    text(bot.name, { size: desk ? 17 : 19, weight: 600, lineHeight: desk ? 22 : 24 }),
    meta("Your ideas, as pictures and in 3D", { size: 12, lines: 1 }),
  ], { gap: 1, flexShrink: 1 });
  const head = desk
    ? row([botAvatar(look, 30), name, grow()], { gap: 10 })
    : row([labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back"), name, grow()], { gap: 6 });

  const hero = heroCard(ctx, look, scenes, desk);
  const body: Node[] = [head, ...(hero ? [hero] : [])];
  if (!o) {
    body.push(notice("Your pictures couldn't be read just now. Pull to try again.", { mark: "close" }));
  } else {
    // AN IDEA: words in, a picture out. Nothing is built until they have seen it.
    const show = {
      kind: "condition", if: { truthy: "cn_pic" },
      then: call("POST", `${CINEMA}/pictures`, { words: "$state.cn_pic" }, {
        ok: seq(setState("cn_pic", ""), said("Here's your idea. Build it in 3D when it looks right."), refresh),
        fail: toast("Couldn't make that picture. Try again."),
      }),
      else: toast("Say what the idea is first."),
    } as ActionSpec;
    body.push(col([
      sectionLabel("An idea"),
      mailField("cn_pic", "A brass desk lamp with a green glass shade. A sneaker on a stone plinth. A tiny cabin in the snow.", desk, { label: "the idea", multiline: true, minHeight: 72, onSubmit: show }),
      row([primaryButton("Show me", show, { size: "md" })]),
      meta(canRender ? "You see it as a picture first. When it looks right, build it in 3D." : "You see it as a picture first. Building in 3D isn't available on this server yet.", { size: 12, lines: 2 }),
    ], { gap: 10 }));

    // THEIR IDEAS: each picture, large, with what to do next. One built already opens its 3D instead of building it twice.
    if (o.pictures.length) {
      const built = new Map(scenes.filter((s) => s.from).map((s) => [s.from!, s]));
      body.push(col([
        sectionLabel("Your ideas"),
        ...o.pictures.slice(0, 6).map((p) => {
          const s = built.get(p.id);
          const next = s
            ? button(s.status === "working" ? "Building in 3D…" : "See it in 3D", openScene(s.id), { kind: "secondary", size: "md", icon: "spark" })
            : canRender ? button("Make it 3D", make3d(p.id), { kind: "secondary", size: "md", icon: "spark" }) : null;
          return card([
            // A tap opens it whole in the viewer, to save or share (screens/media.ts).
            box([wide(p.url, desk ? 280 : 220, 12, plain(p.words).slice(0, 60))], {}, viewPicture(p.url, plain(p.words))),
            text(plain(p.words), { size: 14, lineHeight: 20, lines: 3 }),
            ...(next ? [row([next])] : []),
          ], { gap: 12, padding: 12 });
        }),
      ], { gap: 10 }));
    }

    // THEIR 3D: every creation, the newest first, each with its best picture and where it stands.
    if (scenes.length) {
      body.push(listCard(scenes.slice(0, 12).map((s) => {
        const shot = shotOf(s);
        return listRow({
          label: plain(s.ask).slice(0, 60) || "Your idea",
          sub: `${sceneLine(s)}${s.version > 1 ? ` · version ${s.version}` : ""}`,
          strong: s.status === "working",
          ...(shot ? { left: picture(abs(shot), 48, 48, { radius: 10, fit: "cover", background: C.surface }) } : {}),
          onPress: openScene(s.id),
        });
      }), { title: "Your 3D" }));
    }

    if (!o.pictures.length && !scenes.length) {
      const him = canBuddy(ctx)
        ? botBuddy({ kind: "custom", color: look.color, life: "page.cinema", width: desk ? 170 : 120, height: desk ? 78 : 66, size: desk ? 42 : 36, state: "idle", avatar: DIRECTOR, ...botMoment(ctx, "c.frame", "loop") })
        : row([icon("spark", { size: 28, color: look.color })], { justifyContent: "center" });
      body.push(card([
        row([him], { justifyContent: "center" }),
        text("Say what you want to see. You get it as a picture first; then I build that picture in 3D, render it, look at it, fix what's off, and show it to you from every side.", { size: 14, color: C.ink, align: "center", lineHeight: 20 }),
      ], { dashed: true, gap: 10, padding: 22, style: { alignItems: "center" } }));
    }
  }

  return page(ctx, {
    back: desk, title: bot.name, nav: bot.slug, ...(desk ? { maxWidth: 720 } : {}),
    body,
    footer: o ? [chatBar(ctx, bot.slug, bot.name, "Ask about your ideas…", open(SCREENS.chat, { slug: bot.slug }))] : [],
    gap: 18,
    live: [botTopic(bot.slug)],
    state: { cn_pic: "" },
  });
}

// ===================================================================== one creation

function scenePage(ctx: BotsCtx, s: SceneView | undefined): ScreenResponse {
  const desk = isDesk(ctx);
  if (!s) return page(ctx, { title: "3D", body: [emptyState({ title: "That isn't there", body: "It may have been made on another account." })], back: back() });
  const shot = s.picture ?? s.preview;
  const body: Node[] = [
    col([
      text(plain(s.ask).slice(0, 90) || "Your idea", { size: desk ? 24 : 22, weight: 700, lineHeight: desk ? 30 : 28, tracking: -0.3, lines: 3 }),
      meta(`${sceneLine(s)}${s.version > 1 ? ` · version ${s.version}` : ""}`, { size: 13 }),
    ], { gap: 4 }),
  ];

  // THE IDEA, AND THE 3D OF IT: the picture they chose above what was built from it, so the one can be held against the other.
  if (s.reference) {
    body.push(col([sectionLabel("Your idea"), wide(s.reference, desk ? 260 : 220, 14, "your idea", true)], { gap: 8 }));
  }
  if (shot) {
    body.push(col([
      sectionLabel(s.status === "working" ? "Building it" : "In 3D"),
      box([wide(shot, desk ? 440 : 380, 14, "the 3D render", true)], {}, viewPicture(shot, `${plain(s.ask).slice(0, 40)} · 3D`)),
      ...(s.status === "working" ? [meta("This is the latest look. Each round is checked against your idea and the next one puts right what was off.", { size: 12, lines: 3 })] : []),
    ], { gap: 8 }));
  } else if (s.status === "working") {
    body.push(card([text("Reading your idea and laying out the scene. The first look shows here in a minute or so.", { size: 14, lineHeight: 20 })]));
  }

  // FROM EVERY SIDE: the real render and the other angles of the same thing. This is what makes it 3D and not another picture.
  const sides = [s.picture, ...(s.views ?? [])].filter((x): x is string => !!x);
  if (s.status === "done" && sides.length > 1) {
    const size = desk ? 200 : 104;
    body.push(col([
      sectionLabel("From every side"),
      row(sides.map((u, i) => box([picture(abs(u), size, size, { radius: 12, fit: "contain", background: C.surface })], {}, viewPicture(u, `${plain(s.ask).slice(0, 40)} · side ${i + 1}`))), { gap: 8, flexWrap: "wrap" }),
    ], { gap: 8 }));
  }

  if (s.status === "failed") {
    body.push(notice("It couldn't be finished this time. Try again, or say what to change.", { mark: "close" }));
  }

  // ANOTHER VERSION, in their words: the next version starts from this scene and, when it came from a picture, that picture again.
  if (s.status !== "working") {
    const again = {
      kind: "condition", if: { truthy: "cn_change" },
      then: call("POST", SCENES, { creation: s.creation, ask: `${s.ask}\n\nChange: $state.cn_change` }, {
        ok: seq(setState("cn_change", ""), said("Building the new version."), { kind: "navigateBack" } as ActionSpec, refresh),
        fail: toast("Couldn't start that. Try again in a moment."),
      }),
      else: call("POST", SCENES, { creation: s.creation, ask: s.ask }, {
        ok: seq(said("Building it again."), { kind: "navigateBack" } as ActionSpec, refresh),
        fail: toast("Couldn't start that. Try again in a moment."),
      }),
    } as ActionSpec;
    body.push(col([
      sectionLabel("Another version"),
      mailField("cn_change", "What to change. “Make the shade green glass.” “Lower camera, warmer light.”", desk, { label: "the change", onSubmit: again }),
      row([primaryButton(s.status === "failed" ? "Try again" : "Make it", again, { size: "md" })]),
    ], { gap: 10 }));
  }

  // THE FILES: the Blender script that makes it again exactly, and the .blend when it was kept.
  const files = [
    ...(s.script ? [listRow({ label: "The Blender script", sub: "Makes this scene again in Blender, exactly", onPress: { kind: "openUrl", url: abs(s.script), external: true } as ActionSpec })] : []),
    ...(s.blend ? [listRow({ label: "The .blend file", sub: "Open it in Blender and carry on by hand", onPress: { kind: "openUrl", url: abs(s.blend), external: true } as ActionSpec })] : []),
  ];
  if (files.length && s.status === "done") body.push(listCard(files, { title: "Take it with you" }));

  return page(ctx, {
    title: plain(s.ask).slice(0, 40) || "3D",
    body, back: back(), gap: 18,
    ...(desk ? { maxWidth: 720 } : {}),
    // While it builds, every round moves the page on by itself (scene/service.ts tells the cinema bot's topic).
    live: [botTopic("cinema")],
    state: { cn_change: "" },
  });
}

export const cinema3dScreens: BotsScreen[] = [
  screen<{ scene?: SceneView }>({
    id: SCREENS.cinemaScene,
    load: async (ctx, deps) => ({ scene: await loadScene(deps, String(ctx.params.s ?? "")) }),
    build: (ctx, d) => scenePage(ctx, d?.scene),
  }),
];

export type { BotPageData };
