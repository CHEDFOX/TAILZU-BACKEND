/**
 * TERMINAL SIGN-INS (bots.devices): Xode in a terminal, signed in with the person's account (`xode login`; docs/xode-cli.md).
 *
 * Opened from Settings (the phone's page and the window's card). Each terminal with its name, its system, when it was added and
 * when it was last used, and Remove, which asks once ("Remove <name>?") and then signs that terminal out at once. Under the
 * list, the typed way to approve a new one: the code `xode login` shows opens bots.link (screens/link.ts) with it. With none,
 * it says how to add one.
 *
 * Reads GET /v1/auth/devices; writes DELETE /v1/auth/devices/:id (routes/account/devices.ts), then a refresh.
 */
import type { ActionRef, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, button, C, call, col, divider, emptyState, grow, icon, meta, page, primaryButton, quietButton, row, SCREENS, secondaryButton,
  seq, text, title, when, box,
} from "../../kit.js";
import { screen, type BotsScreen } from "../../registry.js";
import { codeField, withCode } from "../link.js";
import { dayMonth, oops, refresh, toast } from "./parts.js";
import { ago } from "./you.js";

/** GET /v1/auth/devices, as this page reads it. */
export interface DevicesData {
  devices: Array<{ id: string; name: string; platform: "mac" | "windows" | "linux" | ""; kind: "cli"; createdAt: number; lastUsedAt: number | null }>;
}
type Device = DevicesData["devices"][number];

const SYSTEM: Record<string, string> = { mac: "Mac", windows: "Windows", linux: "Linux" };
const enc = encodeURIComponent;

/** "Used just now", "Last used today 10:40", "Last used Mon", "Not used yet". */
function lastUsed(ctx: BotsCtx, t: number | null): string {
  if (!t) return "Not used yet";
  const said = ago(ctx, t);
  if (said === "In use now") return "Used just now";
  return `Last used ${said.replace(/^Today/, "today").replace(/^Yesterday/, "yesterday")}`;
}

function deviceRow(ctx: BotsCtx, d: Device): Node {
  const remove: ActionRef = call("DELETE", `/v1/auth/devices/${enc(d.id)}`, undefined, {
    ok: seq(toast(`${d.name} is signed out`), refresh), fail: oops("remove it"),
  });
  return col([
    row([
      box([icon("code", { size: 18 })], {
        width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center", flexShrink: 0,
      }),
      col([
        text(d.name, { size: 15, weight: 500, lineHeight: 20, lines: 1 }),
        meta(`${SYSTEM[d.platform] ?? "Computer"} · added ${dayMonth(ctx, d.createdAt)} · ${lastUsed(ctx, d.lastUsedAt)}`, { size: 12, lineHeight: 16 }),
      ], { gap: 2, flexShrink: 1, minWidth: 0 }),
      grow(),
      when({ neq: ["remove", d.id] }, secondaryButton("Remove", { kind: "setState", path: "remove", value: d.id }, { size: "md" })),
    ], { gap: 12 }),
    when({ eq: ["remove", d.id] }, col([
      text(`Remove ${d.name}?`, { size: 15, weight: 600, lineHeight: 20 }),
      meta("Xode in that terminal is signed out at once. Run xode login there to sign in again.", { size: 13, lineHeight: 18 }),
      row([
        button("Remove", remove, { kind: "secondary", size: "md" }),
        quietButton("Keep it", { kind: "setState", path: "remove", value: "" }, { size: "md" }),
      ], { gap: 8 }),
    ], { gap: 8, paddingTop: 4 })),
  ], { gap: 8, paddingVertical: 12, paddingHorizontal: 16 });
}

function devicesPage(ctx: BotsCtx, d: DevicesData | undefined) {
  const list = d?.devices;
  return page(ctx, {
    back: true, nav: "settings", title: "Terminal sign-ins", maxWidth: 720, gap: 20, state: { remove: "", code: "" },
    body: [
      col([
        title("Terminal sign-ins"),
        meta("Xode in a terminal, signed in with your account. Each can work on your projects from that terminal until you remove it.", { size: 13, lineHeight: 18 }),
      ], { gap: 4 }),
      ...(!list ? [emptyState({ pose: "think", title: "Couldn't load your terminal sign-ins", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]
        : list.length ? [col(list.flatMap((x, i) => [...(i ? [divider()] : []), deviceRow(ctx, x)]), { borderWidth: 1, borderColor: C.line, borderRadius: 18, overflow: "hidden" })]
          : [emptyState({ pose: "hello", title: "No terminal sign-ins", body: "Run npx xode login in a project folder." })]),
      col([
        text("Signing in a terminal? Type its code", { size: 15, weight: 600, lineHeight: 20 }),
        meta("It's the 8 letters and numbers xode login shows.", { size: 13, lineHeight: 18 }),
        codeField(),
        row([primaryButton("Continue", withCode, { size: "md" })]),
      ], { gap: 8 }),
    ],
  });
}

export const devicesScreens: BotsScreen[] = [
  screen<DevicesData>({ id: SCREENS.devices, load: (_ctx, deps) => deps.api<DevicesData>("GET", "/v1/auth/devices"), build: devicesPage }),
];
