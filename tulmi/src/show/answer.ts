/**
 * WHAT THE PERSON PICKED OR TYPED IN A DRAWING, AS THEIR NEXT MESSAGE.
 *
 *   wordsOf(shown, values) -> "Goa, Manali\nBudget: 20000\nWhen: May"
 *
 * A one-tap choice or a suggestion sends its own words, as if typed. A choice of several, or a form, keeps what is picked and
 * typed on the screen (under show.<key>, experience/bots/show.ts) and sends it up whole with the turn it answers; this turns it
 * back into plain words from the labels the server kept, so the bot reads a message like any other, the chat shows it as the
 * person's bubble, and nothing the screen sent is taken for a label: a pick that names no option of the drawing is left out.
 * No language is assumed: picks are joined with commas, a field is "Label: value".
 *
 * Pure.
 */
import type { Block, Shown } from "./types.js";

/** The longest one typed answer may be. */
const VALUE_MAX = 300;

type Values = Record<string, unknown>;

const isObj = (v: unknown): v is Values => !!v && typeof v === "object" && !Array.isArray(v);
const flat = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "").replace(/\s+/g, " ").trim().slice(0, VALUE_MAX);
const on = (v: unknown): boolean => v === true || v === "true" || v === 1;

/** The asking blocks of a drawing, nested ones included, in the order they are drawn. */
function asks(blocks: readonly Block[], out: Block[] = []): Block[] {
  for (const b of blocks) {
    if (b.type === "choice" || b.type === "form") out.push(b);
    if (b.type === "row" || b.type === "grid" || b.type === "card") asks(b.children, out);
  }
  return out;
}

/** The person's words for what they picked and typed in `shown`. Empty when nothing was. */
export function wordsOf(shown: Shown, values: unknown): string {
  if (!isObj(values)) return "";
  const parts: string[] = [];
  for (const b of asks(shown.blocks)) {
    const mine = values[b.type === "choice" || b.type === "form" ? b.key : ""];
    if (!isObj(mine)) continue;
    if (b.type === "choice") {
      const picked = b.options.filter((_o, i) => on(mine[`o${i}`])).map((o) => o.label);
      if (picked.length) parts.push(picked.join(", "));
    } else if (b.type === "form") {
      const lines: string[] = [];
      b.fields.forEach((f, i) => {
        const v = flat(mine[`f${i}`]);
        if (!v) return;
        if (f.kind === "choice" && !f.options?.includes(v)) return;
        lines.push(`${f.label}: ${v}`);
      });
      if (lines.length) parts.push(lines.join("\n"));
    }
  }
  return parts.join("\n");
}
