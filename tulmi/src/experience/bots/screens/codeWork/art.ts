/**
 * The Code bot at work's art screen.
 */

import type { Node, ActionSpec } from "../../../../../../shared/types/sdui.js";
import {
  type ArtifactRead, type VersionRow, visibleParts, outline, plainWords, type Part, wordsOf, projectName, ago,
} from "../../../../botsCodeWork/read.js";
import {
  call, seq, liveView, box, row, text, whenEq, C, labelled, col, meta, when, statusMark, open, SCREENS, type BotsCtx, page, button,
  sectionLabel, card, grow, meter, icon, botAvatar, emptyState,
} from "../../kit.js";
import { shareButtonsFor } from "../../shareAction.js";
import { type JobData, toast, refresh, glyph, G, oops, MOSS, head, field, statusLine, backButton, write, CODE } from "./parts.js";

// ===================================================================== artifacts: design and preview

/** `live`: the page the app runs the artifact in (GET /v1/artifacts/:id/live), for a build that draws LiveView while a viewer is set. */
export interface ArtData { art: ArtifactRead; versions: VersionRow[]; job?: JobData; live?: LivePage }
export interface LivePage { html: string; origin: string }

/**
 * The artifact running (LiveView), for point and change: a tap on a part (in "Point to change") picks it into `sel` / `selName`, as the
 * drawn parts do; an error the page reports goes to POST /v1/artifacts/:id/errors, and a fix it lands reloads the screen.
 */
function liveArt(d: ArtData, height: number): Node | null {
  if (!d.live) return null;
  const art = d.art;
  const report = call("POST", `/v1/artifacts/${art.artifact.id}/errors`, {
    version: art.version, kind: "$state.live.kind", message: "$state.live.message", line: "$state.live.line", col: "$state.live.col",
  }, { assignTo: "fixed", ok: { kind: "condition", if: { eq: ["fixed.status", "fixed"] }, then: seq(toast("Fixed a problem in the page"), refresh) } });
  const onMessage: ActionSpec = {
    kind: "condition", if: { eq: ["live.t", "select"] },
    then: seq({ kind: "setState", path: "sel", value: "$state.live.id" }, { kind: "setState", path: "selName", value: "$state.live.name" }),
    else: { kind: "condition", if: { eq: ["live.t", "error"] }, then: report },
  };
  return liveView({
    html: d.live.html, origin: d.live.origin, title: art.artifact.title, messagePath: "live", waitForReady: true,
    loadingText: "Opening the page…", errorText: "Couldn't open the page.",
  }, { sendPath: "liveSend", onResult: onMessage, style: { width: "100%", height, borderRadius: 16 } });
}

/** "Use it" or "Point to change": whether a tap on the running page uses it or picks a part (the page is told, nothing reloads). */
function liveMode(o: { compact?: boolean } = {}): Node {
  const tab = (labelText: string, pick: boolean, glyphNode?: Node) => box([row([
    ...(glyphNode ? [glyphNode] : []),
    text(labelText, { size: 13, weight: 500, lineHeight: 17, align: "center" }),
  ], { gap: 6, justifyContent: "center" })], {
    flexGrow: o.compact ? 0 : 1, flexBasis: o.compact ? undefined : 0, paddingVertical: o.compact ? 6 : 9, paddingHorizontal: 14, borderRadius: 10,
    backgroundColor: whenEq("liveSend.pick", pick, C.paper, "transparent"),
  }, { kind: "setState", path: "liveSend.pick", value: pick });
  return labelled(row([tab("Use it", false), tab("Point to change", true, glyph("M5 3l14 7-6 2-2 6z", { size: 14 }))], { gap: 2, padding: 3, borderRadius: 12, backgroundColor: C.surface }), "Preview mode");
}

const POINTABLE = new Set(["html", "react", "svg", "jsx", "tsx"]);

