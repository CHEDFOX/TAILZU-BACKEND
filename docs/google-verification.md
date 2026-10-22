# Google verification pack: Connected apps

For the owner. This covers getting Google's approval for the six Google apps in
Tailzu's Connected apps: Calendar, Docs, Tasks, Sheets, Forms and Classroom.
It was written on 2026-10-22 from the code in `tulmi/` and from Google's help
pages, which were read the same day and are listed at the end.

YouTube is not part of this review. Tailzu no longer connects to anyone's
YouTube account. Its YouTube search uses Tailzu's own API key
(`YOUTUBE_API_KEY`), with no sign-in and no Google permission, so there is no
YouTube scope to ask for.

You need to do four things, in this order:

1. Fix the items in "Before you submit".
2. Fill in the console, following the checklist in section 1.
3. Record the video, following the script in section 3.
4. Submit, then answer Google's emails quickly (section 4).

---

## Before you submit: fix these first

**Must fix. Google rejects without these.**

1. **Deploy section 11 of the privacy policy and check that it is live.** The
   live policy at https://www.tailzu.space/privacy is dated October 20, 2026
   and has no Google section. The new version is already written in
   `tulmi/src/routes/policies/privacy.ts`, dated October 22, 2026. Its section
   "11. Google apps you connect" carries the anchor `id="google-user-data"`
   and the Limited Use statement with its link.

   After the deploy, open
   **https://www.tailzu.space/privacy#google-user-data** and check two things:
   it lands on section 11, and the date at the top says October 22, 2026. If
   `SITE_DIR/privacy.html` exists on the server, that file is served instead,
   so update it or remove it.

2. **Optional, later: try `calendar.events.owned` instead of `calendar.events`.**
   Kept as `calendar.events` for the first review: it is the scope most calendar
   assistants are approved with, and the narrower one is untested with invitations.
   Google's rule is: "You must only request the narrowest scope(s) your app
   needs to function."

   The code now asks for one Calendar scope, `calendar.events`
   (`tulmi/src/connectors/catalog.ts:161`). Every Calendar call is
   `events.list`, `events.get`, `events.insert`, `events.patch` or
   `events.delete`, and every call goes to the person's main ("primary")
   calendar. Free time is worked out from `events.list`. The time zone comes
   from the same `events.list` answer. Google's reference pages (checked
   2026-10-22) list **`calendar.events.owned`** for each of these five calls.
   So `calendar.events` has no honest "a narrower scope would not work" answer.

   Ask your developer to change `catalog.ts:161` to `calendar.events.owned`
   only, and then retest every Calendar ask with a real Google account before
   you submit. Include an event that someone else invited the person to.
   Google describes the scope as "events on Google calendars you own" and does
   not say how it treats invitations. If any ask fails with the narrower
   scope, keep `calendar.events` and be ready to tell the reviewer which call
   needed it.

   Do not ask for `calendar.readonly`, `calendar.freebusy` or
   `calendar.settings.readonly`. The code never calls the methods that need
   them.

3. **Done (2026-10-22): a short notice in the app before Google's consent page opens.**
   Tapping a Google app now opens a sheet with this line and Connect (phone),
   and the desktop row shows it beside Connect. Show it in the video.
   Google's Workspace API User Data Policy says the disclosure of how data is
   used "Cannot be placed only in a privacy policy or terms of service", and it
   "must accompany and immediately precede a request for user consent". Today
   nothing on the Connect sheet mentions the AI model before Google's page
   opens. Add one short line there, for example:

   > What I read here goes to an AI model (OpenAI or Anthropic, through
   > OpenRouter) only to answer you.

   Show this line in the demo video (section 3).

