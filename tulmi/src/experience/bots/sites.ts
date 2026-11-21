/**
 * A BROWSER THAT BELONGS TO THE PERSON — THE RENDERER'S HALF: the payload, the switch, the paths and the words
 * (src/sites, docs/sites.md, CLOUD_BROWSER — off).
 *
 * With the switch off `loadSites()` reads nothing at all, so a screen that asks for it draws exactly what it drew
 * before, and there is no row, no card and no screen.
 *
 * NOTHING HERE ACTS. Every card below reports what a site said and when it was read. The one button that touches
 * money is the hand-off every other screen already uses, and it opens the person's own UPI.
 */
import { getConfig } from "../../config.js";
import type { BotsDeps } from "./live.js";

// ===================================================================== the payload (shared/types/api.ts SitesView)

/** One stage as the SITE names it ("Food ready", "Shipped"), never in our words. */
export interface SiteStage { name: string; when?: string; done: boolean }

/** What a page said about one thing. Every field is the site's, and is drawn with where it came from and when. */
export interface SiteCard {
  title: string;
  line: string;
  stages: SiteStage[];
  detail?: string;
  done?: boolean;
  /** "₹1,340 due in 2 days", as the page wrote it. The card may offer the hand-off; it never pays. */
  owed?: string;
}

export interface SiteWatchView {
  id: string;
  /** The host, shown plainly so a card never hides where it came from. */
  site: string;
  label: string;
  state: "open" | "done" | "stopped" | "lost";
  card?: SiteCard;
  readAt?: number;
  /** An open one's page and whether it is its turn: the phone's reader opens it (SiteView, read). */
  url?: string;
  due?: boolean;
}

export interface SiteLoginView { site: string; who?: string; usedAt?: number; needsSignIn?: boolean; onPhone?: boolean }

export interface SitesView {
  logins: SiteLoginView[];
  watches: SiteWatchView[];
  /** The hosts this server allows at all. Empty means none, and the screen says so rather than offering a dead box. */
  canAdd: string[];
  most: number;
}

// ===================================================================== the switch

export function sitesOn(userId?: string | null): boolean {
  let on = false, only = "";
  try {
    const c = getConfig();
    on = c.CLOUD_BROWSER; only = c.CLOUD_BROWSER_USERS;
  } catch {
    on = (process.env.CLOUD_BROWSER ?? "").toLowerCase() === "true";
    only = process.env.CLOUD_BROWSER_USERS ?? "";
  }
  if (!on) return false;
  const list = only.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return list.length === 0 || (!!userId && list.includes(userId.toLowerCase()));
}

// ===================================================================== the routes

export const SITES_API = "/v1/botsapp/bots/sites";
export const watchPath = (id: string): string => `${SITES_API}/watch/${encodeURIComponent(id)}`;
export const checkPath = (id: string): string => `${SITES_API}/check/${encodeURIComponent(id)}`;
export const signOutPath = (site: string): string => `${SITES_API}/${encodeURIComponent(site)}`;

// ===================================================================== the panel (shared/types/sdui.ts 3k, docs/sites.md)

/** Open one: POST { url }. The only call that makes a panel, and the only one that takes a url. */
export const openPanelPath = (): string => `${SITES_API}/panel`;

/**
 * What POST /panel answers, kept to what the page needs. `ticket` is the page's own secret: it is written into the
 * HTML and nowhere else — never into a screen's state, never sent to the app as a value it could keep, never logged.
 */
export interface PanelOpened { id: string; ticket: string; site: string; width: number; height: number; frame?: string }

/** Read the server's own answer. Anything missing or the wrong shape means undefined: the screen then says so. */
export function cleanPanel(raw: unknown): PanelOpened | undefined {
  const r = (raw ?? {}) as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : "";
  const ticket = typeof r.ticket === "string" ? r.ticket : "";
  const site = typeof r.site === "string" ? r.site : "";
  const w = typeof r.width === "number" && r.width > 0 ? Math.round(r.width) : 0;
  const h = typeof r.height === "number" && r.height > 0 ? Math.round(r.height) : 0;
  // No ticket is no panel: a page that cannot reach its own browser is a picture of a sign-in that does nothing.
  if (!id || !ticket || !site || !w || !h) return undefined;
  return { id, ticket, site, width: w, height: h, ...(typeof r.frame === "string" && r.frame ? { frame: r.frame } : {}) };
}

/**
 * The origin the panel's page runs as, and the only one it may talk to. It must be THIS API, because the page's
 * calls are relative: run it as anything else and every call leaves for somewhere we do not serve.
 */
