/**
 * WHAT A SITE SAID, ON A SCREEN (src/sites, docs/sites.md, CLOUD_BROWSER — off).
 *
 *   sitesScreens   bots.sites: the things being watched, the sites they are signed in to, and what the server allows
 *
 * EVERY CARD SAYS WHERE IT CAME FROM AND WHEN. `readLine()` is under each one — "from swiggy.com · checked 4 min ago" —
 * because a card read an hour ago that looks live is worse than no card: somebody stands at a door for a parcel that
 * has not moved. The stages are the SITE's own words, never ours, so a parcel never acquires a biryani's "Cooking".
 *
 * NOTHING HERE ACTS. There is no button that presses anything on a site. What is owed is shown as the page wrote it,
 * and paying is the hand-off every other screen already uses: their own UPI, their own PIN.
 *
 * One screen id serves the phone and the window, as everything else here does.
 */
import type { ActionRef, Node, ScreenResponse } from "../../../../../shared/types/sdui.js";
import {
  type BotsCtx, C, back, box, button, call, canSitePanel, card, col, divider, emptyState, listCard, listRow, meta,
  page, row, SCREENS, sectionLabel, seq, sitePanel, text,
} from "../kit.js";
import { screen, type BotsScreen } from "../registry.js";
import {
  NONE_ALLOWED, NOTHING_WATCHED, PANEL_BASE, PANEL_NO_DRAW, PANEL_NO_OPEN, PANEL_SAFE_LINE, SIGN_IN_AGAIN, STOPS_LINE,
  checkPath, loadPanel, loadSites, readLine, signOutPath, watchPath,
  type PanelOpened, type SiteCard, type SiteWatchView, type SitesView,
} from "../sites.js";
import { oops } from "./keybotParts.js";
import { refresh, toast } from "./bots/parts.js";

/** The pips: one dot a stage, the last done one filled, the rest of the track grey. Drawn only when the site gave stages. */
function pips(stages: SiteCard["stages"]): Node[] {
  if (stages.length < 2) return [];
  const atIdx = Math.max(0, stages.map((s) => s.done).lastIndexOf(true));
  return [
    row(stages.flatMap((_s, i) => [
      box([], {
        width: 9, height: 9, borderRadius: 5, flexShrink: 0,
        backgroundColor: i <= atIdx ? C.ink : C.track,
      }),
      ...(i < stages.length - 1 ? [box([], { height: 2, flexGrow: 1, backgroundColor: i < atIdx ? C.ink : C.track })] : []),
    ]), { alignItems: "center", gap: 0 }),
    row(stages.map((s, i) => text(s.name, {
      size: 10, color: i === atIdx ? C.ink : C.idle, weight: i === atIdx ? 700 : 400, lines: 1,
    })), { justifyContent: "space-between", gap: 4 }),
  ];
}

/** One thing being watched. Everything in it was written by the site; the last line says which site, and when. */
function watchCard(w: SiteWatchView, now: number): Node {
  const c = w.card;
  const stop: ActionRef = call("DELETE", watchPath(w.id), undefined, {
    ok: seq(toast("I'll stop checking"), refresh),
    fail: oops("Couldn't stop watching that. Try again."),
  });
  const look: ActionRef = call("POST", checkPath(w.id), undefined, { ok: refresh, fail: oops("check that now") });
  return card([
    row([
      col([
        text(c?.title || w.label, { size: 16, weight: 600, lines: 2 }),
        ...(c?.line ? [meta(c.line, { size: 13 })] : []),
      ], { flexGrow: 1, flexShrink: 1, gap: 2 }),
    ], { gap: 12, alignItems: "flex-start" }),
    ...(c?.stages?.length ? [box(pips(c.stages), { gap: 4, marginTop: 11 })] : []),
    ...(c?.detail ? [divider(), text(c.detail, { size: 13, color: C.grey70, lines: 2 })] : []),
    ...(c?.owed ? [divider(), text(c.owed, { size: 14, weight: 600 })] : []),
    meta(readLine(w.site, w.readAt, now), { size: 11.5, color: C.idle }),
    divider(),
    row([
      button("Check now", look, { kind: "secondary", size: "md" }),
      button("Stop watching", stop, { kind: "quiet", size: "md" }),
    ], { gap: 10 }),
  ]);
}

/**
 * A site they are signed in to. Signing out here only forgets the slip; it does not sign them out of the site itself.
 * A row whose slip has stopped working offers the panel instead of "Forget": the thing it needs is a sign-in, and
 * making them forget first and find the site again would be a worse version of the same two taps.
 */
function loginRow(ctx: BotsCtx, site: string, who: string | undefined, needsSignIn: boolean): Node {
  const forget = button("Forget", call("DELETE", signOutPath(site), undefined, {
    ok: seq(toast(`Forgotten ${site}`), refresh),
    fail: oops("Couldn't forget that site. Try again."),
  }), { kind: "quiet", size: "md" });
  return listRow({
    label: site,
    sub: needsSignIn ? SIGN_IN_AGAIN : who || "Signed in",
    chevron: false,
    right: needsSignIn && canSitePanel(ctx) ? signInButton(site) : forget,
  });
}

