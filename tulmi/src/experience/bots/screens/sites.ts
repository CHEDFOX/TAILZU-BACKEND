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
  type BotsCtx, C, back, box, button, call, card, col, divider, emptyState, listCard, listRow, meta,
  page, row, SCREENS, sectionLabel, seq, text,
} from "../kit.js";
import { screen, type BotsScreen } from "../registry.js";
import {
  NONE_ALLOWED, NOTHING_WATCHED, SIGN_IN_AGAIN, STOPS_LINE, checkPath, loadSites, readLine, signOutPath, watchPath,
  type SiteCard, type SiteWatchView, type SitesView,
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

/** A site they are signed in to. Signing out here only forgets the slip; it does not sign them out of the site itself. */
function loginRow(site: string, who: string | undefined, needsSignIn: boolean): Node {
  return listRow({
    label: site,
    sub: needsSignIn ? SIGN_IN_AGAIN : who || "Signed in",
    chevron: false,
    right: button("Forget", call("DELETE", signOutPath(site), undefined, {
      ok: seq(toast(`Forgotten ${site}`), refresh),
      fail: oops("Couldn't forget that site. Try again."),
    }), { kind: "quiet", size: "md" }),
  });
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
    body.push(listCard(d.logins.map((l) => loginRow(l.site, l.who, l.needsSignIn === true))));
    body.push(meta("Only the slip that keeps you signed in is kept. Never your password.", { size: 12, color: C.idle, lines: 2 }));
  } else {
    body.push(sectionLabel("Signed in"));
    body.push(meta(d.canAdd.length ? "Nothing yet." : NONE_ALLOWED, { size: 13, color: C.idle, lines: 2 }));
  }

  return page(ctx, { title: "Sites", body, back: back() });
}

export const sitesScreens: BotsScreen[] = [
  screen<SitesView | undefined>({
    id: SCREENS.sites,
    load: (ctx, deps) => loadSites(deps, ctx.user?.id),
    build: (ctx, d) => sitesPage(ctx, d),
  }),
];
