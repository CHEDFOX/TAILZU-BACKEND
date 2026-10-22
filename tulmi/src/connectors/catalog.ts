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
 * `notes`), for example a pre-registered client id (`preRegistered`), which has
 * to be made in the vendor's console and put in CONNECTOR_OAUTH_CLIENTS first.
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
 *   "oauth"  the vendor's OAuth. For an MCP app, signed in on the vendor's page
 *            (oauth.ts) as, in order: a client registered with the vendor in
 *            advance (CONNECTOR_OAUTH_CLIENTS), Tailzu's published client
 *            document (CIMD), or dynamic client registration. For a native
 *            Google app: authorization code + PKCE with our own registered
 *            client (google/oauth.ts). The screens treat both alike.
 *   "url"    a per-user secret URL the person pastes (Zapier MCP). It is the
 *            credential, so it is stored encrypted like a token, and it must
 *            be on the host of `url` below, over https.
 *   "none"   needs no permission at all (the email hand-off): there is nothing
 *            to connect, so it is `hidden` from the list of apps.
 *
 * An app a person added by link (connector_custom, customDef below) is a
 * ConnectorDef too, with `custom` set. Nobody vetted it, so everything that
 * would trust a catalog app treats it as a stranger: strict sign-in checks
 * (oauth.ts), a cleaned and pinned tool list (hygiene.ts), a per-tool policy
 * instead of a level (risk.ts), and the planner sees it only when the person
 * names it (router.ts). Its `auth` is "oauth" even when its server needs no
 * sign-in (`custom.authless`): "none" means "nothing to ask permission for"
 * here, and every app a person added asks.
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
  /**
   * The vendor registers no client on its own (no dynamic registration, no
   * client document): signing in needs a client made in its console, in
   * CONNECTOR_OAUTH_CLIENTS under this id. Without one, Connect answers
   * "not set up yet" (503) instead of sending anyone to a page that fails.
   */
  preRegistered?: true;
  /** The vendor's official docs confirm the URL, the transport and a sign-in route this code can drive. */
  verified: boolean;
  /** What the docs say about transport and sign-in, and what is still missing. For us, never shown. */
  notes?: string;
  /** The official docs page the facts above were read from. */
  docs?: string;
  /** Set only on an app a person added by link: whose it is and how it signs in. */
  custom?: CustomApp;
}