/** "Sign in": opens the panel screen for that site. The panel itself is made by the screen's own load, not by this tap. */
function signInButton(site: string): Node {
  return button("Sign in", { kind: "navigate", screenId: SCREENS.sitePanel, params: { url: `https://${site}/` } }, { kind: "secondary", size: "md" });
}

function sitesPage(ctx: BotsCtx, d: SitesView | undefined): ScreenResponse {
  if (!d) return page(ctx, { title: "Sites", body: [emptyState({ title: "Not switched on", body: NONE_ALLOWED })], back: back() });
  const now = Date.now();
  const open = d.watches.filter((w) => w.state === "open");
  const done = d.watches.filter((w) => w.state !== "open");
  const body: Node[] = [];

  if (open.length) {
    body.push(sectionLabel("Happening now"));
    for (const w of open) body.push(watchCard(w, now));
    body.push(meta(STOPS_LINE, { size: 12, color: C.idle, lines: 2 }));
  } else {
    body.push(emptyState({ title: NOTHING_WATCHED, body: d.logins.length ? "" : NONE_ALLOWED }));
  }

  if (done.length) {
    body.push(sectionLabel("Done"));
    for (const w of done.slice(0, 10)) {
      body.push(listRow({ label: w.card?.title || w.label, sub: w.card?.line || "Finished", chevron: false }));
    }
  }

  if (d.logins.length) {
    body.push(sectionLabel("Signed in"));
    body.push(listCard(d.logins.map((l) => loginRow(ctx, l.site, l.who, l.needsSignIn === true))));
    body.push(meta("Only the slip that keeps you signed in is kept. Never your password.", { size: 12, color: C.idle, lines: 2 }));
  } else {
    body.push(sectionLabel("Signed in"));
    body.push(meta(d.canAdd.length ? "Nothing yet." : NONE_ALLOWED, { size: 13, color: C.idle, lines: 2 }));
  }

  // The sites the server allows but this person has not signed in to. Only offered to a build that can draw a panel:
  // a "Sign in" that opens a screen the app cannot render is a dead end with a name on it.
  const toAdd = d.canAdd.filter((site) => !d.logins.some((l) => l.site === site));
  if (toAdd.length && canSitePanel(ctx)) {
    body.push(sectionLabel("Add a site"));
    body.push(listCard(toAdd.map((site) => listRow({ label: site, sub: "Not signed in", chevron: false, right: signInButton(site) }))));
  }

  return page(ctx, { title: "Sites", body, back: back() });
}

// ===================================================================== the panel: their own browser, drawn

/**
 * THE ONE PLACE A SITE IS SIGNED IN (shared/types/sdui.ts 3k, src/sites/panel.ts). The browser is made by this
 * screen's own load — POST /panel is what opens it — so arriving here costs a real browser page and leaving must end
 * it. The node does that: it gives up on its own when it is dismissed, and the server closes a panel nobody touches.
 *
 * There is no fallback. A build that cannot draw the panel is told so in a line, because half a sign-in signs nobody
 * in, and a form of ours that collected the password would be the whole point of this feature thrown away.
 */
function panelPage(ctx: BotsCtx, d: PanelOpened | undefined): ScreenResponse {
  if (!canSitePanel(ctx)) return page(ctx, { title: "Sign in", body: [emptyState({ title: "Not on this phone", body: PANEL_NO_DRAW })], back: back() });
  if (!d) return page(ctx, { title: "Sign in", body: [emptyState({ title: "Couldn't start", body: PANEL_NO_OPEN })], back: back() });
  const leave: ActionRef = seq({ kind: "navigateBack" }, refresh);
  return page(ctx, {
    title: d.site,
    body: [
      meta(PANEL_SAFE_LINE, { size: 12, color: C.idle, lines: 3 }),
      sitePanel({
        id: d.id, base: PANEL_BASE, site: d.site, width: d.width, height: d.height,
        ...(d.frame ? { frame: d.frame } : {}),
        title: `Signing in to ${d.site}`,
      }, {
        onResult: seq(toast(`Signed in to ${d.site}`), leave),
        onError: leave,
      }),
    ],
    back: back(),
  });
}

export const sitesScreens: BotsScreen[] = [
  screen<SitesView | undefined>({
    id: SCREENS.sites,
    load: (ctx, deps) => loadSites(deps, ctx.user?.id),
    build: (ctx, d) => sitesPage(ctx, d),
  }),
  screen<PanelOpened | undefined>({
    id: SCREENS.sitePanel,
    // The load OPENS the browser. Only for a build that can draw it: otherwise the page below says so and no page is held.
    load: (ctx, deps) => (canSitePanel(ctx) ? loadPanel(deps, ctx.user?.id, String(ctx.params.url ?? "")) : Promise.resolve(undefined)),
    build: (ctx, d) => panelPage(ctx, d),
  }),
];
