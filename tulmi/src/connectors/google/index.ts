/**
 * The native connectors, by catalog id: Google's here (Calendar, Docs, Tasks,
 * Sheets, Forms, Classroom, each signed in as the person), YouTube's search
 * (Tailzu's own key, no sign-in: youtube.ts), and the hand-offs from
 * ../handoffs. Each is built only when its catalog entry is in the hub's
 * catalog, so a connector that is not switched on has no code listening for it.
 */
import { CATALOG, type ConnectorDef } from "../catalog.js";
import { handoffConnector } from "../handoffs/index.js";
import type { NativeConnector, NativeSet } from "../native.js";
import type { ConnectorStore } from "../store.js";
import { googleCalendar } from "./calendar.js";
import { googleClassroom } from "./classroom.js";
import { googleDocs, type NotesSource } from "./docs.js";
import { googleForms } from "./forms.js";
import { GoogleSession, type GoogleOAuth } from "./oauth.js";
import { googleSheets } from "./sheets.js";
import { googleTasks } from "./tasks.js";
import { youtubeSearch } from "./youtube.js";
import { personZone } from "./zone.js";

export interface NativeOptions {
  store: ConnectorStore;
  google: GoogleOAuth | null;
  notes: NotesSource;
  /** YouTube's search key (YOUTUBE_API_KEY); null opens YouTube's own search instead. */
  youtubeKey?: string | null;
  /** The fetch YouTube's search uses. The Google apps use the one in `google`. */
  fetchFn?: typeof fetch;
  now?: () => number;
}

export function buildNatives(catalog: readonly ConnectorDef[], o: NativeOptions): NativeSet {
  const session = new GoogleSession({ store: o.store, google: o.google, now: o.now });
  // Tasks, Classroom and Forms say days in the person's zone, which only Calendar knows (zone.ts).
  const zone = personZone({ session, calendarOn: catalog.some((d) => d.id === "google-calendar"), now: o.now });
  const ours: Record<string, () => NativeConnector> = {
    "google-calendar": () => googleCalendar({ session, now: o.now }),
    "google-docs": () => googleDocs({ session, notes: o.notes }),
    "google-tasks": () => googleTasks({ session, zone, now: o.now }),
    "google-sheets": () => googleSheets({ session }),
    "google-forms": () => googleForms({ session, zone, now: o.now }),
    "google-classroom": () => googleClassroom({ session, zone, now: o.now }),
    // Not a Google app people connect: no session, our own key (youtube.ts).
    youtube: () => youtubeSearch({ apiKey: o.youtubeKey ?? null, fetchFn: o.fetchFn, now: o.now }),
  };
  const out: NativeSet = {};
  for (const def of catalog) {
    if (def.kind !== "native") continue;
    const made = ours[def.id]?.() ?? handoffConnector(def.id, { now: o.now });
    if (made) out[def.id] = made;
  }
  return out;
}

/**
 * The person's other Google apps, for a disconnect: Google keeps ONE grant
 * per person across all of them (include_granted_scopes), so it is revoked
 * only when none of these still holds a token. Every Google entry counts,
 * switched on here or not, since a connection made before an app was
 * switched off still holds a token under that same grant. YouTube's search
 * is not one of them: it has no grant. Nor is google-youtube, gone from the
 * catalog: a token someone still holds from it is used by nothing, so it
 * does not keep the grant alive, and the revoke ends it with the rest.
 */
export function otherGoogleApps(def: ConnectorDef, enabled: readonly ConnectorDef[]): string[] {
  const ids = [...CATALOG, ...enabled].filter((d) => d.provider === "google" && d.id !== def.id).map((d) => d.id);
  return [...new Set(ids)];
}

export { beginGoogleOAuth, completeGoogleOAuth, revokeGoogleAccess, type GoogleOAuth } from "./oauth.js";
export type { NotesSource } from "./docs.js";
