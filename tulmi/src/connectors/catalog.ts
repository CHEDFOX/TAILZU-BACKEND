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
 * Only the docs count. A sign-in seen only in the vendor's live OAuth metadata
 * (its /.well-known documents) is `verified: false`, with notes that say to try
 * it once live; so is a transport the docs show only as a client setting
 * (`--transport http`, `"type": "http"`) and never name. Some vendors also take
 * client ID metadata documents (CIMD); oauth.ts does not use them yet (it sets
 * no clientMetadataUrl), so for us dynamic client registration is the way in.
 *
 * `aliases` are the words people actually say for an app ("calendar", "jira",
 * "tickets"), not product names alone: the app search on the screens matches
 * them (registry.ts). The router does not pick a catalog app by them: which
 * app does a job (JOB_APPS, with the order among apps that share one) and the
 * names that pick an app outright (PRODUCTS) are in intent.ts, and a new
 * entry goes there too (tests/connector-routing.test.ts fails until it does).
 * `oneLine` and `aliases` still route an app the job tables do not know.
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
  /** "mcp" unless said otherwise. "device": run by the person's own computer, never here, and offered only to a request that carries `capability` (device.ts). */
  kind?: "mcp" | "native" | "device";
  /** Device apps only: the capability a request must carry for the planner to be offered this app. */
  capability?: string;
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
    notes: "v2 is the current endpoint (github.com/atlassian/atlassian-mcp-server: new setups should use /v2/mcp); the older /v1/mcp moves to v2 on 2027-03-01 and clients may need to clear cached client ids; /v1/sse ended 2026-06-30. The docs show type http but do not name Streamable HTTP. They say OAuth 2.1 (or an API token, if an admin allows it) but not how a client registers. The v2 authorization server (auth.atlassian.com, named by the 401's resource_metadata) offers both dynamic client registration and CIMD in its live metadata, but sign-in only works from an allowed domain: the default list is Atlassian's own (claude.ai, chatgpt.com, vscode.dev, localhost and others), so until Atlassian puts X0 Bot's callback domain on it, each org's admin must add it (support.atlassian.com/security-and-access-policies/docs/available-atlassian-rovo-mcp-server-domains/). Jira Service Management tools take an API token only. Not preRegistered: Atlassian's MCP server does not take a client made in its developer console (jira.atlassian.com/browse/ROVO-870, open as of 2026-07), so X0 Bot signs in with its client document (CIMD), else registers itself; the live try is what tells.",
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
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
    url: "https://www.googleapis.com/calendar/v3", auth: "oauth", verified: true,
    docs: "https://developers.google.com/workspace/calendar/api/v3/reference",
    notes: "Our own code against Calendar API v3, events.list/get/insert/patch/delete only, each of which lists calendar.events among its scopes (read 2026-10-22), so that is the one scope asked. The calendar's time zone is the timeZone field of an events.list answer on the primary calendar (\"The time zone of the calendar\", read with fields=timeZone, so no event comes with it), and free time is worked out from events.list over the window (singleEvents, orderBy startTime, maxAttendees=1): events marked transparent (Show me as Available) or declined by the person do not count, overlaps are merged. So neither settings.get nor freeBusy.query is called, and calendar.readonly, which they need, is not asked. Someone who connected before 2026-10-22 also granted calendar.readonly; with include_granted_scopes it stays in their grant, unused, until they disconnect the last Google app, and the callback accepts a grant with or without it. OAuth 2.0 authorization code with PKCE, access_type=offline, tokens at oauth2.googleapis.com/token. calendar.events is sensitive: while Google reviews it only listed test users can connect.",
  },
  {
    id: "google-docs", name: "Google Docs", category: "Docs", kind: "native", provider: "google",
    oneLine: "Write a new Google Doc from your words, or turn a meeting note into a Doc.",
    aliases: ["doc", "docs", "document", "google doc", "google docs", "write up", "meeting note", "minutes"],
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    url: "https://docs.googleapis.com/v1", auth: "oauth", verified: true,
    docs: "https://developers.google.com/workspace/docs/api/reference/rest/v1/documents",
    notes: "Our own code against Docs API v1 (documents.create and documents:batchUpdate), both of which accept the drive.file scope: X0 Bot can only touch the Docs it makes itself, never the rest of the Drive. Same OAuth as Calendar.",
  },
  {
    id: "google-tasks", name: "Google Tasks", category: "Tasks", kind: "native", provider: "google",
    oneLine: "See your to-do list, add a task or a reminder for a day, tick one off or delete it in Google Tasks.",
    aliases: ["google tasks", "tasks", "task", "to-do", "todo", "to-do list", "to do list", "remind me", "reminder", "reminders", "list", "kaam", "yaad dilana", "yaad dila do"],
    scopes: ["https://www.googleapis.com/auth/tasks"],
    url: "https://tasks.googleapis.com/tasks/v1", auth: "oauth", verified: true,
    docs: "https://developers.google.com/workspace/tasks/reference/rest",
    notes: "Our own code against Tasks API v1 (tasklists.list, tasks.list/insert/patch/delete). `tasks` is the one scope that writes (tasks.readonly only reads); Google treats it as sensitive. A task's due is a day only: the API records no time (\"It isn't possible to read or write the time that a task is scheduled for\"), so a time the person says goes in its notes. Same OAuth as Calendar.",
  },
  {
    id: "google-sheets", name: "Google Sheets", category: "Docs", kind: "native", provider: "google",
    oneLine: "Start a Google Sheet, add rows to one, or read one back: an expenses sheet, a list, a table.",
    aliases: ["google sheets", "google sheet", "sheet", "sheets", "spreadsheet", "expenses", "expense", "hisaab", "hisab", "kharcha", "budget", "table"],
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    url: "https://sheets.googleapis.com/v4", auth: "oauth", verified: true,
    docs: "https://developers.google.com/workspace/sheets/api/reference/rest",
    notes: "Our own code against Sheets API v4 (spreadsheets.create, spreadsheets.values.append and .get), each of which lists drive.file among its scopes, and Drive API v3 files.list/get to find a sheet by name (drive.file lists only the files X0 Bot made). drive.file is non-sensitive. X0 Bot can only touch the sheets it made itself. Values go in RAW, never as formulas.",
  },
  {
    id: "google-forms", name: "Google Forms", category: "Docs", kind: "native", provider: "google",
    oneLine: "Make a Google Form (a survey, a quiz, a poll) with its questions, and see who answered what.",
    aliases: ["google forms", "google form", "form", "forms", "quiz", "survey", "poll", "questionnaire", "responses", "sign-up form"],
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    url: "https://forms.googleapis.com/v1", auth: "oauth", verified: true,
    docs: "https://developers.google.com/workspace/forms/api/reference/rest",
    notes: "Our own code against Forms API v1 (forms.create, forms.batchUpdate, forms.setPublishSettings, forms.get, forms.responses.list), every one of which lists drive.file among its scopes, so no Forms scope (forms.body, forms.responses.readonly, both sensitive) is asked. Forms made through the API after 2026-06-30 start unpublished; X0 Bot creates with unpublished=true, adds the questions, then publishes. Same Drive lookup as Sheets.",
  },
  {
    id: "google-classroom", name: "Google Classroom", category: "School", kind: "native", provider: "google",
    oneLine: "See your classes, what classwork and homework is due and whether you turned it in, and the latest announcements in Google Classroom.",
    aliases: ["google classroom", "classroom", "class", "classes", "assignment", "assignments", "homework", "due", "classwork", "coursework", "announcement", "announcements", "padhai"],
    scopes: [
      "https://www.googleapis.com/auth/classroom.courses.readonly",
      "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
      "https://www.googleapis.com/auth/classroom.announcements.readonly",
    ],
    url: "https://classroom.googleapis.com/v1", auth: "oauth", verified: true,
    docs: "https://developers.google.com/workspace/classroom/reference/rest",
    notes: "Our own code against Classroom API v1, read only: courses.list (classroom.courses.readonly), courses.courseWork.list and courses.courseWork.studentSubmissions.list with userId=me (classroom.coursework.me.readonly), courses.announcements.list (classroom.announcements.readonly). All three sensitive. Due dates and times come in UTC. A school's Google Workspace admin can block third-party apps from Classroom data; then sign-in fails for that school's accounts.",
  },
  // More MCP apps, read 2026-10-22. Each offers dynamic client registration,
  // in its docs or only in its live metadata (then `verified: false`).
  // Their aliases are the product's name, and a job word only where no Google
  // app or hand-off says it: "tasks", "meeting" and "booking" are already
  // theirs. An app with no alias in the words still gets a little from a word
  // shared with its oneLine, so a oneLine leaves out a name that is an
  // everyday word ("monday", or the "com" of a .com).
  {
    id: "todoist", name: "Todoist", category: "Tasks",
    oneLine: "See, add, reschedule and complete tasks and projects in your Todoist to-do list.",
    aliases: ["todoist", "to doist"],
    url: "https://ai.todoist.net/mcp", auth: "oauth", verified: true,
    docs: "https://developer.todoist.com/api/v1/",
    notes: "\"Primary URL (Streamable HTTP): https://ai.todoist.net/mcp\". Dynamic client registration is documented (POST https://api.todoist.com/oauth/register, no auth, rate-limited, HTTPS redirect URIs, no review step); the live metadata points at todoist.com/oauth/register, which also exists, and the SDK uses the one it discovers. Registration defaults to client_secret_post, so ask for token_endpoint_auth_method none, as oauth.ts does. Scope data:read_write (deletes are data:delete, not asked). CIMD is documented too. On 2026-10-22 a registration with X0 Bot's details came back 201 and /authorize kept our redirect URI; the redirect after a real login was not tried.",
  },
  {
    id: "calendly", name: "Calendly", category: "Calendar",
    oneLine: "See your Calendly event types, open times and booked meetings, and book or cancel one.",
    aliases: ["calendly", "scheduling link"],
    url: "https://mcp.calendly.com", auth: "oauth", verified: false,
    docs: "https://developer.calendly.com/calendly-mcp-server",
    notes: "The docs give the URL (hosted at https://mcp.calendly.com, no path) and the sign-in: OAuth 2.1 with dynamic client registration (RFC 7591, https://calendly.com/oauth/register), PKCE S256, token_endpoint_auth_method none; no pre-registered app, no personal tokens. Scopes mcp:scheduling:read and mcp:scheduling:write. The docs never name the transport; live, a POST answers 401 with resource_metadata and an Mcp-Session-Id header, which is Streamable HTTP. Try once live. Registration is rate-limited; oauth.ts registers once per person and app and keeps it.",
  },
  {
    id: "granola", name: "Granola", category: "Meeting notes",
    oneLine: "Ask about your meetings in Granola: their notes, transcripts and what was decided.",
    aliases: ["granola", "transcript"],
    url: "https://mcp.granola.ai/mcp", auth: "oauth", verified: true,
    docs: "https://docs.granola.ai/help-center/sharing/integrations/mcp",
    notes: "Streamable HTTP at /mcp, OAuth found by metadata discovery, and \"Granola MCP uses Dynamic Client Registration\": no client id or secret to enter, no API key route. CIMD is documented only for Enterprise clients (private_key_jwt); the live metadata offers it generally. Nine tools, almost all reads (query_granola_meetings, list_meetings, get_meeting_transcript...). A free plan sees only the last 30 days and some tools are paid-only; an Enterprise admin must switch MCP on.",
  },
  {
    id: "otter", name: "Otter", category: "Meeting notes",
    oneLine: "Search your Otter meetings and read their transcripts and summaries.",
    aliases: ["otter", "transcript"],
    url: "https://mcp.otter.ai/mcp", auth: "oauth", verified: false,
    docs: "https://help.otter.ai/hc/en-us/articles/35287607569687-Otter-MCP-Server",
    notes: "The help article (refuses scripted reads; its text is at help.otter.ai/api/v2/help_center/en-us/articles/35287607569687.json, updated 2026-10-15) gives the URL and \"All access is OAuth-authenticated\", and states no plan requirement. It names neither the transport nor how a client registers: the docs don't state it; live metadata offers dynamic client registration (https://otter.ai/oauth/register) and the server answers as Streamable HTTP; try once live. Three tools, all reads (search, fetch, user info); scopes profile:read and conversations:read. Otter has no public API key.",
  },
  {
    id: "fireflies", name: "Fireflies", category: "Meeting notes",
    oneLine: "Search your Fireflies meetings, read their transcripts and summaries, and share one.",
    aliases: ["fireflies", "fire flies", "transcript"],
    url: "https://api.fireflies.ai/mcp", auth: "oauth", verified: false,
    docs: "https://docs.fireflies.ai/getting-started/mcp-configuration",
    notes: "Streamable HTTP only, at POST https://api.fireflies.ai/mcp (not docs.fireflies.ai/mcp, which only searches the docs). Sign-in is OAuth with the Fireflies account, or an API key as a bearer. How a client registers: the docs don't state it; live metadata offers dynamic client registration (https://api.fireflies.ai/register) and CIMD; try once live. fireflies_share_meeting sends a transcript to email addresses, but no word in its name reads as a send to risk.ts, so check on the live try that its annotations make it more than a write.",
  },
  {
    id: "evernote", name: "Evernote", category: "Notes",
    oneLine: "Search, read and create notes, notebooks and tags in Evernote.",
    aliases: ["evernote", "ever note"],
    url: "https://mcp.evernote.com/mcp", auth: "oauth", verified: true,
    docs: "https://dev.evernote.com/mcp/clients/any",
    notes: "\"A standard remote MCP server over Streamable HTTP with OAuth. Any compliant client can connect\", and clients with OAuth dynamic client registration \"connect with no manual setup\" (live: https://accounts.evernote.com/auth/register, token auth none, scopes read, create, write, delete). In beta, and only for paid personal, Business and Teams plans: a free (Basic) account is refused, which looks like a broken Connect.",
  },
  {
    id: "clickup", name: "ClickUp", category: "Projects",
    oneLine: "Find, create and update tasks, lists and docs in ClickUp.",
    aliases: ["clickup"],
    url: "https://mcp.clickup.com/mcp", auth: "oauth", verified: false,
    docs: "https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server",
    notes: "The docs give the URL, \"We only support OAuth\" (OAuth 2.1 with PKCE, no API keys) and, on the setup page (…-mcp-server-1), \"Dynamic Discovery (DCR)\". The transport appears only as --transport http and \"Transport Type: HTTP\", never named. ClickUp's blog says it \"maintains an allowlist of vetted MCP clients\" and says nowhere how to get on it, so whether our hosted redirect is accepted is untried. The live metadata grants authorization_code only, no refresh_token: expect \"Sign in again\" whenever a token runs out. Try once live.",
  },
  {
    id: "trello", name: "Trello", category: "Projects",
    oneLine: "See, add and move cards and lists on your Trello boards.",
    aliases: ["trello"],
    url: "https://mcp.trello.com/v1", auth: "oauth", verified: false,
    docs: "https://support.atlassian.com/trello/docs/connect-trello-to-ai-assistants-with-trello-mcp/",
    notes: "The docs give the URL, \"Trello MCP uses OAuth 2.0\" and no API tokens for MCP; the transport only as type http in a Cursor link. How a client registers: the docs don't state it; live metadata offers dynamic client registration and CIMD, on the same Atlassian authorization server as Jira (auth.atlassian.com); try once live. The same allowlist applies: \"Access to the domain is restricted\" means an org admin must allow X0 Bot's callback domain (Atlassian Administration, Connectors, Atlassian MCP server) until Atlassian adds it for everyone, and a Trello user with no admin cannot. Cards and lists are archived, never deleted.",
  },
  {
    id: "calcom", name: "Cal.com", category: "Calendar",
    oneLine: "See, book, reschedule or cancel your bookings, and check your availability.",
    aliases: ["cal.com", "calcom", "cal dot com"],
    url: "https://mcp.cal.com/mcp", auth: "oauth", verified: false,
    docs: "https://cal.com/docs/mcp-server",
    notes: "\"The hosted server uses Streamable HTTP transport with OAuth 2.1 authentication\", at https://mcp.cal.com/mcp, no API key. How a client registers: the docs don't state it; live metadata offers dynamic client registration (https://mcp.cal.com/oauth/register, PKCE S256, token auth none); try once live. The npx @calcom/cal-mcp server takes an API key and runs locally: not this.",
  },
  {
    id: "airtable", name: "Airtable", category: "Docs",
    oneLine: "Find, add and update records in your Airtable bases.",
    aliases: ["airtable"],
    url: "https://mcp.airtable.com/mcp", auth: "oauth", verified: false,
    docs: "https://airtable.com/developers/agents/mcp/getting-started",
    notes: "The docs give the URL and \"Our server supports Dynamic Client Registration (DCR)\" (also an admin-approved pre-registered app, and personal access tokens for scripts). No page names the transport: only claude mcp add --transport http in the support article. CIMD is in the live metadata only. Scopes include data.records:read/write and schema.bases:read/write. Try once live.",
  },
  {
    id: "monday", name: "Monday.com", category: "Projects",
    oneLine: "Find, create and update items on your boards.",
    aliases: ["monday.com", "monday dot com"],
    url: "https://mcp.monday.com/mcp", auth: "oauth", verified: true,
    docs: "https://developer.monday.com/api-reference/docs/mcp-dynamic-client-registration",
    notes: "\"Supports Streamable HTTP only at https://mcp.monday.com/mcp\" (developer.monday.com/api-reference/docs/integrate-with-monday-mcp; SSE is not supported). CIMD is recommended and dynamic client registration is the documented alternative: \"Any developer can use this path\". The docs name https://mcp.monday.com/register, but discovery gives https://auth.monday.com/oauth_ms/oauth/register, which the SDK uses. Until monday pre-approves X0 Bot (its MCP integration form), the consent screen says \"Admin approval required\" and an account admin must approve it and its redirect URI once: a person who is not their account's admin cannot connect before that. A personal API token as a bearer is the other route.",
  },
  {
    id: "make", name: "Make.com", category: "Automation",
    oneLine: "Run the on-demand scenarios you built in Make.",
    aliases: ["make.com", "make dot com", "make scenario", "integromat"],
    url: "https://mcp.make.com", auth: "oauth", verified: false,
    docs: "https://developers.make.com/mcp-server/make-mcp-server",
    notes: "OAuth at the universal URL https://mcp.make.com over \"stateless Streamable HTTP\"; the person picks the organization and the scopes (\"Run your scenarios\"). How a client registers: the docs don't state it; live metadata offers dynamic client registration (https://www.make.com/oauth/v2/register/mcp); try once live. Its token endpoint takes client_secret_post only, so registration may refuse a public client or hand back a client secret, which the store would keep beside the client id, not encrypted. Only on-demand scenarios are exposed, but one can send, post or change data in any app it touches. The token URL (https://<zone>/mcp/u/<token>) changes host by zone, so the pasted-URL route cannot take it.",
  },
  {
    id: "composio", name: "Composio", category: "Automation",
    oneLine: "Act in the many apps you linked to Composio.",
    aliases: ["composio"],
    url: "https://connect.composio.dev/mcp", auth: "oauth", verified: false,
    docs: "https://connect.composio.dev/api/onboarding/setup",
    notes: "\"Transport: HTTP (streamable HTTP)\" at https://connect.composio.dev/mcp, with an OAuth sign-in prompt; a consumer API key (ck_...) in x-consumer-api-key is the other route. How a client registers: the docs don't state it; live metadata offers dynamic client registration (https://login.composio.dev/oauth2/register, token auth none); try once live. Never the developer URLs (backend.composio.dev/v3/mcp/...), and docs.composio.dev/mcp describes an old SSE host. Its tools act in 1000+ apps, each judged by risk.ts.",
  },
  {
    id: "pipedream", name: "Pipedream", category: "Automation",
    oneLine: "Act in the many apps you linked to Pipedream.",
    aliases: ["pipedream", "pipe dream"],
    url: "https://mcp.pipedream.net/v2", auth: "oauth", verified: false,
    docs: "https://pipedream.com/docs/connect/mcp/users",
    notes: "The docs and the 2025-10-01 changelog give https://mcp.pipedream.net/v2 and \"OAuth authentication with a static URL\", but neither the transport nor how a client registers: the docs don't state it; live metadata offers dynamic client registration; try once live. The 401 names no resource_metadata and /.well-known/oauth-protected-resource/v2 is a 404; the root one names https://mcp.pipedream.com (register at /api/oauth/register, token auth none), and the SDK falls back to the root on that 404. An app not yet linked in Pipedream answers a tool call with a link to connect it, which reaches the planner only as text. remote.mcp.pipedream.net is the developer server: not this.",
  },
];

