/**
 * THE MEDIA SWITCH (MEDIA_INGEST in config.ts; docs/media.md, DEPLOY.md "Media and files").
 *
 * Reading files is a deployment with parts outside this server: migration 0036_media.sql's tables, a Cloudflare R2 bucket
 * for the bytes, and — for office files and scanned PDFs — the Python worker (media-worker/). While the switch is off,
 * `createMedia` returns null and every /v1/files route answers 404 { code: "media_off" }.
 *
 * This is the other half of that: the SCREENS have to stop offering it. FileUpload is a CLIENT capability — the phone
 * saying it can pick a file — so on its own it is true whatever the server can do, and an attach button drawn from it
 * alone sends the person to "Reading files is not switched on." after they have chosen their file. `kit` BotsCtx carries
 * `files` so `canUpload` can ask both: the build can draw it, AND this server can serve it.
 *
 * Nothing is deleted. Turning it on brings the attach back everywhere it is drawn, with no screen change.
 */
import { getConfig } from "../config.js";

/**
 * Is reading files on? Read on every call (the config is parsed once and cached, so this is cheap), so a test can flip it
 * with resetConfigForTests. A process whose config can't be read (only a unit test with none set up) reads the variable
 * itself, the same way config.ts does: off unless it says "true".
 */
export function filesOn(): boolean {
  try {
    return getConfig().MEDIA_INGEST;
  } catch {
    const v = process.env.MEDIA_INGEST;
    return v != null && v.toLowerCase() === "true";
  }
}