/**
 * The artifact's parts as the screen draws them, each one a person can tap to pick (its viewer id goes to `sel`, its name to
 * `selName`). The picked part is outlined in ink. Not the running page: the parts, their words and their order.
 */
function partsView(art: ArtifactRead, o: { scale?: number; max?: number } = {}): Node {
  const s = o.scale ?? 1;
  const parts = POINTABLE.has(art.artifact.type) ? visibleParts(outline(art.content)) : [];
  if (!parts.length) {
    const words = plainWords(art.content, 6);
    return col(words.length ? words.map((b) => text(b.text, { size: Math.round(13 * s), lineHeight: Math.round(19 * s), mono: b.kind === "code", ...(b.kind === "head" ? { weight: 600 as const } : {}) })) : [meta("Nothing to show yet.")], { gap: 8 });
  }
  let budget = o.max ?? 28;
  const draw = (p: Part, depth: number): Node | null => {
    if (budget <= 0) return null;
    budget--;
    const words = p.text || (p.kids.length ? "" : wordsOf(p));
    const pick = seq({ kind: "setState", path: "sel", value: p.id }, { kind: "setState", path: "selName", value: `${p.kind}${words ? ` · ${words.slice(0, 40)}` : ""}` });
    const ring = { borderWidth: 1.5, borderColor: whenEq("sel", p.id, C.ink, "transparent"), borderRadius: 8 };
    const kids = depth < 4 ? p.kids.map((k) => draw(k, depth + 1)).filter((k): k is Node => !!k) : [];
    let own: Node | null = null;
    if (p.kind === "Button") {
      own = labelled(row([text(words || "Button", { size: Math.round(13 * s), weight: 600, color: C.paper, lineHeight: Math.round(17 * s), lines: 1 })], {
        backgroundColor: C.ink, borderRadius: 10, paddingVertical: Math.round(7 * s), paddingHorizontal: Math.round(12 * s), alignSelf: "flex-start",
        borderWidth: 1.5, borderColor: whenEq("sel", p.id, C.outline, C.ink),
      }, pick), `Button ${words}`);
    } else if (p.kind === "Field") {
      own = row([text(words || "Field", { size: Math.round(12 * s), color: C.idle, lineHeight: Math.round(16 * s), lines: 1 })], { ...ring, borderColor: whenEq("sel", p.id, C.ink, C.line), borderWidth: 1, paddingVertical: 7, paddingHorizontal: 10 }, pick);
    } else if (p.kind === "Picture") {
      own = box([glyph(G.image, { size: Math.round(18 * s), color: C.idle })], { ...ring, borderColor: whenEq("sel", p.id, C.ink, C.line), borderWidth: 1, height: Math.round(54 * s), alignItems: "center", justifyContent: "center", backgroundColor: C.surface }, pick);
    } else if (words) {
      const strong = p.kind === "Heading" || /^(strong|b|h\d)$/i.test(p.tag);
      const big = /^h[12]$/i.test(p.tag);
      own = box([text(words, { size: Math.round((big ? 18 : strong ? 15 : 12) * s), weight: strong ? (big ? 700 : 600) : 400, lineHeight: Math.round((big ? 23 : strong ? 20 : 16) * s), color: strong ? C.ink : C.meta, lines: 3 })],
        { ...ring, paddingVertical: 1, paddingHorizontal: 4, marginHorizontal: -4 }, pick);
    }
    if (!kids.length) return own;
    // A part made only of words and buttons is drawn as a card; a part made of parts is a column of them.
    const leafy = p.kids.every((k) => !k.kids.length);
    return col([...(own ? [own] : []), ...kids], leafy
      ? { gap: Math.round(4 * s), backgroundColor: C.paper, borderRadius: 14, padding: Math.round(12 * s) }
      : { gap: Math.round(8 * s) });
  };
  return col(parts.map((p) => draw(p, 0)).filter((n): n is Node => !!n), { gap: Math.round(8 * s) });
}

