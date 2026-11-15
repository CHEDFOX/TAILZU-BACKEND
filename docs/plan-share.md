# Sharing a plan

> "we need a option to share the plan with the friends and people … the plan can be shared so someone with no active plan can
> also work with the shared plan of other person … also a person can request the sharing in the app from friends and people from
> anyone. if the person wo has been requested have a plan they can share directly. if they dont — they have to buy and then can
> share with the person."

Asked how the shared use should be counted and how many people may be on one plan, the owner chose **one shared pot** and
**no limit on how many people**.

Everything here is behind one switch, `PLAN_SHARE`, **off**. With it off there is no new row, no new screen and no new
behaviour anywhere: `payerFor` answers "themselves" for everyone before it reads anything, and every route answers 404.

---

## 1. The idea in one paragraph

A plan is **a month's allowance of spend on one account** (`docs/bots-app.md` §12). Sharing it means other accounts draw on
**that same allowance**. There is no per-seat price and no seat count, because the allowance itself is the ceiling: sharing with
thirty people cannot cost more than sharing with one, it only empties sooner. Someone on your plan uses your month; nothing else
of yours is shared — not your chats, not your bots, not your things.

---

## 2. The rule everything hangs off

`tulmi/src/billing/planShare.ts`:

```ts
export interface Payer {
  /** The account the spend is metered against — the person, unless they are on someone else's plan. */
  userId: string;
  /** Set only when this is not their own plan. */
  sharedFrom?: { userId: string; name: string };
}

export function payerFor(userId: string): Promise<Payer>;
```

* **Their own live entitlement always wins.** `payerFor` only looks at `plan_shares` when the person has none of their own. A
  member who buys a plan stops drawing on anybody else's at once, and the row stays, so letting their own lapse puts them back.
* **A person may be on at most one plan.** The table's key is `(owner_id, member_id)`, which only stops the same pair twice, so
  the single-plan rule is enforced in the service: sharing with someone already on a plan is refused with *"They are already on a
  plan."* — **never whose**, because that is a fact about two other people's money.
* **A lapsed owner's rows stay and simply stop resolving**, so renewing brings everyone back without anybody asking again.
* **A held account** (abuse prevention, `docs/trust.md` §actions) draws on nobody's plan and lends to nobody.
* Cached the way `getEntitlement` is — short, in process — and cleared on every share, every unshare and **every entitlement
  change**, for the account and for everyone on its plan. A cache that outlives a "Stop sharing" is somebody spending money they
  were just taken off.

`payerNow(userId)` is the same answer with no round trip, for the one caller that cannot await (`Spending.record`); it returns
null when the answer is not cached yet, and the caller falls back to `payerFor`.

---

## 3. Where the resolution happens, and why it cannot be forgotten

`tulmi/src/you/limits.ts` keys the whole meter on the payer, at **two points and no others**:

| | |
|---|---|
| `Spending.read(userId)` | every READ of the meter. It resolves the payer first and then reads, caches and keys everything under that id: the entitlement, the plan, the billing anchor, the spend rows and the Xode jobs. Thirty people on one plan share one cached read of one month |
| `Spending.record(userId, …)` | every WRITE. The cost is written against the payer's account, with `by` naming the person it was really for |

There is no other way into the meter. `usage`, `leftToSpend`, `refusal`, `burning`, `gate`, `quota` and the job hook
`holdJobsToUsage` all go through `read`; `recordUsd` and the cost sink go through `record`. A method written next year that does
not call one of them has no meter to key wrongly, which is the point of putting it there rather than at each caller: resolution
happens **exactly once per request** and a new caller cannot forget it.

Two details follow from one pot:

* **The month's boundary** is the payer's. A member reads the owner's cycle on the owner's clock, because one allowance cannot
  turn over at two different moments. Their own month is still on their own clock, exactly as before.
* **Xode jobs** keep their spend on their own row (`code_jobs.spent_paise`), not in `you_spend`, so a shared month also reads the
  jobs of the people on it (`jobsOf`, at most 25 of them — a bound, not a seat count).

---

## 4. The data (migration `0096_plan_share.sql`)

```sql
create table public.plan_shares (
  owner_id   uuid not null references auth.users(id) on delete cascade,
  member_id  uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, member_id)
);
create index plan_shares_member_idx on public.plan_shares (member_id);

create table public.plan_share_asks (
  id          uuid primary key default gen_random_uuid(),
  asker_id    uuid not null references auth.users(id) on delete cascade,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  about       text,          -- "Diwali party": the second line of the card. Never required.
  state       text not null default 'waiting',
  created_at  timestamptz not null default now(),
  answered_at timestamptz
);
create unique index plan_share_asks_open_idx
  on public.plan_share_asks (asker_id, owner_id) where state in ('waiting', 'promised');
create index plan_share_asks_owner_idx on public.plan_share_asks (owner_id, state);
```

An ask's `state` is `waiting` (they have not answered), `promised` (they said yes and have no plan yet — it becomes a share the
moment they buy one), or one of the finished three, `shared` / `declined` / `withdrawn`.

Row level security is on with **no policy** on both tables, so the server's service key is the only thing that reads or writes
them — the same pattern as `plan_busy` and `reminders_gone` (0094) and `rooms` (0091). Rows go with the account from both ends.

The migration also adds **one column to `you_spend`**: `by uuid`, the person on a shared plan a row was really for, null on every
row that is the account's own (which is every row that exists today). The spend of everyone on a plan is written against the
owner, because one pot cannot be added up from thirty places on every request; `by` is what lets the owner's own screen say
"Rahul · Used 12% this month" without the member's account being charged. Both reads and writes fall back to the old shape when
the column is not there yet, so the server runs before the migration is applied.

