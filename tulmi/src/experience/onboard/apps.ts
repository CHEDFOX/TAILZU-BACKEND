/**
 * The Connect apps step.
 */

import type { ConnectorInfo } from "../../../../shared/types/api.js";
import type { Node, ActionSpec } from "../../../../shared/types/sdui.js";
import { appIconNode } from "../appIcons.js";
import { EN } from "./copy.js";
import {
  OB, FROM, type Style, type Plan, seq, haptic, setState, ICON, TXT, words, BTN, toast, HD, H, P, LABEL, nodes, FINE, PUSH, SET, BTN2,
} from "./kit.js";

/** An app's mark: its logo, or its first letter on a rounded square (the letter is the app's, so it comes from state). */
function appMark(id: string, size: number, custom?: boolean): Node {
  const logo = appIconNode(id, size, custom);
  if (logo) return logo;
  return {
    type: "Stack",
    style: {
      width: size, height: size, borderRadius: Math.round(size * 0.29), backgroundColor: OB.card, borderWidth: 1.5, borderColor: OB.hair,
      alignItems: "center", justifyContent: "center",
    },
    children: [FROM(`ini.${id}`, { fontFamily: OB.grotesk, fontSize: Math.round(size * 0.42), color: OB.ink })],
  };
}

/** The small pill under an app's name. */
function appPill(inner: Node[], style: Style): Node {
  return {
    type: "Stack",
    style: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, ...style },
    children: inner,
  };
}

function appTile(a: ConnectorInfo, p: Plan): Node {
  const connected = a.connected;
  return {
    type: "Stack",
    // A tile that is already connected has nothing left to do. On the phone the
    // press opens the sheet that says what happens first; a window connects at once.
    ...(connected
      ? {}
      : { on: { onPress: p.desktop ? ({ kind: "connector.connect", id: a.id } as ActionSpec) : seq(haptic("selection"), setState(`sheet.${a.id}`, true)) } }),
    props: { pressOpacity: 0.7 },
    style: {
      borderRadius: 16, paddingTop: 10, paddingHorizontal: 6, paddingBottom: 9, alignItems: "center", gap: 4,
      backgroundColor: OB.surf, borderWidth: 1.5, borderColor: connected ? OB.ink : OB.hair,
    },
    children: [
      appMark(a.id, 42, a.custom),
      FROM(`n.${a.id}`, { fontSize: 14, fontWeight: "700", color: OB.ink, textAlign: "center" }),
      connected
        ? appPill(
            [ICON("check", 12, OB.ink), TXT(words("st.ok"), { fontSize: 11.5, fontWeight: "700", color: OB.ink })],
            { backgroundColor: OB.neonSoft, borderWidth: 1, borderColor: OB.neonLine },
          )
        : appPill([TXT(words("connect"), { fontSize: 11.5, fontWeight: "700", color: OB.surf })], { backgroundColor: OB.ink }),
    ],
  };
}

/** The tile that opens the whole Connected apps screen (phone). */
function moreAppsTile(): Node {
  return {
    type: "Stack",
    props: { pressOpacity: 0.7 },
    on: { onPress: { kind: "navigate", screenId: "assistant_apps" } },
    style: {
      borderRadius: 16, paddingTop: 10, paddingHorizontal: 6, paddingBottom: 9, alignItems: "center", gap: 4,
      backgroundColor: OB.surf, borderWidth: 1.5, borderStyle: "dashed", borderColor: OB.ti1,
    },
    children: [
      {
        type: "Stack",
        style: { width: 42, height: 42, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", borderColor: OB.ti1, alignItems: "center", justifyContent: "center" },
        children: [TXT("+", { fontFamily: OB.grotesk, fontSize: 18, color: OB.ink })],
      },
      TXT(words("s6.more"), { fontSize: 14, fontWeight: "700", color: OB.ink, textAlign: "center" }),
      appPill([TXT(EN["s6.all"], { fontSize: 11.5, fontWeight: "700", color: OB.ink2 })], { borderWidth: 1, borderStyle: "dashed", borderColor: OB.ti1 }),
    ],
  };
}

/** What Connect does on a phone, said first: what the app is, what happens to what I read, and the button. */
function connectSheet(a: ConnectorInfo): Node {
  return {
    type: "BottomSheet",
    bind: { open: `sheet.${a.id}` },
    props: { background: OB.surf, radius: 28, padding: 16, paddingBottom: 34, handleColor: OB.ti2, scrimColor: "rgba(28,26,23,0.34)" },
    children: [
      {
        type: "Stack",
        style: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
        children: [
          appMark(a.id, 46, a.custom),
          {
            type: "Stack",
            style: { flex: 1, gap: 2 },
            children: [
              FROM(`n.${a.id}`, { fontSize: 20, fontWeight: "700", color: OB.ink }),
              TXT(words("st.no"), { fontSize: 13.5, color: OB.ink2 }),
            ],
          },
        ],
      },
      TXT(a.oneLine, { fontSize: 14, lineHeight: 20, color: OB.ink, marginBottom: 10 }),
      TXT(words("a2.ai", { app: a.name }), { fontSize: 12.5, lineHeight: 19, color: OB.ink2, marginBottom: 14 }),
      // The in-app browser, not openUrl: its promise settles when the person
      // closes it, so the refresh after it redraws the tile as Connected.
      BTN(words("connect"), seq(
        setState(`sheet.${a.id}`, false),
        haptic("selection"),
        {
          kind: "callEndpoint", method: "POST", path: `/v1/connectors/${a.id}/connect`, body: {}, assignTo: "link",
          onSuccess: seq({ kind: "openInAppBrowser", url: "$state.link.authorizeUrl" }, { kind: "refresh" }),
          onError: toast(words("err.connect"), "error"),
        },
      )),
    ],
  };
}

export function appsStep(p: Plan): Node {
  const five = p.five;
  const anyConnected = p.apps.some((a) => a.connected);
  return p.step("apps", [
    HD(p.spot("carry", 100, "s6.say")),
    H("s6.h"),
    P("s6.p"),
    LABEL(words("s6.sug")),
    {
      type: "Grid",
      props: { columns: 3, gap: 8 },
      children: nodes([...five.map((a) => appTile(a, p)), p.desktop ? null : moreAppsTile()]),
    },
    p.desktop ? FINE("s6.ai") : null,
    PUSH(),
    // Dimmed until one app is connected. Known by the server, fresh on every fetch.
    BTN(EN["ob.cont"], SET(p.I.careful!), !anyConnected),
    BTN2(EN["ob.skip"], SET(p.I.careful!)),
    ...(p.desktop ? [] : five.filter((a) => !a.connected).map(connectSheet)),
  ]);
}