function versionDots(head: number, size = 8): Node {
  const n = Math.min(head, 6);
  return labelled(row(Array.from({ length: n }, (_, i) => box([], { width: size, height: size, borderRadius: size / 2, backgroundColor: i === n - 1 ? C.ink : C.outline })), { gap: 5 }),
    `Version ${head} of ${head}`);
}

/** Say what to change about the picked part (or the whole thing): POST /v1/artifacts/:id/edit. */
function changeAction(art: ArtifactRead): ActionSpec {
  return {
    kind: "condition", if: { falsy: "change" }, then: toast("Say what to change first"), else: seq(
      { kind: "setState", path: "changing", value: true },
      call("POST", `/v1/artifacts/${art.artifact.id}/edit`, { instruction: "$state.change", elementId: "$state.sel" }, {
        ok: seq({ kind: "setState", path: "changing", value: false }, { kind: "clearState", path: "change" }, toast("Changed. The old version is kept."), refresh),
        fail: seq({ kind: "setState", path: "changing", value: false }, oops("Couldn't change that. Try again.")),
      }),
    ),
  };
}

const changing = (): Node => when({ truthy: "changing" }, row([statusMark("working", { color: MOSS }), meta("Changing it…", { size: 13 })], { gap: 8 }));

/** Build the approved version into the project (a Xode job whose spec it is), then watch it work. */
function buildAction(art: ArtifactRead): ActionSpec | null {
  if (!art.artifact.projectId) return null;
  return call("POST", `/v1/artifacts/${art.artifact.id}/build`, { projectId: art.artifact.projectId, version: art.version }, {
    assignTo: "built",
    ok: seq(toast("Xode is building it"), open(SCREENS.codeJob, { id: "$state.built.job.id" })),
    fail: oops("Couldn't start the build. Try again."),
  });
}

function selectedLabel(): Node {
  return row([
    text("Selected · ", { size: 11, weight: 600, upper: true, tracking: 0.4, lineHeight: 15 }),
    text("Tap a part", { size: 11, weight: 600, upper: true, tracking: 0.4, lineHeight: 15, bind: "selName", lines: 1, style: { flexShrink: 1 } }),
  ]);
}

function designPhone(ctx: BotsCtx, d: ArtData) {
  const { art } = d;
  const build = buildAction(art);
  const live = liveArt(d, 420);
  return page(ctx, {
    nav: "code", title: art.artifact.title, gap: 16,
    body: [
      head({ title: art.artifact.title, sub: meta(`In your app's style · version ${art.version}`, { size: 12 }), right: versionDots(art.artifact.headVersion) }),
      col([live ?? partsView(art), selectedLabel()], { backgroundColor: C.surface, borderRadius: 24, padding: 14, gap: 12 }),
      field("change", "Make it stand out more", changeAction(art), { ink: true }),
      changing(),
      meta("Tap any part, say what to change. Only that part is redone.", { size: 12 }),
    ],
    footer: build ? [
      button("Build it into my app", build, { kind: "primary", wide: true, icon: undefined }),
      meta("After building, I'll compare the real screen with this and fix any difference.", { size: 12, align: "center" }),
    ] : [meta("This design isn't part of a project, so there's nowhere to build it yet.", { size: 12, align: "center" })],
    state: { sel: "", selName: "Tap a part", change: "", changing: false, ...liveState(live) },
  });
}

