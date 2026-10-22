/**
 * GOOGLE DOCS, as a native connector, with the drive.file scope only.
 *
 *   create_doc   write   a new Doc from a title and some text
 *   save_note    write   a meeting note from Tailzu's notes, into a new Doc
 *
 * documents.create and documents:batchUpdate both accept drive.file, which
 * lets Tailzu reach only the files it made itself: never the rest of the
 * person's Drive, and not the Docs they already have. Plain text goes in with
 * one insertText.
 */
import type { Note } from "../../../../shared/types/api.js";
import type { CallOutcome } from "../client.js";
import type { Args, NativeConnector, NativeTool } from "../native.js";
import { ConnectorError } from "../oauth.js";
import type { GoogleSession } from "./oauth.js";

const API = "https://docs.googleapis.com/v1/documents";
const ID = "google-docs";
const APP = "Google Docs";
const TITLE_MAX = 200;
const BODY_MAX = 30_000;

const TOOLS: NativeTool[] = [
  {
    name: "create_doc", risk: "write", verb: "create",
    description: "Create a new Google Doc with a title and some text. It makes a new Doc; it never changes one that exists.",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" }, body: { type: "string", description: "The text of the Doc, plain text with line breaks." } },
      required: ["title", "body"],
    },
    annotations: {},
  },
  {
    name: "save_note", risk: "write", verb: "create",
    description: "Save one of the person's Tailzu meeting notes as a new Google Doc: its summary, key points and people. With no note_id it is their most recent note.",
    inputSchema: {
      type: "object",
      properties: { note_id: { type: "string", description: "Leave out for the most recent note." }, title: { type: "string", description: "Default: the note's own title." } },
    },
    annotations: {},
  },
];

/** Where the connector reads a person's notes from (src/notes/store). */
export interface NotesSource {
  /** One note, or the most recent when no id is given. Null when there is none. */
  find(userId: string, id?: string): Promise<Note | null>;
}

const reject = (message: string) => new ConnectorError("rejected", message);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");
const oneLine = (s: string, max = 80) => (s.replace(/\s+/g, " ").trim().length > max ? s.replace(/\s+/g, " ").trim().slice(0, max - 1).trimEnd() + "…" : s.replace(/\s+/g, " ").trim());

/** A note as the text of a Doc: when, who, the summary, the key points; the transcript only when nothing was organised. */
export function noteText(note: Note): { title: string; body: string } {
  const title = note.title?.trim() || "Meeting note";
  const who = new Map(note.people.map((p) => [p.label, p.name?.trim() || p.label]));
  const nameOf = (label: string) => who.get(label) ?? label;
  const when = new Date(note.startedAt);
  const date = Number.isNaN(when.getTime()) ? "" : when.toISOString().slice(0, 10);
  const mins = Math.round(note.durationSeconds / 60);
  const lines: string[] = [[date, mins > 0 ? `${mins} min` : ""].filter(Boolean).join(" · ")];
  const people = [...new Set(note.people.map((p) => nameOf(p.label)))];
  if (people.length) lines.push(`People: ${people.join(", ")}`);
  if (note.summary?.trim()) lines.push("", "Summary", note.summary.trim());
  if (note.highlights.length) {
    lines.push("", "Key points", ...note.highlights.map((h) => `• ${nameOf(h.speaker)}: ${h.text.trim()}`));
  }
  if (!note.summary?.trim() && !note.highlights.length && note.transcript.length) {
    lines.push("", "What was said", ...note.transcript.map((s) => `${s.speaker ? `${nameOf(s.speaker)}: ` : ""}${s.text.trim()}`));
  }
  return { title, body: lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n").trim() };
}

export function googleDocs(o: { session: GoogleSession; notes: NotesSource }): NativeConnector {
  async function make(userId: string, title: string, body: string): Promise<CallOutcome> {
    if (!title) throw reject("What should I call the Doc?");
    const doc = await o.session.json<{ documentId?: string }>(userId, ID, APP, API, { method: "POST", body: { title } });
    if (!doc.documentId) throw new ConnectorError("failed", `${APP} ran into a problem.`);
    const link = `https://docs.google.com/document/d/${encodeURIComponent(doc.documentId)}/edit`;
    if (body) {
      try {
        await o.session.json(userId, ID, APP, `${API}/${encodeURIComponent(doc.documentId)}:batchUpdate`, {
          method: "POST", body: { requests: [{ insertText: { location: { index: 1 }, text: body } }] },
        });
      } catch {
        // The Doc exists: say so, with its link, rather than pretending nothing happened.
        return { ok: true, text: `Made the Google Doc "${oneLine(title)}" but couldn't put the text in. ${link}` };
      }
    }
    return { ok: true, text: `Made the Google Doc "${oneLine(title)}". ${link}` };
  }

  return {
    tools: () => TOOLS,

    async preview(userId, tool, args): Promise<string | undefined> {
      if (tool !== "save_note") return undefined;
      const n = await o.notes.find(userId, typeof args.note_id === "string" ? args.note_id : undefined);
      return n ? `Save the note "${oneLine(str(args.title, TITLE_MAX) || noteText(n).title)}" as a new Google Doc` : undefined;
    },

    async call(userId, tool, args: Args): Promise<CallOutcome> {
      if (tool === "create_doc") {
        const body = str(args.body, BODY_MAX + 1);
        if (body.length > BODY_MAX) throw reject("That's longer than I can put in one Doc. Ask for a shorter one.");
        return make(userId, str(args.title, TITLE_MAX), body);
      }
      if (tool === "save_note") {
        const id = typeof args.note_id === "string" && args.note_id.trim() ? args.note_id.trim() : undefined;
        const note = await o.notes.find(userId, id);
        if (!note) throw reject(id ? "I couldn't find that note." : "You don't have a note to save yet.");
        const t = noteText(note);
        return make(userId, str(args.title, TITLE_MAX) || t.title, t.body.slice(0, BODY_MAX));
      }
      throw reject(`${APP} doesn't have an action called ${tool.slice(0, 40)}.`);
    },
  };
}
