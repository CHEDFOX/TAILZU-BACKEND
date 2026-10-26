# The GitHub App for the Code bot

For the owner. The Code bot works in a person's repos through a GitHub App
that Tailzu owns and each person installs on their own account. This page
covers making that App, the settings the server reads from it, and what it
can and cannot do. The code is in `tulmi/src/code/` and
`tulmi/src/routes/code.ts`.

You need to do four things, in this order:

1. Create the App (below), and write down what GitHub gives you.
2. Run the migration `tulmi/supabase/migrations/0020_code_github.sql`.
3. Put the values in `tulmi/.env` and switch `CODE_GITHUB` on.
4. Install it on your own account and try it (section 4).

The whole feature is off by default. While `CODE_GITHUB` is false every
`/v1/code/*` route answers `404 {"code":"code_off"}`; on, but with any part of
the App missing, they answer `503 {"code":"not_configured"}`.

---

## 1. Create the App

Make it under the account that should own it (your own, or the company's
organisation: `https://github.com/organizations/<org>/settings/apps/new`).
Pick one of the two ways.

### A. By hand

`https://github.com/settings/apps/new`, then:

| Field | Value |
| --- | --- |
| GitHub App name | `Tailzu Code`, or any name nobody has taken. The URL name that GitHub makes from it (`github.com/apps/<slug>`) is `GITHUB_APP_SLUG` |
| Homepage URL | `https://www.tailzu.space` |
| Callback URL | `https://api.tailzu.space/v1/code/github/callback` |
| Request user authorization (OAuth) during installation | **On** |
| Expire user authorization tokens | Leave on. The server uses the person's token once, at once |
| Setup URL | GitHub turns this field off while OAuth during installation is on. The callback URL above is where installs come back |
| Webhook: Active | On |
| Webhook URL | `https://api.tailzu.space/v1/code/github/webhook` |
| Webhook secret | `openssl rand -hex 32`. This is `GITHUB_APP_WEBHOOK_SECRET` |
| SSL verification | Enable |
| Repository permissions | **Contents: Read and write.** **Pull requests: Read and write.** **Metadata: Read-only** (GitHub sets this one itself). Nothing else, and in particular not Workflows |
| Account and organization permissions | None |
| Subscribe to events | Tick **Pull request** and **Pull request review** (they only appear once Pull requests is given). `installation` and `installation_repositories` are sent to every App without being asked for, and this server reads those too |
| Where can this GitHub App be installed? | **Any account.** With "Only on this account" nobody but you could install it |

Create it, then on the App's page:

* copy **Client ID** (`GITHUB_APP_CLIENT_ID`) and **App ID** (`GITHUB_APP_ID`);
* **Generate a new client secret** (`GITHUB_APP_CLIENT_SECRET`), shown once;
* **Generate a private key**: a `.pem` file downloads once (`GITHUB_APP_PRIVATE_KEY`).

### B. From a manifest

The manifest below makes the same App in one go. GitHub takes it as a form
post, not a link, so save this as `make-app.html`, open it in a browser where
you are signed in to GitHub, and press the button:

```html
<form method="post" action="https://github.com/settings/apps/new?state=tailzu">
  <input type="hidden" name="manifest" id="manifest">
  <button>Create the Tailzu Code App</button>
</form>
<script>
  document.getElementById("manifest").value = JSON.stringify(MANIFEST_JSON_FROM_BELOW);
</script>
```

The manifest (replace `MANIFEST_JSON_FROM_BELOW` above with it; change the
name if it is taken, and the origin if the API is not at `api.tailzu.space`):

```json
{
  "name": "Tailzu Code",
  "url": "https://www.tailzu.space",
  "description": "Lets Tailzu's Code bot read your chosen repos and open draft pull requests from its own tailzu/ branches. It never writes to your default branch.",
  "hook_attributes": {
    "url": "https://api.tailzu.space/v1/code/github/webhook",
    "active": true
  },
  "redirect_url": "https://api.tailzu.space/v1/code/github/callback",
  "callback_urls": ["https://api.tailzu.space/v1/code/github/callback"],
  "request_oauth_on_install": true,
  "public": true,
  "default_permissions": {
    "contents": "write",
    "pull_requests": "write",
    "metadata": "read"
  },
  "default_events": ["pull_request", "pull_request_review"]
}
```

