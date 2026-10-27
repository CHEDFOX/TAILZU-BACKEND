/**
 * CSV AND TSV, READ INTO ROWS: THE TEXT A QUESTION IS ANSWERED FROM, AND THE TABLE A CHART OR A TABLE ARTIFACT IS MADE FROM.
 *
 * A spreadsheet is two things to us. To a question ("what was March's revenue?") it is text: a header, how many rows, per-column facts
 * over EVERY row (the sum, the range, the commonest values), and then the rows as a markdown table that the chunker cuts into pieces with
 * the header repeated on each. To a chart it is a `DataTable`: at most ROWS_MAX rows and COLUMNS_MAX columns, with the numeric columns
 * marked. The facts are computed over the whole file so a question about a total is not answered from the 500 rows kept.
 *
 * The parser is RFC 4180: quotes, doubled quotes, newlines inside quotes, CRLF. A row that is shorter than the header is padded, one that
 * is longer is cut. Caps: 200,000 rows read, 40 columns kept, a cell shown to 200 characters. Pure.
 */
import { COLUMNS_MAX, ROWS_MAX, TEXT_CHARS_MAX, type DataTable } from "./types.js";

export const ROWS_READ_MAX = 200_000;
const CELL_SHOWN = 200;

/** The rows of delimited text. A trailing blank line is not a row. */
export function parseDelimited(text: string, delimiter: string, maxRows = ROWS_READ_MAX): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const n = text.length;
  const endRow = (): void => {
    row.push(cell);
    cell = "";
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };
  while (i < n) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false;
      } else cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n") { endRow(); if (rows.length >= maxRows + 1) return { rows, truncated: i + 1 < n }; }
    else if (ch === "\r") { /* the \n that follows ends the row; a lone \r is dropped */ if (text[i + 1] !== "\n") { endRow(); } }
    else cell += ch;
    i += 1;
  }
  if (cell !== "" || row.length) endRow();
  return { rows, truncated: false };
}

// optional "(" , sign, currency, sign, digits (grouped with commas in threes or twos), fraction, exponent, percent, optional ")"
const NUM = /^(\()?\s*([-+])?\s*(?:[$€£¥₹]|rs\.?|inr)?\s*([-+])?\s*(\d{1,3}(?:,\d{2,3})+|\d+)?(\.\d+)?([eE][-+]?\d+)?\s*%?\s*(\))?$/i;

/** A cell as a number, or null: thousands commas, a currency sign, a percent sign and brackets for negatives are understood. */
export function toNumber(cell: string | number | null | undefined): number | null {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  if (cell === null || cell === undefined) return null;
  const s = cell.trim();
  if (!s || s.length > 30) return null;
  const m = NUM.exec(s);
  if (!m) return null;
  if (Boolean(m[1]) !== Boolean(m[7])) return null;
  if (!m[4] && !m[5]) return null;
  const v = Number(`${(m[4] ?? "0").replace(/,/g, "")}${m[5] ?? ""}${m[6] ?? ""}`);
  if (!Number.isFinite(v)) return null;
  return m[1] || m[2] === "-" || m[3] === "-" ? -v : v;
}

/** Whether the first row names the columns: most of its cells are words, not numbers or blanks, and they are not all the same. */
function hasHeader(first: string[], second: string[] | undefined): boolean {
  const cells = first.map((c) => c.trim());
  const words = cells.filter((c) => c && toNumber(c) === null);
  if (words.length < Math.max(1, Math.ceil(cells.length / 2))) return false;
  if (new Set(cells).size < cells.length / 2) return false;
  if (!second) return true;
  // A first row of words over a second row of the same words is data, not names.
  return second.some((c, i) => (c ?? "").trim() !== cells[i]);
}

export function makeTable(name: string, columns: string[], rows: Array<Array<string | number | null>>, totalRows: number): DataTable {
  const cols = columns.slice(0, COLUMNS_MAX).map((c, i) => (c ?? "").toString().trim().slice(0, 80) || `column ${i + 1}`);
  const kept = rows.slice(0, ROWS_MAX).map((r) => cols.map((_, i) => (r[i] === undefined ? null : r[i]!)));
  const numeric: number[] = [];
  cols.forEach((_, i) => {
    let seen = 0;
    let nums = 0;
    for (const r of kept) {
      const v = r[i];
      if (v === null || v === "") continue;
      seen += 1;
      if (toNumber(v) !== null) nums += 1;
    }
    if (seen > 0 && nums / seen >= 0.9) numeric.push(i);
  });
  // A numeric column is held as numbers, so a chart does not have to guess.
  const typed = kept.map((r) => r.map((v, i) => (numeric.includes(i) && v !== null && v !== "" ? (toNumber(v) ?? v) : v)));
  return { name, columns: cols, rows: typed, totalRows, numeric };
}

