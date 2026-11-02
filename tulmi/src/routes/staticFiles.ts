/**
 * Files served as they are: the desktop installers, the phone app's typefaces, Blip's pictures, the apps' logos and the bots' sounds.
 */

import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { registerBotSoundFiles } from "./botSounds.js";

export interface StaticFileRouteDeps {
  downloadsDir: string;
}

export async function registerStaticFileRoutes(app: FastifyInstance, deps: StaticFileRouteDeps): Promise<void> {
  const { downloadsDir: DOWNLOADS_DIR } = deps;
  try {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  } catch (err) {
    // Non-Docker boots (local dev, CI) may not be able to create /data — that
    // must not kill the server; /downloads just 404s until the dir exists.
    console.warn(`[downloads] could not create ${DOWNLOADS_DIR}:`, (err as Error).message);
  }
  await app.register(fastifyStatic, {
    root: DOWNLOADS_DIR,
    prefix: "/downloads/",
    decorateReply: false,
    cacheControl: true,
    maxAge: "1h",
    // THE CLICK IS THE DOWNLOAD. An installer is never something to show in
    // a tab, so it is named as an attachment: the site's Download button
    // starts the file and the page stays where it was.
    setHeaders(res, filePath) {
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
    },
  });

  // --- Typefaces for the phone app ---------------------------------------------
  // The app bundles no fonts and loads the ones the bootstrap names (FONTS in
  // experience/phone/theme.ts) from here, so a change of typeface is a deploy, not
  // a store release. Shipped in the image (tulmi/fonts); OFL.txt is their
  // licence. The names in phone/theme.ts carry a ?v= so a changed file is a new URL.
  const FONTS_DIR = process.env.FONTS_DIR || path.join(process.cwd(), "fonts");
  if (fs.existsSync(FONTS_DIR)) {
    await app.register(fastifyStatic, {
      root: FONTS_DIR,
      prefix: "/fonts/",
      decorateReply: false,
      cacheControl: true,
      maxAge: "365d",
      immutable: true,
    });
  }

  // --- Blip's animated pictures for the store builds ----------------------------
  // The new onboarding draws Blip with an overlay the builds in the stores do not
  // have, and every build has an Image that animates a WebP: one short loop per
  // pose (experience/blipLoops.ts; cut by scripts/make-blip-loops.ts). Served the
  // way the typefaces are: shipped in the image (tulmi/blip), immutable, and the
  // URLs carry a ?v= so a changed picture is a new file to the app's cache.
  const BLIP_DIR = process.env.BLIP_DIR || path.join(process.cwd(), "blip");
  if (fs.existsSync(BLIP_DIR)) {
    await app.register(fastifyStatic, {
      root: BLIP_DIR,
      prefix: "/blip/",
      decorateReply: false,
      cacheControl: true,
      maxAge: "365d",
      immutable: true,
    });
  }

  // --- The connected apps' logos ---------------------------------------------
  // Each app in Connected apps, Tasks and the onboarding is shown with its own
  // logo, through the Image node every build already has. 128-point tiles cut
  // from the Simple Icons set by scripts/make-app-icons.ts (tulmi/icons, with the
  // NOTICE that they are their owners' trademarks, used only to name the apps).
  // Served the way the typefaces and Blip are: shipped in the image, immutable,
  // and the URLs carry a ?v= (experience/appIcons.ts). An app a person added by
  // link has no logo here, and none is ever fetched from anywhere else.
  const ICONS_DIR = process.env.ICONS_DIR || path.join(process.cwd(), "icons");
  if (fs.existsSync(ICONS_DIR)) {
    await app.register(fastifyStatic, {
      root: ICONS_DIR,
      prefix: "/icons/",
      decorateReply: false,
      cacheControl: true,
      maxAge: "365d",
      immutable: true,
    });
  }

  // --- The bots' sounds ---------------------------------------------------------
  // Pull-a-bot's and the bots' moments' sounds (experience/bots/sounds.ts), made by scripts/make-bot-sounds.py and kept
  // in shared/bots/sounds: served the way the typefaces are, immutable, each URL carrying its file's hash.
  await registerBotSoundFiles(app);
}
