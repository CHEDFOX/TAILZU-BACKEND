/**
 * EACH APP, WITH ITS COMPANY'S OWN LOGO beside its name, so people know it at a
 * glance: the phone's Connected apps tiles and sheets, the confirm sheet and
 * Tasks, the onboarding's Connect apps step, and the desk's Connected apps and
 * Tasks.
 *
 * The logos are small PNGs (tulmi/icons/<id>.png, 128 points square, a rounded
 * tile each) cut from the Simple Icons set by scripts/make-app-icons.ts, served
 * from /icons/ the way the typefaces and Blip are served (server.ts), and drawn
 * with the Image node both clients already have: a `source` with a `url` and a
 * `contentFit`, nothing else, so no build needs a release for it.
 *
 * AN APP WITHOUT A LOGO KEEPS ITS LETTER BADGE: the ones Simple Icons has no
 * glyph for, and the ones that are no one company's (Phone, Shopping, Play).
 * `appIconNode` answers undefined for them and the screen draws what it drew
 * before.
 *
 * AN APP ADDED BY LINK NEVER GETS A LOGO. Nobody vetted it, so it shows its
 * letter and its host and nothing that could be mistaken for a vendor's mark;
 * its id (`c_` and a UUID) is never a name in the list; and nothing here ever
 * fetches a picture from the app's own site or any third party: a logo is a
 * file in this image or it is not drawn.
 *
 * blipData.ts's twin: appIconData.ts is the script's output, the version in the
 * URLs (a changed logo is a new URL to the app's cache) and the files made.
 */
import type { Node } from "../../../shared/types/sdui.js";
import { APP_ICON_BUILD } from "./appIconData.js";

/** Where the logos are served: the same origin as the typefaces and Blip. */
const iconBase = (): string => `${process.env.PUBLIC_ORIGIN || "https://api.tailzu.space"}/icons/`;

/** The ids that have a logo: catalog ids, and the services a hand-off opens (spotify, youtube-music). */
export const APP_ICON_IDS: readonly string[] = Object.keys(APP_ICON_BUILD.files);

/**
 * An app's logo address, or undefined when it keeps the badge. `custom` is the
 * app's own flag (an app added by link); the id's own shape says the same, so
 * either one alone is enough to refuse.
 */
export function appIconUrl(id: string, custom?: boolean): string | undefined {
  if (custom === true || id.startsWith("c_") || !Object.hasOwn(APP_ICON_BUILD.files, id)) return undefined;
  return `${iconBase()}${id}.png?v=${APP_ICON_BUILD.v}`;
}

/**
 * The logo, `size` points square, or undefined (draw the badge).
 *
 * A Stack of the size holding an Image that fills it: the same on the phone and
 * the desk. A window's Image carries a bottom margin of its own unless it
 * fills its parent, and a phone's rounds itself unless told not to; the tile is
 * already a rounded square, so the radius is 0 and the box is the parent's.
 */
export function appIconNode(id: string, size: number, custom?: boolean): Node | undefined {
  const url = appIconUrl(id, custom);
  if (!url) return undefined;
  return {
    type: "Stack",
    style: { width: size, height: size, flexShrink: 0 },
    children: [{
      type: "Image",
      props: { source: { url }, contentFit: "contain" },
      style: { width: "100%", height: "100%", borderRadius: 0 },
    }],
  };
}