`default_events` lists the two events the server follows a pull request's life
with (closed, reopened, ready for review; a review submitted). GitHub sends
`installation` and `installation_repositories` to every App and does not let
you subscribe to them, and a manifest that lists them can be refused, so they
are not here. There is no `workflows` permission, no `issues`, nothing else.

GitHub then sends you to `redirect_url` with a one-time `code` in the address.
That page says "That didn't work" (it is the install callback, and this is not
an install); that is fine. Copy the `code=` value from the address bar and,
within the hour, trade it for the App's secrets:

```bash
curl -s -X POST https://api.github.com/app-manifests/CODE/conversions > app.json
jq -r '.slug, .id, .client_id' app.json     # GITHUB_APP_SLUG, GITHUB_APP_ID, GITHUB_APP_CLIENT_ID
jq -r .client_secret app.json               # GITHUB_APP_CLIENT_SECRET
jq -r .webhook_secret app.json              # GITHUB_APP_WEBHOOK_SECRET
jq -r .pem app.json | base64 -w0            # GITHUB_APP_PRIVATE_KEY (base64 of the PEM)
```

Keep `app.json` only as long as it takes to fill in `.env`, then delete it:
it holds everything that acts as the App.

---

## 2. The settings

In `tulmi/.env` (also listed in `tulmi/.env.example`):

| Variable | What it is |
| --- | --- |
| `CODE_GITHUB` | `true` to switch the Code bot on. Default `false` |
| `GITHUB_APP_ID` | The App's number. Only used as the JWT's issuer when there is no client id |
| `GITHUB_APP_SLUG` | The App's URL name. The install link is `https://github.com/apps/<slug>/installations/new` |
| `GITHUB_APP_CLIENT_ID` | The client id (`Iv23...`). The JWT's issuer, and the OAuth client of the install step |
| `GITHUB_APP_CLIENT_SECRET` | The client secret. Secret |
| `GITHUB_APP_PRIVATE_KEY` | The `.pem`: raw, or base64 of it. An env file can't hold line breaks, so use `base64 -w0 key.pem`, or write the line breaks as `\n`. Secret, and the most powerful thing on this page: it signs in as the App to every repo it is installed on |
| `GITHUB_APP_WEBHOOK_SECRET` | The webhook secret. Secret. Use one with no `$` in it (Docker Compose rewrites those in env files) |
| `CONNECTOR_TOKEN_KEY` | Already set for Connected apps. The Code bot signs the install link's `state` with a key made from it, so without it nothing can be connected |

None of the secrets is ever logged or sent to a device. The server does not
store any GitHub token: the person's own token is used once and dropped, and
the App's tokens (one hour, one repo each) live in the server's memory.

Then run `tulmi/supabase/migrations/0020_code_github.sql` in the Supabase SQL
editor (or re-run `full_schema.sql`), and restart the server.

---

## 3. What happens when someone connects

1. In Tailzu, the person taps Connect GitHub. The server answers with the
   install link, carrying a signed `state` (ten minutes) that names them.
2. They pick the account and the repos on GitHub's page and install. Because
   "Request user authorization during installation" is on, GitHub sends them
   back to the callback URL with a one-time `code`, the `installation_id` and
   the `state`.
3. The server trades the `code` for the person's own GitHub token, asks GitHub
   which installs that token can reach, and links the install **only if its id
   is one of them**. That is what stops anyone claiming an install by putting
   its number in a link. With the same token it reads who the person is on
   GitHub (their id and login) and keeps those on the link. The token is then
   thrown away.
4. If the person is not an owner of the organisation, GitHub sends
   `setup_action=request` instead: the owner has to approve first, and the page
   says so. Nothing is linked until they connect again after the approval.
5. They pick a repo as a project, and Tailzu makes a work branch
   `tailzu/<words-from-the-task>-<4 hex>` from the default branch's head.

A repo that doesn't exist yet: Tailzu gives the person a link that opens GitHub's
"new repository" page with the name filled in and Private chosen
(`GET /v1/code/new-repo-link?name=`); the person creates it themselves, so the
App never needs the Administration permission. A repo with no commits can be
added as a project but has nothing to branch from: Tailzu says so
(`repo_empty`), and `POST /v1/code/projects/:id/init` writes one `README.md`
with the project's title as its first commit (below, the first of two
exceptions to "never the default branch").

After the branch is made, the work goes on through these (all under
`/v1/code/projects/:id/branches/:branch`, with the branch URL-encoded):