export interface ParsedTable {
  table: DataTable;
  /** The text a question is answered from: facts over every row, then the rows. */
  text: string;
  truncated: boolean;
  columnsDropped: number;
}

const cellText = (v: string | number | null): string => (v === null ? "" : String(v)).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim().slice(0, CELL_SHOWN);

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));

/** Facts over every row: for a number column its count, sum, range and mean; for any other, its distinct values and the commonest. */
export function columnFacts(columns: string[], allRows: string[][], numeric: number[]): string[] {
  const lines: string[] = [];
  columns.forEach((name, i) => {
    if (numeric.includes(i)) {
      let n = 0, sum = 0, min = Infinity, max = -Infinity;
      for (const r of allRows) {
        const v = toNumber(r[i]);
        if (v === null) continue;
        n += 1; sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (n) lines.push(`- ${name}: numbers; ${n} values, sum ${fmt(sum)}, min ${fmt(min)}, max ${fmt(max)}, mean ${fmt(sum / n)}`);
    } else {
      const counts = new Map<string, number>();
      for (const r of allRows) {
        const v = (r[i] ?? "").trim();
        if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
        if (counts.size > 5000) break;
      }
      if (!counts.size) return;
      const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v, k]) => `${cellText(v).slice(0, 40)} (${k})`);
      lines.push(`- ${name}: text; ${counts.size > 5000 ? "over 5000" : counts.size} different values${counts.size <= 5000 ? `; commonest: ${top.join(", ")}` : ""}`);
    }
  });
  return lines;
}

/** A CSV or TSV read into its text and its table. */
export function readDelimited(text: string, delimiter: string, name = "table"): ParsedTable {
  const { rows, truncated } = parseDelimited(text, delimiter);
  if (!rows.length) return { table: makeTable(name, [], [], 0), text: "", truncated: false, columnsDropped: 0 };
  const header = hasHeader(rows[0]!, rows[1]);
  const width = Math.max(...rows.slice(0, 200).map((r) => r.length));
  const columns = header ? rows[0]!.slice(0, width) : Array.from({ length: width }, (_, i) => `column ${i + 1}`);
  const body = (header ? rows.slice(1) : rows).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
  const table = makeTable(name, columns, body, body.length);
  const columnsDropped = Math.max(0, width - COLUMNS_MAX);
  const shownCols = table.columns.length;

  const numeric = table.numeric;
  const facts = columnFacts(table.columns, body, numeric);
  const head = [
    `# ${name}`,
    `${body.length}${truncated ? "+" : ""} rows, ${shownCols} columns${columnsDropped ? ` (${columnsDropped} more columns were left out)` : ""}.`,
    ...(facts.length ? ["", "Facts over every row:", ...facts] : []),
    "",
  ];
  const md: string[] = [`| ${table.columns.map(cellText).join(" | ")} |`, `| ${table.columns.map(() => "---").join(" | ")} |`];
  let size = head.join("\n").length + md[0]!.length * 2;
  let cut = false;
  for (const r of body) {
    const line = `| ${table.columns.map((_, i) => cellText(r[i] ?? "")).join(" | ")} |`;
    if (size + line.length + 1 > TEXT_CHARS_MAX) { cut = true; break; }
    md.push(line);
    size += line.length + 1;
  }
  return { table, text: `${head.join("\n")}${md.join("\n")}${cut ? "\n\n(the rest of the rows are not searchable: the file is bigger than I keep)" : ""}`, truncated: truncated || cut, columnsDropped };
}

/** A table from a spreadsheet as the worker read it, as the text a question is answered from. */
export function tableText(t: DataTable, maxChars: number): string {
  const lines = [`## ${t.name}`, `${t.totalRows} rows, ${t.columns.length} columns.`, "", `| ${t.columns.map(cellText).join(" | ")} |`, `| ${t.columns.map(() => "---").join(" | ")} |`];
  let size = lines.join("\n").length;
  for (const r of t.rows) {
    const line = `| ${t.columns.map((_, i) => cellText(r[i] ?? null)).join(" | ")} |`;
    if (size + line.length + 1 > maxChars) break;
    lines.push(line);
    size += line.length + 1;
  }
  return lines.join("\n");
}
