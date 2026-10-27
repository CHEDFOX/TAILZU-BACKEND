/**
 * THE SEAM EVERY OUTBOUND READ OF THE WEB GOES THROUGH: SAFE FETCH.
 *
 * The page reader, the search sources and the library finder fetch addresses a
 * stranger chose, so they never use `fetch` bare. They ask for `safeFetchWith({
 * timeoutMs, maxBytes })` and get a fetch that refuses what must not be dialled.
 * WHICH guard that is depends on where the code runs, and that is all this file
 * decides:
 *
 *   the VPS        connectors/egress.ts. It resolves the name inside the
 *                  connection's own DNS lookup (an undici Agent), so the address
 *                  it checked is the address it dialled. It imports undici,
 *                  node:dns and node:net, and installs itself here when it is
 *                  loaded (the bottom of that file)
 *   the Worker     web/workerSafeFetch.ts. Nothing to import: a Worker has no
 *                  such Agent, and jobs/ must not bundle undici or the two node
 *                  modules. The Worker's entry installs it before anything runs
 *
 * Nothing here imports either, so a module that fetches (the reader, the
 * search sources) can be bundled for a Worker without dragging the VPS guard in.
 * The guard is looked up when a request is MADE, not when the fetch is built,
 * so modules that build theirs at load time (and keep it) still get whichever
 * guard the process installed, whatever the order the files loaded in.
 *
 * With no guard installed nothing is fetched: it fails closed, loudly, instead
 * of falling back to a bare fetch.
 */
import type { EgressOptions, FetchLike } from "../connectors/egressTypes.js";

export interface SafeFetchImpl {
  /** A guarded fetch with its own time limit and size cap. */
  fetchWith(o: EgressOptions): FetchLike;
  /** Whether an address written as an IP is one never to be dialled. The Worker's guard refuses every address written as an IP, so it says yes to all. */
  isBlockedAddress(ip: string): boolean;
}

let installed: SafeFetchImpl | null = null;

/** Puts a guard in place. The last one installed is the one used. */
export function installSafeFetch(impl: SafeFetchImpl): void {
  installed = impl;
}

export function isSafeFetchInstalled(): boolean {
  return installed !== null;
}

/** Removes the guard (tests). */
export function clearSafeFetchForTests(): void {
  installed = null;
}

function guard(): SafeFetchImpl {
  if (!installed) throw new Error("no safe fetch is installed: load connectors/egress.ts (the server) or install workerSafeFetch (the Worker) before fetching");
  return installed;
}

/** A guarded fetch with its time and size limits. Which guard is looked up on each request. */
export function safeFetchWith(o: EgressOptions = {}): FetchLike {
  return async (input, init) => guard().fetchWith(o)(input, init);
}

/** The guard alone, with no limits of its own. */
export const safeFetch: FetchLike = safeFetchWith();

/** Whether an address written as an IP is one never to be dialled. Anything that is not an address counts as one. */
export function isBlockedAddress(ip: string): boolean {
  return guard().isBlockedAddress(ip);
}
