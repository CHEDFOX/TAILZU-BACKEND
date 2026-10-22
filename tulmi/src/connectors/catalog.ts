/**
 * THE CONNECTOR CATALOG: the apps Tailzu's assistant can act in, each one a
 * remote MCP server.
 *
 * Every entry is DISABLED until it is named in CONNECTORS_ENABLED_IDS.
 * Endpoints, transports and sign-in were read from each vendor's official docs
 * on 2026-10-22 (`docs` names the page, `notes` what it says). `verified: true`
 * means those docs confirm all three: the URL, the transport (this client
 * speaks Streamable HTTP only) and a sign-in route this code can drive (OAuth
 * with dynamic client registration, or a pasted token URL). It does NOT mean
 * tried against the live service: do that once, end to end, before an entry is
 * switched on for anybody. `verified: false` entries need something more (see
 * `notes`), for example a pre-registered client id, which oauth.ts does not do.
 * Vendors move these; read the page again when one stops working.
 *
 * `oneLine` and `aliases` are what the router matches an utterance against, so
 * aliases are the words people actually say ("calendar", "jira", "tickets"),
 * not product names alone.
 *
 * kind:
 *   "mcp"     (default) a remote MCP server the client in client.ts talks to.
 *   "native"  our own code against the vendor's documented REST API
 *             (src/connectors/google/), behind the same interface the engine
 *             uses: tools with names, descriptions, schemas and annotations,
 *             and call(tool, args). Router, risk gate, approvals, audit, cards
 *             and screens cannot tell the two apart. For these `verified: true`
 *             means the code was written against the vendor's documented API.
 *
 * auth:
 *   "oauth"  the vendor's OAuth. For an MCP app: MCP dynamic client
 *            registration, signed in on the vendor's page (oauth.ts). For a
 *            native Google app: authorization code + PKCE with our own
 *            registered client (google/oauth.ts). The screens treat both alike.
 *   "url"    a per-user secret URL the person pastes (Zapier MCP). It is the
 *            credential, so it is stored encrypted like a token, and it must
 *            be on the host of `url` below, over https.
 *   "none"   needs no permission at all (the email hand-off): there is nothing
 *            to connect, so it is `hidden` from the list of apps.
 */
export interface ConnectorDef {
  id: string;
  name: string;
  category: string;
  /** What it does, in a sentence. Used for routing, never shown as marketing. */
  oneLine: string;
  /** Words people say when they mean this app. */
  aliases: string[];
  /** The vendor's remote MCP endpoint (for "url" auth: the host the pasted URL must be on; for a native app: the REST API it calls). */
  url: string;
  auth: "oauth" | "url" | "none";
  /** "mcp" unless said otherwise. */
  kind?: "mcp" | "native";
  /** Native only: whose OAuth it is. */
  provider?: "google";
  /** Native OAuth only: the scopes asked, only when the person taps Connect on this app. All must be granted. */
  scopes?: string[];
  /** Not listed as an app to connect (the screens never see it); its tools are simply there. */
  hidden?: boolean;
  /** The vendor's official docs confirm the URL, the transport and a sign-in route this code can drive. */
  verified: boolean;
  /** What the docs say about transport and sign-in, and what is still missing. For us, never shown. */
  notes?: string;
  /** The official docs page the facts above were read from. */
  docs?: string;
}

