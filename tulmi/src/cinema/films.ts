/**
 * WHETHER FILMS ARE ON (CINEMA_FILMS, off for now; docs/cinema.md). The cinema bot is pictures and 3D while it is off: an idea is
 * shown as a picture, and the picture is built in 3D (docs/cinema-3d.md §2a). Films already made stay; none can be started or moved
 * forward, and nothing offers one. One place answers it, so the routes, the page and the chat cannot disagree.
 */
import { getConfig } from "../config.js";

export function filmsOn(): boolean {
  try { return getConfig().CINEMA_FILMS === true; } catch { return (process.env.CINEMA_FILMS ?? "").toLowerCase() === "true"; }
}
