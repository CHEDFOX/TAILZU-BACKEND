/**
 * The apps switched on, with this person's state in each: the one list behind
 * GET /v1/connectors and the desk's Connected apps (experience/desk.ts), so the
 * two cannot disagree about what is connected.
 */
import type { AssistantTask, ConnectorInfo } from "../../../shared/types/api.js";
import type { Connectors } from "./index.js";

export async function connectorList(c: Connectors, userId: string): Promise<ConnectorInfo[]> {
  const mine = new Map((await c.store.listConnections(userId)).map((x) => [x.connectorId, x]));
  // A hidden app (the email hand-off) has nothing to connect, so the screens never see it.
  return c.hub.catalog.filter((d) => !d.hidden).map((d) => {
    const m = mine.get(d.id);
    const connected = !!m?.tokensEnc;
    return {
      id: d.id, name: d.name, category: d.category, oneLine: d.oneLine, auth: d.auth === "url" ? "url" : "oauth",
      connected, ...(connected && c.hub.needsSignIn(userId, d.id) ? { needsSignIn: true } : {}),
      level: m?.level ?? "look", auto: m?.autoOk ?? [],
    };
  });
}

/** What a desk page of the assistant needs, read at once. A failed read is the caller's to turn into an empty page. */
export interface AssistantView {
  apps?: ConnectorInfo[];
  tasks?: AssistantTask[];
  /** connector id -> the app's name, for words like "Slack · needs your OK". */
  names: Record<string, string>;
}

export async function assistantView(c: Connectors, userId: string, want: { apps?: boolean; tasks?: boolean }): Promise<AssistantView> {
  const [apps, tasks] = await Promise.all([
    want.apps ? connectorList(c, userId) : undefined,
    want.tasks ? c.tasks.list(userId) : undefined,
  ]);
  return {
    ...(apps ? { apps } : {}),
    ...(tasks ? { tasks: tasks as AssistantTask[] } : {}),
    names: Object.fromEntries(c.hub.catalog.map((d) => [d.id, d.name])),
  };
}
