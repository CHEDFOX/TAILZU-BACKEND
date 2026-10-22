/**
 * The native connectors, by catalog id: Google's here (Calendar, Docs, Tasks,
 * Sheets, Forms, Classroom, YouTube), the hand-offs from ../handoffs. Each is
 * built only when its catalog entry is in the hub's catalog, so a connector
 * that is not switched on has no code listening for it.
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
import { googleYouTube } from "./youtube.js";
import { personZone } from "./zone.js";

export interface NativeOptions {
  store: ConnectorStore;
  google: GoogleOAuth | null;
  notes: NotesSource;
  now?: () => number;
}

export function buildNatives(catalog: readonly ConnectorDef[], o: NativeOptions): NativeSet {
  const session = new GoogleSession({ store: o.store, google: o.google, now: o.now });
  // Tasks, Classroom and Forms say days in the person's zone, which only Calendar knows (zone.ts).
  const zone = personZone({ session, calendarOn: catalog.some((d) => d.id === "google-calendar"), now: o.now });
  const google: Record<string, () => NativeConnector> = {
    "google-calendar": () => googleCalendar({ session, now: o.now }),
    "google-docs": () => googleDocs({ session, notes: o.notes }),
    "google-tasks": () => googleTasks({ session, zone, now: o.now }),
    "google-sheets": () => googleSheets({ session }),
    "google-forms": () => googleForms({ session, zone, now: o.now }),
    "google-classroom": () => googleClassroom({ session, zone, now: o.now }),
    "google-youtube": () => googleYouTube({ session }),
  };
  const out: NativeSet = {};
  for (const def of catalog) {
    if (def.kind !== "native") continue;
    const made = google[def.id]?.() ?? handoffConnector(def.id, { now: o.now });
    if (made) out[def.id] = made;
  }
  return out;
}

/**
 * The person's other Google apps, for a disconnect: Google keeps ONE grant
 * per person across all of them (include_granted_scopes), so it is revoked
 * only when none of these still holds a token. Every Google entry counts,
 * switched on here or not, since a connection made before an app was
 * switched off still holds a token under that same grant.
 */
export function otherGoogleApps(def: ConnectorDef, enabled: readonly ConnectorDef[]): string[] {
  const ids = [...CATALOG, ...enabled].filter((d) => d.provider === "google" && d.id !== def.id).map((d) => d.id);
  return [...new Set(ids)];
}

export { beginGoogleOAuth, completeGoogleOAuth, revokeGoogleAccess, type GoogleOAuth } from "./oauth.js";
export type { NotesSource } from "./docs.js";
