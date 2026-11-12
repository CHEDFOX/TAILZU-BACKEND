# The mail worker

X0 Bot's mail: each business's mailbox on the mail server, its mail filed and auto-answered, and replies the AI writes in the business's
voice, drafted for a person or sent after a short wait. X0 Bot's server drives it with signed calls; the mail server tells it of new mail
with a signed webhook. The feature, end to end: `docs/mail.md`.

## Where it came from

The mail engine of the owner's **Xooteq Mail** (github.com/CHEDFOX/xooteq-mail, `dashboard/server` at commit `7f1a314`), copied here
and tuned for any business. It does not follow Xooteq Mail: the two are separate from here on, and Xooteq Mail is not changed by
anything here. Taken, with what changed:

| Here | From | Changed |
| --- | --- | --- |
| `server/stalwart.ts` | `stalwart.ts` | nothing: the mail server's JMAP, admin and mailbox (by impersonation, so no mailbox password is kept) |
| `server/sieve.ts` | `sieve.ts` | nothing: each address filed into its folder, auto-replies, rules |
| `server/dns.ts` | `dns.ts` | nothing: the records a domain adds, each checked live |
| `server/companies.ts` | `companies.ts` | each business owned by an X0 account, with a daily AI allowance; a domain already on the mail server is refused, never adopted (it may be Xooteq Mail's own); addresses start in Draft; a business removed takes its mailbox with it; no admin views of mailboxes made elsewhere |
| `server/ai/engine.ts` | `ai/engine.ts` | our AI, within each business's allowance, with each reply's cost logged; mail is skipped only from the business's own domain (two businesses here may write to each other); each message sorted (kind, priority, one line); a person's say over a draft (read, change, write again as asked, send, throw away), their changes kept to teach later replies; what waits for a person; the day in numbers; spend per day |
| `server/ai/prompt.ts` | `ai/prompt.ts` | the brief names no AI provider; the answer also sorts the message; long facts narrowed to what the email needs; the team's earlier changes shown as examples; the AI never claims to be a person (a sincere "is this a person?" goes to one) |
| `server/ai/brief.ts` | new | the first brief drafted from the business's own website, read from public addresses only |
| `server/ai/model.ts` | `ai/providers.ts`, `openai.ts`, `anthropic.ts` | replaced: our AI (OpenRouter with the platform's key, best model first, `model@low` for thinking effort); nobody brings a key. The JSON reading is theirs |
| `server/config.ts`, `db.ts`, `crypto.ts`, `app.ts`, `main.ts` | the same names | cut to the mail: no dashboard login, web app, sealed keys, Postal sending apps or app users; a schema of its own |
| `server/routes/hooks.ts` | `routes/hooks.ts` | the new-mail webhook, for this worker's own businesses only |
| `server/routes/x0.ts`, `security.ts`, `cli.ts` | new | the signed API X0 Bot's server calls; its signature check (the media and Oracle workers' scheme); the worker's own webhook registration |
| `test/unit.test.ts` | `test/unit.test.ts` | without the logins and sealed keys |
| `test/api.test.ts`, `engine.test.ts`, `fakeStalwart.ts` | new | the signed API and the engine end to end, against a stand-in mail server and a stand-in model |

Not taken: the web dashboard, its owners and sessions, the sign-in mails and Postal's sending apps, the apps' Users databases, the
contact forms.

## Run and test

```
npm install
npm run typecheck
npm test            # offline: a stand-in mail server, no model
npm start           # needs the values in server/config.ts (deploy/mail-up.sh puts them in tulmi/.env)
```

On the VPS it runs from `docker-compose.yml` (profile `mail`), switched on once by `deploy/mail-up.sh` and kept up to date by
`deploy/ship.sh`.