4. **Done (2026-10-22): every planner call to OpenRouter sends
   `provider: { data_collection: "deny" }`.** Google's Workspace
   policy forbids transferring this data to create, train or improve AI or
   machine-learning models. Nothing in the code prevents this today:
   `tulmi/src/agent/llm.ts` sends OpenRouter no `provider.data_collection` or
   `zdr`. OpenRouter's default (`"allow"`) permits providers that "store user
   data non-transiently and may train on it".

   Ask your developer to send `provider: { data_collection: "deny" }` on every
   OpenRouter call that can carry what a Google app returned: the planner's
   calls in `agent/llm.ts` (both its text and picture ladders), and any write
   or rewrite call for Ask that is handed it. Add `zdr: true` where the models
   offer it. You
   could instead turn off the matching options in OpenRouter's privacy
   settings. Then check that every model in the ladder still answers, because
   a filter can leave a model with no provider.

   Until this is done, the policy says only that OpenRouter and the model's
   provider handle the data under their own policies and may keep it for a
   time. Once it is done, add a line to the policy's section 11.3 saying the
   providers may not train on Google data, and how long they keep it.

**Should fix. Reviewers or Google's policy can catch these.**

5. **The homepage never mentions the Google apps.** Google says the homepage must
   describe what the app does. Add one short block to https://www.tailzu.space
   along these lines: "Connected apps: let Tailzu work in Google Calendar, Docs,
   Tasks, Sheets, Forms and Classroom when you ask." Link it to the policy
   section.

6. **Known gaps.** The policy now describes each one as it is. Fixing them
   would let it promise more.
   - Deleting a Tailzu account does not remove Tailzu's access at Google.
   - Google keeps one permission for all of a person's Google apps
     (`include_granted_scopes`). Disconnecting one app removes nothing at
     Google until it is the person's last connected Google app. Until then,
     the permission still covers the app that was just disconnected. To fix
     this, revoke on every disconnect and have the remaining apps reconnect
     with only their own scopes.
   - Approvals that nobody answers are kept until the account is deleted.
     They can hold words read from Google, such as an event's title and
     guests, or a task's or sheet's name. To fix this, clear them once they
     are older than `APPROVAL_TTL_MS` (an hour).
   - People who connected the old YouTube app (`google-youtube`) still have an
     encrypted token stored. Tailzu no longer lists that app, so they cannot
     disconnect it. To fix this, run a one-off job that revokes those tokens
     at Google and deletes the `google-youtube` rows.
   - On the phone, a question Tailzu asks back stays in the server's memory
     until the person's next request, not for five minutes only. The policy
     says so.
   - The server's request log records the sign-in return address
     (`/v1/connectors/callback?code=...&state=...`) in full.

---

## 1. The console checklist, in order

Open https://console.cloud.google.com and pick **the project that already holds
Tailzu's Google sign-in**. The Connected-apps OAuth client lives in that same
project. In the left menu, open **Google Auth Platform**.

| Step | Where to click | What to enter or check |
| --- | --- | --- |
| 1 | APIs & Services, then **Library** | **Enable** these APIs: Google Calendar API, Google Docs API, Google Drive API, Google Sheets API, Google Forms API, Google Tasks API and Google Classroom API. YouTube Data API v3 also stays on, for the YouTube search key, but it asks for no scope. |
| 2 | Google Auth Platform, then **Clients** | Open the web client used by Connected apps (often named "Tailzu Connected apps"). Check that it lists `https://api.tailzu.space/v1/connectors/callback` as an authorized redirect URI. Remove test clients that are not used. **Do not touch the sign-in client.** |
| 3 | **Branding** | Fill in the app details (see the list after this table). Then click **Verify branding**, and then **Publish branding** when the status says "Ready to publish". |
| 4 | Google Search Console (search.google.com/search-console) | Verify that you own **tailzu.space**. Add it as a Domain property and confirm it with the DNS TXT record. Use a Google account that is an Owner or Editor on the Cloud project. |
| 5 | **Audience** | User type: **External**. Publishing status: **In production** (click Publish app). Apps that are still in Testing cannot be verified. |
| 6 | **Data Access**, then **Add or remove scopes** | Add exactly the scopes Tailzu asks for (see the list after this table). Do not add anything the code does not use, such as Gmail, full Drive or YouTube. |
| 7 | **Verification Center** | Under Data access, click **Prepare for verification**. Check the details and **Save and continue**. Paste the justifications from section 2. Optionally add up to 3 documentation links: https://www.tailzu.space/privacy#google-user-data and https://www.tailzu.space/faq. Paste the **YouTube link** to the video. Then click **Submit for verification**. |
| 8 | Your inbox | Google writes to the project's Owners and Editors and to the support email. Answer by replying to their latest email. You can also check progress on the Verification Center page. **Do not change branding while the review runs, because that cancels it.** |

