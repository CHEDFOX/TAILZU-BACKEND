/**
 * ONE PLACE ASKS FOR AI ("the user need to agree to the terms just once until we update something"): Home's card
 * (firstRun/aiConsentCard.ts), while it is due. Every other Bots screen, on the phone and on the computer, built for someone who has not
 * said yes (and has not answered), draws no AI card and says nothing like "turn on AI": with no answers to its own reads, and with the
 * render check's samples (scripts/bots-render/samples: every screen as its boards draw it, the capture card and the call without AI
 * among them). You › Privacy keeps its switch: that is the setting, not an ask.
 */
process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.GROQ_API_KEY = "test-groq-key";
process.env.NODE_ENV = "test";

import { describe, expect, it } from "vitest";
import { BOTS_SCREENS, buildBotsScreen } from "../src/experience/bots/index.js";
import { IST, fakeDeps } from "../src/experience/bots/fixtures.js";
import { SCREENS } from "../src/experience/bots/ids.js";
import { SAMPLES, apiFor } from "../scripts/bots-render/samples/index.js";

const ALL = { has: () => true } as unknown as Set<string>;
/** Not agreed, not answered: the card is due on Home, and only there. */
const NO_YES = { "GET /v1/you/ai-consent": { agreed: false, asked: false } };
/** What only an AI ask says: the card's titles (the short card and the one with the terms), its label, and any nudge to turn it on. */
const ASK = /Your data, your choice|Terms and privacy|"label":"AI permission"|turn on AI|tap Agree|needs your OK first/i;

describe("one place asks for AI", () => {
  it("no screen but Home draws an AI card or a nudge to turn AI on; Home does while it is due, and not once it is answered", async () => {
    const asks = new Set<string>();
    type Build = { id: string; variant?: string; params?: Record<string, string | number | boolean>; api: () => Promise<Record<string, unknown>>; fake?: object };
    const builds: Build[] = [
      ...[...BOTS_SCREENS.keys()].map((id) => ({ id, api: async () => NO_YES })),
      ...SAMPLES.map((x) => ({ id: x.id, variant: x.variant, params: x.params, fake: x.fake, api: async () => ({ ...(await apiFor(x)), ...NO_YES }) })),
    ];
    for (const b of builds) {
      for (const client of ["phone", "desktop"] as const) {
        const s = await buildBotsScreen({
          screenId: b.id, client, params: (b.params ?? {}) as Record<string, string>, tzOffsetMinutes: IST, user: { id: "11111111-2222-3333-4444-555555555555", name: "Aanya Rao" },
          can: ALL, desk: { pages: client === "desktop", notes: true },
        }, fakeDeps({ ...(b.fake ?? {}), api: await b.api() }));
        if (ASK.test(JSON.stringify(s))) asks.add(b.id);
      }
    }
    expect([...asks]).toEqual([SCREENS.home]);
    // Answered (Not now, or switched off), Home asks no more.
    const home = SAMPLES.find((x) => x.id === SCREENS.home && x.variant === "ai")!;
    for (const client of ["phone", "desktop"] as const) {
      const s = await buildBotsScreen({
        screenId: SCREENS.home, client, params: {}, tzOffsetMinutes: IST, user: { id: "11111111-2222-3333-4444-555555555555", name: "Aanya Rao" },
        can: ALL, desk: { pages: client === "desktop", notes: true },
      }, fakeDeps({ api: { ...(await apiFor(home)), "GET /v1/you/ai-consent": { agreed: false, asked: true } } }));
      expect(JSON.stringify(s)).not.toMatch(ASK);
    }
  }, 120_000);
});
