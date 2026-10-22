/**
 * The hand-offs, by catalog id: the email one (email.ts) and the apps
 * (apps.ts). None of them needs a sign-in or a key, so each is built whenever
 * its always-on catalog entry is there (CONNECTORS on).
 */
import type { NativeConnector } from "../native.js";
import { handoffApp, type HandoffOptions } from "./apps.js";
import { emailHandoff } from "./email.js";

export function handoffConnector(id: string, o: HandoffOptions = {}): NativeConnector | undefined {
  return id === "email-handoff" ? emailHandoff() : handoffApp(id, o);
}

export { HANDOFF_IDS, type HandoffOptions } from "./apps.js";
export { handoffLinks } from "./email.js";
export { linkKind, onPhone, type LinkKind } from "./links.js";