/** What an app added by link carries beyond a catalog entry. */
export interface CustomApp {
  ownerId: string;
  /** The server answered without asking anyone to sign in. */
  authless?: boolean;
  /** Where its server is, for the words on the screens ("mcp.example.com"). */
  host: string;
  /** The person's own OAuth client: its id, its secret (encrypted) and, once a sign-in found it, its auth server. */
  client?: { id: string; secretEnc?: string; issuer?: string };
  /** Where its last sign-in sent the person ("auth.example.com"), for "You'll sign in at ..." */
  signInHost?: string;
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
    url: "https://api.githubcopilot.com/mcp/", auth: "oauth", preRegistered: true, verified: false,
    docs: "https://github.com/github/github-mcp-server/blob/main/README.md",
    notes: "The docs show type http but never name Streamable HTTP. OAuth is the default sign-in, but each MCP host application must configure its own GitHub App or OAuth App (a pre-registered client id, in CONNECTOR_OAUTH_CLIENTS with issuer https://github.com/login/oauth, the auth server its resource metadata names); dynamic client registration is not documented (also docs.github.com/en/copilot/how-tos/provide-context/use-mcp/set-up-the-github-mcp-server). A personal access token sent as a bearer is the documented alternative.",
  },
  {
    id: "atlassian", name: "Jira and Confluence", category: "Projects",
    oneLine: "Search and update Jira issues and read or write Confluence pages.",
    aliases: ["jira", "confluence", "atlassian", "ticket", "tickets", "issue", "issues", "epic", "backlog"],
    url: "https://mcp.atlassian.com/v2/mcp", auth: "oauth", verified: false,
    docs: "https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/",
    notes: "v2 is the current endpoint; the older /v1/mcp moves to v2 on 2027-03-01 and clients may need to clear cached client ids. The docs show type http but do not name Streamable HTTP or mention /sse. OAuth 2.1 is the primary sign-in; an API token is optional (admins control it). Not preRegistered: its live auth server metadata (issuer auth.atlassian.com/<tenant>, read 2026-10-22) lists client_id_metadata_document_supported, a registration endpoint, S256 and \"none\", so Tailzu signs in with its client document (CIMD), else registers itself; and Atlassian's MCP server does not take a client made in its developer console (an OAuth 2.0 / 3LO app: jira.atlassian.com/browse/ROVO-870, \"exclusively uses OAuth 2.1 with Dynamic Client Registration\", open as of 2026-07). Each Atlassian organisation's admin decides which domains may connect (Atlassian Administration, Rovo MCP server, Domains; support.atlassian.com/security-and-access-policies/docs/control-atlassian-mcp-server-settings/), so the live try is what tells.",
  },
  {
    id: "asana", name: "Asana", category: "Projects",
    oneLine: "See, create and complete tasks and projects in Asana.",
    aliases: ["asana", "task", "tasks", "to-do", "todo", "project", "projects"],
    url: "https://mcp.asana.com/v2/mcp", auth: "oauth", preRegistered: true, verified: false,
    docs: "https://developers.asana.com/docs/integrating-with-asanas-mcp-server",
    notes: "V2 is generally available at /v2/mcp over Streamable HTTP (developers.asana.com/docs/using-asanas-mcp-server); the old /sse beta is deprecated, shutdown 05/11/2026. OAuth, but \"Dynamic client registration is not supported\": the MCP app must be pre-registered in Asana's developer console for a client id and secret, which go in CONNECTOR_OAUTH_CLIENTS (issuer https://app.asana.com, per its live metadata on 2026-10-22). Bearer access tokens last one hour; refresh tokens renew them.",
  },
  {
    id: "zapier", name: "Zapier", category: "Automation",
    oneLine: "Reach thousands of apps (email, calendar, Slack, sheets and more) through the actions set up in Zapier.",
    aliases: ["zapier", "email", "gmail", "calendar", "slack", "sheet", "sheets", "spreadsheet", "meeting", "schedule"],
    url: "https://mcp.zapier.com/api/v1/connect", auth: "url", verified: true,
    docs: "https://docs.zapier.com/mcp/overview/how-connections-work",
    notes: "Streamable HTTP only, no SSE. Sign-in is OAuth through the MCP client, or a connection token made at mcp.zapier.com and sent as Authorization: Bearer or as ?token= on the URL; the person pastes that URL here. The docs do not say whether dynamic client registration is supported, and this entry does not use it. The docs prefer the header to a URL token, so a pasted ?token= is sent as Authorization: Bearer (client.ts); the link is stored as pasted.",
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

// ------------------------------------------------------------- apps added by link

/** The category every app a person added shows under. */
export const CUSTOM_CATEGORY = "Added by you";

/** The ConnectorDef of an app a person added by link. */
export function customDef(row: {
  id: string; userId: string; name: string; url: string; auth: "oauth" | "none";
  clientId: string | null; clientSecretEnc: string | null; clientIssuer: string | null; signInHost?: string | null;
}): ConnectorDef {
  const host = new URL(row.url).host;
  return {
    id: row.id, name: row.name, category: CUSTOM_CATEGORY,
    // Our words, not the server's: what an app says about itself is not read until it is cleaned (hygiene.ts).
    oneLine: `An app you added, at ${host}.`,
    aliases: [], url: row.url, auth: "oauth", verified: false,
    custom: {
      ownerId: row.userId, host,
      ...(row.auth === "none" ? { authless: true } : {}),
      ...(row.signInHost ? { signInHost: row.signInHost } : {}),
      ...(row.clientId ? {
        client: {
          id: row.clientId,
          ...(row.clientSecretEnc ? { secretEnc: row.clientSecretEnc } : {}),
          ...(row.clientIssuer ? { issuer: row.clientIssuer } : {}),
        },
      } : {}),
    },
  };
}

/**
 * Where the catalog's vendors sign people in, beyond the hosts of their MCP
 * servers: the auth servers named in the catalog's notes (GitHub's, Asana's,
 * Atlassian's tenants under auth.atlassian.com) and Google's own sign-in.
 * Compared by site (siteOf), so a vendor moving between its own hosts is
 * still caught; Notion's and Linear's are their MCP hosts' sites, counted
 * from the catalog itself.
 */
const VENDOR_SIGN_IN_HOSTS = ["github.com", "auth.atlassian.com", "app.asana.com", "accounts.google.com"];

/**
 * Second-level labels under which a registrable domain takes three labels
 * ("example.co.uk"), for the countries Tailzu's people are mostly in. Not the
 * whole public suffix list: siteOf only has to tell our vendors' sites apart
 * from the rest, and none of them sits under a suffix like these.
 */
const TWO_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "co.in", "net.in", "org.in", "gov.in", "ac.in", "com.au", "net.au", "org.au",
  "co.nz", "co.jp", "ne.jp", "com.br", "com.cn", "com.sg", "com.hk", "co.za", "com.mx", "co.kr", "com.tr",
]);

/** The registrable domain of a hostname ("auth.notion.com" -> "notion.com"); an address stays as it is. */
export function siteOf(hostname: string): string {
  const h = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (/^[\d.]+$/.test(h) || h.includes(":")) return h;
  const labels = h.split(".").filter(Boolean);
  const take = labels.length >= 3 && TWO_PART_SUFFIXES.has(labels.slice(-2).join(".")) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/**
 * The sites where the catalog's vendors sign people in: their MCP servers'
 * and auth servers' hosts, and the issuers of the clients registered with
 * them (CONNECTOR_OAUTH_CLIENTS). An app added by link that sends people to
 * sign in at one of these, from somewhere else, is refused (oauth.ts): with
 * Tailzu's one client id, the person would sign in to their real Notion and
 * the token would go to a stranger's server.
 */
export function vendorSites(issuers: Iterable<string> = []): Set<string> {
  const hosts = [...CATALOG, ...ALWAYS_ON].map((c) => new URL(c.url).hostname);
  for (const i of issuers) { try { hosts.push(new URL(i).hostname); } catch { /* not a URL: nothing to add */ } }
  return new Set([...hosts, ...VENDOR_SIGN_IN_HOSTS].map(siteOf));
}