/**
 * Apps that are simply there when CONNECTORS is on, with nothing to connect:
 * the hand-offs (src/connectors/handoffs), and YouTube's search. Not in
 * CATALOG, so CONNECTORS_ENABLED_IDS neither turns them on nor off (an old
 * "google-youtube" left there is an id the catalog no longer has, ignored
 * like any other), and not listed on the screens (`hidden`).
 *
 * Each hand-off opens another app on the person's own device with everything
 * filled in (an email in Gmail, a message in WhatsApp, a payment in their UPI
 * app, a route in Maps) for them to finish there. Tailzu never sees the
 * account, never sends and never pays, so they ask for no permission and need
 * no key. `url` is the link each one opens; `verified: true` means the vendor
 * documents that link, `false` that it is the vendor's own search address,
 * long-standing but undocumented (see `notes`).
 *
 * YouTube's search asks for no permission either: it reads YouTube's public
 * search results with Tailzu's own API key (YOUTUBE_API_KEY), never anyone's
 * account, and without the key it opens YouTube's own search instead, as the
 * play hand-off does. Its `url` is the API it calls.
 */
const handoff = (o: Pick<ConnectorDef, "id" | "name" | "category" | "oneLine" | "aliases" | "url" | "verified" | "notes" | "docs">): ConnectorDef =>
  ({ ...o, kind: "native", hidden: true, auth: "none" });