export const CATALOG: readonly ConnectorDef[] = [
  {
    id: "notion", name: "Notion", category: "Docs",
    oneLine: "Search, read and write pages, databases and notes in Notion.",
    aliases: ["notion", "notes", "wiki", "page", "pages", "database"],
    url: "https://mcp.notion.com/mcp", auth: "oauth", verified: true,
    docs: "https://developers.notion.com/guides/mcp/get-started-with-mcp",
    notes: "Streamable HTTP at /mcp (recommended); /sse is a supported fallback. OAuth, and the server supports dynamic client registration (RFC 7591), per developers.notion.com/guides/mcp/build-mcp-client; keep the client_id it returns, since registering again orphans earlier grants. Business and Enterprise workspaces can also issue an MCP token sent as a bearer.",
  },
  {
    id: "linear", name: "Linear", category: "Projects",
    oneLine: "Find, create and update issues, projects and cycles in Linear.",
    aliases: ["linear", "issue", "issues", "ticket", "tickets", "bug", "bugs", "sprint", "cycle"],
    url: "https://mcp.linear.app/mcp", auth: "oauth", verified: true,
    docs: "https://linear.app/docs/mcp",
    notes: "Streamable HTTP at /mcp is primary (/mcp/readonly exposes read tools only); /sse is a deprecated fallback. OAuth 2.1 with dynamic client registration. An OAuth token or API key in an Authorization bearer header is also accepted.",
  },
  {
    id: "github", name: "GitHub", category: "Code",
    oneLine: "Read repositories, issues and pull requests, and comment or open them on GitHub.",
    aliases: ["github", "repo", "repository", "pull request", "pr", "commit", "commits", "branch"],
    url: "https://api.githubcopilot.com/mcp/", auth: "oauth", verified: false,
    docs: "https://github.com/github/github-mcp-server/blob/main/README.md",
    notes: "The docs show type http but never name Streamable HTTP. OAuth is the default sign-in, but each MCP host application must configure its own GitHub App or OAuth App (a pre-registered client id); dynamic client registration is not documented (also docs.github.com/en/copilot/how-tos/provide-context/use-mcp/set-up-the-github-mcp-server). A personal access token sent as a bearer is the documented alternative.",
  },
  {
    id: "atlassian", name: "Jira and Confluence", category: "Projects",
    oneLine: "Search and update Jira issues and read or write Confluence pages.",
    aliases: ["jira", "confluence", "atlassian", "ticket", "tickets", "issue", "issues", "epic", "backlog"],
    url: "https://mcp.atlassian.com/v2/mcp", auth: "oauth", verified: false,
    docs: "https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/",
    notes: "v2 is the current endpoint; the older /v1/mcp moves to v2 on 2027-03-01 and clients may need to clear cached client ids. The docs show type http but do not name Streamable HTTP or mention /sse. OAuth 2.1 is the primary sign-in; an API token is optional (admins control it). Dynamic client registration is not documented (also support.atlassian.com/atlassian-ai-gateway/docs/configure-oauth-2-1/).",
  },
  {
    id: "asana", name: "Asana", category: "Projects",
    oneLine: "See, create and complete tasks and projects in Asana.",
    aliases: ["asana", "task", "tasks", "to-do", "todo", "project", "projects"],
    url: "https://mcp.asana.com/v2/mcp", auth: "oauth", verified: false,
    docs: "https://developers.asana.com/docs/integrating-with-asanas-mcp-server",
    notes: "V2 is generally available at /v2/mcp over Streamable HTTP (developers.asana.com/docs/using-asanas-mcp-server); the old /sse beta is deprecated, shutdown 05/11/2026. OAuth, but \"Dynamic client registration is not supported\": the MCP app must be pre-registered in Asana's developer console for a client id and secret, which oauth.ts does not do yet. Bearer access tokens last one hour; refresh tokens renew them.",
  },
  {
    id: "zapier", name: "Zapier", category: "Automation",
    oneLine: "Reach thousands of apps (email, calendar, Slack, sheets and more) through the actions set up in Zapier.",
    aliases: ["zapier", "email", "gmail", "calendar", "slack", "sheet", "sheets", "spreadsheet", "meeting", "schedule"],
    url: "https://mcp.zapier.com/api/v1/connect", auth: "url", verified: true,
    docs: "https://docs.zapier.com/mcp/overview/how-connections-work",
    notes: "Streamable HTTP only, no SSE. Sign-in is OAuth through the MCP client, or a connection token made at mcp.zapier.com and sent as Authorization: Bearer or as ?token= on the URL; the person pastes that URL here. The docs do not say whether dynamic client registration is supported, and this entry does not use it. The docs prefer the header to a URL token.",
  },
  {
    id: "google-calendar", name: "Google Calendar", category: "Calendar", kind: "native", provider: "google",
    oneLine: "See your schedule, find free time, and add, move or cancel events in Google Calendar.",
    aliases: ["calendar", "google calendar", "meeting", "meetings", "schedule", "invite", "event", "events", "appointment", "free time", "availability", "busy"],
    scopes: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"],
    url: "https://www.googleapis.com/calendar/v3", auth: "oauth", verified: true,
    docs: "https://developers.google.com/workspace/calendar/api/v3/reference",
    notes: "Our own code against Calendar API v3 (events.list/insert/patch/delete, freeBusy.query, settings.get). OAuth 2.0 authorization code with PKCE, access_type=offline, tokens at oauth2.googleapis.com/token. calendar.events lets it change events, calendar.readonly lets it read the calendar's settings and free/busy; both are asked together. While Google reviews these (sensitive) scopes only listed test users can connect.",
  },
  {
    id: "google-docs", name: "Google Docs", category: "Docs", kind: "native", provider: "google",
    oneLine: "Write a new Google Doc from your words, or turn a meeting note into a Doc.",
    aliases: ["doc", "docs", "document", "google doc", "google docs", "write up", "meeting note", "minutes"],
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    url: "https://docs.googleapis.com/v1", auth: "oauth", verified: true,
    docs: "https://developers.google.com/workspace/docs/api/reference/rest/v1/documents",
    notes: "Our own code against Docs API v1 (documents.create and documents:batchUpdate), both of which accept the drive.file scope: Tailzu can only touch the Docs it makes itself, never the rest of the Drive. Same OAuth as Calendar.",
  },
];

/**
 * Apps that are simply there when CONNECTORS is on, with nothing to connect.
 * Not in CATALOG, so CONNECTORS_ENABLED_IDS neither turns them on nor off, and
 * not listed on the screens (`hidden`).
 *
 * The email hand-off writes an email in Gmail's compose window for the person
 * to check and send themselves. Tailzu never sees their mailbox and never
 * sends anything, so it asks for no permission at all.
 */
export const ALWAYS_ON: readonly ConnectorDef[] = [
  {
    id: "email-handoff", name: "Gmail", category: "Email", kind: "native", hidden: true,
    oneLine: "Write an email in Gmail for you to check and send yourself.",
    aliases: ["email", "e-mail", "mail", "gmail", "compose", "draft an email", "write an email", "send an email"],
    url: "https://mail.google.com/mail/", auth: "none", verified: true,
    docs: "https://www.rfc-editor.org/rfc/rfc6068",
    notes: "No API and no sign-in: a Gmail compose link (https://mail.google.com/mail/?view=cm&fs=1&to=&su=&body=) opened in the person's own browser, with a mailto: link (RFC 6068) as the fallback. Gmail does not document its compose link; it is long-standing and widely used, and if it ever stops working the mailto: still does. The person presses Send.",
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