/** DeskDesign's right side: the build job, if one is named: where it is, and how close the real screen is to the design. */
function builtSide(ctx: BotsCtx, d: ArtData): Node {
  const j = d.job;
  if (!j) {
    const build = buildAction(d.art);
    return col([
      sectionLabel("Your real app"),
      card([
        text("Not built yet", { size: 16, weight: 600, lineHeight: 21 }),
        meta("Xode builds this version into your project with your own components, runs the app, puts it next to the design and fixes any difference before it asks you to review.", { size: 13, lineHeight: 18 }),
        ...(build ? [button("Build it into my app", build, { kind: "primary", size: "md" })] : [meta("This design isn't part of a project yet.", { size: 13 })]),
      ], { gap: 12, padding: 18 }),
    ], { gap: 10, flexGrow: 1, flexBasis: 0, minWidth: 0 });
  }
  const dz = j.agent?.design;
  const match = dz?.match;
  return col([
    row([sectionLabel("Your real app"), grow(), meta(projectName(j.project), { size: 12 })]),
    card([
      statusLine(j.job, ctx.live.now, 14),
      ...(j.agent?.pr ? [meta(`PR #${j.agent.pr.number}${j.agent.verify?.ok ? " · all checks pass" : ""}`, { size: 13 })] : []),
      ...(match !== undefined ? [meter(match, 100, { label: "Matches your design", valueText: `${Math.round(match)}%` })] : []),
      ...(dz ? [meta(dz.skipped ? dz.skipped : dz.round ? `Compared ${dz.round} ${dz.round === 1 ? "time" : "times"} and sent it back to fix the differences.` : "Compares the built screen with this design before review.", { size: 12, lineHeight: 17 })] : []),
      button("Watch it work", open(SCREENS.codeJob, { id: j.job.id }), { kind: "secondary", size: "md" }),
    ], { gap: 12, padding: 18 }),
  ], { gap: 10, flexGrow: 1, flexBasis: 0, minWidth: 0 });
}

function designDesk(ctx: BotsCtx, d: ArtData) {
  const { art } = d;
  const pr = d.job?.agent?.pr;
  const live = liveArt(d, 520);
  return page(ctx, {
    nav: "code", title: art.artifact.title, gap: 22, maxWidth: 1100,
    body: [
      row([
        backButton(),
        text(art.artifact.title, { size: 17, weight: 600, lineHeight: 22 }),
        meta(`In ${projectName(d.job?.project)}'s style · version ${art.version}`, { size: 12 }),
        grow(),
        ...(pr ? [button("Review the PR", { kind: "openUrl", url: pr.url, external: true }, { kind: "primary", size: "md" })] : []),
      ], { gap: 12 }),
      row([
        col([
          sectionLabel("The design you approved"),
          col([live ?? partsView(art), selectedLabel()], { backgroundColor: C.surface, borderRadius: 24, padding: 16, gap: 12 }),
          field("change", "Click any part, then say what to change…", changeAction(art)),
          changing(),
        ], { gap: 12, flexGrow: 1, flexBasis: 0, minWidth: 0 }),
        builtSide(ctx, d),
      ], { gap: 28, alignItems: "flex-start" }),
    ],
    state: { sel: "", selName: "Click a part", change: "", changing: false, ...liveState(live) },
  });
}

function versionRows(ctx: BotsCtx, d: ArtData): Node[] {
  const head = d.art.artifact.headVersion;
  return d.versions.slice().sort((a, b) => b.version - a.version).slice(0, 8).map((v) => {
    const now = v.version === head;
    return row([
      col([
        text(`v${v.version}${now ? " · now" : ""}`, { size: 13, weight: now ? 600 : 500, lineHeight: 17 }),
        meta(v.note || (v.madeBy === "person" ? "Your change" : "Xode's change"), { size: 12, lines: 1 }),
        meta(ago(v.createdAt, ctx.live.now), { size: 11.5 }),
      ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 1 }),
      ...(now ? [] : [labelled(box([text("Go back", { size: 12, weight: 500, lineHeight: 16 })], { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: C.outline },
        write("POST", `/v1/artifacts/${d.art.artifact.id}/revert`, { version: v.version }, `Back to v${v.version}. Nothing is lost.`, "Couldn't go back. Try again.")), `Go back to version ${v.version}`)]),
    ], { gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, ...(now ? { backgroundColor: C.surface } : {}) });
  });
}

/** The running page's state: point and change on, and nothing heard from it yet. */
const liveState = (live: Node | null): Record<string, unknown> => (live ? { liveSend: { pick: true }, live: null, fixed: null } : {});