export const ALWAYS_ON: readonly ConnectorDef[] = [
  handoff({
    id: "email-handoff", name: "Gmail", category: "Email",
    oneLine: "Write an email in Gmail for you to check and send yourself.",
    aliases: ["email", "e-mail", "mail", "gmail", "compose", "draft an email", "write an email", "send an email"],
    url: "https://mail.google.com/mail/", verified: true,
    docs: "https://www.rfc-editor.org/rfc/rfc6068",
    notes: "No API and no sign-in: a Gmail compose link (https://mail.google.com/mail/?view=cm&fs=1&to=&su=&body=) opened in the person's own browser, with a mailto: link (RFC 6068) as the fallback. Gmail does not document its compose link; it is long-standing and widely used, and if it ever stops working the mailto: still does. The person presses Send.",
  }),
  handoff({
    id: "whatsapp", name: "WhatsApp", category: "Messages",
    oneLine: "Write a WhatsApp message to someone for you to send yourself.",
    aliases: ["whatsapp", "whats app", "message", "tell", "text", "msg", "chat", "message karo", "bata do", "bol do"],
    url: "https://wa.me/", verified: true,
    docs: "https://faq.whatsapp.com/5913398998672934",
    notes: "WhatsApp's click to chat: https://wa.me/<number>?text=<message> opens that chat with the message written; https://wa.me/?text=<message> lets the person pick the chat. The number is digits only with the country code (no +, zeros, brackets or dashes). The Help Center page draws itself with a script, so on 2026-10-22 its text was read from copies of it; the format is long-standing.",
  }),
  handoff({
    id: "telegram", name: "Telegram", category: "Messages",
    oneLine: "Write a Telegram message for you to send yourself.",
    aliases: ["telegram", "tg", "telegram message"],
    url: "https://t.me/", verified: true,
    docs: "https://core.telegram.org/api/links",
    notes: "Public username links t.me/<username>?text=<draft> put the draft in that chat's text box; share links t.me/share/url?url=<url>&text=<text> ask which chat. The share link's url is its one required field and goes first in the text box, so a message with no link of its own is sent as the url.",
  }),
  handoff({
    id: "phone", name: "Phone", category: "Calls",
    oneLine: "Call a number, or write a text message, on your phone for you to tap Call or Send.",
    aliases: ["call", "phone", "ring", "dial", "sms", "text message", "call karo", "phone karo"],
    url: "tel:", verified: true,
    docs: "https://www.rfc-editor.org/rfc/rfc5724",
    notes: "tel: (RFC 3966) opens the dialer; sms:<number>?body=<text> (RFC 5724) opens Messages with the text written, the same link the phone app's own sms action writes. Phone only: a computer is told to ask on the phone.",
  }),
  handoff({
    id: "upi", name: "UPI", category: "Payments",
    oneLine: "Fill in a UPI payment in your UPI app for you to check and pay with your PIN.",
    aliases: ["pay", "upi", "gpay", "google pay", "phonepe", "phone pe", "paytm", "bhim", "send money", "transfer money", "paise bhejo", "pay karo", "payment"],
    url: "upi://pay", verified: true,
    docs: "https://www.npci.org.in/PDF/npci/upi/circular/2017/Circular%20on%20Non-compliance%20of%20UPI%20apps%20to%20Deeplinking%20specs%20Circular%2037-%201.11.2017.pdf",
    notes: "NPCI's UPI Linking Specification (deep linking; NPCI circular 37 of 2017 holds every UPI app to it): upi://pay?pa=<vpa>&pn=<name>&am=<amount>&cu=INR&tn=<note>, pa and pn required, INR the only currency. The specification is not on a public NPCI page (npci.org.in refuses scripted reads); a copy of its v1.6 draft was read on 2026-10-22. Phone only. Some UPI apps decline a prefilled payment to a personal UPI ID (one that is not a merchant's); the PIN is always the person's own, typed in their UPI app. X0 Bot pays nothing.",
  }),
  handoff({
    id: "maps", name: "Google Maps", category: "Travel",
    oneLine: "Open directions to a place, or find a place, in Google Maps.",
    aliases: ["directions", "direction", "navigate", "navigation", "map", "maps", "google maps", "route", "raasta", "rasta", "near me", "nearby"],
    url: "https://www.google.com/maps/", verified: true,
    docs: "https://developers.google.com/maps/documentation/urls/get-started",
    notes: "Maps URLs: https://www.google.com/maps/dir/?api=1&destination=..&travelmode=driving|walking|bicycling|two-wheeler|transit and https://www.google.com/maps/search/?api=1&query=..; at most 2,048 characters. They open the Maps app on a phone.",
  }),
  handoff({
    id: "uber", name: "Uber", category: "Travel",
    oneLine: "Open Uber with a ride to a place for you to book.",
    aliases: ["uber", "cab", "taxi", "ride", "book a cab", "book a ride"],
    url: "https://m.uber.com/ul/", verified: false,
    docs: "https://developer.uber.com/docs/riders/ride-requests/tutorials/deep-links/introduction",
    notes: "https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=.. is Uber's older universal link, still widely used. Uber's page now documents uber://?action=setPickup&pickup=my_location&dropoff[..] and https://m.uber.com/looking?drop[0]=<Location JSON>, both with coordinates; a drop given only as an address is not documented. Try it on a phone before relying on it.",
  }),
  handoff({
    id: "shopping", name: "Shopping", category: "Shopping",
    oneLine: "Search Amazon or Flipkart for something to buy.",
    aliases: ["buy", "order", "shop", "shopping", "amazon", "flipkart", "kharido", "mangao", "mangwa do"],
    url: "https://www.amazon.in/s", verified: false,
    notes: "https://www.amazon.in/s?k=.. and https://www.flipkart.com/search?q=.. are the addresses each site's own search box goes to. Neither is documented as a link format.",
  }),
  handoff({
    id: "play", name: "Play", category: "Music and video",
    oneLine: "Find a song or a video on YouTube, YouTube Music or Spotify to play.",
    aliases: ["play", "song", "songs", "music", "video", "videos", "youtube", "yt", "youtube music", "spotify", "listen", "gaana", "gana", "bajao", "chalao"],
    url: "https://www.youtube.com/results", verified: false,
    notes: "https://www.youtube.com/results?search_query=.., https://music.youtube.com/search?q=.. and https://open.spotify.com/search/.. are each service's own search address, opened in its app on a phone. None is documented as a link format.",
  }),
  handoff({
    id: "threads", name: "Threads", category: "Social",
    oneLine: "Write a Threads post for you to check and post yourself.",
    aliases: ["threads", "post on threads", "thread post", "post"],
    url: "https://www.threads.com/intent/post", verified: true,
    docs: "https://developers.facebook.com/docs/threads/threads-web-intents",
    notes: "Threads Web Intents: https://www.threads.com/intent/post?text=.. (Meta's page names threads.com; threads.net links still redirect). On a phone it opens the Threads app. A post is at most 500 characters.",
  }),
  handoff({
    id: "booking", name: "Booking.com", category: "Travel",
    oneLine: "Find hotels in a place on Booking.com for you to pick and book.",
    aliases: ["hotel", "hotels", "booking", "booking com", "stay", "room", "rooms"],
    url: "https://www.booking.com/searchresults.html", verified: false,
    notes: "https://www.booking.com/searchresults.html?ss=<place>&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&group_adults=<n>&no_rooms=1 is what Booking.com's own search form sends. It is not documented publicly.",
  }),
  // Last, so a hand-off wins a tie: "play X on YouTube" is the play hand-off's.
  handoff({
    id: "youtube", name: "YouTube", category: "Music and video",
    oneLine: "Find YouTube videos for some words, with their titles, channels and links.",
    // Not "video" alone: it is on for everyone, a search spends the day's
    // shared 100, and "edit the video" or "send the video on WhatsApp" are
    // not searches. A video with no YouTube said is the play hand-off's,
    // which opens YouTube's own search for nothing.
    aliases: ["youtube", "you tube", "yt", "youtube search", "search youtube", "youtube pe", "youtube par", "video dhoondo", "video dikhao"],
    url: "https://www.googleapis.com/youtube/v3/search", verified: true,
    docs: "https://developers.google.com/youtube/v3/docs/search/list",
    notes: "Our own code against YouTube Data API v3 search.list (part=snippet, type=video, maxResults=5), called with the server's API key (YOUTUBE_API_KEY, from the same Google Cloud project, restricted to YouTube Data API v3; sent in the x-goog-api-key header, never in the address) and no OAuth: search results are public, so there is no sign-in and no Google scope. Quota: a search costs 100 of the project's 10,000 units a day (search.list's page now says it is a bucket of its own, 100 calls a day), shared by everyone, so about 100 searches a day until Google raises it. Without the key, on 403 quotaExceeded, or when Google can't be reached, it opens https://www.youtube.com/results?search_query=.. through the play hand-off instead. Playing a video is the play hand-off, not this. It replaces google-youtube (OAuth, the youtube scope, playlists), dropped 2026-10-22.",
  }),
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
