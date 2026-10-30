/**
 * "SHARE TO A SPACE OR PERSON", FROM ANY ITEM THE APP SHOWS: a plan, a trip, a list, a meeting note, a file, a link, a bot's answer, a
 * Xode preview. It opens bots.share (screens/spaces.ts) with what the item is; the person picks a space or someone, and the server
 * keeps it (POST /v1/botsapp/bots/shares; src/botsBots/shared.ts checks what it can: a file must be theirs, a trip comes from their own).
 *
 *   button("Share", shareTo({ kind: "trip", ref: trip.id, title: `Trip to ${trip.place}` }), { kind: "secondary", icon: "share" })
 *   shareButton({ kind: "answer", title: "Plan for Sunday", text: answer, bot: "plan" })
 */
import type { ActionSpec, Node } from "../../../../shared/types/sdui.js";
import { button, SCREENS } from "./kit.js";

export type ShareKind = "list" | "trip" | "plan" | "note" | "file" | "link" | "answer" | "preview" | "text";

export interface Shareable {
  kind: ShareKind;
  /** The item's own id where the server can read it itself (a file's, a trip's). */
  ref?: string;
  title: string;
  /** Its words (a note, an answer, a day's plan), kept as a copy when shared. */
  text?: string;
  url?: string;
  /** A list's lines. */
  items?: string[];
  /** The bot an answer came from. */
  bot?: string;
}

/** Opens "Share to a space or person" for this item. */
export function shareTo(item: Shareable): ActionSpec {
  const params: Record<string, unknown> = { kind: item.kind, title: item.title.slice(0, 120) };
  if (item.ref) params.ref = item.ref;
  if (item.text) params.text = item.text.slice(0, 4000);
  if (item.url) params.url = item.url.slice(0, 2000);
  if (item.items?.length) params.items = item.items.slice(0, 60).map((s) => s.slice(0, 200)).join("\n");
  if (item.bot) params.bot = item.bot;
  return { kind: "navigate", screenId: SCREENS.share, params };
}

/** A quiet "Share" pill for an item's page. */
export function shareButton(item: Shareable, o: { size?: "md" | "lg"; label?: string } = {}): Node {
  return button(o.label ?? "Share", shareTo(item), { kind: "secondary", size: o.size ?? "md", icon: "share" });
}