/**
 * DPreview's frame around the running page: a phone (300 wide, its bar) or the window's width, by the Phone / Desktop switch. One frame
 * whose look follows state, so switching does not reload the page.
 */
function liveFrame(live: Node): Node {
  return col([
    when({ eq: ["frame", "phone"] }, row([text("9:41", { size: 9.5, weight: 600, lineHeight: 12 }), grow(), box([], { width: 56, height: 14, borderRadius: 7, backgroundColor: C.ink }), grow(), text("5G", { size: 9, lineHeight: 12 })])),
    live,
  ], {
    width: whenEq("frame", "phone", 300, "100%"), borderWidth: whenEq("frame", "phone", 6, 1), borderColor: whenEq("frame", "phone", C.ink, C.line),
    borderRadius: whenEq("frame", "phone", 34, 14), padding: whenEq("frame", "phone", 12, 0), gap: 10, backgroundColor: C.paper, alignSelf: "center", overflow: "hidden",
  });
}

function phoneFrame(inner: Node, width: number): Node {
  return col([
    row([text("9:41", { size: 9.5, weight: 600, lineHeight: 12 }), grow(), box([], { width: 56, height: 14, borderRadius: 7, backgroundColor: C.ink }), grow(), text("5G", { size: 9, lineHeight: 12 })]),
    inner,
  ], { width, borderWidth: 6, borderColor: C.ink, borderRadius: 34, backgroundColor: C.paper, paddingVertical: 12, paddingHorizontal: 12, gap: 10, alignSelf: "center" });
}

/** Share the preview with a space or a person: its name and version, as a card (screens/spaces.ts bots.share). */
const previewShare = (ctx: BotsCtx, art: ArtifactRead): Node[] => shareButtonsFor(ctx, { kind: "preview", ref: art.artifact.id, title: art.artifact.title, text: `A live preview Xode made: ${art.artifact.title}, version ${art.version}.` });

function previewPhone(ctx: BotsCtx, d: ArtData) {
  const { art } = d;
  const head0 = art.artifact.headVersion;
  const live = liveArt(d, 440);
  return page(ctx, {
    nav: "code", title: "Live preview", gap: 16,
    body: [
      head({
        title: "Live preview", size: 24, weight: 700,
        sub: meta(`${art.artifact.title} · updated ${ago(art.artifact.updatedAt, ctx.live.now)}`, { size: 12, lines: 1 }),
        right: col([versionDots(head0), meta(`v${art.version} of ${head0}`, { size: 12 })], { gap: 4, alignItems: "flex-end" }, { kind: "toggleState", path: "showVersions" }),
      }),
      live ? liveMode() : row([icon("search", { size: 15, color: C.meta }), meta("Point to change: tap any part of the preview.", { size: 13 })], { gap: 6, backgroundColor: C.surface, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 }),
      when({ truthy: "showVersions" }, col(versionRows(ctx, d), { gap: 2 })),
      box([phoneFrame(live ?? partsView(art, { scale: 0.85, max: 22 }), 260)], { backgroundColor: C.surface, borderRadius: 24, paddingVertical: 16, alignItems: "center" }),
      selectedLabel(),
      field("change", "Make this bigger and say 'Book now'", changeAction(art), { ink: true }),
      changing(),
      meta(`Only the part you picked changes. v${head0} stays, so you can go back.`, { size: 12 }),
      ...previewShare(ctx, art),
    ],
    state: { sel: "", selName: "Tap a part", change: "", changing: false, showVersions: false, ...liveState(live) },
  });
}

