# The GitHub App for the Code bot

For the owner. The Code bot works in a person's repos through a GitHub App
that Tailzu owns and each person installs on their own account. This page
covers making that App, the settings the server reads from it, and what it
can and cannot do. The code is in `tulmi/src/code/` and
`tulmi/src/routes/code.ts`.

You need to do four things, in this order:

1. Create the App (below), and write down what GitHub gives you.
2. Run the migrations `tulmi/supabase/migrations/0020_code_github.sql` and
   `0022_code_policy.sql` (the second is the bot's permissions, section 5).
3. Put the values in `tulmi/.env` and switch `CODE_GITHUB` on.
4. Install it on your own account and try it (section 4).

The bot is **not fenced into a corner of the repo**. It works like Claude Code
works with git: it has principles, and a permission system. Some things it just
does, some it asks you about first, a few it asks about with Face ID every
single time, and a few it never does. You can answer an "ask" once and for all
for a project (a *standing permission*). Section 5 is that system; read it
before switching the bot on for anyone else.

There is a second, optional way to connect that needs no App install:
**Sign in with GitHub**, a classic GitHub OAuth App (section 7). It is off by
default and reaches far more than an install does, so read section 7 before
switching it on.

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
| Repository permissions | **Contents: Read and write.** **Pull requests: Read and write.** **Metadata: Read-only** (GitHub sets this one itself). Nothing else. **Workflows: Read and write** only if you want the bot to be able to change `.github/workflows/*` files at all (it still asks every time; section 5) |
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
  "description": "Lets Tailzu's Code bot work in your chosen repos: it commits to its own tailzu/ branches and opens draft pull requests, and asks you before it does anything else.",
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
are not here. There is no `workflows` permission (add it to the manifest, or to
the App later, only if you want workflow files to be possible), no `issues`,
nothing else.

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
| `CODE_BOT_NAME` | Who the bot is in git: the **author name** of every commit it makes. Default `Blip` |
| `CODE_BOT_EMAIL` | The author email. Default `blip@tailzu.space`. For the bot's avatar to show on GitHub, use a GitHub bot account's noreply address (section 5, "Who commits") |

None of the secrets is ever logged or sent to a device. The server does not
store any GitHub token: the person's own token is used once and dropped, and
the App's tokens (one hour, one repo each) live in the server's memory.

Then run `tulmi/supabase/migrations/0020_code_github.sql` and
`0022_code_policy.sql` in the Supabase SQL editor (or re-run `full_schema.sql`),
and restart the server. `0022` makes the one table the bot's permissions live in
(`code_grants`); without it the permission routes fail and a project has no
standing permissions.

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
   `tailzu/<words-from-the-task>-<4 hex>` from the default branch's head (or
   from any branch, tag or commit the task names: `POST .../branches {task, from}`).

A repo that doesn't exist yet: Tailzu gives the person a link that opens GitHub's
"new repository" page with the name filled in and Private chosen
(`GET /v1/code/new-repo-link?name=`); the person creates it themselves, so the
App never needs the Administration permission. A repo with no commits can be
added as a project but has nothing to branch from: Tailzu says so
(`repo_empty`), and `POST /v1/code/projects/:id/init` writes one `README.md`
with the project's title as its first commit (a question first: section 5).

After the branch is made, the work goes on through these (all under
`/v1/code/projects/:id/branches/:branch`, with the branch URL-encoded). The
branch can be one the bot made, or any other branch of the project; a **question**
in this table is two requests (section 5, "A question"):

