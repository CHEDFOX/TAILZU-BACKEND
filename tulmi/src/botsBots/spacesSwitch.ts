/**
 * THE SPACES SWITCH (SPACES_ENABLED in config.ts; docs/spaces.md "Turning Spaces off").
 *
 * Spaces is family and friends: its spaces, chats with those people, sharing to them, Work in space on the bots' pages. While the
 * switch is off, all of it is out of sight until it is ready, and the person sees an app that simply has no Spaces:
 *
 *   - every Spaces and Work in space route answers 404 { code: "spaces_off" } before the session (`spacesGate`)
 *   - a link, a widget row or a notification into one of its screens opens Home (`isSpacesScreen`)
 *   - Home has no Space card or group tiles, You and the window's settings no Spaces, the bots' pages no Work in space, a thing's
 *     Share no "space or person" (kit hasSpaces)
 *   - no push of Spaces is sent (`isSpacePush`: every space_* kind, those to come too) and no invite mail goes (`isSpaceMail`)
 *   - the bots read nothing a space shared or told them, and nothing a space gave the person shows on their days
 *
 * Nothing is deleted or changed: turning it back on brings back every space, message, share and task as it was.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { getConfig } from "../config.js";

/** What a Spaces route answers while the switch is off. */
export const SPACES_OFF = { code: "spaces_off", message: "Spaces isn't on yet." } as const;

/**
 * Is Spaces on? Read on every call (the config is parsed once and cached, so this is cheap), so a test can flip it with
 * resetConfigForTests. A process whose config can't be read (only a unit test with none set up) reads the variable itself, the
 * same way config.ts does: off unless it says "true".
 */
export function spacesOn(): boolean {
  try {
    return getConfig().SPACES_ENABLED;
  } catch {
    const v = process.env.SPACES_ENABLED;
    return v != null && v.toLowerCase() === "true";
  }
}

/**
 * A route's onRequest hook (route options `{ onRequest: spacesGate }`): while Spaces is off the route answers 404 spaces_off before
 * anything else, the session included, so a build that still asks gets the same plain answer whoever asks.
 */
export async function spacesGate(_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  // An async hook that answered returns the reply, so Fastify stops there and the route never runs.
  if (!spacesOn()) return reply.code(404).send(SPACES_OFF);
  return undefined;
}

/** The screens that are Spaces' own (experience/bots/ids.ts): a link to one, while Spaces is off, opens Home. */
const SPACES_SCREENS: ReadonlySet<string> = new Set([
  "bots.spaces", "bots.share", "bots.work", "bots.chats", "bots.thread", "bots.person",
]);

/** Is this one of Spaces' screens (bots.spaces, every bots.space.*, sharing to a space or person, Work in space, the chats)? */
export function isSpacesScreen(screenId: string): boolean {
  return SPACES_SCREENS.has(screenId) || screenId.startsWith("bots.space.");
}

/** A push from Spaces (push/defaults.ts: space_task, space_feed, ...). Every space_* kind, so one added later is covered too. */
export const isSpacePush = (kind: string): boolean => kind.startsWith("space_");

/** A mail from Spaces (an invite: spaces.ts queues "space_invite"). Kept in the outbox while Spaces is off, sent once it is on. */
export const isSpaceMail = (kind: string): boolean => kind.startsWith("space_");
