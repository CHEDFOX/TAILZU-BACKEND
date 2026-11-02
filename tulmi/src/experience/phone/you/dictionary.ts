/**
 * The person's dictionary: words the app should know.
 */

import { type ScreenResponse, SDUI_SCHEMA_VERSION } from "../../../../../shared/types/sdui.js";
import { PHONE_LOOK } from "../../phoneLook.js";
import type { ScreenContext } from "../../screens.js";
import { YOU_UI, youHead } from "./copy.js";

export function dictionaryScreen(ctx: ScreenContext): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "dictionary",
    title: "Dictionary",
    state: { dictionary: ctx.dictionary ?? [] },
    actions: { err: { kind: "toast", message: "Couldn't save.", tone: "error" } },
    // The amber block reaches the top of the window, so the app's own header
    // has to go. The block carries the way back in its place.
    hideHeader: true,
    root: {
      type: "Stack",
      style: { flex: 1, backgroundColor: YOU_UI.ground },
      children: [
        // The kicker IS the instruction. A screen of two fields does not also
        // need a sentence under a heading explaining that it is two fields.
        youHead("Dictionary", "Type the word, get the phrase."),
        {
          type: "Screen",
          style: {
            backgroundColor: "transparent",
            paddingHorizontal: PHONE_LOOK.side, paddingTop: 24, paddingBottom: 40,
          },
          children: [
            {
              // TWO PILLS AND A SAVE. The column headings are gone — "Word"
              // and "Replace With" label two fields that already say what they
              // are, in their own placeholders.
              //
              // What is NOT gone is the list of pairs already saved. The pairs
              // arrive as more of the same pill, one row each, with the blank
              // one to add always at the end — so an empty dictionary IS two
              // pills and a save, and a full one is the same shape repeated.
              // Dropping the list would have hidden every word the user had
              // added and left no way to remove one.
              type: "DictionaryEditor",
              bind: { value: "dictionary" },
              props: {
                full: true,
                showLabels: false,
                // The refresh: quiet fields on the ground, and Save in the
                // app's pale — saving is not live, so it is not amber.
                cellRadius: 12,
                cellBackground: "rgba(243,226,198,0.045)",
                cellBorderWidth: 1,
                cellBorderColor: "rgba(243,226,198,0.1)",
                cellColor: PHONE_LOOK.ink,
                placeholderColor: PHONE_LOOK.ink3,
                cellPaddingHorizontal: 14,
                cellPaddingVertical: 12,
                cellFontSize: 15,
                gap: 10,
                rowGap: 10,
                removeColor: PHONE_LOOK.ink3,
                saveLabel: "SAVE",
                saveBackground: PHONE_LOOK.ink,
                saveColor: PHONE_LOOK.ground,
                saveRadius: 12,
                saveHeight: 44,
                saveFontSize: 10,
                saveTracking: 1.8,
                saveFullWidth: true,
              },
              on: { onError: "err" },
            },
          ],
        },
      ],
    },
    cacheTtlSeconds: 180,
  };
}