| | |
| --- | --- |
| `POST .../sync` | merges the default branch **into** the work branch to keep it current. A conflict is never resolved or forced: the branch is marked `conflict` and the person is told |
| `GET .../diff` | what the branch changes: commits (first line), files with status and line counts, 300 files at most. Never file contents |
| `GET .../pr`, `.../pr/comments` | where the pull request is (state, draft, mergeable, head, review decision, review comments), and what reviewers wrote, 100 comments at most. That text is other people's: it is data for the bot to read, never instructions |
| `POST .../pr/ready`, `.../pr/close` | take it out of draft (GitHub's GraphQL `markPullRequestReadyForReview`; REST has no way), or close it without merging |
| `POST .../pr/merge` | two steps. With no body it merges nothing and returns an approval id and a summary (title, base, files, additions, deletions, head commit). With `{approvalId}` it squash-merges exactly that commit; if the branch moved, `changed_since_approval`. An approval is single use, kept in the server's memory for ten minutes, and bound to the person, project, branch and head commit. The phone will put Face ID in front of the second step |
| `DELETE .../branches/:branch` | once the pull request is merged or closed, deletes the branch from GitHub (only `tailzu/` branches); the record stays, with the state `deleted` |

A branch's state is `active`, `pr_open`, `conflict`, `merged`, `closed` or
`deleted`, kept up as these happen and by GitHub's `pull_request` and
`pull_request_review` webhooks (matched by repo and branch name, and only for a
branch in that same repo, not a fork's).

Removing Tailzu in Tailzu forgets the link and the projects on Tailzu's side
and gives the person the GitHub page where the install can really be removed.
Removing it on GitHub (or suspending it) reaches Tailzu through the webhook.

---

## 4. Check it works

* `GET /v1/code/github` with a signed-in token answers
  `{"configured":true,"connected":false,"installations":[]}`.
* Install the App on your own account (use the install link from
  `POST /v1/code/github/connect`), and the page should say "GitHub connected".
* On the App's page on GitHub, **Advanced** shows every webhook delivery with
  its response. A delivery that answers 401 has the wrong
  `GITHUB_APP_WEBHOOK_SECRET`; 503 means the server has none; 404 means
  `CODE_GITHUB` is off. Redeliver from there after you fix it.

---

## 5. What Tailzu can and cannot do

**Can**, in the repos the person gave the App access to and can write to themselves, and nowhere else:

* list those repos (300 per install; it says when there are more);
* make a branch named `tailzu/...` from the default branch, and keep it current
  by merging the default branch into it;
* read the file tree and the text files (1 MB at most) on its own branches;
* commit text files to its own branches: add, change, delete, many in one
  commit, never forced;
* open a **draft** pull request from its branch into the default branch, find
  it again if it is already open, show where it is and what reviewers wrote,
  take it out of draft, or close it;
* squash-merge it, but only after a person approved that exact commit (see the
  exceptions below);
* delete a finished `tailzu/` branch;
* hand a sandbox a token for one repo (no route yet): `contents:read` to clone,
  `contents:write` to push, nothing else, made when asked and kept nowhere.

**Cannot**:

* write to the default branch, or to any branch that does not start with
  `tailzu/`, with **two exceptions**, each its own function with its own guard:
  the first `README.md` of a repo with **no commits at all** (checked first;
  a repo with commits is refused), and the squash-merge of a work branch's pull
  request that a person approved at that head commit. Everything else goes
  through `assertWorkBranch`, checked before every write; a branch must match
  `tailzu/[a-z0-9][a-z0-9-]{0,48}`, differ from the default branch and contain
  no `..`;
* resolve a merge conflict, force-push, or rewrite history;
* change anything under `.github/workflows/` (the App has no Workflows
  permission, and Tailzu says so before GitHub does);
* merge without that approval, approve a pull request, delete a repo or any
  branch that is not a finished `tailzu/` one, change settings, or read issues,
  Actions, secrets or anything else: the App's permissions are Contents, Pull
  requests and Metadata, and nothing more;
* reach a repo the person did not give the App, or any repo through a token made
  for another: each token is for one repo;
* work in a repo the person cannot themselves write to (next section);
* write files that are not text, files over 1 MB, or keep a script's
  executable bit (every file it writes is mode `100644`).

**Worth knowing**

* The `tailzu/` rule is Tailzu's own code. GitHub itself would let a token with
  Contents: write change any branch. Put **branch protection or a ruleset**
  on each default branch (Settings, Rules) so that even a bug in Tailzu cannot
  push to it; do not add the App to a bypass list.
* A draft pull request needs a repo that can have them. Private repos on
  GitHub's free plans cannot, and Tailzu says so instead of opening a normal
  one.
* **Linking an install is not access to its repos.** GitHub lists an install
  for anyone who can reach any repo in it: every member of an organisation, and
  anyone invited to a single repo on another person's account. So Tailzu
  decides repo by repo, from the GitHub login it kept when the person linked:
  * an install of kind User on the person's own login is theirs, and all of it
    is open to them;
  * in any other install (an organisation, or somebody else's personal
    account) a repo counts only if GitHub says that login has **write or
    admin** there (the collaborator permission endpoint, asked with the
    install's own token; this needs only the Metadata permission the App
    already has). A 404 or any error counts as no access;
  * the answer is kept for ten minutes for each install, repo and login, and
    at most eight questions are out at once when listing. The rule is applied
    when listing repos, when adding a project, and again before every write (a
    branch, a commit, a pull request, a sync, a ready, a close, a merge, a
    delete, the first README, a runner's token), which asks GitHub afresh: access taken
    away is felt at once by writes, and within ten minutes by reads;
  * a link made before the login was kept has no way to tell, so it counts for
    nothing and the person is asked to connect again (`needs_reconnect`).

  Choosing **Only select repositories** when installing on an organisation is
  still the right advice, as a second guard: the App then cannot even see the
  rest. A person who changes their GitHub username has to connect again.
* The 4 hex digits of a branch name can collide with a branch from before;
  Tailzu then tries another name, up to four times.
* Tailzu keeps, per person: which installs they linked (account name, whether
  it sees all or some repos, and the person's GitHub id and login), the repos
  they picked as projects, and for each work branch its name, the first 200 characters of the task it was
  made for, the commit it started from and its pull request number. Add this to
  the privacy policy (`tulmi/src/routes/policies/privacy.ts`, and the site's
  copy) before turning `CODE_GITHUB` on.

## 6. When something is wrong

| What you see | Why |
| --- | --- |
| Every `/v1/code` route answers 404 `code_off` | `CODE_GITHUB` is not `true` |
| 503 `not_configured` | One of `GITHUB_APP_SLUG`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_PRIVATE_KEY` is missing or the key can't be read, or `CONNECTOR_TOKEN_KEY` is missing. The server prints which on start (never the values) |
| The install page says "That install isn't yours" | The GitHub account that installed is not one that can reach that install |
| Connect works but the repo list is empty | The install has no repos selected, is suspended, the person is looking at the wrong GitHub account, or (in an organisation or somebody else's account) they have only read access to its repos |
| 403 `needs_reconnect` | The link was made before the person's GitHub login was kept, or they renamed themselves on GitHub: connect GitHub again |
| 403 `no_access` on a branch, commit, pull request, sync, merge or delete | The person's access to that repo was taken away on GitHub since they added the project |
| 409 `repo_empty` | The repo has no commits, so there is nothing to branch from. Start it with `POST /v1/code/projects/:id/init` (or add a first file on GitHub) |
| 409 `repo_not_empty` on init | The repo already has commits. Tailzu only ever writes a first README to an empty one |
| 409 `conflict` on sync | The default branch changed lines this branch also changed. Tailzu never resolves it: resolve it on GitHub, or start a new branch |
| 409 `changed_since_approval` | The branch moved after the person looked at the merge. Nothing was merged; look again |
| 409 `approval_invalid` or `approval_expired` | The approval id is unknown, for another branch or person, already used, or older than ten minutes |
| 409 `pr_draft`, `not_mergeable`, `branch_in_use` | The pull request is still a draft, GitHub says it can't be merged (conflicts, or a required check or review), or the branch's pull request is still open |
| A pull request or review on GitHub doesn't show in Tailzu | The App isn't subscribed to Pull request and Pull request review events, or the webhook is failing (the App's Advanced tab) |
| 502 `github_auth` for everything | The private key does not belong to this App (or was revoked). Generate a new key on the App's page and replace it |
| `branch_moved` on a commit | Someone pushed to the work branch while Tailzu was committing. Nothing was overwritten; read the branch again and retry |
| Webhook deliveries fail with 401 | `GITHUB_APP_WEBHOOK_SECRET` is not the secret on the App's page |

To replace the private key: generate a second key on the App's page, put it in
`.env`, restart, then delete the old key on GitHub.