**What to fill in on the Branding page (step 3):**
- **App name:** `Tailzu`
- **User support email:** pick it from the dropdown (your Google account, or a Google Group you manage).
- **Logo:** the Tailzu icon.
- **App home page:** `https://www.tailzu.space`. (`https://tailzu.space` redirects there with a 308, so use the www address everywhere.)
- **Privacy policy:** `https://www.tailzu.space/privacy`. This must be the same link that the homepage uses, and it does use `/privacy`.
- **Terms of service:** `https://www.tailzu.space/terms`
- **Authorized domains:** `tailzu.space`. This one entry covers www and api. Keep any domain that is already listed for Google sign-in.
- **Developer contact:** `privacy@tailzu.space`, or any address that someone reads every day.

**The scopes to add on the Data Access page (step 6):**
- One Calendar scope: `calendar.events.owned` if the swap in item 2 is done,
  or `calendar.events` if it is not.
- Then `drive.file`, `tasks`, `classroom.courses.readonly`,
  `classroom.coursework.me.readonly` and `classroom.announcements.readonly`.
- Remove `calendar.readonly` and `youtube` if they are listed from before.
  The code no longer asks for either.
- Keep the sign-in scopes that are already there (openid, email, profile).

---

## 2. Scope justifications (paste-ready)

Google may give you one box for all scopes or one box per scope. Either way,
paste the block for each scope. Every scope is asked for only when the person
taps **Connect** on that one app, in Connected apps on the phone or desktop.
Signing in to Tailzu never asks for any of them. Tailzu refuses the connection
unless every permission on Google's page is ticked.

**Use one of the two Calendar blocks.**

