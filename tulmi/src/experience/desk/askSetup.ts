/**
 * Ask's one-time setup cards: turning Ask on, and the folders it may read.
 */

import type { Node } from "../../../../shared/types/sdui.js";
import type { DeskContext } from "./context.js";
import { typeFor } from "./kit.js";

/**
 * LET ASK SEE WHAT YOU SEE: Ask's one-time setup, in the app (the window's
 * sdui.js askSetupNode draws it). The owner: "if the user accepts there, we
 * don't have to ask every time on the working screens." Three rows, each a
 * permission with its own button: read the screen (the Mac's
 * Accessibility), see it (Screen Recording), and look when it's needed
 * without stopping to ask (a yes for every app, kept on that computer).
 *
 * Only the words come from here. Whether a row is on is the computer's to
 * say, and none of it comes to the server: the window asks its main process
 * and draws each row's state and button from that answer. The home card
 * puts itself away once every row is on; the one in Settings always shows.
 *
 * NOT ONE WORD ABOUT SENDING. The owner: "dont use the send the pic words
 * while asking permissions". The card says Ask sees or looks at the screen
 * when it is needed. That a picture of part of it goes with a question that
 * needs one, and where, is the privacy policy's to say (its Ask section,
 * routes/policies/privacy.ts), and the card links to it.
 */
export function askSetupCard(a: NonNullable<DeskContext["askSetup"]>, place: "home" | "settings"): Node {
  const home = place === "home";
  // Windows asks for neither system permission, so there the row is simply
  // on, and a line about opening the Mac's setting would be about another
  // computer. A window that did not say which it is gets the Mac's line.
  const mac = a.os !== "windows" && a.os !== "linux";
  return {
    type: "DeskAskSetup",
    props: {
      place,
      // On the home page the card is a page of its own above the room, on the
      // page's measure; in Settings it sits in its section's column.
      ...(home ? { cls: "d-page" } : {}),
      eyebrow: "Ask · one-time setup",
      title: "Let Ask see",
      titleEm: "what you see.",
      lede: "Allow these once and Ask answers straight away on any screen, without stopping to ask.",
      rows: [
        { key: "read", title: "Read the screen", sub: "Buttons, fields and text, so it can point at things and do small jobs." },
        { key: "see", title: "See the screen", sub: mac ? "Text in pictures, charts and diagrams. Opens the Mac's Screen Recording setting." : "Text in pictures, charts and diagrams." },
        { key: "pictures", title: "Look at the screen when it's needed", sub: "When a question is about something on your screen, Ask looks without stopping to ask." },
      ],
      on: "On",
      allow: "Allow",
      turnOff: "Turn off",
      restart: "Restart X0 Bot to finish",
      restartButton: "Restart",
      // "Change these any time in Settings" is the home card's to say: read
      // on the Settings page, it sent you to the page you were on.
      foot: home ? "Change these any time in Settings. How Ask uses what it sees:" : "How Ask uses what it sees:",
      policyLabel: "Privacy policy",
      policyUrl: a.privacyUrl,
    },
    ...(home ? { style: { ...typeFor("d-page"), paddingTop: 44, paddingBottom: 44 } } : {}),
  };
}

/**
 * THE FOLDERS ASK MAY USE (Settings, under Ask): the allowed-folders row of
 * "This computer" (connectors/device.ts). Only the words come from here; which
 * folders are allowed is this computer's own list, kept on it (Downloads,
 * Desktop and Documents until the person changes it), and the window draws it
 * from what its main process says (sdui.js DeskFolders, sent only to a window
 * that declared it). Ask never goes into
 * system, app or hidden folders, whatever is added.
 */
export function askFoldersCard(a: NonNullable<DeskContext["askSetup"]>): Node {
  return {
    type: "DeskFolders",
    props: {
      title: "Folders Ask can use",
      lede: "When you ask Ask to find, sort or tidy your files, it only works inside these folders, and never in system, app or hidden ones. Only file names, sizes, kinds and dates are used to answer you, never what is inside a file.",
      usual: "The usual three",
      add: "Add a folder",
      remove: "Remove",
      reset: "Back to the usual three",
      none: "No folders yet. Add one, or go back to the usual three.",
      refused: "Ask can't use that folder.",
      foot: "How Ask uses your files:",
      policyLabel: "Privacy policy",
      policyUrl: a.privacyUrl,
    },
    style: { marginTop: 14 },
  };
}
