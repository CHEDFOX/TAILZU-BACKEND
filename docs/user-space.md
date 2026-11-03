# Your space

What a person's bots know about them, in one place, in sections. Only they see it. Code: `tulmi/src/you/space.ts`,
`spaceFile.ts`, `spaceMarks.ts`; routes `tulmi/src/routes/bots/botsYouSpace.ts`; screens `screens/you/space.ts`
(You › Your space, and Privacy › See what they know).

## Sections

| Section | Lines bots learned | Beside them |
|---|---|---|
| About you | who they are, languages | the account's name and gender (changed in place) |
| Your day | routine, times | the next two days of their calendar, open to-dos |
| People | family, friends, colleagues | their groups and who is in them |
| Places | where they live, are from | Plan Ease's home, their trips |
| Likes | food, music, how they like replies | |
| Money | money lines | (kept by the one bot told; never shared, never written by hand) |
| Work | job, studies | their Xode projects |
| Bots | | each bot and how many things it knows |
| Files & notes | | their notes |
| Timeline | every line, newest first, by day | |

## How it works

- **Nothing is copied.** The lines are the facts bots already keep (`bot_facts`: each bot's own and the shared `_you`).
  Deleting their data or account clears the space as before. No migration.
- **Filed by rules, not a model.** The first rule that fits: money, people, work, your day, places, likes, else About you.
  Free and the same every time.
- **One line, many bots.** The same words kept by three bots are one line, and the line shows which bots keep it.
- **What they change** is kept with their settings (`you_settings.privacy.space`):
  - sections switched off;
  - pinned lines (up to 40);
  - lines moved to another section.

## What a person can do

- **Pin a line.** Every bot is shown it first.
- **Move a line** to another section.
- **Reword a line.** Every copy changes, and the line keeps its pin and section.
- **Forget a line.** Every bot that kept it forgets it.
- **Switch a section off.** Its lines stay in the space, but no bot is shown them, not even the bot that learned them.
- **Write a line.** It is kept for all their bots. Never allowed:
  - health, religion, politics or money;
  - secrets;
  - instructions to a bot.

## What bots read

- `sharedFacts` (every bot, Ask, Xode): leaves out lines in a switched-off section and lines moved to Money, and puts
  pinned lines first.
- `usableForBots` (a bot's own memory): leaves out lines in a switched-off section; a pinned line counts as the newest.
- Both read the settings once, in the same 30-second cache as the "Use what you've told your bots" switch.