**`calendar.events.owned`** (if you made the swap in item 2)
> Used by Tailzu's Google Calendar app in Connected apps, and asked for only
> when the user taps Connect on it, never at sign-in. When the user asks,
> Tailzu reads events on their primary calendar (to answer "what's on
> tomorrow", to find free time, and to learn the calendar's time zone), and
> adds, moves or deletes an event there. Every call is events.list, get,
> insert, patch or delete on the primary calendar. A change is shown on a
> confirm card first and runs only after the user taps Approve, unless the
> user has set the app to Can send and chosen to let that kind of change run
> without asking. Deletions always ask. When the user adds guests, Google
> emails them the invite. calendar.events.owned.readonly cannot add, move or
> delete events, so this is the narrowest scope that works.

**`calendar.events`** (only if the swap is not done)
> Used by Tailzu's Google Calendar app in Connected apps, and asked for only
> when the user taps Connect on it, never at sign-in. When the user asks,
> Tailzu reads events on their primary calendar (to answer "what's on
> tomorrow", to find free time, and to learn the calendar's time zone), and
> adds, moves or deletes an event there. A change is shown on a confirm card
> first and runs only after the user taps Approve, unless the user has set the
> app to Can send and chosen to let that kind of change run without asking.
> Deletions always ask. When the user adds guests, Google emails them the
> invite. Tailzu does not touch other calendars.

Note: this block has no "a narrower scope would not work" line, because
`calendar.events.owned` covers every call Tailzu makes. If the reviewer asks,
do not argue. Make the swap and use the block above.

**`drive.file`** (non-sensitive, so no justification is required; this is here in case you are asked)
> Used by Google Docs, Google Sheets and Google Forms in Connected apps, and asked
> for only when the user taps Connect on one of them. Tailzu creates Docs (for
> example from the user's own Tailzu meeting note), creates sheets and adds rows,
> and creates forms. It reads back only the sheets and form answers of files that
> Tailzu itself created. drive.file gives access only to files the app created,
> never the rest of the user's Drive, and Docs, Sheets, Forms and Drive files.list
> all accept it, so no broader Docs, Sheets, Forms or Drive scope is requested.

**`tasks`** (sensitive)
> Used by Tailzu's Google Tasks app, asked for only when the user taps Connect on
> it. When the user asks, Tailzu lists their task lists and tasks, adds a task,
> marks one complete, or deletes one. A change is shown on a confirm card and
> runs only after Approve, unless the user has set the app to Can send and
> chosen to let that kind of change run without asking. Deletions always ask.
> The only narrower option, tasks.readonly, cannot add, complete or delete
> tasks, which are the main things the feature does.

**`classroom.courses.readonly`** (sensitive)
> Used by Tailzu's Google Classroom app, which is read-only and asked for only
> when the user taps Connect on it. It lists the user's own classes
> (courses.list) so Tailzu can answer "what are my classes" and look up
> classwork and announcements in them. It is the read-only scope for courses.

**`classroom.coursework.me.readonly`** (sensitive)
> Used by the same Classroom app to answer "what's due". Tailzu reads the
> classwork in the user's classes (courseWork.list) and the user's own
> submissions (studentSubmissions.list with userId=me) to say what is due, when,
> whether they turned it in, and the grade if one is given. The ".me.readonly"
> scope is the narrowest one. It sees only the user's own work, read-only, never
> other students' work.

**`classroom.announcements.readonly`** (sensitive)
> Used by the same Classroom app to answer "any new announcements". Tailzu reads
> recent announcements in the user's classes (announcements.list) and shows a
> short excerpt of each. This is the read-only announcements scope, and
> nothing is posted or changed.

**A paragraph to add once, at the end of the justification**
> What Tailzu reads is used only to answer that request. It is passed, through
> OpenRouter, to the AI model that writes the answer. Tailzu does not use it to
> train models, sell it or use it for ads. No one at Tailzu reads it unless the
> user asks us to, it is needed for security, or the law requires it. Tokens
> are stored encrypted. Disconnecting an app in Tailzu deletes its token, and
> when the user disconnects their last Google app, Tailzu asks Google to revoke
> its access. Full details:
> https://www.tailzu.space/privacy#google-user-data

Once item 4 is done, you can add: "The AI providers are not allowed to train
on it." Do not add it before then.

---

## 3. Demo video script

**The rules**
- Google wants to see these things:
  - the full sign-in flow;
  - the consent screen showing the app name and the exact scopes;
  - the language set to **English**;
  - **the browser address bar showing the OAuth `client_id`**;
  - each scope's feature in use.
- Upload the video to YouTube with Visibility set to **Unlisted**.
- Google's pages give no length limit. Aim for about 3½ minutes, as timed below.
  Running a little long is fine. Leaving a scope out is not.

**Record on the desktop app.** It opens Google's page in your normal browser, so
you can widen the window and click into the address bar to show the full
address, including `client_id=...`. The phone opens Google in the phone's
browser, which cuts the address bar short. Use the phone only for the short
clip in scene 10.

**Set up before you record**
- Ask your developer to confirm the server is ready:
  - `CONNECTORS=true` is set;
  - all six Google ids are in `CONNECTORS_ENABLED_IDS`: `google-calendar`, `google-docs`, `google-tasks`, `google-sheets`, `google-forms` and `google-classroom`;
  - the Google client id and secret and `CONNECTOR_TOKEN_KEY` are set;
  - the in-app notice from item 3 is in the build you record.
- Use one demo Google account and set Tailzu's language to English.
- Remove Tailzu from that account at https://myaccount.google.com/connections, so that every consent screen appears fresh.
- In the demo account, prepare:
  - Google Calendar: one event tomorrow.
  - Tailzu: one meeting note.
  - Google Classroom: join a class made by a second account, with one assignment due and one announcement.
  - A second email inbox open in another tab, to receive a guest invite.
- Turn off notifications, use 1080p, and close other tabs.
- Cut only between scenes, never in the middle of a consent screen.

**Each Connect (do this 6 times)**
1. On the desktop, open **Settings**, then **Connected apps**, then the app. Hold on the notice about the AI model (item 3) for a moment, then tap **Connect**.
2. The browser opens. Click into the address bar and move slowly across it so that `client_id=` can be read.
3. Check that the language at the bottom left is set to **English**.
4. Show the whole consent screen: the name **Tailzu**, and every permission line. Tick **Select all** (or every box), then **Continue**.

   If Google shows its "Google hasn't verified this app" screen first, that is
   expected before approval. Click through it (Continue, or Advanced and then
   Go to Tailzu).
5. The "You're connected" page appears. Go back to Tailzu, where the row now says **Connected**.
6. In the app's sheet ("How far can I go in ..."), set the level. New apps start at **Can look**, and changes are blocked there:
   - **Can send** for Calendar, because an event with a guest counts as sending.
   - **Can draft** for Docs, Tasks, Sheets and Forms.
   - Classroom can stay at **Can look**.
7. Say or caption which scope does what, using the lines from section 2.

**To ask Tailzu something on the desktop,** tap **Alt twice** (or use the tray) and speak.
Changes show a confirm card. Click **Approve**.

| # | Time | Shot | Shows |
| --- | --- | --- | --- |
| 1 | 0:00 | Title caption: "Tailzu: Google OAuth verification demo". Name the Cloud project. | the app and its branding |
| 2 | 0:08 | Sign in to Tailzu. If you sign in with Google, the consent screen there asks only for name and email. Caption: "Signing in never asks for Calendar, Docs or other data." | no sensitive scopes at sign-in |
| 3 | 0:18 | Settings, then Connected apps: the six Google apps, all "Not connected". | where Connect lives |
| 4 | 0:25 | **Google Calendar**: the notice, then Connect (as above, with its one Calendar line), then set Can send. Ask "What's on my calendar tomorrow?" and the answer names the real event. Ask "When am I free tomorrow afternoon?" Ask "Add a call with [second email] tomorrow at 4": the card says **Ready to send?** with the exact invite, then Approve. Show the event in calendar.google.com and the invite in the second inbox. Ask "Cancel that call": the card says **Ready to delete this?**, then Approve. | calendar.events.owned (or calendar.events) |
| 5 | 1:10 | **Google Docs**: Connect (one line, "only the specific Google Drive files you use with this app"), then set Can draft. Ask "Save my last meeting note as a Google Doc", then the card, then Approve. Open the new Doc. Caption: "Tailzu can only touch files it created." | drive.file |
| 6 | 1:30 | **Google Tasks**: Connect, then set Can draft. Ask "What's on my to-do list?" Ask "Add a task: pay the electricity bill on Friday", then the card, then Approve. Ask "Mark it done", then the card, then Approve. Show it in Google Tasks. | tasks |
| 7 | 1:52 | **Google Sheets**: Connect, then set Can draft. Ask "Start an expenses sheet with Date, Item, Amount", then Approve. Ask "Add a row: today, lunch, 250", then Approve. Ask "Read my expenses sheet back." Open the sheet. | drive.file |
| 8 | 2:14 | **Google Forms**: Connect, then set Can draft. Ask "Make a form asking for name and favourite lunch day", then Approve. Open the form and submit one answer. Ask "Who answered my form?" | drive.file |
| 9 | 2:36 | **Google Classroom**: Connect (three Classroom lines), and leave it at Can look. Ask "What are my classes?" Ask "What's due?" (the assignment, its due date, turned in or not). Ask "Any new announcements?" Show classroom.google.com side by side. | the 3 Classroom scopes |
| 10 | 2:58 | **Phone, about 15 seconds**: Settings, then Connected apps (the same apps, Connected). Then Settings, then **Ask me**: type "What's on tomorrow?", tap **Do it**, and the answer appears. Caption: "Same apps and same Google sign-in on the phone." | same flow on the second surface |
| 11 | 3:13 | **Disconnect**: on the desktop, open each Google app, then **Disconnect [app]**, and it changes to "Not connected". Speed this up with cuts. Then open myaccount.google.com/connections, where Tailzu is gone. Caption: "Disconnecting the last Google app removes Tailzu's access at Google." | revoking access |
| 12 | 3:33 | End caption: privacy@tailzu.space and https://www.tailzu.space/privacy#google-user-data | contact |

---

## 4. What to expect

**Review time** (Google's own figures, which it says are not guaranteed):
- Branding check: a few minutes when automated. When a person reviews it, about 2 to 3 business days.
- Sensitive scopes:
  - Google's developer guide says "typically 3 to 5 business days".
  - Its FAQ says "about 10 business days".
  - Each round of questions adds time, so reply within a day.

**Until approval**
- **In Testing:** only test users can connect, up to 100, added by email under Audience. Their Google access expires every 7 days, so they see "Sign in again" weekly. Testing apps cannot be submitted.
- **In production but not yet approved:** people see Google's "hasn't verified this app" warning, and the app is **limited to 100 new users**. Google's FAQ says this cap covers "the entire lifetime of the project, and it cannot be reset". Do not spend it on public users before approval.
- **If Google rejects the scopes:** people's access to them through OAuth stops working until you are approved.

**Common rejections and how to answer**

| Google says | What to do, then reply to their latest email |
| --- | --- |
| Privacy policy does not disclose how Google user data is used, or has no Limited Use statement | Deploy section 11 (item 1) and check that it is live. Reply with the exact link (#google-user-data). |
| No in-app disclosure before consent | Add the notice on the Connect sheet (item 3). Re-record that part and send the new link. |
| Homepage does not explain the app, or does not link the policy | Add the Connected-apps block (item 5). The /privacy link is already there. |
| Domain not verified | Verify tailzu.space in Search Console with an Owner or Editor account. |
| Demo video: wrong app, consent screen not shown, not in English, client ID not visible, or a scope's feature not shown | Re-record the scene that is missing, following section 3. Send the new unlisted link. |
| Request a narrower scope | For Calendar, make the swap (item 2) and say so. For the others, quote the "narrower would not work" line from section 2. |
| Scopes in the request do not match the consent screen or the code | Make the Data Access list exactly match what Tailzu asks for. Remove extras, such as `calendar.readonly` or `youtube` from before. |
| Questions about AI | Explain that Tailzu reads only to answer the user's request and passes the result to the answering model. Tailzu does not use it for training, sell it or use it for ads. Say what item 4 changed for the providers. Point to the policy section. |

Keep each reply short and point by point. Fix the problem first, then reply.
Do not resubmit from scratch unless Google asks you to.

**Gmail is a separate, later review.** Today, Gmail in Tailzu is only a
hand-off: Tailzu opens a written email in Gmail and the person presses Send.
It uses no Gmail API and no Gmail scope, so nothing about Gmail is in this
review.

If Tailzu ever reads mail or writes drafts through the Gmail API, the scopes it
would need are **restricted**: `gmail.readonly`, `gmail.compose` and
`gmail.modify`. Restricted scopes mean:
- a separate restricted-scope review, which Google says takes "several weeks" (its FAQ says about 6);
- **plus a security assessment** by an independent assessor that Google approves (the CASA framework);
- the assessment is renewed every 12 months, and you should budget for it.

The one exception is `gmail.send` (send only). It is sensitive, not restricted,
so it could be added in a review like this one.

---

### Sources (read 2026-10-22)

- Sensitive scope verification:
  https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- Verification requirements:
  https://support.google.com/cloud/answer/13464321
- Submitting for verification:
  https://support.google.com/cloud/answer/13461325
- FAQ (review times, 100-user cap):
  https://support.google.com/cloud/answer/13463817
- Demo video:
  https://support.google.com/cloud/answer/13804565
- Unverified apps:
  https://support.google.com/cloud/answer/7454865
- Restricted scope verification:
  https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- Overview:
  https://support.google.com/cloud/answer/13463073 and https://support.google.com/cloud/answer/9110914
- User Data Policy:
  https://developers.google.com/terms/api-services-user-data-policy
- Workspace API User Data Policy (in-app disclosure, AI models):
  https://developers.google.com/workspace/workspace-api-user-data-developer-policy
- Calendar scopes and the method pages (events.list, get, insert, patch and delete):
  https://developers.google.com/workspace/calendar/api/auth
- OpenRouter provider routing (`data_collection`, `zdr`):
  https://openrouter.ai/docs/features/provider-routing
- Gmail scopes:
  https://developers.google.com/workspace/gmail/api/auth/scopes
- Tasks scopes:
  https://developers.google.com/workspace/tasks/auth
