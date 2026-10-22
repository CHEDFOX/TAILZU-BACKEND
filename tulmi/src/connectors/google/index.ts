/**
 * The native connectors, by catalog id. Each is built only when its catalog
 * entry is in the hub's catalog, so a connector that is not switched on has no
 * code listening for it.
 */
import type { ConnectorDef } from "../catalog.js";
import type { NativeSet } from "../native.js";
import type { ConnectorStore } from "../store.js";
import { googleCalendar } from "./calendar.js";
import { googleDocs, type NotesSource } from "./docs.js";
import { emailHandoff } from "./handoff.js";
import { GoogleSession, type GoogleOAuth } from "./oauth.js";

export interface NativeOptions {
  store: ConnectorStore;
  google: GoogleOAuth | null;
  notes: NotesSource;
  now?: () => number;
}

export function buildNatives(catalog: readonly ConnectorDef[], o: NativeOptions): NativeSet {
  const session = new GoogleSession({ store: o.store, google: o.google, now: o.now });
  const out: NativeSet = {};
  for (const def of catalog) {
    if (def.kind !== "native") continue;
    if (def.id === "google-calendar") out[def.id] = googleCalendar({ session, now: o.now });
    else if (def.id === "google-docs") out[def.id] = googleDocs({ session, notes: o.notes });
    else if (def.id === "email-handoff") out[def.id] = emailHandoff();
  }
  return out;
}

export { beginGoogleOAuth, completeGoogleOAuth, revokeGoogleAccess, type GoogleOAuth } from "./oauth.js";
export type { NotesSource } from "./docs.js";
