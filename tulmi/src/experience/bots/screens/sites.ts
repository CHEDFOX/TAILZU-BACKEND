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
  type BotsCtx, C, back, box, button, call, canLive, card, col, divider, emptyState, listCard, listRow, liveView, meta,
  page, row, SCREENS, sectionLabel, seq, text,
} from "../kit.js";
import { screen, type BotsScreen } from "../registry.js";
import {
  NONE_ALLOWED, NOTHING_WATCHED, PANEL_NO_DRAW, PANEL_NO_OPEN, SIGN_IN_AGAIN, STOPS_LINE,
  checkPath, loadPanel, loadSites, panelOrigin, readLine, signOutPath, watchPath,
  type PanelOpened, type SiteCard, type SiteWatchView, type SitesView,
} from "../sites.js";
import { panelPage as panelHtml } from "../../../sites/panelHost.js";
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
    right: needsSignIn && canLive(ctx) ? signInButton(site) : forget,
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
  if (toAdd.length && canLive(ctx)) {
    body.push(sectionLabel("Add a site"));
    body.push(listCard(toAdd.map((site) => listRow({ label: site, sub: "Not signed in", chevron: false, right: signInButton(site) }))));
  }

  return page(ctx, { title: "Sites", body, back: back() });
}

// ===================================================================== the panel: their own browser, drawn

/**
 * THE ONE PLACE A SITE IS SIGNED IN (docs/sites.md "The panel", src/sites/panel.ts, src/sites/panelHost.ts).
 *
 * The panel is a PAGE the server writes, shown in the LiveView node the apps already have — not a component of
 * their own. So the frame clock, the tap arithmetic and the keyboard ship when this server deploys, and a phone
 * that has never heard of sites can draw one today. The page is given a ticket that is this one panel and nothing
 * else, because a LiveView cannot see the app's token and must not be handed one.
 *
 * The browser is made by this screen's own load — POST /panel is what opens it — so arriving here costs a real
 * browser page and leaving must end it. The page's "Not now" does that, and the server closes one that goes quiet.
 *
 * A build with no LiveView is told so in a line. Half a sign-in signs nobody in, and a form of ours that collected
 * the password would throw away the whole reason this happens in the browser that keeps the cookie.
 */
function panelPage(ctx: BotsCtx, d: PanelOpened | undefined): ScreenResponse {
  if (!canLive(ctx)) return page(ctx, { title: "Sign in", body: [emptyState({ title: "Not on this phone", body: PANEL_NO_DRAW })], back: back() });
  if (!d || !d.ticket) return page(ctx, { title: "Sign in", body: [emptyState({ title: "Couldn't start", body: PANEL_NO_OPEN })], back: back() });
  const made = panelHtml({
    id: d.id, ticket: d.ticket, site: d.site, width: d.width, height: d.height,
    ...(d.frame ? { frame: d.frame } : {}),
    origin: panelOrigin(),
  });
  // Whatever the page says it is over with, the screen does the same thing: go back, and read the list again. The
  // words the person sees came from the server already, through the page.
  const leave: ActionRef = seq({ kind: "navigateBack" }, refresh);
  return page(ctx, {
    title: d.site,
    // NEVER KEPT. A page with a cache time is written to AsyncStorage, and this one carries the panel's ticket: a
    // live credential has no business on disk, however short its life. `keep: false` makes cacheTtlSeconds 0, so
    // the ticket exists in memory, for as long as the screen is on screen, and nowhere else.
    keep: false,
    body: [
      liveView({
        html: made.html, origin: made.origin, waitForReady: true,
        title: `Signing in to ${d.site}`,
        loadingText: "Opening…", errorText: PANEL_NO_OPEN, retryText: "Try again",
      }, { onResult: leave, onError: leave, style: { flexGrow: 1, minHeight: 420 } }),
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
    // The load OPENS the browser. Only for a build that can draw it: otherwise the page below says so, and no real
    // Chrome page is held in the cloud for a phone that would show a blank box.
    load: (ctx, deps) => (canLive(ctx) ? loadPanel(deps, ctx.user?.id, String(ctx.params.url ?? "")) : Promise.resolve(undefined)),
    build: (ctx, d) => panelPage(ctx, d),
  }),
];
