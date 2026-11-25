/**
 * NAVIGATION, AUDITED ACROSS THE WHOLE APP: every Bots screen, on the phone and on the computer, built empty and with every
 * render sample, and every navigate in it read. Plus everything outside a screen that names one (pushes, widgets, quick actions).
 *
 *   - nothing leads to a screen that is gone (experience/bots/index.ts RETIRED_SCREENS: the old Bots home, its empty state, the
 *     old Activity ledger), and what stands in for each is a real screen that is not gone itself
 *   - a back, close, done, cancel or "stop for now" control never PUSHES: it goes back, or up as a replace (kit.ts up). Pushed,
 *     Back then walked through every step again and could loop (the Xode list → Bots → list recording)
 *   - a tab's own page (Talk, Activities) is never pushed: it is switched to, or the stack under it would be retraced
 *   - no screen pushes a copy of itself (a second tap doubled the stack)
 *
 * tests/wiring.test.ts checks the other half: that every screen a button opens exists, and every call reaches a route.
 */
process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.NODE_ENV = "test";

import { describe, expect, it } from "vitest";
import { BOTS_SCREENS, RETIRED_SCREENS, botsNav, buildBotsScreen } from "../src/experience/bots/index.js";
import { IST, fakeDeps } from "../src/experience/bots/fixtures.js";
import { SAMPLES, apiFor } from "../scripts/bots-render/samples/index.js";
import { PUSH_DEFAULTS } from "../src/push/defaults.js";
import { WIDGETS_DEFAULTS } from "../src/widgets/defaults.js";
import { APP_KNOB_FLAGS } from "../src/experience/appKnobsData.js";

const ALL = { has: () => true } as unknown as Set<string>;
const RETIRED = new Set(Object.keys(RETIRED_SCREENS));
const TAB_ROOTS = new Set(botsNav().tabs.map((t) => t.screenId));
/** The words of a control that leaves a screen for where the person came from. */
const BACKISH = /^(back|close|done|cancel|stop for now|all meetings)\b/i;

type Finding = Map<string, Set<string>>;
const note = (m: Finding, k: string, v: string) => { (m.get(k) ?? m.set(k, new Set()).get(k)!).add(v); };
const show = (m: Finding) => [...m].map(([k, v]) => `${k}  ← ${[...v].slice(0, 4).join(", ")}${v.size > 4 ? ` (+${v.size - 4})` : ""}`);

/** Every navigate in a tree, with the accessibility label of the nearest labelled node above it (a button's words). */
function navigates(root: unknown): Array<{ a: Record<string, unknown>; label: string }> {
  const out: Array<{ a: Record<string, unknown>; label: string }> = [];
  const seen = new Set<unknown>();
  const visit = (v: unknown, label: string): void => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { v.forEach((x) => visit(x, label)); return; }
    const o = v as Record<string, unknown>;
    const props = o.props as Record<string, unknown> | undefined;
    const here = props && typeof props.accessibilityLabel === "string" ? props.accessibilityLabel : label;
    if (o.kind === "navigate" && typeof o.screenId === "string") out.push({ a: o, label: here });
    for (const x of Object.values(o)) visit(x, here);
  };
  visit(root, "");
  return out;
}

describe("navigation, the whole app", () => {
  it("what stands in for a retired screen is a real screen, not retired itself", () => {
    for (const [gone, instead] of Object.entries(RETIRED_SCREENS)) {
      expect(BOTS_SCREENS.has(instead), `${gone} → ${instead}`).toBe(true);
      expect(RETIRED.has(instead), `${gone} → ${instead}`).toBe(false);
    }
  });

  it("no button on any screen leads to a retired screen, pushes from a back control, pushes a tab's page, or pushes itself", async () => {
    const found = { retired: new Map(), backPush: new Map(), tabPush: new Map(), selfPush: new Map() } satisfies Record<string, Finding>;
    type Build = { id: string; params?: Record<string, unknown>; deskParams?: Record<string, unknown>; deps: () => Promise<ReturnType<typeof fakeDeps>> };
    const builds: Build[] = [
      ...[...BOTS_SCREENS.keys()].filter((id) => !RETIRED.has(id)).map((id) => ({ id, deps: async () => fakeDeps() })),
      ...SAMPLES.filter((x) => !RETIRED.has(x.id)).map((x) => ({ id: x.id, params: x.params, deskParams: x.deskParams, deps: async () => fakeDeps({ ...(x.fake ?? {}), api: await apiFor(x) }) })),
    ];
    let seen = 0;
    for (const b of builds) {
      for (const client of ["phone", "desktop"] as const) {
        const params = (client === "desktop" ? b.deskParams ?? b.params : b.params) ?? {};
        const s = await buildBotsScreen({
          screenId: b.id, client, params: params as Record<string, string>, tzOffsetMinutes: IST,
          user: { id: "11111111-2222-3333-4444-555555555555", name: "Aanya Rao", email: "aanya@example.in" },
          can: ALL, desk: { pages: client === "desktop", notes: true },
        }, await b.deps());
        const where = `${b.id} (${client})`;
        for (const { a, label } of navigates(s)) {
          seen++;
          const to = String(a.screenId);
          const stays = a.replace === true || a.root === true;
          if (RETIRED.has(to)) note(found.retired, to, `${where} [${label}]`);
          if (BACKISH.test(label) && !stays) note(found.backPush, `${label} → ${to}`, where);
          if (TAB_ROOTS.has(to) && !stays) note(found.tabPush, to, `${where} [${label}]`);
          if (to === b.id && !stays && JSON.stringify(a.params ?? {}) === JSON.stringify(params)) note(found.selfPush, to, `${where} [${label}]`);
        }
      }
    }
    expect(seen).toBeGreaterThan(200);
    expect({ retired: show(found.retired), backPush: show(found.backPush), tabPush: show(found.tabPush), selfPush: show(found.selfPush) })
      .toEqual({ retired: [], backPush: [], tabPush: [], selfPush: [] });
  }, 300_000);

  it("pushes, widgets and quick actions open real screens, never a retired one", () => {
    const targets: Array<[string, string]> = [];
    for (const [k, v] of Object.entries(PUSH_DEFAULTS.flags)) if (k.endsWith(".screenId") && typeof v === "string") targets.push([k, v]);
    const links = (WIDGETS_DEFAULTS.flags as Record<string, unknown>)["widgets.links"] as Record<string, string>;
    for (const [k, v] of Object.entries(links)) targets.push([`widgets.links.${k}`, v.split("?")[0]!]);
    for (const k of ["app.quickActions.ios", "app.quickActions.android"]) {
      for (const qa of (APP_KNOB_FLAGS[k] as Array<{ id: string; url: string }>)) targets.push([`${k}.${qa.id}`, qa.url.replace(/^tulmi:\/\/screen\//, "").split("?")[0]!]);
    }
    const bad = targets.filter(([, id]) => id.startsWith("bots.") && !id.includes("{") && (RETIRED.has(id) || !BOTS_SCREENS.has(id)));
    expect(targets.length).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });
});
