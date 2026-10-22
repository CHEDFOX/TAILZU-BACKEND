/**
 * FILES TAILZU MADE, FOUND BY NAME.
 *
 * Sheets and Forms ask only for drive.file, which reaches the files Tailzu
 * created and nothing else in the person's Drive; Drive's files.list under
 * that scope lists only those. So "my expenses sheet" is a match by name
 * among Tailzu's own sheets (the fifty changed last), and a link to anyone
 * else's sheet is simply not found: Google answers 404, and so do we.
 */
import { oneLine, pickByName, reject, str, andList } from "./plain.js";
import type { GoogleSession } from "./oauth.js";

export interface DriveKind {
  mime: string;
  /** "sheet": said to the person. */
  noun: string;
  /** The part of a docs.google.com link before /d/<id>. */
  path: "spreadsheets" | "forms";
}

export const SHEET: DriveKind = { mime: "application/vnd.google-apps.spreadsheet", noun: "sheet", path: "spreadsheets" };
export const FORM: DriveKind = { mime: "application/vnd.google-apps.form", noun: "form", path: "forms" };

export interface OwnFile { id: string; name: string }

const FILES = "https://www.googleapis.com/drive/v3/files";
const FILE_ID = /^[A-Za-z0-9_-]{20,200}$/;

/** The id in a docs.google.com/<path>/d/<id> link, or null. A form's /d/e/ answer link names no form and is not one. */
function idInLink(s: string, kind: DriveKind): string | null {
  const m = new RegExp(`^https://docs\\.google\\.com/${kind.path}/d/([A-Za-z0-9_-]{20,200})(?:[/?#]|$)`).exec(s);
  return m?.[1] ?? null;
}

export function ownFiles(session: GoogleSession, connectorId: string, app: string) {
  /** Tailzu's own files of this kind, the most recently changed first. */
  async function list(userId: string, kind: DriveKind, max = 50): Promise<OwnFile[]> {
    const q = new URLSearchParams({
      q: `mimeType='${kind.mime}' and trashed=false`, orderBy: "modifiedTime desc", pageSize: String(max), fields: "files(id,name)",
    });
    const res = await session.json<{ files?: OwnFile[] }>(userId, connectorId, app, `${FILES}?${q}`);
    return (res.files ?? []).filter((f) => typeof f.id === "string" && FILE_ID.test(f.id));
  }

  /** One file by its id, when it is Tailzu's and of this kind; null otherwise. */
  async function byId(userId: string, kind: DriveKind, id: string): Promise<OwnFile | null> {
    try {
      const f = await session.json<{ id?: string; name?: string; mimeType?: string; trashed?: boolean }>(
        userId, connectorId, app, `${FILES}/${encodeURIComponent(id)}?fields=id,name,mimeType,trashed`,
      );
      return f.id && f.mimeType === kind.mime && !f.trashed ? { id: f.id, name: f.name ?? "" } : null;
    } catch (e) {
      // Not Tailzu's (drive.file cannot see it) or not there: not found. Anything else is a real failure.
      if ((e as { code?: string }).code === "rejected") return null;
      throw e;
    }
  }

  /** The file the person meant: a link, an id, or (most often) its name. Throws a sentence when there is none. */
  async function find(userId: string, kind: DriveKind, wanted: unknown): Promise<OwnFile> {
    const w = str(wanted, 300);
    if (!w) throw reject(`Which ${kind.noun}? Tell me its name.`);
    const linked = idInLink(w, kind);
    if (linked || /^https?:/i.test(w)) {
      const f = linked ? await byId(userId, kind, linked) : null;
      if (f) return f;
      throw reject(`I can only open ${kind.noun}s I made for you, and that link isn't one of them.`);
    }
    if (FILE_ID.test(w)) {
      const f = await byId(userId, kind, w);
      if (f) return f;
    }
    const mine = await list(userId, kind);
    const hit = pickByName(mine, w, (f) => f.id, (f) => f.name, kind.noun);
    if (hit) return hit;
    const names = mine.slice(0, 5).map((f) => `"${oneLine(f.name, 40)}"`);
    throw reject(names.length
      ? `I couldn't find a ${kind.noun} called "${oneLine(w, 40)}" that I made. The ${kind.noun}s I made for you: ${andList(names)}.`
      : `I haven't made any ${kind.noun}s for you yet, and I can only open ones I made.`);
  }

  return { list, find };
}
