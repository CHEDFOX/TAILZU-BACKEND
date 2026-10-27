/**
 * THE PIECES A BOT RUNS ON, AS SMALL SEAMS: THE CONNECTED APPS, THE FILES, THE ARTIFACT CORE, THE CODE BOT'S ANSWERS AND THE WEB.
 *
 * A bot reuses what Tailzu already has and builds none of it again. Each seam is the least a bot needs of the thing behind it, so the server
 * hands in the real one (connectorsPort over connectors/, mediaPort over media/, ...) and the tests hand in a fake.
 *
 *   BotConnectors  the person's connected apps: what is on offer, whether each is connected, an app's tools, and one tool call. The call goes through
 *                  connectors/tasks.ts use(): the SAME permission tiers as the assistant's (read runs; a change asks the owner the first time, and runs
 *                  by itself only after they said yes to that kind of change, or set it to Allow on an app they added), the same audit, the same card.
 */
import type { Artifacts } from "../artifacts/index.js";
import type { ConnectorDef } from "../connectors/catalog.js";
import type { Connectors } from "../connectors/index.js";
import type { UseOutcome } from "../connectors/tasks.js";
import type { WebToolDeps, WebTools } from "../code/webTools.js";
import type { KnowledgeMedia } from "./knowledge.js";

export interface ConnectorToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export type ConnectorStatus = "connected" | "not_connected" | "unavailable";

export interface BotConnectors {
  /** The apps on offer to this person, for the maker to choose from. */
  catalog(userId: string): Promise<Array<{ id: string; name: string; oneLine: string; connected: boolean }>>;
  /** Each id with its name and whether this person has it connected. An id Tailzu does not have is "unavailable". */
  status(userId: string, ids: readonly string[]): Promise<Array<{ id: string; name: string; status: ConnectorStatus }>>;
  /** The tools the person's app offers a bot (the app's own tool list, cleaned; for an app added by link, only the ones switched on). */
  tools(userId: string, id: string): Promise<ConnectorToolInfo[]>;
  /** One tool call, through the permission tiers. */
  use(userId: string, runId: string, said: string, line: { connector: string; tool: string; args: Record<string, unknown> }, opts: { allowWrite: boolean }): Promise<UseOutcome>;
  /** The request ended: the task it made, if any, is closed (a change still waiting for a yes stays waiting). */
  settle(userId: string, runId: string, ending: "done" | "error"): Promise<void>;
}

/** What the Code bot can say about a person's project: a question, answered from the project's index. */
export type CodeAsk = (a: { userId: string; projectId: string; question: string; maxPaise: number; signal?: AbortSignal }) => Promise<{ text: string; paise: number }>;

export interface BotPorts {
  connectors?: BotConnectors | null;
  media?: KnowledgeMedia | null;
  artifacts?: Pick<Artifacts, "service"> | null;
  code?: CodeAsk | null;
  /** makeWebTools, or a stand-in. */
  web?: (d: WebToolDeps) => WebTools;
}

/** The connectors the server has, as a bot sees them. */
export function connectorsPort(c: Connectors): BotConnectors {
  const connectedIn = async (userId: string, def: ConnectorDef): Promise<boolean> => {
    // An app that needs no permission (a hand-off) is always there; the others need a sign-in on record.
    if (def.auth === "none") return true;
    return !!(await c.store.getConnection(userId, def.id))?.tokensEnc;
  };
  return {
    async catalog(userId) {
      const own = await c.hub.customApps(userId).catch(() => [] as ConnectorDef[]);
      const out: Array<{ id: string; name: string; oneLine: string; connected: boolean }> = [];
      for (const def of [...c.hub.catalog, ...own]) {
        if (def.hidden || def.kind === "device") continue;
        out.push({ id: def.id, name: def.name, oneLine: def.oneLine, connected: await connectedIn(userId, def) });
      }
      return out;
    },
    async status(userId, ids) {
      const out: Array<{ id: string; name: string; status: ConnectorStatus }> = [];
      for (const id of ids) {
        const def = await c.hub.resolve(userId, id).catch(() => undefined);
        if (!def || def.kind === "device") out.push({ id, name: id, status: "unavailable" });
        else out.push({ id, name: def.name, status: (await connectedIn(userId, def)) ? "connected" : "not_connected" });
      }
      return out;
    },
    async tools(userId, id) {
      const tools = await c.hub.tools(userId, id);
      return tools.map((t) => ({ name: t.name, ...(t.description ? { description: t.description } : {}), inputSchema: t.inputSchema as Record<string, unknown> }));
    },
    use: (userId, runId, said, line, opts) => c.tasks.use(userId, runId, said, line, opts),
    settle: (userId, runId, ending) => c.tasks.settle(userId, runId, ending),
  };
}