function previewDesk(ctx: BotsCtx, d: ArtData) {
  const { art } = d;
  const head0 = art.artifact.headVersion;
  const live = liveArt(d, 560);
  return page(ctx, {
    nav: "code", title: "Live preview", gap: 20, maxWidth: 1180,
    body: [
      row([
        backButton(),
        text("Live preview", { size: 20, weight: 700, lineHeight: 26, tracking: -0.3 }),
        meta(`${art.artifact.title} · updated ${ago(art.artifact.updatedAt, ctx.live.now)}`, { size: 13 }),
        grow(),
        box([row([
          box([text("Phone", { size: 13, weight: 500, lineHeight: 17, align: "center" })], { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 10, backgroundColor: whenEq("frame", "phone", C.paper, "transparent") }, { kind: "setState", path: "frame", value: "phone" }),
          box([text("Desktop", { size: 13, weight: 500, lineHeight: 17, align: "center" })], { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 10, backgroundColor: whenEq("frame", "desktop", C.paper, "transparent") }, { kind: "setState", path: "frame", value: "desktop" }),
        ], { gap: 2 })], { padding: 3, borderRadius: 12, backgroundColor: C.surface }),
        ...(live ? [liveMode({ compact: true })] : []),
        ...previewShare(ctx, art),
      ], { gap: 12 }),
      row([
        col([sectionLabel("Versions"), ...versionRows(ctx, d), meta("Every change makes a new version. Older ones stay.", { size: 12, lineHeight: 17 })], { width: 220, flexShrink: 0, gap: 6 }),
        box(live ? [liveFrame(live)] : [
          when({ eq: ["frame", "phone"] }, phoneFrame(partsView(art, { scale: 0.9, max: 30 }), 300)),
          when({ eq: ["frame", "desktop"] }, box([partsView(art, { scale: 1, max: 40 })], { width: "100%", borderWidth: 1, borderColor: C.line, borderRadius: 14, backgroundColor: C.paper, padding: 18 })),
        ], { flexGrow: 1, flexBasis: 0, minWidth: 0, backgroundColor: C.surface, borderRadius: 24, padding: 22, alignItems: "center" }),
        col([
          sectionLabel("Selected"),
          text("Click a part", { size: 14, weight: 600, lineHeight: 19, bind: "selName", lines: 2 }),
          sectionLabel("What should change?"),
          field("change", "Make this button bigger and say 'Book now'", changeAction(art), { compact: true, radius: 16 }),
          changing(),
          meta(`Only that part changes. v${head0} stays, so you can go back.`, { size: 12, lineHeight: 17 }),
          card([
            row([botAvatar(CODE, 24), text("Before Xode acts", { size: 13, weight: 600, lineHeight: 17 })], { gap: 8 }),
            row([meta("Changes", { size: 12 }), grow(), text("Only the part you picked", { size: 12, lineHeight: 16 })]),
            row([meta("Leaves alone", { size: 12 }), grow(), text("The rest of the page", { size: 12, lineHeight: 16 })]),
            row([meta("Keeps", { size: 12 }), grow(), text(`v${head0}, to go back to`, { size: 12, lineHeight: 16 })]),
          ], { gap: 8, padding: 14, radius: 16 }),
          meta("Click any part of the preview to pick it.", { size: 12 }),
        ], { width: 280, flexShrink: 0, gap: 10 }),
      ], { gap: 22, alignItems: "flex-start" }),
    ],
    state: { sel: "", selName: "Click a part", change: "", changing: false, frame: "phone", ...liveState(live) },
  });
}

export function artScreen(kind: "design" | "preview") {
  return (ctx: BotsCtx, d: ArtData | undefined) => {
    if (!d) {
      return page(ctx, {
        back: true, nav: "code", title: kind === "design" ? "Design" : "Live preview",
        body: [emptyState({ pose: "think", title: "Nothing to preview yet", body: "When Xode makes a design or a component for your project, it shows here, and you can point at any part to change it.", action: { label: "Go to Xode", onPress: open(SCREENS.code) } })],
      });
    }
    if (kind === "design") return ctx.client === "desktop" ? designDesk(ctx, d) : designPhone(ctx, d);
    return ctx.client === "desktop" ? previewDesk(ctx, d) : previewPhone(ctx, d);
  };
}
