/**
 * GOOGLE SHEETS, as a native connector, with the drive.file scope only.
 *
 *   create_sheet   write   a new sheet, with rows in it if they gave some
 *   append_rows    write   rows added under the last one of a sheet
 *   read_sheet     read    what a sheet says, row by row
 *
 * spreadsheets.create, values.append and values.get all accept drive.file, so
 * Tailzu reaches only the sheets it made: an expenses sheet ("hisaab") it
 * started, never the rest of the person's Drive. A sheet is named by its name
 * (drive.ts finds it among Tailzu's own), or by its link.
 *
 * Values go in RAW, so nothing anyone said is ever run as a formula: a number
 * is sent as a number (it adds up), "=SUM(..)" stays the text "=SUM(..)".
 * Ranges name no tab, which in A1 notation is the first visible one.
 */
import type { CallOutcome } from "../client.js";
import type { Args, NativeConnector, NativeTool } from "../native.js";
import { ConnectorError } from "../oauth.js";
import { ownFiles, SHEET } from "./drive.js";
import type { GoogleSession } from "./oauth.js";
import { count, noSuchTool, ok, oneLine, reject, str, type Describe } from "./plain.js";

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const ID = "google-sheets";
const APP = "Google Sheets";
const TITLE_MAX = 200;
const ROWS_MAX = 200;
const COLS_MAX = 26;
const CELL_MAX = 500;
/** What read_sheet reads: the first 26 columns and 200 rows of the first tab. */
const READ_RANGE = "A1:Z200";
/** A plain number: no leading zero (a PIN or a phone number stays text), at most fifteen digits. */
const NUMBER = /^-?(0|[1-9]\d{0,14})(\.\d{1,10})?$/;
/** Digits grouped with commas, Indian (1,00,000) or Western (100,000). */
const GROUPED = /^-?\d{1,3}(,\d{2,3})+(\.\d{1,10})?$/;

type Cell = string | number;

const ROWS = {
  type: "array",
  description: "Rows, each a list of cells: [[\"Date\",\"Item\",\"Amount\"],[\"22 Oct\",\"Chai\",20]]. Numbers as numbers.",
  items: { type: "array", items: { type: ["string", "number"] } },
};

const TOOLS: NativeTool[] = [
  {
    name: "create_sheet", risk: "write",
    description: "Create a new Google Sheet with a title, and rows in it if the person gave some (a header row first is good). It makes a new sheet; it never changes one that exists.",
    inputSchema: { type: "object", properties: { title: { type: "string" }, rows: ROWS }, required: ["title"] },
    annotations: {},
  },
  {
    name: "append_rows", risk: "write",
    description: "Add rows under the last row of a Google Sheet Tailzu made (an expenses sheet, a list).",
    inputSchema: {
      type: "object",
      properties: { sheet: { type: "string", description: "The sheet's name (\"Expenses\") or link." }, rows: ROWS },
      required: ["sheet", "rows"],
    },
    annotations: {},
  },
  {
    name: "read_sheet", risk: "read",
    description: "Read a Google Sheet Tailzu made, row by row: to answer what is in it or add it up.",
    inputSchema: { type: "object", properties: { sheet: { type: "string", description: "The sheet's name or link." } }, required: ["sheet"] },
    annotations: { readOnlyHint: true },
  },
];

const linkOf = (id: string) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;

/** One cell as it goes in: a number stays a number, text is cut to one line's worth. */
function cellOf(v: unknown): Cell {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : typeof v === "boolean" ? String(v) : "";
  const plain = GROUPED.test(s) ? s.replace(/,/g, "") : s;
  if (NUMBER.test(plain)) return Number(plain);
  return s.slice(0, CELL_MAX);
}

/** The rows they gave, checked: a list of lists, none too long, not all empty. */
function rowsOf(v: unknown, required: boolean): Cell[][] {
  if (v === undefined || v === null || (Array.isArray(v) && !v.length)) {
    if (required) throw reject("What should the rows say?");
    return [];
  }
  if (!Array.isArray(v)) throw reject("I need the rows as a list.");
  if (v.length > ROWS_MAX) throw reject(`That's more than ${ROWS_MAX} rows. Ask me for fewer at a time.`);
  const rows = v.map((r) => (Array.isArray(r) ? r : [r]).map(cellOf));
  if (rows.some((r) => r.length > COLS_MAX)) throw reject(`A row can have at most ${COLS_MAX} cells.`);
  if (rows.every((r) => r.every((c) => c === ""))) {
    if (required) throw reject("What should the rows say?");
    return [];
  }
  return rows;
}

