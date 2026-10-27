/**
 * THE LIVE SESSION, THE SHARED PART (docs/cloudflare-jobs.md section 10).
 *
 * "Make the bot work like Claude Code": instant read, grep and glob over the real files, and one runner kept open for the whole job, so a
 * command takes about a second instead of 30 to 60. The Durable Objects that hold it are in jobs/ (the room, jobs/src/jobRoom.ts; the person's
 * presence, jobs/src/userDevices.ts); everything that is logic and not Cloudflare is here, so it runs in the Worker, in the VPS and in a test:
 *
 *   limits.ts     the numbers (the three that are settings are in config.ts)
 *   protocol.ts   the frames a runner, a PC and the app send, and their parsers
 *   tickets.ts    short-lived signed passes for those WebSockets
 *   offers.ts     the way into a room that a runner is handed with its step
 *   rules.ts      what a copy of the code holds (the project brain's skip rules)
 *   unpack.ts     a tarball into a copy, streaming, capped at 50 MB
 *   search.ts     read, list, glob and grep over text, with the guards against a pattern that never ends
 *   minutes.ts    the month's GitHub Actions minutes: tell at 80%, stop at 95%
 *   ports.ts      what the agent loop asks of all this (AgentDeps.live)
 *   preview.ts    the preview: its address, its token, what crosses between the browser and the dev server
 */
export * from "./limits.js";
export * from "./protocol.js";
export * from "./tickets.js";
export * from "./offers.js";
export * from "./rules.js";
export * from "./unpack.js";
export * from "./search.js";
export * from "./minutes.js";
export * from "./ports.js";
export * from "./preview.js";