export function panelOrigin(): string {
  const raw = (process.env.PUBLIC_ORIGIN || "https://api.x0bot.com").trim().replace(/\/+$/, "");
  return /^https:\/\/[^/?#]+$/.test(raw) ? raw : "https://api.x0bot.com";
}

/** Open a panel at a site's sign-in. The browser is made HERE, by this call, so a screen that cannot run it draws nothing. */
export async function loadPanel(deps: Pick<BotsDeps, "api">, userId: string | null | undefined, url: string): Promise<PanelOpened | undefined> {
  if (!sitesOn(userId) || !url) return undefined;
  return deps.api<unknown>("POST", openPanelPath(), { url }).then(cleanPanel).catch(() => undefined);
}

/** When the phone cannot draw a panel: there is no half version of a sign-in worth showing. */
export const PANEL_NO_DRAW = "Signing in needs a newer version of the app.";

/** When the server would not open one (not switched on, a site that is not allowed, the browser busy). */
export const PANEL_NO_OPEN = "Couldn't open the sign-in just now.";

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** What came back, kept to the shape the screens draw. Everything in it was written by a site. */
export function cleanSites(raw: unknown): SitesView {
  const r = (raw ?? {}) as Record<string, unknown>;
  const watches = Array.isArray(r.watches) ? r.watches : [];
  const logins = Array.isArray(r.logins) ? r.logins : [];
  return {
    most: num(r.most) ?? 6,
    canAdd: (Array.isArray(r.canAdd) ? r.canAdd : []).map((x) => str(x, 120)).filter(Boolean),
    logins: logins.map((x) => {
      const l = (x ?? {}) as Record<string, unknown>;
      return {
        site: str(l.site, 120),
        ...(str(l.who, 80) ? { who: str(l.who, 80) } : {}),
        ...(num(l.usedAt) ? { usedAt: num(l.usedAt) } : {}),
        ...(l.needsSignIn === true ? { needsSignIn: true as const } : {}),
        ...(l.onPhone === true ? { onPhone: true as const } : {}),
      };
    }).filter((l) => l.site),
    watches: watches.map((x) => {
      const w = (x ?? {}) as Record<string, unknown>;
      const c = (w.card ?? null) as Record<string, unknown> | null;
      const stages = c && Array.isArray(c.stages) ? c.stages : [];
      return {
        id: str(w.id, 64), site: str(w.site, 120), label: str(w.label, 80),
        state: (["open", "done", "stopped", "lost"].includes(String(w.state)) ? String(w.state) : "open") as SiteWatchView["state"],
        ...(num(w.readAt) ? { readAt: num(w.readAt) } : {}),
        ...(/^https:\/\//.test(str(w.url, 2000)) ? { url: str(w.url, 2000) } : {}),
        ...(w.due === true ? { due: true as const } : {}),
        ...(c && str(c.title, 80) ? {
          card: {
            title: str(c.title, 80), line: str(c.line, 120),
            stages: stages.slice(0, 8).map((s) => {
              const st = (s ?? {}) as Record<string, unknown>;
              return { name: str(st.name, 40), done: st.done === true, ...(str(st.when, 40) ? { when: str(st.when, 40) } : {}) };
            }).filter((s) => s.name),
            ...(str(c.detail, 160) ? { detail: str(c.detail, 160) } : {}),
            ...(str(c.owed, 80) ? { owed: str(c.owed, 80) } : {}),
            ...(c.done === true ? { done: true as const } : {}),
          },
        } : {}),
      };
    }).filter((w) => w.id),
  };
}

export async function loadSites(deps: Pick<BotsDeps, "api">, userId?: string | null): Promise<SitesView | undefined> {
  if (!sitesOn(userId)) return undefined;
  return deps.api<unknown>("GET", SITES_API).then(cleanSites).catch(() => undefined);
}

// ===================================================================== the words every screen says the same

/** Under a card: where it came from and how old it is, so a stale card never looks live. */
export function readLine(site: string, readAt: number | undefined, now: number): string {
  if (!readAt) return `from ${site}`;
  const mins = Math.max(0, Math.round((now - readAt) / 60_000));
  if (mins < 1) return `from ${site} · checked just now`;
  if (mins < 60) return `from ${site} · checked ${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `from ${site} · checked ${hrs === 1 ? "an hour" : `${hrs} hours`} ago`;
  const days = Math.round(hrs / 24);
  return `from ${site} · checked ${days === 1 ? "yesterday" : `${days} days ago`}`;
}

/** The manners, said out loud, under the list. */
export const STOPS_LINE = "I stop checking once a thing arrives.";
/** When the server allows no sites at all. */
export const NONE_ALLOWED = "No sites are set up for this yet.";
/** The slip has gone stale and they have to sign in again. */
export const SIGN_IN_AGAIN = "Needs you to sign in again";
/** Nothing being watched. */
export const NOTHING_WATCHED = "Nothing to keep an eye on right now.";
