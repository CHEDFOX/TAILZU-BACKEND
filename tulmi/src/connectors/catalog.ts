/**
 * THE CONNECTOR CATALOG: the apps Tailzu's assistant can act in, each one a
 * remote MCP server.
 *
 * Every entry here is a SEED, `verified: false`, and DISABLED until it is
 * named in CONNECTORS_ENABLED_IDS. The endpoints below are the vendors' public
 * remote-MCP addresses as last known; vendors move them, change their sign-in
 * (some do not accept dynamic client registration at all), and retire old
 * transports. Each one must be tried end to end against the real service
 * before it is switched on for anybody. Flip `verified` only after that.
 *
 * `oneLine` and `aliases` are what the router matches an utterance against, so
 * aliases are the words people actually say ("calendar", "jira", "tickets"),
 * not product names alone.
 *
 * auth:
 *   "oauth"  the vendor's MCP OAuth, with dynamic client registration; the
 *            person signs in on the vendor's page (oauth.ts).
 *   "url"    a per-user secret URL the person pastes (Zapier MCP). It is the
 *            credential, so it is stored encrypted like a token, and it must
 *            be on the host of `url` below, over https.
 */
export interface ConnectorDef {
  id: string;
  name: string;
  category: string;
  /** What it does, in a sentence. Used for routing, never shown as marketing. */
  oneLine: string;
  /** Words people say when they mean this app. */
  aliases: string[];
  /** The vendor's remote MCP endpoint (for "url" auth: the host the pasted URL must be on). */
  url: string;
  auth: "oauth" | "url";
  /** Endpoint and sign-in confirmed against the live service. All false for now. */
  verified: boolean;
}

export const CATALOG: readonly ConnectorDef[] = [
  {
    id: "notion", name: "Notion", category: "Docs",
    oneLine: "Search, read and write pages, databases and notes in Notion.",
    aliases: ["notion", "notes", "wiki", "page", "pages", "database"],
    url: "https://mcp.notion.com/mcp", auth: "oauth", verified: false,
  },
  {
    id: "linear", name: "Linear", category: "Projects",
    oneLine: "Find, create and update issues, projects and cycles in Linear.",
    aliases: ["linear", "issue", "issues", "ticket", "tickets", "bug", "bugs", "sprint", "cycle"],
    url: "https://mcp.linear.app/mcp", auth: "oauth", verified: false,
  },
  {
    id: "github", name: "GitHub", category: "Code",
    oneLine: "Read repositories, issues and pull requests, and comment or open them on GitHub.",
    aliases: ["github", "repo", "repository", "pull request", "pr", "commit", "commits", "branch"],
    url: "https://api.githubcopilot.com/mcp/", auth: "oauth", verified: false,
  },
  {
    id: "atlassian", name: "Jira and Confluence", category: "Projects",
    oneLine: "Search and update Jira issues and read or write Confluence pages.",
    aliases: ["jira", "confluence", "atlassian", "ticket", "tickets", "issue", "issues", "epic", "backlog"],
    url: "https://mcp.atlassian.com/v1/mcp", auth: "oauth", verified: false,
  },
  {
    id: "asana", name: "Asana", category: "Projects",
    oneLine: "See, create and complete tasks and projects in Asana.",
    aliases: ["asana", "task", "tasks", "to-do", "todo", "project", "projects"],
    url: "https://mcp.asana.com/sse", auth: "oauth", verified: false,
  },
  {
    id: "zapier", name: "Zapier", category: "Automation",
    oneLine: "Reach thousands of apps (email, calendar, Slack, sheets and more) through the actions set up in Zapier.",
    aliases: ["zapier", "email", "gmail", "calendar", "slack", "sheet", "sheets", "spreadsheet", "meeting", "schedule"],
    url: "https://mcp.zapier.com/", auth: "url", verified: false,
  },
];

/** The ids named in CONNECTORS_ENABLED_IDS ("notion, linear"), cleaned. */
export function enabledIds(list: string | undefined): string[] {
  return (list ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** The catalog entries switched on. An id that is not in the catalog is ignored. */
export function enabledCatalog(ids: string[], all: readonly ConnectorDef[] = CATALOG): ConnectorDef[] {
  return all.filter((c) => ids.includes(c.id));
}