/** A row read back: "Chai | 20". */
const rowWords = (r: unknown[]) => r.map((c) => oneLine(String(c ?? ""), 60, "")).join(" | ");
/** The first rows, for the confirm card. */
const rowsPreview = (rows: Cell[][]) =>
  rows.slice(0, 3).map((r) => r.map((c) => (typeof c === "number" ? String(c) : `"${oneLine(c, 40, "")}"`)).join(", ")).join("; ")
  + (rows.length > 3 ? `; and ${rows.length - 3} more` : "");

export function googleSheets(o: { session: GoogleSession }): NativeConnector {
  const files = ownFiles(o.session, ID, APP);

  async function append(userId: string, id: string, rows: Cell[][]): Promise<{ updatedRows?: number }> {
    const q = new URLSearchParams({ valueInputOption: "RAW", insertDataOption: "INSERT_ROWS" });
    const res = await o.session.json<{ updates?: { updatedRows?: number } }>(
      userId, ID, APP, `${API}/${encodeURIComponent(id)}/values/A1:append?${q}`,
      { method: "POST", body: { majorDimension: "ROWS", values: rows }, notFound: "I couldn't find that sheet." },
    );
    return res.updates ?? {};
  }

  async function createSheet(userId: string, args: Args): Promise<CallOutcome> {
    const title = str(args.title, TITLE_MAX);
    if (!title) throw reject("What should I call the sheet?");
    const rows = rowsOf(args.rows, false);
    const made = await o.session.json<{ spreadsheetId?: string }>(userId, ID, APP, API, { method: "POST", body: { properties: { title } } });
    if (!made.spreadsheetId) throw new ConnectorError("failed", `${APP} ran into a problem.`);
    const link = linkOf(made.spreadsheetId);
    if (rows.length) {
      try {
        await append(userId, made.spreadsheetId, rows);
      } catch {
        // The sheet exists: say so, with its link, rather than pretending nothing happened.
        return ok(`Made the Google Sheet "${oneLine(title)}" but couldn't put the rows in. ${link}`);
      }
    }
    return ok(`Made the Google Sheet "${oneLine(title)}"${rows.length ? ` with ${count(rows.length, "row")}` : ""}. ${link}`);
  }

  async function appendRows(userId: string, args: Args): Promise<CallOutcome> {
    const rows = rowsOf(args.rows, true);
    const sheet = await files.find(userId, SHEET, args.sheet);
    const done = await append(userId, sheet.id, rows);
    return ok(`Added ${count(done.updatedRows ?? rows.length, "row")} to "${oneLine(sheet.name)}". ${linkOf(sheet.id)}`);
  }

  async function readSheet(userId: string, args: Args): Promise<CallOutcome> {
    const sheet = await files.find(userId, SHEET, args.sheet);
    const q = new URLSearchParams({ majorDimension: "ROWS", valueRenderOption: "FORMATTED_VALUE" });
    const res = await o.session.json<{ values?: unknown[][] }>(
      userId, ID, APP, `${API}/${encodeURIComponent(sheet.id)}/values/${encodeURIComponent(READ_RANGE)}?${q}`, { notFound: "I couldn't find that sheet." },
    );
    const rows = (res.values ?? []).filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim()));
    if (!rows.length) return ok(`"${oneLine(sheet.name)}" is empty. ${linkOf(sheet.id)}`);
    return ok(`"${oneLine(sheet.name)}" has ${count(rows.length, "row")}:\n${rows.map((r) => `- ${rowWords(r)}`).join("\n")}`);
  }

  /** The confirm card: which sheet, and the rows themselves. */
  const describe: Describe = async (userId, tool, args) => {
    if (tool === "create_sheet") {
      const title = str(args.title, TITLE_MAX);
      if (!title) throw reject("What should I call the sheet?");
      const rows = rowsOf(args.rows, false);
      return `Make a new Google Sheet "${oneLine(title)}"${rows.length ? ` with ${count(rows.length, "row")}: ${rowsPreview(rows)}` : ""}`;
    }
    if (tool === "append_rows") {
      const rows = rowsOf(args.rows, true);
      const sheet = await files.find(userId, SHEET, args.sheet);
      return `Add ${count(rows.length, "row")} to the Google Sheet "${oneLine(sheet.name)}": ${rowsPreview(rows)}`;
    }
    return undefined;
  };

  return {
    tools: () => TOOLS,
    preview: describe,

    async call(userId, tool, args): Promise<CallOutcome> {
      switch (tool) {
        case "create_sheet": return createSheet(userId, args);
        case "append_rows": return appendRows(userId, args);
        case "read_sheet": return readSheet(userId, args);
        default: throw noSuchTool(APP, tool);
      }
    },
  };
}