---

## 5. The routes

Under the app's bots prefix, `/v1/botsapp/bots` (`tulmi/src/routes/bots/botsPlanShare.ts`):

| | |
|---|---|
| `GET /plan/share` | `PlanShareView`: who is on my plan with each one's share of the month, or whose plan I am on; who I could share with; asks waiting for me; my own ask |
| `POST /plan/share` | `{ memberIds: string[] }` → share with them |
| `DELETE /plan/share/:memberId` | stop sharing with one person |
| `DELETE /plan/share/mine` | leave the plan I am on (`mine` is never an account id, so the two never collide) |
| `POST /plan/share/ask` | `{ ownerId, about? }` → ask someone |
| `PUT /plan/share/ask/:id` | `{ decision: "share" \| "promise" \| "decline" }`, or `"withdraw"` on my own ask |

Every one of them refuses politely:

* **`PLAN_SHARE` off** (or the account is not in `PLAN_SHARE_USERS`, when that list names anyone) → 404 `plan_share_off`.
* **The two share no space** → 403 `not_connected`, *"You can only share with people you share a space with."*
* **The asker already has a plan** → 409 `has_plan`. **The target is already on one** → 409 `already_shared`, *"They are already
  on a plan."*, never whose. **The sharer has none** → 409 `no_plan`.
* **Either account is held by signals** (`trust/actions.ts` `heldFreeUse`) → 403 `not_now`, *"That can't be done right now. Try
  again later."* — and nothing anywhere says why.
* **"Not now" is quiet**: the asker is told only that nothing is waiting, never a reason, and the same person cannot be asked
  again for a week (`asked_recently`).

### 5.1 Answering from the notification

The ask's push (`plan_share_ask`) carries the category `x0_plan_share` — two buttons, **Share** and **Not now**, and never a
third — and the one ask it is about, as `psa:<askId>` on its `data.item` (`tulmi/src/widgets/items.ts`). Both buttons post to
`POST /v1/widgets/act`, the one door every notification's button posts to, and land back in this file through
`billing/planShareActs.ts`, so a tap does exactly what the same button on the Activity card does, with the same checks and the
same quiet "Not now". A second tap is harmless: the first answer is replayed (`repeat: true`), and the other button on an ask
that has been answered, promised or withdrawn is refused with 409 `not_waiting`. An ask that is not this person's is 404 `not_found`,
the same answer anybody gets for an ask that has gone.

**Share may only share.** On the card, someone on Free is given "See plans and share": it promises the share and opens the
plans screen. A notification's button runs with the app shut and has no screen to open, so promising there would take the ask
out of Activity and leave the owner believing they had shared when nobody had been put on anything. It refuses instead, with
the route's own 409 `no_plan`, and the ask stays waiting for the card — which does have a plans screen to open.

With `PLAN_SHARE` off: the category is not registered with the phone, no push of the kind is ever raised, and the act door is
not there either, so nothing a phone still holds can answer anything.

The payload both halves of the app are built to is `PlanShareView` in `shared/types/api.ts`.

Who may be reached is the same rule messaging and tasks use: everyone the viewer still shares a space with, nobody across a
block, each with their tiny bot as the first space they share has them (`botsBots/threads.ts` `looksKnown` /`contacts()`, drawn
by `botsBots/personLook.ts`).

---

## 6. When a plan is bought

`billing/entitlements.ts` fires `onEntitlementChange` from `forgetEntitlement`, which every grant and every revoke already passes
through — RevenueCat's webhook (`applyRevenueCatEvent`) and Razorpay's (`syncSubscription`, `cancelForUser`) alike. Two things
follow a grant:

1. the payer cache is cleared for that account **and for everyone on its plan**, because what each of them may spend has changed;
2. every `promised` ask by that account becomes a real share and the asker is told (`settlePromisedAsks`).

That is the whole of the owner's *"if they don't have a plan they have to buy and then can share"*: the person presses one
button, buys a plan, and the share they promised is waiting when the payment lands. Nobody has to come back to a screen.

---

## 7. What is deliberately not possible

* **No price anywhere but the plans screen.** Nothing in this feature shows money, and nothing about it is sold: there is no
  seat, no tier and no upgrade for sharing. The only number any screen is given is a share of the month.
* **No new way to reach a person.** Spaces only: no email field, no invite link, no code. A plan cannot be handed to a stranger.
* **Nothing is unlocked by anything the client says.** The share is read on the server, on every request.
* **Nothing about another person's money is ever shown**: not their plan's name, their spend or their renewal date. The single
  exception is `hasPlan`, a yes/no, and only so the right row can be drawn on their page.
* **Whose plan somebody is on is never told to anyone but them.** "They are already on a plan." names nobody.
* **A held account may neither share, be shared with, nor ask**, and is told nothing about why.
* **Two plans at once is impossible**, and a member's own plan always wins over a shared one.

---

## 8. The switch

| | |
|---|---|
| `PLAN_SHARE` | **false.** Off: `payerFor` always answers "themselves", every route answers 404, and nothing changes for anyone |
| `PLAN_SHARE_USERS` | a comma-separated list of account ids. Set, only those accounts may share, be shared with or ask, even with `PLAN_SHARE` on. Empty (the default) means the switch alone decides |

Both in `tulmi/src/config.ts` and `tulmi/.env.example`, in the shape of the other `*_USERS` settings. The tables are
migration 0096; with the switch on and the tables missing, every route answers politely and `payerFor` answers "themselves".

Tested in `tulmi/tests/plan-share.test.ts` (the notification's two buttons included) and `tulmi/tests/widgets.test.ts` (the
item and the push that carries it).