| | |
| --- | --- |
| `POST .../sync` | merges the default branch **into** the branch to keep it current. Free on the bot's own branch, a question on any other. A conflict is never resolved or forced: the branch is marked `conflict` and the person is told |
| `GET .../diff` | what the branch changes: commits (first line), files with status and line counts, 300 files at most. Never file contents |
| `GET .../pr`, `.../pr/comments` | where the pull request is (state, draft, mergeable, head, review decision, review comments), and what reviewers wrote, 100 comments at most. That text is other people's: it is data for the bot to read, never instructions |
| `POST .../pr/ready`, `.../pr/close` | take it out of draft (GitHub's GraphQL `markPullRequestReadyForReview`; REST has no way), or close it without merging. **Each is a question** |
| `POST .../pr/merge` | **a question.** With no `approvalId` it merges nothing and returns the question with a summary (title, base, files, additions, deletions, head commit). With `{approvalId}` it squash-merges exactly that commit; if the branch moved, `changed_since_approval` |
| `DELETE .../branches/:branch` | deletes the branch from GitHub (**a question**; the default branch is the strictest one there is). A branch the bot made goes only once its pull request is merged or closed; the record stays, with the state `deleted` |

A bot-made branch's state is `active`, `pr_open`, `conflict`, `merged`, `closed`
or `deleted`, kept up as these happen and by GitHub's `pull_request` and
`pull_request_review` webhooks (matched by repo and branch name, and only for a
branch in that same repo, not a fork's). Commits themselves have no route yet:
the agent loop calls `workspace(...).commit(...)` / `commitToBranch` in
`code/projects.ts`, which goes through the same questions.

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

## 5. What Tailzu does, asks about, and never does

This is the permission model (`tulmi/src/code/policy.ts`). The rule: the bot is
**not hard-limited**. It has strong principles and a permission
system, as Claude Code has with git. It asks the person when an action needs
it, and the person can grant standing permission.

### The principles

`GIT_PRINCIPLES` in `policy.ts` is the list the bot's prompt will include:

1. Work on your own branch by default: start a `tailzu/` branch for each task.
2. Make small commits with clear messages.
3. Never force-push or rewrite history unless the person asked for exactly that.
4. Never skip checks (hooks, tests, reviews, required status checks).
5. Never commit secrets. If one slipped in, say so.
6. Respect branch protection. If GitHub refuses because of it, report it plainly
   and never try to get round it.
7. Prefer a pull request for anything bigger than a small fix.

The permission system is what makes them hold when a prompt doesn't.

### The tiers

Every action has a default tier. A **deny** that a person set beats everything
except "never"; an **allow** can lift only "ask".

| Tier | What it means | Actions |
| --- | --- | --- |
| **free** | Just do it | read; make a branch (from any branch, tag or commit); commit and push to a branch the bot made (a recorded `tailzu/` branch); open a **draft** pull request; bring its own branch up to date with the default branch; comment on its own pull request |
| **ask** | Do it only after the person says yes (or has said "always" for this project) | commit or push to **any other existing branch, the default branch included**; merge a pull request; mark one ready for review; close one; delete a branch; change a `.github/workflows/*` file (also needs the token or the App to be allowed to: below); start an empty repo with a README; keep a branch it didn't make up to date |
| **ask_strict** | Ask **every time**, with **Face ID** on the phone (`faceId: true`). No standing permission can ever lift it | force-push, or anything that is not a fast-forward; delete the default branch; commit something the secret scanner flags; change a repo's visibility (nothing does that yet; it is in the catalog) |
| **never** | Refuse, whatever anyone says | a path that escapes the repo (absolute, `..`, backslashes, empty parts) or writes inside `.git/`; deleting the repo |

`GET /v1/code/projects/:id/permissions` returns the catalog (`actions`: id, tier,
label, `faceId`, `grantable`, `branchScoped`) for the screen that edits these.

`decide(action, ctx)` is the one function that says what happens: `allow`,
`ask` or `deny`, with the tier, a reason and `faceId`. Its context is the
project, the branch, the default branch, `attended`, the connection (`app` or
`oauth`), the token's scopes, the project's standing grants and whether the
branch is one the bot made. With **nobody there to ask** (`attended: false`, a
run nobody is watching) anything that would ask becomes a denial with the
reason `needs_you` (403 `needs_you`, carrying the action and what to show), so
that whoever called can send a "needs your OK" notification instead of failing.
Standing allows still work unattended: that is what they are for.

### A question

An action in the ask tiers is **two requests**. The first does nothing and
answers `200`:

```json
{ "needsApproval": true, "approvalId": "…", "action": "pr.merge", "faceId": false,
  "expiresAt": 1793022230266, "summary": { "…": "what to show" } }
```

`summary` is plain data for the approval card: the files' names (never their
contents), the message's first line, the branch, the pull request's title and
counts, the head commit. The same request again with `{approvalId}` (in the
body; for a `DELETE`, `?approvalId=`) does it. An approval:

* is **single use**, and lasts **ten minutes**;
* is bound to the person, the project, the **action** and the **branch**, and
  where it matters to the commit the branch was at (the pull request's head, for
  a merge) and to a fingerprint of what would be written (the files and message
  of a commit; the commit a force-push would move to);
* does nothing if **anything is different**: another branch, another action, a
  branch that moved on (`409 changed_since_approval`), different contents. It is
  spent by the try, and the answer is to look again;
* is kept in the server's memory, not the database: a restart only means asking
  again.

When one commit raises more than one question (a workflow file with a secret in
it, on the default branch) it is **one** question, for the strictest of them,
and the card lists them all.

### Standing permissions

A person can say "always" or "never" for one project. A grant is
`{action, branchPattern?, effect: allow | deny, expiresAt?}`:

* `GET /v1/code/projects/:id/permissions` lists them (those that haven't run out);
* `POST /v1/code/projects/:id/permissions {action, branchPattern?, effect?, expiresAt?}`
  makes one (`effect` is `allow` unless said). The same action, pattern and
  effect again is the same grant with the new expiry. At most 100 a project;
* `DELETE /v1/code/projects/:id/permissions/:grantId` takes one back.

`branchPattern` is a glob over branch names: `main` is exactly main, `release/*`
is `release/` and one more part (`*` does not cross a slash), `**` crosses
slashes, `?` is one character. No pattern means every branch. Only an action
about a branch can have one.

* An **allow** skips the question for that action on those branches. It can't be
  made for an `ask_strict` or a `never` action: the route refuses with `400
  not_grantable` (for a deny too), and the policy ignores such a row if one got
  in some other way. It also can't give a token a permission GitHub hasn't:
  workflow files below.
* A **deny** stops the action, free ones too (deny `branch.create` and no branch
  is made; deny `read` and the bot can't look). It beats every allow. The error
  is `403 policy_denied`, with the action.
* A grant is not a secret waiver: a commit with a secret in it is `ask_strict`
  whatever else is allowed.

Allowing something "always" is a decision about the project's repo, so the phone
should put the same confirmation in front of the `POST` as in front of a
question. Grants are stored in `code_grants` (migration `0022_code_policy.sql`,
RLS like `0020`: a person reads their own projects' rows, only the server writes).

### The secret scan

Before **any** commit, the new contents of every file (deletions are not
scanned) go through `scanForSecrets`: AWS access keys; GitHub tokens (`ghp_`,
`gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`); private-key headers (`-----BEGIN
… PRIVATE KEY-----`); Slack tokens and webhook addresses; a long random value
after `api_key=`, `secret=`, `client_secret:`, `access_token=` and the like (it
must look random: letters and digits, enough variety, not "your-key-here"); and
`.env` files (not `.env.example`, `.sample`, `.template`). A hit makes that
commit `commit.secret`: ask_strict, Face ID, every time. The approval card shows
**which files** and **what kind of thing** (`"looksLike": ["a private key"]`),
**never the value**. The matched text is thrown away when it is matched: it is
not kept, not logged, not in any error. The detector is small and built in, on
purpose; it is a net, not a guarantee. Turn on GitHub's own secret scanning and
push protection on the repo as well.

### Workflow files

`.github/workflows/*` is its own action (`workflow.write`, ask). It also needs
the connection to be allowed to change workflows at all, which GitHub requires:

* **Sign in with GitHub:** the token needs the `workflow` scope. Sign-in does not
  ask for it; the incremental sign-in (`oauth.beginWorkflow`) does, for a person
  who wants it. Without it the bot says so before it asks anything
  (`403 needs_workflow_scope`: "Sign in with GitHub again and allow it").
* **The GitHub App:** the App needs **Workflows: Read and write** on the install
  (App settings, Permissions; the person accepts the new permission on GitHub).
  The server checks the install's permissions, and only for the one commit that
  changes a workflow file does it ask GitHub for a token that has Workflows in it.
  Without it, `403 needs_workflow_scope`.

A standing allow for `workflow.write` skips the question; it can't create the
permission.

### GitHub's branch protection

The bot respects it and does not try to get round it. A refusal because of
protection or a repository rule (a protected ref, a required status check, a
required review, "changes must be made through a pull request", a rule
violation), from any call (a commit, a delete, a merge, a force), is
**`409 protected_branch`**, in plain words, never GitHub's own. Set **branch
protection or a ruleset** on each default branch (Settings, Rules): it is the
second lock, and it is what holds when someone gives a standing allow too
freely. Do not add the App to a bypass list.

### Who commits

Every commit the bot makes, through either connection, has the **bot as its
author**: name `CODE_BOT_NAME` (default `Blip`), email `CODE_BOT_EMAIL` (default
`blip@tailzu.space`). The **committer** is left for GitHub to fill in, so it is
whoever the token is: the App for an install, the person for a sign-in. The
message ends with a trailer that credits the person, when their GitHub id and
login are known (the link keeps them):

```
Co-authored-by: <login> <id+login@users.noreply.github.com>
```

The old `Co-authored-by: Tailzu <code@tailzu.space>` trailer is gone. Two
things GitHub makes itself and gives no author field for: the **squash-merge**
commit and a **sync's merge commit**. Those are authored by the token's identity.

**Recommendation: make a GitHub account for the bot.** With the default email
the commits say "Blip" with no avatar. If the bot has an account of its own,
GitHub shows its picture on every commit:

1. Create a GitHub user for it (for example `blip-tailzu`; GitHub's terms allow a
   machine account alongside your own). Give it the picture you want. It needs no access
   to any repo and no token.
2. Find its id: `curl -s https://api.github.com/users/blip-tailzu | jq .id`.
3. Set `CODE_BOT_NAME=Blip` and `CODE_BOT_EMAIL=<id>+blip-tailzu@users.noreply.github.com`
   (its noreply address), and restart.

GitHub links a commit to an account by the author email, so the noreply address
is what puts the avatar on. A name or email with `<`, `>` or a line break in it
is ignored for the default.

### Worth knowing

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
    away is felt at once by writes, and within ten minutes by reads. **Access is
    settled before the policy is asked**, and a refusal for it (`no_access`) is
    never turned into a question;
  * a link made before the login was kept has no way to tell, so it counts for
    nothing and the person is asked to connect again (`needs_reconnect`).

  Choosing **Only select repositories** when installing on an organisation is
  still the right advice, as a second guard: the App then cannot even see the
  rest. A person who changes their GitHub username has to connect again.
* The bot **never** resolves a merge conflict, never rewrites history without a
  strict yes, and writes only text files (1 MB at most, every file mode
  `100644`: it can't keep a script's executable bit). It cannot approve a pull
  request, change repo settings or read issues, Actions or secrets: the App's
  permissions are Contents, Pull requests and Metadata (and Workflows, if you
  add it), and nothing more.
* A **runner** (the desktop app, through the runner routes: section 8) is given
  a token for one repo that can **read and nothing else** (`contents:read`), or
  for a sign-in project a one-time download link and no token at all. It is
  never given one that can write: GitHub can't narrow a write token to a
  branch, so it would step round this policy. It hands its changes back and the
  server commits them through the policy like any other commit (`runnerAccess`
  answers `use_server_commit` to a request for push access).
* A draft pull request needs a repo that can have them. Private repos on
  GitHub's free plans cannot, and Tailzu says so instead of opening a normal
  one.
* The 4 hex digits of a branch name can collide with a branch from before;
  Tailzu then tries another name, up to four times.
* A pull request for a branch the bot didn't make is found on GitHub by the
  branch's name (the open one). Only the bot's own branches have a record, so
  only they keep a state (`merged`, `deleted`...) and are followed by the
  webhook.
* Tailzu keeps, per person: which installs they linked (account name, whether
  it sees all or some repos, and the person's GitHub id and login), the repos
  they picked as projects, for each work branch its name, the first 200 characters of the task it was
  made for, the commit it started from and its pull request number, and the
  standing permissions they gave (action, branch pattern, allow or deny, expiry).
  Add this to the privacy policy (`tulmi/src/routes/policies/privacy.ts`, and
  the site's copy) before turning `CODE_GITHUB` on.

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
| 409 `changed_since_approval` | The branch (or the pull request's head, or what was to be written) is not what the person looked at. Nothing was done; look again |
| 409 `approval_invalid` or `approval_expired` | The approval id is unknown, for another project, action or branch, already used, or older than ten minutes |
| 409 `protected_branch` | GitHub's branch protection (or a repository rule: a required check or review, pull-request-only) refused it. Tailzu doesn't try another way: use a pull request, or change the rule on GitHub |
| 409 `pr_draft`, `not_mergeable`, `branch_in_use` | The pull request is still a draft, GitHub says it can't be merged (conflicts), or the branch's pull request is still open |
| 409 `not_fast_forward` | A move of a branch that isn't a fast-forward without the force that only a strict approval gives |
| 403 `needs_you` | The action needs the person's OK and nobody was there to give it (an unattended run). The body says which `action`, and carries a `summary` to show; it is waiting for them |
| 403 `policy_denied` | The person set a standing "never" for that action in this project (take it back under the project's permissions) |
| 403 `needs_workflow_scope` | A workflow file: the sign-in token lacks the `workflow` scope (sign in again for it), or the App lacks the Workflows permission |
| 403 `never` | The one thing that is never done (deleting a repo, a path outside the repo) |
| 400 `not_grantable` | A standing permission was asked for an action that always asks (Face ID) or never happens |
| 400 `bad_path` | A path that is absolute, goes up with `..`, or is inside `.git` |
| A pull request or review on GitHub doesn't show in Tailzu | The App isn't subscribed to Pull request and Pull request review events, or the webhook is failing (the App's Advanced tab) |
| 502 `github_auth` for everything | The private key does not belong to this App (or was revoked). Generate a new key on the App's page and replace it |
| `branch_moved` on a commit | Someone pushed to the work branch while Tailzu was committing. Nothing was overwritten; read the branch again and retry |
| Webhook deliveries fail with 401 | `GITHUB_APP_WEBHOOK_SECRET` is not the secret on the App's page |

To replace the private key: generate a second key on the App's page, put it in
`.env`, restart, then delete the old key on GitHub.

---

## 7. Sign in with GitHub (the OAuth App way)

An App install reaches only the repos the person picked, with tokens that last
an hour and are made for one repo. Some people won't install an App, or want
to start at once. **Sign in with GitHub** is the other way in: a classic GitHub
**OAuth App**, where the person signs in once and Tailzu holds *their own*
GitHub token. It is off by default (`CODE_GITHUB_OAUTH=false`). Both ways can
be on at the same time; where the App reaches a repo, the App is the one used.

### Create the OAuth App

GitHub, Settings, Developer settings, OAuth Apps, New OAuth App (under the
account or organisation that should own it):

| Field | Value |
| --- | --- |
| Application name | `Tailzu Code`, or anything people will recognise on GitHub's consent page |
| Homepage URL | `https://www.tailzu.space` |
| Authorization callback URL | `https://api.tailzu.space/v1/code/github/signin/callback` |
| Enable Device Flow | **Leave off.** Tailzu uses the web flow only |

Create it, then **Generate a new client secret**. In `tulmi/.env`:

| Variable | What it is |
| --- | --- |
| `CODE_GITHUB_OAUTH` | `true` to offer the sign-in. Also the kill switch (below). Default `false` |
| `GITHUB_OAUTH_CLIENT_ID` | The OAuth App's client id. Not the GitHub App's |
| `GITHUB_OAUTH_CLIENT_SECRET` | Its client secret. Secret |

Run `tulmi/supabase/migrations/0021_code_oauth.sql` first. `CONNECTOR_TOKEN_KEY`
must be set: the sign-in's `state` is signed with it and **the tokens are
stored encrypted under it** (changing that key makes stored tokens unreadable;
people then sign in again). With the switch on but the id or secret missing,
the sign-in routes answer `503 not_configured`; with it off, `404 oauth_off`.

The sign-in asks for `repo read:user` and nothing else. It uses PKCE (S256)
as well as the signed `state`; GitHub has announced PKCE for OAuth Apps, and
if a GitHub does not enforce it the extra parameters are ignored and the
signed `state` is what protects the flow.

### What sign-in can reach, against the App

| | GitHub App install | Sign in with GitHub |
| --- | --- | --- |
| Reaches | the repos the person chose at install | **every repo the person can reach**, public and private, in every organisation that allows it |
| The token | an hour, for one repo, made when needed, never kept | the person's own, long-lived, **kept (encrypted)** until it is revoked |
| Commits show | the bot (Blip) as the author, the person credited in a `Co-authored-by` trailer, the App as committer | the bot (Blip) as the author, the person credited in a `Co-authored-by` trailer, **the person** as committer |
| Pull requests and merges | by the App | by the person |
| Revoked by | uninstalling | disconnecting in Tailzu, or on GitHub (Settings, Applications) |
| Organisations | the owner installs the App | an organisation with **OAuth App access restrictions** (or SAML SSO) refuses it until an owner approves Tailzu |

### What Tailzu does to make that safe

GitHub offers no way to narrow an OAuth token to chosen repos, so Tailzu does:

* **Only repos added as projects.** The token is never used on a repo the
  person did not explicitly add. Every use checks that, from the database,
  before the token is decrypted. The one exception is listing the repos to
  choose from (`GET /user/repos`, only repos the person can **push** to,
  archived ones left out, 300 at most).
* **Push access, again, before every write.** Before a branch, a commit, a
  pull request, a sync, a merge, a delete, Tailzu asks GitHub (`GET
  /repos/{o}/{r}`, `permissions.push`) whether the person can still push. Reads
  go by what was kept ten minutes.
* **The whole policy of section 5**, unchanged: the same tiers, questions,
  standing permissions, secret scan and path rules as for an App project.
* **A runner never gets the token.** For a sign-in project `runnerAccess` "read"
  gives a one-time download link (GitHub's tarball redirect, not followed by the
  server) and "push" is refused (`use_server_commit`): a sandbox hands its
  changes back and the server commits them through the same guards.
* **The scopes are checked.** The token GitHub returns must have no scope
  beyond `repo read:user` (its `X-OAuth-Scopes`); if it does it is revoked on
  the spot and nothing is connected. `workflow` is not asked for by the plain
  sign-in. A separate incremental sign-in (`oauth.beginWorkflow`) asks for it
  too, for a person who wants the bot to be able to change workflow files; even
  then every such commit is a question (section 5).
* **The token is never shown.** Encrypted at rest (AES-256-GCM), never logged,
  never in a reply, never given to the model, a sandbox or a runner. The table
  has no row-level-security policy at all, so even the person's own Supabase
  token can't read it.
* **Revoked, not just forgotten.** On disconnect, on account delete, and after
  **30 days unused**, the server calls `DELETE /applications/{client_id}/token`
  and then drops the token. A disconnect that can't reach GitHub does not drop
  the token (it could never be revoked then): the link is made unusable and
  the person is told to try again. A token GitHub answers 401 for is dropped and
  the link marked `needs_signin` (403 `needs_signin`; the person signs in again,
  and their projects are still there).
* **Organisations that haven't approved it** answer 403 `org_blocked`, with a
  hint: an owner approves Tailzu under the organisation's third-party access
  settings (or the person authorises the sign-in for the SSO organisation), or
  installs the Tailzu GitHub App on it.

### The kill switch

`CODE_GITHUB_OAUTH=false` and a restart: no stored token is used, ever. The
sign-in routes answer 404, projects that go through it answer `oauth_off`,
listing skips it. Revoking still works (it only destroys), so a person can still
disconnect.

To end every token at once, for an emergency:

```bash
docker compose exec backend node dist/tulmi/scripts/revoke-github-oauth.js
```

(`npx tsx scripts/revoke-github-oauth.ts` outside the container.) It revokes
every stored token at GitHub, drops it from the database, and marks each link
`needs_signin`. It prints counts, never a token. Run it again if it reports
that GitHub would not revoke some. Rotate `GITHUB_OAUTH_CLIENT_SECRET` or
delete the OAuth App on GitHub to end every authorisation at GitHub's end too.

### Privacy

Add to the privacy policy that, for people who sign in with GitHub, Tailzu keeps
their GitHub id and login and their GitHub token (encrypted) until they
disconnect, delete their account, or it goes 30 days unused.

## 8. Jobs, and where their commands run

A coding task is a **job**: edit steps through the API above, and exec steps
(install, build, test) that need a computer. The environment router
(`tulmi/src/code/jobs`, `docs/code-router.md`) runs each exec step on the
cheapest place there is: the person's own PC first, then GitHub's free
Actions minutes (2,000 a month on a free plan, `CODE_GITHUB_FREE_MINUTES`, a
tenth kept back), then paid compute only under the person's own rule
(`never`, `ask`, or `auto` up to a monthly cap); otherwise the job waits and
the person is told. A step that is out holds a 90-second lease with an epoch
that goes up on every dispatch, so a computer that went quiet and was
replaced can never count; a finished step writes a checkpoint, and a job
moved to another place re-runs only the step that was out. Needs migration
0023.
