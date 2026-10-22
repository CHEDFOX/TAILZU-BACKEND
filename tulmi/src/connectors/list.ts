/**
 * The apps switched on, with this person's state in each: the one list behind
 * GET /v1/connectors and the desk's Connected apps (experience/desk.ts), so the
 * two cannot disagree about what is connected. The catalog's apps come first,
 * then the ones this person added by link (while those are switched on),
 * marked `custom` and shown with their host, since nobody vetted them.
 *
 * One app's tools, as the per-tool sheet shows them, are shaped here too
 * (toolOf), for GET /v1/connectors/:id/tools and for the screens that draw
 * that sheet, so a tool reads the same in both.
 */
import type { AssistantTask, ConnectorInfo, ConnectorTool } from "../../../shared/types/api.js";
import { getConfig } from "../config.js";
import type { ConnectorDef } from "./catalog.js";
import type { ToolInfo } from "./client.js";
import { policyOf, stripInvisible } from "./hygiene.js";
import type { Connectors } from "./index.js";
import { gate, policiesFor } from "./risk.js";
import type { Connection } from "./store.js";

/** A tool's description, as far as the sheet shows it. */
const DESCRIPTION_MAX = 1000;
/** How long a screen waits for an app to list its tools before it says it couldn't. */
export const TOOLS_SCREEN_WAIT_MS = 8000;

export async function connectorList(c: Connectors, userId: string, email?: string): Promise<ConnectorInfo[]> {
  const [conns, own] = await Promise.all([c.store.listConnections(userId), c.hub.customApps(userId)]);
  const mine = new Map(conns.map((x) => [x.connectorId, x]));
  // A hidden app (the email hand-off) has nothing to connect, so the screens
  // never see it; one held back for testers shows only to them.
  return [...c.hub.catalog.filter((d) => !d.hidden && mayConnect(d.id, email)), ...own].map((d) => infoOf(c, userId, d, mine.get(d.id)));
}

/**
 * Whether this person may see and connect an app: false only for an app named
 * in CONNECTORS_TESTER_ONLY_IDS when their sign-in email is not in
 * CONNECTORS_TESTERS (compared without case).
 */
export function mayConnect(id: string, email: string | undefined, cfg = getConfig()): boolean {
  const list = (s: string) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!list(cfg.CONNECTORS_TESTER_ONLY_IDS).includes(id.toLowerCase())) return true;
  return !!email && list(cfg.CONNECTORS_TESTERS).includes(email.trim().toLowerCase());
}

function infoOf(c: Connectors, userId: string, d: ConnectorDef, m: Connection | undefined): ConnectorInfo {
  const connected = !!m?.tokensEnc;
  return {
    id: d.id, name: d.name, category: d.category, oneLine: d.oneLine, auth: d.auth === "url" ? "url" : "oauth",
    connected, ...(connected && c.hub.needsSignIn(userId, d.id) ? { needsSignIn: true } : {}),
    level: m?.level ?? "look", auto: m?.autoOk ?? [],
    ...(d.custom ? { custom: true as const, host: d.custom.host } : {}),
    ...(d.custom && m?.toolsChanged.length ? { toolsChanged: m.toolsChanged.length } : {}),
    ...(d.custom?.signInHost ? { signInHost: d.custom.signInHost } : {}),
  };
}

/** One tool as the per-tool sheet shows it. */
export function toolOf(c: Connectors, def: ConnectorDef, t: ToolInfo, conn: Connection): ConnectorTool {
  const risk = c.hub.toolRisk(def, t);
  const description = stripInvisible(t.description ?? "").replace(/\s+/g, " ").trim().slice(0, DESCRIPTION_MAX);
  const base = { name: t.name, ...(t.title ? { title: t.title } : {}), description, risk };
  if (def.custom) {
    return {
      ...base, policy: policyOf(t, conn), choices: [...policiesFor(risk)],
      ...(conn.toolsChanged.includes(t.name) ? { changed: true as const } : {}),
    };
  }
  // A catalog app has no per-tool setting: this is what its level and auto list come to.
  const g = gate(risk, conn.level, conn.autoOk.includes(t.name));
  return { ...base, policy: g === "run" ? "allow" : g === "approve" ? "ask" : "off" };
}

/** An app added by link, and what it can do, for its own page. */
export interface AppTools {
  info: ConnectorInfo;
  /** Null when it is not connected, or could not be asked just now. */
  tools: ConnectorTool[] | null;
  /** The list's version, for Looks right to say what it accepted. */
  version?: string;
}

/**
 * One app the person added, with its tools asked for afresh (what they are
 * about to look at is what is there now). Undefined for anything that is not
 * theirs to set tool by tool: a catalog app, someone else's, an unknown id.
 */
export async function appTools(c: Connectors, userId: string, id: string, waitMs = TOOLS_SCREEN_WAIT_MS): Promise<AppTools | undefined> {
  const def = await c.hub.resolve(userId, id);
  if (!def?.custom) return undefined;
  const conn = await c.store.getConnection(userId, def.id);
  const info = infoOf(c, userId, def, conn ?? undefined);
  if (!conn?.tokensEnc) return { info, tools: null };
  let timer: NodeJS.Timeout | undefined;
  const sheet = await Promise.race([
    c.hub.toolSheet(userId, def, { fresh: true }).catch(() => null),
    new Promise<null>((r) => { timer = setTimeout(() => r(null), waitMs); timer.unref?.(); }),
  ]);
  clearTimeout(timer);
  if (!sheet) return { info, tools: null };
  const now = sheet.conn ?? conn;
  return {
    // The count and the sign-in state as they are after this look.
    info: infoOf(c, userId, def, now),
    tools: sheet.tools.map((t) => toolOf(c, def, t, now)),
    ...(sheet.version ? { version: sheet.version } : {}),
  };
}

/** What a page of the assistant needs, read at once. A failed read is the caller's to turn into an empty page. */
export interface AssistantView {
  apps?: ConnectorInfo[];
  tasks?: AssistantTask[];
  /** connector id -> the app's name, for words like "Slack · needs your OK". */
  names: Record<string, string>;
  /** People may add apps by link (CUSTOM_CONNECTORS): the screens offer Add by link and More apps. */
  custom?: boolean;
  /** The app a tools page is about (want.tools). */
  app?: AppTools;
}

export async function assistantView(c: Connectors, userId: string, want: { apps?: boolean; tasks?: boolean; tools?: string }, email?: string): Promise<AssistantView> {
  const [apps, tasks, own, app] = await Promise.all([
    want.apps ? connectorList(c, userId, email) : undefined,
    want.tasks ? c.tasks.list(userId) : undefined,
    c.hub.customApps(userId).catch(() => [] as ConnectorDef[]),
    want.tools ? appTools(c, userId, want.tools) : undefined,
  ]);
  return {
    ...(apps ? { apps } : {}),
    ...(tasks ? { tasks: tasks as AssistantTask[] } : {}),
    names: Object.fromEntries([...c.hub.catalog, ...own].map((d) => [d.id, d.name])),
    ...(c.custom.enabled ? { custom: true } : {}),
    ...(app ? { app } : {}),
  };
}
