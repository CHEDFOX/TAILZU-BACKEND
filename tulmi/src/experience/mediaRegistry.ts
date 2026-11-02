/**
 * The media registry as the screens see it: set at boot by server.ts (routes/app/media.ts owns the
 * registry), read when a screen names an uploaded picture, film or sound by its key.
 */

import type { MediaPresent } from "../../../shared/types/sdui.js";

/**
 * Optional accessor into the media registry — set at boot by server.ts so the
 * catalog can surface uploaded media URLs into the keyboard config without a
 * circular import. Signature matches routes/app/media.ts getMediaRegistry().
 */
export type MediaEntry = {
  url: string; contentType: string; size: number; uploadedAt: number;
  /** Playback length, when the compressor has measured it. */
  durationMs?: number;
  /** How this slot is shown — shape, fit, radius, hold. Set over HTTP by
   *  POST /v1/media/present, so changing it needs no deploy. */
  present?: MediaPresent;
  /** A video's first frame, cut by the server (routes/app/media.ts). */
  poster?: { url: string; contentType: string; from: string };
};
export let getMediaRegistryFn: (() => Record<string, MediaEntry>) | null = null;
export function setMediaRegistryAccessor(fn: () => Record<string, MediaEntry>): void {
  getMediaRegistryFn = fn;
}

/**
 * Media source for a registry key, RESOLVED server-side.
 *
 * `{ url, contentType }` instead of `{ key }`: the client resolves it with no
 * registry lookup at all, which removes the whole class of "the registry
 * wasn't set yet when this screen rendered" failures — the race that kept the
 * intro black. The key form survives as the fallback so a screen built while
 * the registry is somehow empty still degrades to the old behaviour rather
 * than to nothing.
 */
export function mediaSrc(key: string): Record<string, unknown> {
  const entry = getMediaRegistryFn?.()?.[key];
  return entry?.url ? mediaSource(entry.url, entry.contentType) : { key };
}

/**
 * The key a window reads: "<key>.desktop" when one has been uploaded, else
 * the phone's. A portrait opening and a landscape one are different pictures
 * (see screenHero), and the same rule now holds for every slot.
 */
export function mediaKeyFor(key: string, formFactor?: string): string {
  if (formFactor !== "desktop") return key;
  return getMediaRegistryFn?.()?.[`${key}.desktop`]?.url ? `${key}.desktop` : key;
}

/**
 * A media source shaped to survive the SHIPPED Video node.
 *
 * That node does this before handing the source to the player:
 *
 *   spec = "source" in raw ? raw : { source: raw }
 *
 * and the resolver behind it understands { url }, { key }, { asset }, { data },
 * { emoji } and a bare string — never { source }. So a plain { url } was boxed
 * into a shape nothing could read, resolved to "empty", and the player returned
 * null. Every backend Video rendered nothing, silently. That is the black
 * intro and the flow clip that was "just the text".
 *
 * The fix is one line in the app, and it is written and pushed. This is what
 * reaches the builds already installed, which cannot be fixed at all otherwise:
 *
 *   `source` present  → the node takes the pass-through branch and stops
 *                       wrapping, so the object arrives at the resolver intact.
 *   `url` present     → the resolver matches on it, first, and never looks at
 *                       `source`.
 *
 * Forward-safe, deliberately. The fixed node reads `raw.source`, which is the
 * url string, and the resolver's string branch turns that back into { url };
 * the extension then names the type where contentType would have. So both the
 * broken build and the fixed one play the same clip from the same payload, and
 * nothing has to be timed against an OTA.
 *
 * REMOVE IT when no install predating that fix is still in the field, and not
 * before — a shim whose reason has been forgotten is worse than the bug.
 */
export function mediaSource(url: string, contentType?: string): Record<string, unknown> {
  return { url, ...(contentType ? { contentType } : {}), source: url };
}
